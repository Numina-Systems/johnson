// pattern: Imperative Shell
package main

import (
	"constellation-tui/internal/app"
	"constellation-tui/internal/backend"
	"constellation-tui/internal/protocol"
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	tea "charm.land/bubbletea/v2"
)

func main() {
	withDiscord := flag.Bool("with-discord", false, "Start Discord bot alongside TUI")
	flag.Parse()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	proc := backend.NewBackendProcess("..", *withDiscord)
	stdout, stdin, err := proc.Start(ctx)
	if err != nil {
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
		fmt.Fprintf(os.Stderr, "failed to receive ready: %v\n", err)
		os.Exit(1)
	}

	// Protocol version check
	if ready.ProtocolVersion != "1" {
		fmt.Fprintf(os.Stderr, "unsupported protocol version: %s (expected 1)\n", ready.ProtocolVersion)
		proc.Shutdown(5 * time.Second)
		os.Exit(1)
	}

	// Create initial session
	var initialSessionID string
	var createResult protocol.SessionCreateResult
	err = client.Call(context.Background(), "session/create", protocol.SessionCreateParams{}, &createResult)
	if err != nil {
		fmt.Fprintf(os.Stderr, "warning: failed to create initial session, falling back to session list: %v\n", err)
	} else {
		initialSessionID = createResult.ID
	}

	appModel := app.NewAppModel(client, proc, initialSessionID)
	p := tea.NewProgram(appModel)

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "TUI error: %v\n", err)
	}

	// Clean shutdown
	client.Close()
	if err := proc.Shutdown(5 * time.Second); err != nil {
		fmt.Fprintf(os.Stderr, "backend shutdown: %v\n", err)
	}
}
