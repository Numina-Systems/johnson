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
	conn            *jsonrpc2.Conn
	mu              sync.Mutex
	ready           chan ReadyParams
	onAgentEvent    func(AgentEventParams)
	onAgentResponse func(AgentResponseParams)
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
		case "agent/event":
			var params AgentEventParams
			if req.Params != nil {
				if err := json.Unmarshal(*req.Params, &params); err != nil {
					fmt.Fprintf(io.Discard, "failed to unmarshal agent/event params: %v\n", err)
					return
				}
			}
			c.mu.Lock()
			fn := c.onAgentEvent
			c.mu.Unlock()
			if fn != nil {
				fn(params)
			}
		case "agent/response":
			var params AgentResponseParams
			if req.Params != nil {
				if err := json.Unmarshal(*req.Params, &params); err != nil {
					fmt.Fprintf(io.Discard, "failed to unmarshal agent/response params: %v\n", err)
					return
				}
			}
			c.mu.Lock()
			fn := c.onAgentResponse
			c.mu.Unlock()
			if fn != nil {
				fn(params)
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

func (c *Client) SetOnAgentEvent(fn func(AgentEventParams)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onAgentEvent = fn
}

func (c *Client) SetOnAgentResponse(fn func(AgentResponseParams)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onAgentResponse = fn
}

func (c *Client) Chat(ctx context.Context, message string, sessionID string) (AgentChatResult, error) {
	var result AgentChatResult
	err := c.Call(ctx, "agent/chat", AgentChatParams{
		Message:   message,
		SessionID: sessionID,
	}, &result)
	return result, err
}

func (c *Client) Reset(ctx context.Context) error {
	var result struct{ OK bool `json:"ok"` }
	return c.Call(ctx, "agent/reset", struct{}{}, &result)
}

func (c *Client) Call(ctx context.Context, method string, params any, result any) error {
	return c.conn.Call(ctx, method, params, result)
}

func (c *Client) Close() {
	c.conn.Close()
}
