# Discord Voice Channel Design

## Summary

Add voice channel support to the Discord bot. The agent joins a voice channel, listens to users via streaming speech-to-text (Deepgram), feeds transcriptions through the existing `agent.chat()` loop, and speaks responses back via streaming text-to-speech (Cartesia). Voice is a new I/O adapter — no changes to agent internals are needed. The same shared agent, tool registry, compaction, and recall systems work as-is; voice just replaces the text message event with an audio pipeline.

## Motivation

The agent currently only interacts via text in Discord channels and DMs. Voice support would allow hands-free, real-time conversation in voice channels — useful for collaborative sessions, quick queries while doing other things, and general novelty value.

## Architecture

### Data Flow

```
Discord Voice Channel
    │ (per-user Opus streams)
    ▼
Receiver (decode Opus → PCM, VAD)
    │ (speech segments)
    ▼
STT Provider (Deepgram streaming)
    │ (transcription text)
    ▼
agent.chat()  ← same loop as text messages
    │ (ChatResult.text)
    ▼
TTS Provider (Cartesia streaming)
    │ (PCM audio chunks)
    ▼
Sender (encode → AudioPlayer → Discord)
```

### New Modules

```
src/
  discord/
    bot.ts                  # existing — add voice join/leave command handling
    voice/
      connection.ts         # Imperative Shell — voice connection lifecycle
      receiver.ts           # Imperative Shell — per-user audio → VAD → STT
      sender.ts             # Imperative Shell — TTS → Opus → Discord player
      types.ts              # VoiceSession, VoiceConfig types
  tools/
    voice.ts                # sandbox tools: join_voice, leave_voice, say
  providers/
    stt.ts                  # Imperative Shell — Deepgram streaming client
    tts.ts                  # Imperative Shell — Cartesia streaming client
```

### Core Types

```typescript
// src/discord/voice/types.ts
type VoiceConfig = {
  readonly enabled: boolean;
  readonly sttProvider: 'deepgram' | 'whisper';
  readonly ttsProvider: 'cartesia';
  readonly ttsVoiceId: string;
  readonly vadSilenceMs: number;       // silence before flush to STT (default 800)
  readonly maxUtteranceSeconds: number; // safety cap (default 30)
};

type VoiceSession = {
  readonly guildId: string;
  readonly channelId: string;
  readonly connection: VoiceConnection;
  readonly player: AudioPlayer;
  readonly activeListeners: Map<string, UserAudioStream>;
  speaking: boolean;  // mutex — don't listen while bot is talking
};
```

### Integration With Existing Systems

**agent.chat()** — voice transcriptions are passed as regular text messages. Uses `conversationOverride` for per-channel history (same as text handler) and `sessionId: "voice:<channelId>"` for compaction scoping.

**shouldInterrupt()** — already exists in `ChatOptions`. Used to signal when a user starts speaking while the agent is processing, allowing early exit from the tool loop.

**speaking mutex** — when the bot is playing TTS audio, the receiver ignores incoming audio to prevent the bot from hearing itself. Simple boolean flag on `VoiceSession`.

**Tool registry** — three new sandbox-mode tools (`join_voice`, `leave_voice`, `say`) registered via `registerVoiceTools()` in `src/agent/tools.ts`.

**SecretManager** — `DEEPGRAM_API_KEY` and `CARTESIA_API_KEY` managed through existing secrets system.

### Config Extension

```toml
[discord.voice]
enabled = false
stt_provider = "deepgram"
tts_provider = "cartesia"
tts_voice_id = "..."
vad_silence_ms = 800
max_utterance_seconds = 30
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@discordjs/voice` | Voice connection, audio player, receiver |
| `@discordjs/opus` or `opusscript` | Opus encode/decode |
| `prism-media` | PCM ↔ Opus transcoding |
| `sodium-native` or `tweetnacl` | Encryption (Discord voice protocol) |
| FFmpeg (system) | Audio format conversion fallback |

External APIs:
- **Deepgram** — streaming STT with built-in endpointing/VAD
- **Cartesia** — streaming TTS, returns PCM/WAV chunks

## Known Risks

### Bun + Native Deps
`@discordjs/voice` depends on native Node addons (sodium, opus). Bun's Node compatibility layer handles most cases but this needs validation early. If it doesn't work, `opusscript` (pure JS) and `tweetnacl` (pure JS) are fallbacks at the cost of CPU.

### Turn Detection (VAD)
Knowing when a user has finished speaking is genuinely hard. Energy-based silence thresholds are simple but imprecise — too short cuts off mid-sentence, too long creates awkward pauses. Deepgram's streaming mode has built-in endpointing which mitigates this significantly. Silero VAD (`@ricky0123/vad-node`) is a more accurate alternative if needed.

### Latency Budget
STT (~200-500ms) + agent LLM call (~1-3s) + TTS first-byte (~200ms) = 1.4-3.7s total. Noticeable but manageable for a conversational agent. Streaming TTS (start speaking before full response is generated) would improve perceived latency but requires model streaming support.

### Multi-User
MVP targets single active speaker. Multiple simultaneous speakers requires per-user stream management, speaker identification, and a strategy for whose input gets priority. Phase 2 concern.

## Implementation Phases

### Phase 1: MVP (single user, basic flow)
1. Voice connection lifecycle (join/leave via text command `!join`, `!leave`)
2. Single-user receive → Deepgram streaming STT → `agent.chat()` → Cartesia TTS → playback
3. Basic VAD with configurable silence threshold
4. Speaking mutex (don't listen while talking)
5. Voice tools (`join_voice`, `leave_voice`)

### Phase 2: Polish
1. Interruption handling (user speaks while bot is talking → stop playback, listen)
2. Multi-user support with speaker identification
3. Streaming response → streaming TTS (speak as response generates)
4. Graceful reconnection on voice disconnect
5. `say` tool for explicit TTS outside normal response flow

### Phase 3: Nice-to-have
1. Voice activity transcription logging (store transcripts like text messages)
2. Per-user voice recognition / speaker diarization
3. Voice-specific persona tuning (shorter responses, more conversational)
4. Ambient mode (listen passively, respond only on wake word or mention)

## Effort Estimate

- Phase 1: ~2-3 days, ~800-1200 lines of new code
- Phase 2: ~2-3 days additional
- Phase 3: variable, depends on scope

## Open Questions

1. Should voice sessions share history with the text channel, or maintain separate conversation threads?
2. Do we want a wake-word or push-to-talk mode, or always-listening?
3. Should the agent's responses be shorter/more conversational when in voice mode (system prompt tweak)?
4. Is Deepgram the right default, or should we evaluate Whisper streaming / AssemblyAI first?
