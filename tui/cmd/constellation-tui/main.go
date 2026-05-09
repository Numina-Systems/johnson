package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"constellation-tui/internal/app"
	"constellation-tui/internal/protocol"
	tea "charm.land/bubbletea/v2"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	backendCmd := exec.CommandContext(ctx, "bun", "run", "src/index.ts", "--interface", "jsonrpc")
	backendCmd.Dir = ".."
	backendCmd.Stderr = os.Stderr

	stdin, err := backendCmd.StdinPipe()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create stdin pipe: %v\n", err)
		os.Exit(1)
	}

	stdout, err := backendCmd.StdoutPipe()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create stdout pipe: %v\n", err)
		os.Exit(1)
	}

	if err := backendCmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to start backend: %v\n", err)
		os.Exit(1)
	}

	client, err := protocol.NewClient(ctx, stdout, stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create protocol client: %v\n", err)
		os.Exit(1)
	}

	ready, err := client.WaitReady(ctx)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to receive ready notification: %v\n", err)
		os.Exit(1)
	}

	fmt.Fprintf(os.Stderr, "backend ready: protocol v%s, capabilities: %v\n",
		ready.ProtocolVersion, ready.Capabilities)

	// Create and run the TUI
	appModel := app.NewAppModel(client)
	p := tea.NewProgram(appModel)

	result, err := p.Run()
	if err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %v\n", err)
		os.Exit(1)
	}

	if result != nil {
		fmt.Fprintf(os.Stderr, "TUI exited\n")
	}

	// Gracefully shut down the backend
	client.Close()

	backendCmd.Process.Signal(syscall.SIGTERM)

	// Wait with timeout
	done := make(chan error, 1)
	go func() { done <- backendCmd.Wait() }()

	select {
	case <-done:
		// Process exited cleanly
	case <-time.After(5 * time.Second):
		// Force kill if it doesn't exit in time
		backendCmd.Process.Kill()
		<-done
	}
}
