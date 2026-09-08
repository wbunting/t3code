# Thread VMs

Hover over a thread in the sidebar to check its VM status. Threads with a
micro-VM also show its status in the web and desktop header:

- **Loading** (amber): the VM is being provisioned or started.
- **Live** (green): the VM host reports that it is running.
- **Failed** (red): provisioning failed.
- **Stopped** (gray): the VM has stopped or been released.
- **Unknown** (gray): T3 cannot confirm the current state.

In the desktop app, click a live VM indicator to open **VM desktop** in the
built-in browser. You can see the same desktop the agent uses and control it
with your mouse and keyboard. The first connection may take longer while the VM
sets up desktop sharing. A running VM must also have its desktop available.

Use **Disconnect** to close the connection without stopping the VM. Console
links expire after 30 minutes; click the thread's VM indicator again to reconnect.
Opening the console does not create or restart a VM. Threads that share a
worktree also share its VM.

The mobile client does not currently show the VM indicator. Desktop control
requires the desktop client.
