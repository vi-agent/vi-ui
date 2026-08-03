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

- **Prod**: `~/vi-ui/` — systemd `--user` unit `vi-ui.service` running at `~/.config/systemd/user/vi-ui.service`.
- **Dev**: `~/workplace/vi-ui/` — edit here, push to `main`, `bash ~/vi-ui/scripts/deploy.sh` to release.
- **Port**: 3001 (internal, `127.0.0.1` only). Exposed via `lan-ssl-proxy` on **https://192.168.40.33:8444** (dedicated SSL port, no subpath rewriting needed).

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

### E02: Deployment as a systemd user service ✅ IMPLEMENTED

- `~/.config/systemd/user/vi-ui.service` — runs `node dist-server/server/index.js` from `~/vi-ui` on `127.0.0.1:3001`. Enabled and started via `systemctl --user enable --now vi-ui.service`.
- `lan-ssl-proxy` wired: dedicated `server { listen 8444 ssl; }` block proxies to `:3001` with WebSocket upgrade headers (`Upgrade`, `Connection`) and long timeouts (3600 s) for chat streams. No base-URL rewriting needed — clean dedicated port.
- Access URL: **https://192.168.40.33:8444**

### E03: Strip multi-provider UX

Remove Cursor/Codex code paths and UI so the interface presents only Claude — reduces surface area and keeps upstream merges targeted.
