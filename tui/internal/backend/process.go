// pattern: Imperative Shell
package backend

import (
	"context"
	"io"
	"os"
	"os/exec"
	"syscall"
	"time"
)

type BackendProcess struct {
	cmd         *exec.Cmd
	cancel      context.CancelFunc
	withDiscord bool
	workDir     string
	exited      chan error
	done        chan struct{}
}

func NewBackendProcess(workDir string, withDiscord bool) *BackendProcess {
	return &BackendProcess{
		workDir:     workDir,
		withDiscord: withDiscord,
		exited:      make(chan error, 1),
		done:        make(chan struct{}),
	}
}

func (b *BackendProcess) Start(ctx context.Context) (io.ReadCloser, io.WriteCloser, error) {
	// Create a child context with cancel for lifecycle management
	childCtx, cancel := context.WithCancel(ctx)
	b.cancel = cancel

	// Build interface flag
	interfaceMode := "jsonrpc"
	if b.withDiscord {
		interfaceMode = "both"
	}

	// Create the command
	b.cmd = exec.CommandContext(childCtx, "bun", "run", "src/index.ts", "--interface", interfaceMode)
	b.cmd.Dir = b.workDir

	// Create pipes for stdin/stdout (JSON-RPC transport)
	stdin, err := b.cmd.StdinPipe()
	if err != nil {
		return nil, nil, err
	}

	stdout, err := b.cmd.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}

	// Pipe stderr to process stderr
	b.cmd.Stderr = os.Stderr

	// Start the process
	if err := b.cmd.Start(); err != nil {
		return nil, nil, err
	}

	// Launch goroutine that waits for process exit
	go func() {
		err := b.cmd.Wait()
		b.exited <- err
		close(b.done)
	}()

	return stdout, stdin, nil
}

func (b *BackendProcess) Shutdown(timeout time.Duration) error {
	if b.cmd == nil || b.cmd.Process == nil {
		return nil
	}

	// Send SIGTERM
	_ = b.cmd.Process.Signal(syscall.SIGTERM) // error OK if process already exited

	// Wait for graceful exit with timeout
	select {
	case err := <-b.exited:
		return err
	case <-time.After(timeout):
		// Force kill if it doesn't exit in time
		b.cmd.Process.Kill()
		return <-b.exited
	}
}

func (b *BackendProcess) WaitExit() <-chan error {
	return b.exited
}

func (b *BackendProcess) Done() <-chan struct{} {
	return b.done
}

func (b *BackendProcess) Restart(ctx context.Context) (io.ReadCloser, io.WriteCloser, error) {
	// Kill old process if still running
	if b.cmd != nil && b.cmd.Process != nil {
		b.cmd.Process.Kill()
		<-b.exited  // wait for actual exit
	}

	// Cancel old context
	if b.cancel != nil {
		b.cancel()
	}

	// Create new exit and done channels for the new process
	b.exited = make(chan error, 1)
	b.done = make(chan struct{})

	// Start new process
	return b.Start(ctx)
}
