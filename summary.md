# vi-ui

Fork of `siteboon/claudecodeui` — a web UI for Claude Code sessions. Reduced to a Claude-only interface where every new chat is equivalent to running the terminal `via` alias:

    alias via='claude --dangerously-skip-permissions --append-system-prompt-file ~/agent-system/context/vi-context.md'

## Folders

- Dev: `~/workplace/vi-ui` — edit here, push, deploy
- Prod: `~/vi-ui` — runs the server, pulled by `scripts/deploy.sh`

## Structure

- `server/` — Node/TypeScript backend (Express + WebSocket)
- `src/` — React + Vite frontend
- `electron/` — Electron desktop wrapper (unused for our web deployment)
- `docker/`, `docs/`, `plugins/` — upstream extras
- `scripts/deploy.sh` — prod deploy (our addition)

## Key entry points for vi parity

- `server/modules/providers/list/claude/claude-runtime.provider.js` — SDK chat flow, `mapCliOptionsToSDK()` (~L161–240) — where SDK options like `permissionMode` and `appendSystemPrompt` get set.
- `server/modules/websocket/services/shell-websocket.service.ts` — shell-terminal flow, `buildShellCommand()` (~L178–227) — where the `claude` CLI command string is constructed.
