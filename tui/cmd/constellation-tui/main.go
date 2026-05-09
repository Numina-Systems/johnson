package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"constellation-tui/internal/protocol"
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

	client.Close()

	if err := backendCmd.Wait(); err != nil {
		fmt.Fprintf(os.Stderr, "backend exited: %v\n", err)
	}
}
