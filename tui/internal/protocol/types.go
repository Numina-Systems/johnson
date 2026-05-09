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
