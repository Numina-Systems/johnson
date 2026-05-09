package protocol

type ReadyParams struct {
	ProtocolVersion string   `json:"protocolVersion"`
	Capabilities    []string `json:"capabilities"`
}

type SessionListParams struct {
	Limit  int    `json:"limit,omitempty"`
	Cursor string `json:"cursor,omitempty"`
}

type SessionRow struct {
	ID           string  `json:"id"`
	Title        *string `json:"title"`
	UpdatedAt    string  `json:"updatedAt"`
	MessageCount int     `json:"messageCount"`
}

type SessionListResult struct {
	Sessions []SessionRow `json:"sessions"`
	Cursor   string       `json:"cursor,omitempty"`
}

type SessionCreateParams struct {
	Title string `json:"title,omitempty"`
}

type SessionCreateResult struct {
	ID string `json:"id"`
}

type SessionDeleteParams struct {
	ID string `json:"id"`
}

type SessionDeleteResult struct {
	OK bool `json:"ok"`
}

type SessionMessagesParams struct {
	SessionID string `json:"sessionId"`
	Limit     int    `json:"limit,omitempty"`
	Cursor    string `json:"cursor,omitempty"`
}

type MessageRow struct {
	ID        int    `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
}

type SessionMessagesResult struct {
	Messages []MessageRow `json:"messages"`
	Cursor   string       `json:"cursor,omitempty"`
}

type AgentChatParams struct {
	Message   string `json:"message"`
	SessionID string `json:"sessionId"`
}

type AgentChatResult struct {
	RequestID string `json:"requestId"`
}

type AgentEventParams struct {
	RequestID string                 `json:"requestId"`
	Kind      string                 `json:"kind"`
	Data      map[string]interface{} `json:"data"`
}

type AgentResponseParams struct {
	RequestID string    `json:"requestId"`
	Text      string    `json:"text"`
	Stats     ChatStats `json:"stats"`
}

type ChatStats struct {
	InputTokens     int `json:"inputTokens"`
	OutputTokens    int `json:"outputTokens"`
	ContextEstimate int `json:"contextEstimate"`
	ContextLimit    int `json:"contextLimit"`
	Rounds          int `json:"rounds"`
	DurationMs      int `json:"durationMs"`
}

// Skills
type SkillInfo struct {
	Rkey        string   `json:"rkey"`
	Description *string  `json:"description"`
	GrantStatus *string  `json:"grantStatus"`
	Secrets     []string `json:"secrets"`
}

type SkillListResult struct {
	Skills []SkillInfo `json:"skills"`
}

type SkillGrantParams struct {
	Rkey   string `json:"rkey"`
	Status string `json:"status"`
}

type SkillUpdateSecretsParams struct {
	Rkey    string   `json:"rkey"`
	Secrets []string `json:"secrets"`
}

type SkillDeleteParams struct {
	Rkey string `json:"rkey"`
}

// Custom Tools
type CustomToolInfo struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Approved    bool     `json:"approved"`
	CodeHash    string   `json:"codeHash"`
	Secrets     []string `json:"secrets"`
}

type CustomToolListResult struct {
	Tools []CustomToolInfo `json:"tools"`
}

type CustomToolApproveParams struct {
	Name string `json:"name"`
}

type CustomToolRevokeParams struct {
	Name string `json:"name"`
}

type CustomToolUpdateSecretsParams struct {
	Name    string   `json:"name"`
	Secrets []string `json:"secrets"`
}

// Grants
type GrantInfo struct {
	SkillName string   `json:"skillName"`
	CodeHash  string   `json:"codeHash"`
	Status    string   `json:"status"`
	Secrets   []string `json:"secrets"`
	CreatedAt string   `json:"createdAt"`
	UpdatedAt string   `json:"updatedAt"`
}

type GrantListResult struct {
	Grants []GrantInfo `json:"grants"`
}

// Generic OK response
type OkResult struct {
	OK bool `json:"ok"`
}

// Builtins
type BuiltinToolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type BuiltinListResult struct {
	Tools []BuiltinToolInfo `json:"tools"`
}

// Secrets
type SecretListResult struct {
	Keys []string `json:"keys"`
}

type SecretSetParams struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type SecretRemoveParams struct {
	Key string `json:"key"`
}

// Schedules
type TaskRunInfo struct {
	TaskID     string `json:"taskId"`
	StartedAt  string `json:"startedAt"`
	Output     string `json:"output"`
	Success    bool   `json:"success"`
	DurationMs int    `json:"durationMs"`
}

type TaskStateInfo struct {
	ID        string       `json:"id"`
	Name      string       `json:"name"`
	Prompt    string       `json:"prompt"`
	Schedule  string       `json:"schedule"`
	DeliverTo string       `json:"deliverTo,omitempty"`
	Trigger   string       `json:"trigger,omitempty"`
	Skill     string       `json:"skill,omitempty"`
	CreatedAt string       `json:"createdAt"`
	Enabled   bool         `json:"enabled"`
	LastRun   *TaskRunInfo `json:"lastRun,omitempty"`
	RunCount  int          `json:"runCount"`
}

type ScheduleListResult struct {
	Tasks []TaskStateInfo `json:"tasks"`
}

type ScheduleSetEnabledParams struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

// Prompt
type PromptGetResult struct {
	Prompt string `json:"prompt"`
}
