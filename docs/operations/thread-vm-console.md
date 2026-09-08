# Thread VM console

The fork resolves a thread's worktree (or project root) against Hydra helper
worker and provisioning records. VM state comes from `hydra-microvm-driver get`,
not the cached worker status. Only the visible thread requests status, at most
once every ten seconds while the client is visible and connected.

The server uses these optional overrides:

- `HYDRA_POOL_HELPER_WORKER_STATE_DIR`: defaults to
  `~/.cache/worktree-helper/workers`.
- `HYDRA_POOL_HELPER_PROVISION_STATE_DIR`: defaults to the sibling `provisioning`
  directory.
- `T3CODE_MICROVM_DRIVER`: defaults to `/usr/local/bin/hydra-microvm-driver`.

Console opening requires the orchestration operate scope. The server connects
to the assigned guest over SSH as `will` and shares the existing X11 display
`:99`. Ubuntu guests must allow that user to install `x11vnc` and start a system
service through noninteractive sudo. Installation happens on demand. The
`t3-vnc` service binds guest loopback port 5909 and expires after two hours.

The browser receives a random console capability valid for 30 minutes. T3's
`/api/vm-console/:token` WebSocket route forwards binary traffic over SSH to the
guest's loopback listener. No public VNC listener or guest port forwarding is
needed. Closing the browser connection terminates its SSH transport. Restarting
T3 invalidates outstanding console capabilities. The console entry page is
`vm-console.html`, built as a separate entry so noVNC is not loaded by chat.

Clients use the selected environment's HTTP origin for the console. Its proxy
must forward WebSocket upgrades for `/api/vm-console/*` and serve the console
entry page. Validate these routes when configuring a relay or reverse proxy.
