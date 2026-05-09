// pattern: Imperative Shell
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

func (c *Client) ListSkills(ctx context.Context) (SkillListResult, error) {
	var result SkillListResult
	err := c.Call(ctx, "skill/list", struct{}{}, &result)
	return result, err
}

func (c *Client) GrantSkill(ctx context.Context, rkey string, status string) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "skill/grant", SkillGrantParams{
		Rkey:   rkey,
		Status: status,
	}, &result)
	return result, err
}

func (c *Client) UpdateSkillSecrets(ctx context.Context, rkey string, secrets []string) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "skill/updateSecrets", SkillUpdateSecretsParams{
		Rkey:    rkey,
		Secrets: secrets,
	}, &result)
	return result, err
}

func (c *Client) DeleteSkill(ctx context.Context, rkey string) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "skill/delete", SkillDeleteParams{
		Rkey: rkey,
	}, &result)
	return result, err
}

func (c *Client) ListCustomTools(ctx context.Context) (CustomToolListResult, error) {
	var result CustomToolListResult
	err := c.Call(ctx, "customTool/list", struct{}{}, &result)
	return result, err
}

func (c *Client) ApproveCustomTool(ctx context.Context, name string) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "customTool/approve", CustomToolApproveParams{
		Name: name,
	}, &result)
	return result, err
}

func (c *Client) RevokeCustomTool(ctx context.Context, name string) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "customTool/revoke", CustomToolRevokeParams{
		Name: name,
	}, &result)
	return result, err
}

func (c *Client) UpdateCustomToolSecrets(ctx context.Context, name string, secrets []string) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "customTool/updateSecrets", CustomToolUpdateSecretsParams{
		Name:    name,
		Secrets: secrets,
	}, &result)
	return result, err
}

func (c *Client) ListGrants(ctx context.Context) (GrantListResult, error) {
	var result GrantListResult
	err := c.Call(ctx, "grant/list", struct{}{}, &result)
	return result, err
}

func (c *Client) ListBuiltins(ctx context.Context) (BuiltinListResult, error) {
	var result BuiltinListResult
	err := c.Call(ctx, "builtin/list", struct{}{}, &result)
	return result, err
}

func (c *Client) ListSecrets(ctx context.Context) (SecretListResult, error) {
	var result SecretListResult
	err := c.Call(ctx, "secret/list", struct{}{}, &result)
	return result, err
}

func (c *Client) SetSecret(ctx context.Context, key string, value string) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "secret/set", SecretSetParams{
		Key:   key,
		Value: value,
	}, &result)
	return result, err
}

func (c *Client) RemoveSecret(ctx context.Context, key string) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "secret/remove", SecretRemoveParams{
		Key: key,
	}, &result)
	return result, err
}

func (c *Client) ListSchedules(ctx context.Context) (ScheduleListResult, error) {
	var result ScheduleListResult
	err := c.Call(ctx, "schedule/list", struct{}{}, &result)
	return result, err
}

func (c *Client) SetScheduleEnabled(ctx context.Context, id string, enabled bool) (OkResult, error) {
	var result OkResult
	err := c.Call(ctx, "schedule/setEnabled", ScheduleSetEnabledParams{
		ID:      id,
		Enabled: enabled,
	}, &result)
	return result, err
}

func (c *Client) GetPrompt(ctx context.Context) (PromptGetResult, error) {
	var result PromptGetResult
	err := c.Call(ctx, "prompt/get", struct{}{}, &result)
	return result, err
}

func (c *Client) Call(ctx context.Context, method string, params any, result any) error {
	return c.conn.Call(ctx, method, params, result)
}

func (c *Client) Close() {
	c.conn.Close()
}
