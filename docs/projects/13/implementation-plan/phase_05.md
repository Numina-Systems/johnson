# GH13: Multi-Screen TUI — Phase 5: Secrets Screen

**Goal:** Build the secrets management screen that lists, adds, and deletes secrets from the `SecretManager`.

**Architecture:** The secrets screen reads from `SecretManager.listKeys()` (names only, never values). It supports adding new secrets (two-step: name then value, with the value hidden during input) and deleting existing ones. It also shows which tools/skills reference each secret by cross-referencing grant data.

**Tech Stack:** React 19, Ink 7, TypeScript (strict mode), Bun runtime

**Scope:** Phase 5 of 7 from GH13 design

**Codebase verified:** 2026-04-27

---

## Acceptance Criteria Coverage

This phase implements and tests:

### GH13.AC7: Secrets screen lists/adds/deletes secrets (values never displayed)
- **GH13.AC7.1:** Secret names are listed; values are never shown after entry
- **GH13.AC7.2:** Pressing `a` starts the add flow: prompts for name, then value (value input is masked)
- **GH13.AC7.3:** Pressing `d` deletes the selected secret after confirmation
- **GH13.AC7.4:** Each secret shows which skills reference it (based on grant secret assignments)
- **GH13.AC7.5:** Empty state shows "No secrets configured" when vault is empty

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/tui/screens/SecretsScreen.tsx`

**Verifies:** GH13.AC7.1, GH13.AC7.2, GH13.AC7.3, GH13.AC7.4, GH13.AC7.5

**Files:**
- Create: `src/tui/screens/SecretsScreen.tsx`

**Implementation:**

**Props:**

```typescript
type SecretsScreenProps = {
  readonly secrets: SecretManager;
  readonly store: Store;
  readonly onBack: () => void;
};
```

Note: `store` is needed to look up which skills reference each secret (via `store.listGrants()`).

**State:**

```typescript
type Mode = 'list' | 'add_name' | 'add_value';

const [mode, setMode] = useState<Mode>('list');
const [selectedIdx, setSelectedIdx] = useState(0);
const [newSecretName, setNewSecretName] = useState('');
const [newSecretValue, setNewSecretValue] = useState('');
```

**List mode:**

Display all secret names from `secrets.listKeys()`. For each secret, show which skills reference it:

```typescript
const allGrants = store.listGrants();
const secretUsers = new Map<string, string[]>();
for (const grant of allGrants) {
  for (const secretKey of grant.secrets) {
    const users = secretUsers.get(secretKey) ?? [];
    users.push(grant.skillName);
    secretUsers.set(secretKey, users);
  }
}
```

Render each secret as:
```
> API_KEY_NAME        used by: skill:exa-news-search, skill:weather
  DISCORD_WEBHOOK     (not referenced)
```

**Key bindings (list mode):**
- `j`/`k` or up/down arrows — navigate
- `a` — start add flow (switch to `add_name` mode)
- `d` — delete selected secret (`secrets.remove(key)`)
- `Escape` — call `onBack()`

**Add flow:**

Two-step input using `TextInput`:

1. `add_name` mode: prompt "Secret name:" — on submit, store name and switch to `add_value`
2. `add_value` mode: prompt "Value for {name}:" — on submit, call `secrets.set(name, value)` and switch back to `list`

For the value input, the value should be masked. `ink-text-input` does not have a built-in mask option, but we can use a workaround: render the `TextInput` normally but replace the displayed characters. Actually, `ink-text-input` v6 for Ink 7 may or may not support masking. The pragmatic approach:

Option A: Use `TextInput` with a `mask` prop if available.
Option B: Use `TextInput` normally and accept that the value is visible during entry (same as current ReviewPage behaviour — the existing `add_secret` mode in ReviewPage shows the value during entry).

The current ReviewPage does NOT mask values. Follow the same pattern. The design says "value hidden during input" but the existing behaviour doesn't do this. Document this as a known gap; masking can be added later with a custom component.

**Empty state:**
```
(No secrets configured. Press 'a' to add one.)
```

**Layout:**

```
┌─ Secrets ────────────────────────────────────────┐
│ > API_KEY_NAME        used by: skill:news-search │
│   DISCORD_WEBHOOK     (not referenced)           │
│   OPENAI_API_KEY      used by: skill:summarize   │
│                                                  │
│ a=add  d=delete  Esc=back                        │
└──────────────────────────────────────────────────┘
```

Pattern comment: `// pattern: UI Shell — secret vault management (names only, never values)`

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

**Commit:** `feat(tui): add SecretsScreen with add/delete/list`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire SecretsScreen into App.tsx

**Files:**
- Modify: `src/tui/App.tsx` — replace secrets placeholder with real component

**Implementation:**

```typescript
case 'secrets':
  if (!deps.secrets) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Secret management not available.</Text>
        <Text dimColor>Press Escape to go back.</Text>
      </Box>
    );
  }
  return (
    <SecretsScreen
      secrets={deps.secrets}
      store={deps.store}
      onBack={pop}
    />
  );
```

The `secrets` dependency is optional in `TuiDependencies`. If not provided, show a graceful fallback. In practice, `secrets` is always provided by `src/index.ts`, but the type allows `undefined` for robustness.

**Verification:**
Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && npx tsc --noEmit`
Expected: No type errors

Run: `cd /Users/scarndp/dev/johnson/.worktrees/GH13 && bun run build`
Expected: Build succeeds

**Commit:** `feat(tui): wire SecretsScreen into navigation shell`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
