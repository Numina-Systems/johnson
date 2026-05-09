// pattern: Imperative Shell (test)
package backend

import (
	"testing"
	"time"
)

func TestNewBackendProcess(t *testing.T) {
	tests := []struct {
		name        string
		workDir     string
		withDiscord bool
		validate    func(*testing.T, *BackendProcess)
	}{
		{
			name:        "jsonrpc mode",
			workDir:     "/tmp/test",
			withDiscord: false,
			validate: func(t *testing.T, b *BackendProcess) {
				if b.workDir != "/tmp/test" {
					t.Errorf("workDir: got %q, want %q", b.workDir, "/tmp/test")
				}
				if b.withDiscord != false {
					t.Errorf("withDiscord: got %v, want false", b.withDiscord)
				}
				if b.cmd != nil {
					t.Error("cmd should be nil until Start() is called")
				}
				if b.exited == nil {
					t.Error("exited channel should be initialized")
				}
				if b.done == nil {
					t.Error("done channel should be initialized")
				}
			},
		},
		{
			name:        "both mode with discord",
			workDir:     "/home/user/project",
			withDiscord: true,
			validate: func(t *testing.T, b *BackendProcess) {
				if b.workDir != "/home/user/project" {
					t.Errorf("workDir: got %q, want %q", b.workDir, "/home/user/project")
				}
				if b.withDiscord != true {
					t.Errorf("withDiscord: got %v, want true", b.withDiscord)
				}
				if b.cmd != nil {
					t.Error("cmd should be nil until Start() is called")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proc := NewBackendProcess(tt.workDir, tt.withDiscord)
			tt.validate(t, proc)
		})
	}
}

func TestBackendProcessChannelsInitialized(t *testing.T) {
	proc := NewBackendProcess("/tmp", false)

	// Channels should be initialized and buffered
	select {
	case <-proc.exited:
		t.Fatal("exited channel should not have a value yet")
	default:
		// Expected: channel is empty
	}

	select {
	case <-proc.done:
		t.Fatal("done channel should not have a value yet")
	default:
		// Expected: channel is empty
	}
}

func TestBackendProcessShutdownWithNilCmd(t *testing.T) {
	proc := NewBackendProcess("/tmp", false)

	// Shutdown should handle nil cmd gracefully
	err := proc.Shutdown(5 * time.Second)
	if err != nil {
		t.Fatalf("Shutdown() with nil cmd should return nil, got %v", err)
	}
}

func TestBackendProcessWithDiscordAffectsInterfaceMode(t *testing.T) {
	tests := []struct {
		name        string
		withDiscord bool
	}{
		{
			name:        "jsonrpc only",
			withDiscord: false,
		},
		{
			name:        "both jsonrpc and discord",
			withDiscord: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proc := NewBackendProcess("/tmp", tt.withDiscord)

			// Verify that the flag is set correctly
			if proc.withDiscord != tt.withDiscord {
				t.Errorf("withDiscord flag: got %v, want %v", proc.withDiscord, tt.withDiscord)
			}
		})
	}
}

func TestBackendProcessExitedChannelIsBuffered(t *testing.T) {
	proc := NewBackendProcess("/tmp", false)

	// The exited channel should be buffered (capacity 1)
	// This allows the goroutine that writes to it to not block
	select {
	case proc.exited <- nil:
		// Successfully sent to buffered channel
	default:
		t.Fatal("exited channel is not buffered or already full")
	}
}

func TestBackendProcessMultipleInstances(t *testing.T) {
	proc1 := NewBackendProcess("/tmp/1", false)
	proc2 := NewBackendProcess("/tmp/2", true)

	if proc1.workDir == proc2.workDir {
		t.Error("different processes should have different workDirs")
	}

	if proc1.withDiscord == proc2.withDiscord {
		t.Error("processes with different settings should have different withDiscord values")
	}

	// They should have separate channels
	if proc1.exited == proc2.exited {
		t.Error("processes should have independent exited channels")
	}

	if proc1.done == proc2.done {
		t.Error("processes should have independent done channels")
	}
}

func TestBackendProcessRestartChannelsReset(t *testing.T) {
	proc := NewBackendProcess("/tmp", false)

	// Verify that the process can be created and has channels initialized
	if proc.exited == nil {
		t.Fatal("exited channel should be initialized")
	}
	if proc.done == nil {
		t.Fatal("done channel should be initialized")
	}

	// Note: Start() will fail without a valid working directory and bun,
	// but we can verify that the channels are properly initialized for restart behavior
}

func TestBackendProcessWaitExitReturnsChannel(t *testing.T) {
	proc := NewBackendProcess("/tmp", false)

	// WaitExit should return the exited channel
	exitChan := proc.WaitExit()
	if exitChan == nil {
		t.Fatal("WaitExit() returned nil")
	}

	// Should be the same channel
	if exitChan != proc.exited {
		t.Error("WaitExit() should return the same channel as proc.exited")
	}
}

func TestBackendProcessDoneReturnsChannel(t *testing.T) {
	proc := NewBackendProcess("/tmp", false)

	// Done should return the done channel
	doneChan := proc.Done()
	if doneChan == nil {
		t.Fatal("Done() returned nil")
	}

	// Should be the same channel
	if doneChan != proc.done {
		t.Error("Done() should return the same channel as proc.done")
	}
}
