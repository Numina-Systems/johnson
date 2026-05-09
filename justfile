# Default recipe
default: build

# Build everything
build: build-ts build-go

# Build TypeScript backend
build-ts:
	bun run build

# Build Go TUI
build-go:
	cd tui && go build -o ../bin/constellation-tui ./cmd/constellation-tui/

# Run tests
test: test-ts test-go

# Test TypeScript
test-ts:
	bun test

# Test Go
test-go:
	cd tui && go test ./...

# Run TUI (dev mode — no build)
dev:
	cd tui && go run ./cmd/constellation-tui/

# Run TUI with Discord
dev-discord:
	cd tui && go run ./cmd/constellation-tui/ --with-discord

# Run Discord only (no TUI)
discord:
	bun run src/index.ts --interface discord

# Clean build artifacts
clean:
	rm -rf dist bin
	cd tui && go clean

# Format Go code
fmt:
	cd tui && gofmt -w .
