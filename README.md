# Hermes Manager

A local, single-user command center for Hermes agents on your machines. Manage SSH connections, organize tasks on a kanban board, watch task output, open interactive shells, and review agent reports in one workspace.

## Run It

Requires **Node.js 24 or newer**. Remote machines need an SSH server, a POSIX-compatible shell, and a recent [Hermes Agent](https://github.com/NousResearch/hermes-agent) installation.

```sh
npm install
npm run build
npm start
```

Open **http://127.0.0.1:4310**. The server binds only to loopback. On Windows, use `npm.cmd` instead of `npm` if PowerShell blocks `npm.ps1`.

For development with hot reload:

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies API and WebSocket traffic to the local backend on port 4310.

## First Connection

1. Select **Set up vault**, then choose and confirm a passphrase of at least 12 characters. Keep it safe: there is no passphrase recovery.
2. Select **Add agent**. Choose **This computer** to manage the Hermes installation on the same machine as Hermes Manager, or choose SSH for a remote host. Local agents use the manager's OS user and do not require SSH credentials.
3. Under **Hermes configuration**, use the absolute executable path if possible, such as `C:\Users\you\AppData\Local\hermes\hermes-agent\.hermes\bin\hermes.exe` for a local Windows installation or `/home/hermes/.local/bin/hermes` for SSH. Noninteractive SSH may not have your usual PATH. Optionally specify a working directory and Hermes profile.
4. Select **Check connection**. Independently verify the displayed SSH host-key fingerprint before trusting it. For an Ed25519 key, run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256` on the host through a trusted channel; other key algorithms have corresponding public-key files.
5. Trust the verified fingerprint. The manager then checks SSH authentication, the Hermes version, and required CLI capabilities.
6. Create a task, assign its agent, open the task, and select **Run task**. Review the confirmation before allowing execution.

**Explore demo** opens a clearly labeled, read-only sample workspace. Its agents, tasks, and reports are examples only. No sample credentials or records are inserted into the database.

## What It Does

- **Agents:** save and edit connections, explicitly trust host keys, check reachability, and retain the most recent connection error. Trusted agents are checked approximately every 30 seconds while the vault is unlocked and the agent has no other manager operation running.
- **Local Hermes:** launch one-shot tasks directly through the installed Hermes executable. Existing desktop sessions are not imported; interactive shells remain an SSH feature.
- **Tasks:** create, assign, prioritize, search, filter, and move tasks through Backlog, Ready, In progress, Review, Done, and Blocked. A list view is also available. Use the task's status selector as a keyboard/touch alternative to dragging cards.
- **Execution:** explicitly launch one-shot Hermes work over SSH. Prompts go through stdin, not shell interpolation. Instructions are the prompt; the title is used if instructions are empty. A successful process exit and valid successful final result move the task to Review, not Done.
- **Output and reports:** stream stdout/stderr into task history, retain final agent reports and failure details, and export reports as text. Review and verify outcomes before marking them Done.
- **Terminal:** open an interactive SSH PTY using xterm.js. Input and window resizing are forwarded over a local WebSocket. Leaving the terminal page closes the SSH session; 15 minutes without input also closes it. Terminal output is not persisted.
- **Persistence:** agent settings, task history, logs, and the encrypted vault are stored in a local SQLite database.

## Hermes Compatibility

### Choosing models

Models resolve in this order: an agent's own override, then the **global model** set on the Models page, then the Hermes installation's own configuration. Swap the global model to change every agent without an override at once. On the Agents page, select several agents and use **Set model…** or **Use global model** to change or clear overrides in bulk. On an agent card, select **Change model** to set its **Provider** and **Model ID**. Changing a name, colour, or model never requires a new connection check. Overrides are saved per agent and passed only to new managed task runs; they do not change the Hermes installation's configuration. This works with local and SSH agents. Provider credentials must already be configured in that Hermes installation. Use the exact model ID from your provider; connection checks verify Hermes CLI availability, not model availability or credits.

The current integration checks `hermes --version` and `hermes chat --help`, then requires `--oneshot`, `--query-file`, and `--format stream-json`. The execution command is equivalent to:

```sh
/absolute/path/to/hermes -p optional-profile chat --in /optional/workdir \
  --oneshot --query-file - --format stream-json
```

Optional profile and working-directory flags are omitted when not configured. Each argument is POSIX shell-quoted; the prompt is sent separately over stdin followed by EOF. No PTY is allocated for task runs. The final structured result and SSH exit status must both indicate success.

Normal remote Hermes approval policy remains in force. **The manager never adds `--yolo` or automatically approves dangerous operations.** Configure the remote Hermes installation, provider credentials, tool permissions, and approval policy yourself. A noninteractive task that needs approval can fail or be denied rather than displaying an interactive approval prompt here.

Older Hermes releases without these streaming flags can still be accessed through the SSH terminal, but cannot run managed tasks until updated. The capability check explains the mismatch.

### Coding tools: Claude Code, Codex, OpenCode

Each connection check also looks for `claude`, `codex`, and `opencode` on the agent: on PATH, then in common install folders such as `~/.local/bin`, `~/.npm-global/bin`, `~/.bun/bin`, and nvm. Set an explicit path under **Coding tools** in the agent settings if detection misses one. Local Windows agents need an `.exe` launcher; npm `.cmd` shims are not launched. Choose **Run with** on a task or schedule, and optionally a folder on the agent (usually a repository). Runs start in that folder (or the agent's working directory), with the tool's folder prepended to PATH so node-based installs find their interpreter.

| Tool        | Command                                                                         | Permissions                                                                                   |
| ----------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Claude Code | `claude -p --output-format stream-json --verbose --permission-mode acceptEdits` | Edits in the folder are allowed. Other tools are denied, and the task moves to **Needs you**. |
| Codex       | `codex exec --json --sandbox workspace-write --skip-git-repo-check -`           | Workspace-write sandbox; no network.                                                          |
| OpenCode    | `opencode run --format json -- <prompt>`                                        | OpenCode's own permission settings on that machine.                                           |

The prompt goes over stdin, except for OpenCode, which takes it as one quoted argument. A per-tool model can be set globally on the Models page or per agent. No tool is ever started with permission-bypass flags.

### Needs you

A run that ends with a question for you, or with a permission denial, moves to **Needs you** instead of Review. The agent's avatar pulses amber, the sidebar and tab title show a count, and the board gets an inbox listing questions, blocked tasks, setup problems (locked vault, unverified host keys, offline agents, stuck schedules), and work to review. Open a waiting task and reply. Claude Code, Codex, and OpenCode continue the same session; Hermes does too when its `chat --help` lists `--resume`, and otherwise the reply starts a new run that includes the previous answer. Question detection is a heuristic: it looks at whether the final paragraph asks something. Turn on **desktop alerts** in the sidebar for browser notifications.

## Scope and Limits

- This manages tasks launched **from Hermes Manager**. It does not import independently launched Hermes sessions (including the Hermes desktop app), remote native kanban tasks, gateway jobs, cron work, or tasks from the optional Runs API.
- Reachable means the latest SSH/Hermes check succeeded. Working means this manager has launched a task. Neither is a complete inventory of every remote process, and status is last-observed rather than a guarantee of instantaneous availability.
- Moving a task to Ready does not schedule it. Dragging a card never executes commands. A run must be started explicitly. There is no automatic queue or retry loop.
- Only one SSH operation per agent is allowed at a time, including probes, task runs, and terminals. At most eight SSH operations run concurrently across the workspace. A busy agent cannot be edited or deleted.
- **Do not stop the manager while work is running.** Runs are tied to SSH connections, not a durable remote supervisor. Disconnects, one-hour deadlines, and manager restarts can leave remote work running or its outcome unknown. Such tasks are Blocked, never reported as successfully cancelled. Inspect the host before retrying to avoid duplicate actions. There is no cancellation or reconnect/resume guarantee.
- Task reports are agent assertions, not proof that changes are correct. Reports may contain remote-generated untrusted content, which the interface renders as text rather than executable HTML.
- Stored logs are capped at 2,000 entries per task and 20,000 globally. Individual entries, per-run output, and final reports also have bounds. These are an operational view, not a complete archival transcript. Re-running a task keeps earlier logs but replaces the current final report.
- The interface works on desktop and mobile-sized screens, but the service is deliberately not reachable from a separate phone or another LAN machine. This is not a shared, authenticated team server.

## Security and Storage

SSH passwords, private keys, and key passphrases are encrypted with **AES-256-GCM**, using unique IVs and agent-specific authenticated context. The vault key is derived from your passphrase with **scrypt** and is kept only in the server process while unlocked. Only the salt and encrypted verification record are persisted. Credentials are not returned through the API and are not stored in browser local storage. The first setup and all unlocks happen over local loopback HTTP.

Unknown or changed SSH host keys are rejected before authentication. A trust action must match a recently observed fingerprint. The manager never silently accepts a new key. API mutations require a process-specific token; Host/Origin validation, WebSocket checks, no CORS access, and production security headers restrict browser access to expected local origins.

**SSH secrets and the Nous catalog API key are encrypted.** Agent connection metadata, schedules, task prompts, reports, logs, activity, and collected files are readable in local storage. Saved SSH secrets are filtered from captured output on a best-effort basis, but arbitrary API keys or sensitive information emitted by remote tools are not reliably redacted. Protect the data directory with OS permissions and disk encryption, and avoid putting secrets into task prompts.

This is a **trusted local-user** security model, not a multi-user authentication boundary. Another process or user with access to the unlocked manager, browser, OS account, or filesystem may access or modify workspace data and execute work. Do not expose it with port forwarding, a reverse proxy, or `0.0.0.0` without adding appropriate authentication and transport security. Vault locking prevents new SSH work but does not hide task history, encrypt all workspace data, or disable task editing. Locking is refused while any SSH operation is active. The vault locks when the server stops, not when you close a browser tab. There is no automatic vault inactivity timeout or passphrase-change UI.

Default storage: **`data/manager.sqlite`**, with SQLite WAL sidecar files while running. Shut down the manager cleanly before backing up the entire `data/` directory. Restore the entire directory and use the original passphrase. A lost passphrase means saved credentials cannot be recovered; task data remains readable. A second server process cannot share the same database. On Windows, ensure the directory's inherited ACL permits only your intended OS users; POSIX mode flags do not establish Windows ACL isolation.

Optional environment variables:

| Variable                  | Default  | Purpose                                                                      |
| ------------------------- | -------- | ---------------------------------------------------------------------------- |
| `PORT`                    | `4310`   | Production loopback HTTP port. Development proxy remains fixed to 4310.      |
| `HERMES_MANAGER_DATA_DIR` | `./data` | SQLite data directory, relative to the server working directory or absolute. |

## Development and Tests

### Schedules, output libraries, and models

Schedules create a separate task per occurrence and use the agent's current model settings. The manager process must remain running and the vault unlocked. Due schedules wait for busy agents or a successful connection check. Missed recurring occurrences are coalesced into one run; a previous running occurrence never overlaps another occurrence of the same schedule. Recurrence is a fixed interval in minutes (1440 = every 24 hours), not a calendar rule that adjusts for daylight saving time. One-shot schedules disable after launch. Pause, edit, and delete controls preserve previous tasks. An occurrence claimed immediately before a process crash may be skipped to avoid duplicate execution.

Documents includes task reports and uploaded files. The media gallery previews images, audio, and video. After each run, supported files that are new or changed directly inside `<task folder or agent working directory>/artifacts/` are collected. Local agents use the filesystem; SSH agents use SFTP and compare against a listing taken before the run, so clock differences don't matter. Instruct agents to write deliverables there. Subfolders and symlinks are excluded. Text, Markdown, CSV, and PDF files can be previewed, and any file can be deleted from the library. Each file is limited to 25 MB, with a 2,000-file library limit. Files are stored under `data/artifacts` and should be included in backups.

In Models, unlock the vault and enter a Nous Portal API key. It is verified before saving, and the catalog is cached for an hour. Search or select Free only, choose **Global default** or specific agents, and apply a model. Free requires explicit zero input and output pricing and excludes subscription entries; unknown pricing is never classified as free. Prices and availability can change. The catalog key is used only with the fixed Nous inference catalog endpoint. Agent execution continues using each agent's own existing Nous credentials; the key is not copied to agents. Agent settings also accept manual provider/model IDs and can revert to Hermes defaults.

```sh
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

The unit/integration suite tests vault encryption and tampering, quoting, stream parsing, API security, database persistence, SSH host verification before credentials, execution outcomes, transport failures, capability checks, and PTY lifecycle. SSH tests use an in-process SSH2 server with generated keys, not your machines.

Browser tests start an isolated production server on port 4311 with a temporary database. They exercise vault/agent/task flows, persisted state, safe drag behavior, demo isolation, desktop/mobile rendering, and automated WCAG A/AA checks. A generated-key SSH fixture also verifies the complete browser flow from host-key confirmation through task execution, report review, and interactive terminal input. No real agent credentials are needed. Screenshots are produced under `test-results/`.

Stack: React 19, TypeScript, Vite, Express 5, Node SQLite, SSH2, WebSockets, xterm.js, and Lucide icons. No cloud service or Docker container is required. Fonts and application assets are served locally.
