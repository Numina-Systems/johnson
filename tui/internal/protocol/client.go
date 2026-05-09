package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"

	"github.com/sourcegraph/jsonrpc2"
)

type Client struct {
	conn  *jsonrpc2.Conn
	mu    sync.Mutex
	ready chan ReadyParams
}

func NewClient(ctx context.Context, stdout io.ReadCloser, stdin io.WriteCloser) (*Client, error) {
	c := &Client{
		ready: make(chan ReadyParams, 1),
	}

	stream := newObjectStream(stdout, stdin)
	c.conn = jsonrpc2.NewConn(ctx, stream, c)

	return c, nil
}

func (c *Client) Handle(ctx context.Context, conn *jsonrpc2.Conn, req *jsonrpc2.Request) {
	if req.Notif {
		switch req.Method {
		case "ready":
			var params ReadyParams
			if req.Params != nil {
				if err := json.Unmarshal(*req.Params, &params); err != nil {
					fmt.Fprintf(io.Discard, "failed to unmarshal ready params: %v\n", err)
					return
				}
			}
			select {
			case c.ready <- params:
			default:
			}
		}
	}
}

func (c *Client) WaitReady(ctx context.Context) (ReadyParams, error) {
	select {
	case params := <-c.ready:
		return params, nil
	case <-ctx.Done():
		return ReadyParams{}, fmt.Errorf("context cancelled waiting for ready: %w", ctx.Err())
	}
}

func (c *Client) Call(ctx context.Context, method string, params any, result any) error {
	return c.conn.Call(ctx, method, params, result)
}

func (c *Client) Close() {
	c.conn.Close()
}
