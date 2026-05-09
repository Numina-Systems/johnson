// pattern: Imperative Shell (test)
package protocol

import (
	"encoding/json"
	"testing"
)

func TestSessionRowMarshal(t *testing.T) {
	tests := []struct {
		name    string
		row     SessionRow
		wantKey map[string]bool
	}{
		{
			name: "all fields populated",
			row: SessionRow{
				ID:           "session123",
				Title:        stringPtr("My Session"),
				UpdatedAt:    "2026-05-09T12:00:00Z",
				MessageCount: 42,
			},
			wantKey: map[string]bool{
				"id":           true,
				"title":        true,
				"updatedAt":    true,
				"messageCount": true,
			},
		},
		{
			name: "nil title",
			row: SessionRow{
				ID:           "session456",
				Title:        nil,
				UpdatedAt:    "2026-05-09T12:00:00Z",
				MessageCount: 0,
			},
			wantKey: map[string]bool{
				"id":           true,
				"title":        true,
				"updatedAt":    true,
				"messageCount": true,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.row)
			if err != nil {
				t.Fatalf("json.Marshal() failed: %v", err)
			}

			var unmarshalled map[string]interface{}
			if err := json.Unmarshal(data, &unmarshalled); err != nil {
				t.Fatalf("json.Unmarshal() failed: %v", err)
			}

			for key := range tt.wantKey {
				if _, exists := unmarshalled[key]; !exists {
					t.Errorf("SessionRow marshal missing key: %q", key)
				}
			}
		})
	}
}

func TestReadyParamsUnmarshal(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		want    ReadyParams
		wantErr bool
	}{
		{
			name: "valid ready params",
			json: `{"protocolVersion":"1","capabilities":["chat","tools"]}`,
			want: ReadyParams{
				ProtocolVersion: "1",
				Capabilities:    []string{"chat", "tools"},
			},
			wantErr: false,
		},
		{
			name: "empty capabilities",
			json: `{"protocolVersion":"1","capabilities":[]}`,
			want: ReadyParams{
				ProtocolVersion: "1",
				Capabilities:    []string{},
			},
			wantErr: false,
		},
		{
			name: "invalid json",
			json: `{invalid}`,
			want: ReadyParams{},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var params ReadyParams
			err := json.Unmarshal([]byte(tt.json), &params)
			if (err != nil) != tt.wantErr {
				t.Fatalf("json.Unmarshal() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err == nil {
				if params.ProtocolVersion != tt.want.ProtocolVersion {
					t.Errorf("ProtocolVersion: got %q, want %q", params.ProtocolVersion, tt.want.ProtocolVersion)
				}
				if len(params.Capabilities) != len(tt.want.Capabilities) {
					t.Errorf("Capabilities length: got %d, want %d", len(params.Capabilities), len(tt.want.Capabilities))
				}
			}
		})
	}
}

func TestAgentChatParamsMarshal(t *testing.T) {
	tests := []struct {
		name      string
		params    AgentChatParams
		wantError bool
	}{
		{
			name: "normal chat params",
			params: AgentChatParams{
				Message:   "Hello, agent!",
				SessionID: "session-abc123",
			},
			wantError: false,
		},
		{
			name: "empty message",
			params: AgentChatParams{
				Message:   "",
				SessionID: "session-xyz",
			},
			wantError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.params)
			if err != nil {
				t.Fatalf("json.Marshal() failed: %v", err)
			}

			// Unmarshal back to verify correctness
			var unmarshalled AgentChatParams
			if err := json.Unmarshal(data, &unmarshalled); err != nil {
				t.Fatalf("json.Unmarshal() failed: %v", err)
			}

			if unmarshalled.Message != tt.params.Message {
				t.Errorf("Message: got %q, want %q", unmarshalled.Message, tt.params.Message)
			}
			if unmarshalled.SessionID != tt.params.SessionID {
				t.Errorf("SessionID: got %q, want %q", unmarshalled.SessionID, tt.params.SessionID)
			}
		})
	}
}

func TestOmitEmptyFields(t *testing.T) {
	tests := []struct {
		name    string
		input   interface{}
		checkFn func(*testing.T, map[string]interface{})
	}{
		{
			name: "SessionListParams with zero values",
			input: SessionListParams{
				Limit:  0,
				Cursor: "",
			},
			checkFn: func(t *testing.T, m map[string]interface{}) {
				// Fields with omitempty should not appear when zero
				if _, hasLimit := m["limit"]; hasLimit {
					t.Error("limit should be omitted when 0")
				}
				if _, hasCursor := m["cursor"]; hasCursor {
					t.Error("cursor should be omitted when empty")
				}
			},
		},
		{
			name: "SessionListParams with values",
			input: SessionListParams{
				Limit:  10,
				Cursor: "abc123",
			},
			checkFn: func(t *testing.T, m map[string]interface{}) {
				if _, hasLimit := m["limit"]; !hasLimit {
					t.Error("limit should be present when set")
				}
				if _, hasCursor := m["cursor"]; !hasCursor {
					t.Error("cursor should be present when set")
				}
			},
		},
		{
			name: "SessionCreateParams with empty title",
			input: SessionCreateParams{
				Title: "",
			},
			checkFn: func(t *testing.T, m map[string]interface{}) {
				// title has omitempty, so empty string should be omitted
				if _, hasTitle := m["title"]; hasTitle {
					t.Error("title should be omitted when empty")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.input)
			if err != nil {
				t.Fatalf("json.Marshal() failed: %v", err)
			}

			var m map[string]interface{}
			if err := json.Unmarshal(data, &m); err != nil {
				t.Fatalf("json.Unmarshal() failed: %v", err)
			}

			tt.checkFn(t, m)
		})
	}
}

func TestChatStatsStructure(t *testing.T) {
	stats := ChatStats{
		InputTokens:     100,
		OutputTokens:    50,
		ContextEstimate: 1500,
		ContextLimit:    4000,
		Rounds:          3,
		DurationMs:      2500,
	}

	data, err := json.Marshal(stats)
	if err != nil {
		t.Fatalf("json.Marshal() failed: %v", err)
	}

	var unmarshalled ChatStats
	if err := json.Unmarshal(data, &unmarshalled); err != nil {
		t.Fatalf("json.Unmarshal() failed: %v", err)
	}

	if unmarshalled.InputTokens != stats.InputTokens {
		t.Errorf("InputTokens: got %d, want %d", unmarshalled.InputTokens, stats.InputTokens)
	}
	if unmarshalled.OutputTokens != stats.OutputTokens {
		t.Errorf("OutputTokens: got %d, want %d", unmarshalled.OutputTokens, stats.OutputTokens)
	}
	if unmarshalled.ContextEstimate != stats.ContextEstimate {
		t.Errorf("ContextEstimate: got %d, want %d", unmarshalled.ContextEstimate, stats.ContextEstimate)
	}
	if unmarshalled.ContextLimit != stats.ContextLimit {
		t.Errorf("ContextLimit: got %d, want %d", unmarshalled.ContextLimit, stats.ContextLimit)
	}
	if unmarshalled.Rounds != stats.Rounds {
		t.Errorf("Rounds: got %d, want %d", unmarshalled.Rounds, stats.Rounds)
	}
	if unmarshalled.DurationMs != stats.DurationMs {
		t.Errorf("DurationMs: got %d, want %d", unmarshalled.DurationMs, stats.DurationMs)
	}
}

func TestTaskStateInfoOptionalFields(t *testing.T) {
	tests := []struct {
		name    string
		task    TaskStateInfo
		checkFn func(*testing.T, map[string]interface{})
	}{
		{
			name: "minimal task (omitempty fields empty)",
			task: TaskStateInfo{
				ID:        "task-1",
				Name:      "My Task",
				Prompt:    "Do something",
				Schedule:  "0 9 * * *",
				DeliverTo: "",
				Trigger:   "",
				Skill:     "",
				CreatedAt: "2026-05-09T00:00:00Z",
				Enabled:   true,
				LastRun:   nil,
				RunCount:  0,
			},
			checkFn: func(t *testing.T, m map[string]interface{}) {
				// Check that omitempty fields are absent
				if _, has := m["deliverTo"]; has {
					t.Error("deliverTo should be omitted when empty")
				}
				if _, has := m["trigger"]; has {
					t.Error("trigger should be omitted when empty")
				}
				if _, has := m["skill"]; has {
					t.Error("skill should be omitted when empty")
				}
				if _, has := m["lastRun"]; has {
					t.Error("lastRun should be omitted when nil")
				}
			},
		},
		{
			name: "full task with all fields",
			task: TaskStateInfo{
				ID:        "task-2",
				Name:      "Full Task",
				Prompt:    "Do something",
				Schedule:  "0 9 * * *",
				DeliverTo: "discord",
				Trigger:   "some code",
				Skill:     "my-skill",
				CreatedAt: "2026-05-09T00:00:00Z",
				Enabled:   true,
				LastRun: &TaskRunInfo{
					TaskID:     "task-2",
					StartedAt:  "2026-05-09T09:00:00Z",
					Output:     "done",
					Success:    true,
					DurationMs: 1000,
				},
				RunCount: 5,
			},
			checkFn: func(t *testing.T, m map[string]interface{}) {
				// Check that fields are present
				if _, has := m["deliverTo"]; !has {
					t.Error("deliverTo should be present when set")
				}
				if _, has := m["trigger"]; !has {
					t.Error("trigger should be present when set")
				}
				if _, has := m["skill"]; !has {
					t.Error("skill should be present when set")
				}
				if _, has := m["lastRun"]; !has {
					t.Error("lastRun should be present when set")
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, err := json.Marshal(tt.task)
			if err != nil {
				t.Fatalf("json.Marshal() failed: %v", err)
			}

			var m map[string]interface{}
			if err := json.Unmarshal(data, &m); err != nil {
				t.Fatalf("json.Unmarshal() failed: %v", err)
			}

			tt.checkFn(t, m)
		})
	}
}

// Helper function
func stringPtr(s string) *string {
	return &s
}
