# vi-ui

Web UI for talking to Vi (Claude) from the browser. Fork of `siteboon/claudecodeui` reduced to a Claude-only interface where every new chat is equivalent to running `via` in the terminal.

## Goal

Reference behavior — the terminal alias:

    alias via='claude --dangerously-skip-permissions --append-system-prompt-file ~/agent-system/context/vi-context.md'

Every new chat opened through vi-ui must:

1. Run with permission prompts bypassed (`--dangerously-skip-permissions` → SDK `permissionMode: 'bypassPermissions'`).
2. Have the contents of `~/agent-system/context/vi-context.md` appended to the system prompt (equivalent to `--append-system-prompt-file`).
3. Talk to Claude (no Cursor CLI, no Codex — upstream supports multiple providers we don't need).

## Non-goals (for now)

- Cursor CLI / Codex provider support (Claude only).
- Multi-user auth. Localhost / LAN behind SSH tunnel only.
- Cloud managed variant.

## Deployment

- **Prod**: `~/vi-ui/` — systemd `--user` unit `vi-ui.service` (TBD).
- **Dev**: `~/workplace/vi-ui/` — edit here, push to `main`, `bash ~/vi-ui/scripts/deploy.sh` to release.
- **Port**: 3001 by default (upstream). Reverse-proxied via `lan-ssl-proxy` (TBD).

## Epics

<!-- TODO: define epics before running enqueue.py plan -->

### E01: Vi parity for new chats

Make every new chat equivalent to `via`. Concrete changes identified in initial investigation:

- **SDK path (main chat flow)** — file `server/modules/providers/list/claude/claude-runtime.provider.js`:
  - Load `~/agent-system/context/vi-context.md` at chat start and pass its contents as the SDK `appendSystemPrompt` (or `systemPrompt` append) option in `mapCliOptionsToSDK()` (~lines 161–240).
  - Force `permissionMode: 'bypassPermissions'` regardless of the UI toggle (upstream already wires the toggle at lines 188–190; we hardcode it on).
- **Shell path (terminal-in-UI, `server/modules/websocket/services/shell-websocket.service.ts`)**:
  - Change `buildShellCommand()` (~lines 178–227) to always append `--dangerously-skip-permissions --append-system-prompt-file $HOME/agent-system/context/vi-context.md` when the provider is Claude.
- **cwd default** — `shell-websocket.service.ts:308` currently defaults `cwd` to `process.cwd()` when no project is selected. Decide: default to `$HOME` or force a project selection. (`via` in a terminal runs in whatever pwd, so `$HOME` is the closest analogue for "just opened a chat".)
- **UI**: remove/hide the `skipPermissions` toggle (it's always on) and remove the provider selector (Claude only).

### E02: Deployment as a systemd user service

- Create `~/.config/systemd/user/vi-ui.service` that runs `npm run server` from `~/vi-ui`.
- Wire `scripts/deploy.sh` (already scaffolded) to restart it.
- Decide LAN-SSL-proxy integration for HTTPS access.

### E03: Strip multi-provider UX

Remove Cursor/Codex code paths and UI so the interface presents only Claude — reduces surface area and keeps upstream merges targeted.
