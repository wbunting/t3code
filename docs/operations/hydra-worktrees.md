# Hydra worktrees and Pi

This fork can delegate server-side Git worktree creation to an external helper. The normal
`git worktree add` behavior remains the default everywhere else.

## Server configuration

Set these variables on the T3 server running on Hydra:

```bash
T3CODE_WORKTREE_HELPER=/home/will/.local/bin/worktree-helper
T3CODE_WORKTREE_HELPER_TIMEOUT_MS=900000
T3CODE_WORKTREE_HELPER_BACKGROUND_PROVISIONING=1
T3CODE_HERDR_AGENT_REPORTING=1
T3CODE_HERDR_COMMAND=/usr/bin/herdr
```

For a new branch, T3 runs `worktree-helper new <branch>`. For an existing branch, it runs
`worktree-helper checkout <branch>`. It also sets `HERDR_REPO` to the project checkout and
`WT_FG=0`. With background provisioning enabled, the registration call also disables worker,
devbox, and Tailscale setup so it returns as soon as Herder has registered the local worktree.
T3 then calls `worktree-helper provision-background <branch>`, which queues the slow worker
setup in a deterministic user-systemd unit. T3 resolves the local path from `git worktree list`
instead of parsing human-readable helper output.

The helper owns placement, so requests containing an explicit worktree path fail rather than
silently creating the worktree somewhere else. Provisioning retries reuse the same unit and
recorded worker for a repository/branch key. Its systemd journal contains the durable progress
log, while T3 logs structured registration, enqueue, completion, failure, and interruption
events with the branch and helper phase.

With agent reporting enabled, a T3-owned Pi RPC session claims the otherwise-empty Herdr pane
whose working directory matches the thread worktree. Herdr displays it as `Pi · T3`, including
working, done, and needs-input lifecycle states. T3 continues to own the `pi --mode rpc` child
and its raw JSONL streams; Herdr is the presentation and navigation surface, not the transport.
The lifecycle integration is best-effort: a missing pane or unavailable Herdr server is logged
without interrupting the Pi session. `T3CODE_HERDR_COMMAND` defaults to `herdr`, and
`T3CODE_HERDR_AGENT_REPORTING_TIMEOUT_MS` defaults to 5000 milliseconds.

## Hydra Pool MCP for Pi

The Pi provider uses Pi's normal config directory and does not disable global packages or
extensions. On Hydra, keep `pi-mcp-adapter` enabled and register the Hydra Pool stdio server in
`~/.pi/agent/mcp.json`. The command should start `hydra-pool/dist/mcp-stdio.js` with
`HYDRA_POOL_DATABASE_URL` available in its environment.

The expected artifact tools are:

- `pool_status`
- `list_jobs`
- `get_job`
- `list_job_artifacts`
- `read_job_artifact`

Images returned by `read_job_artifact` are native MCP image content. Videos and other binary
artifacts are embedded resources. Keep credentials in Hydra's protected environment file; do
not place them in T3 provider settings or the repository.
