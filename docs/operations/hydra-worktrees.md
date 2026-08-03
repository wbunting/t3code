# Hydra worktrees and Pi

This fork can delegate server-side Git worktree creation to an external helper. The normal
`git worktree add` behavior remains the default everywhere else.

## Server configuration

Set these variables on the T3 server running on Hydra:

```bash
T3CODE_WORKTREE_HELPER=/home/will/.local/bin/worktree-helper
T3CODE_WORKTREE_HELPER_TIMEOUT_MS=900000
```

For a new branch, T3 runs `worktree-helper new <branch>`. For an existing branch, it runs
`worktree-helper checkout <branch>`. It also sets `HERDR_REPO` to the project checkout and
`WT_FG=0`, so Herder creates the workspace in the background. The helper remains responsible
for Hydra Pool worker startup and worktree placement. T3 resolves the resulting path from
`git worktree list` instead of parsing human-readable helper output.

The helper owns placement, so requests containing an explicit worktree path fail rather than
silently creating the worktree somewhere else. The default 15-minute timeout accommodates
worker provisioning and can be changed up to one hour.

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
