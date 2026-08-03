# vi-ui

Web UI for talking to Vi (Claude) from the browser — fork of [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui), rebranded/reduced to behave like the terminal `via` alias:

    alias via='claude --dangerously-skip-permissions --append-system-prompt-file ~/agent-system/context/vi-context.md'

Every new chat opened through this UI must be equivalent to running `via` on the terminal.

## Folders

- **Dev**: `~/workplace/vi-ui` — this folder. Edit here, commit, push to `origin/main`.
- **Prod**: `~/vi-ui` — runs the actual server. `scripts/deploy.sh` pulls latest and rebuilds.

Same two-folder pattern as `agent-system` and `app-promo`.

## Deploy

From dev after pushing to `main`:

    bash ~/vi-ui/scripts/deploy.sh

## Upstream

`upstream = siteboon/claudecodeui`. To pull upstream changes:

    git remote add upstream https://github.com/siteboon/claudecodeui.git   # once
    git fetch upstream && git merge upstream/main
