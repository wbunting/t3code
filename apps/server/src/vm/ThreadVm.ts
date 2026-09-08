// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { ThreadVmStatus } from "@t3tools/contracts";

type RecordValue = Record<string, unknown>;
export const asRecord = (value: unknown): RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

export function runVmCommand(
  command: string,
  args: string[],
  input?: string,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = NodeChildProcess.execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, signal },
      (error, stdout) => {
        if (error) reject(error);
        else resolveResult(stdout);
      },
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

async function records(directory: string): Promise<RecordValue[]> {
  const names = await NodeFSP.readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) =>
        asRecord(JSON.parse(await NodeFSP.readFile(NodePath.join(directory, name), "utf8"))),
      ),
  );
}

export function selectVmRecords(cwd: string, workers: RecordValue[], requests: RecordValue[]) {
  const matches = (value: unknown) =>
    typeof value === "string" && NodePath.resolve(value) === NodePath.resolve(cwd);
  const worker = workers
    .filter((row) => row.provider === "microvm" && matches(row.worktree))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
  const request = requests
    .filter((row) => matches(row.worktreePath))
    .sort((a, b) => String(b.requestedAt ?? "").localeCompare(String(a.requestedAt ?? "")))[0];
  return { worker, request };
}

export function vmStatusFromRecords(
  worker: RecordValue | undefined,
  request: RecordValue | undefined,
  response?: unknown,
): ThreadVmStatus {
  if (!worker) {
    if (!request) return { state: "none", detail: "No VM assigned" };
    if (request.status === "completed" || request.status === "succeeded") {
      return { state: "stopped", detail: "Provisioning finished; no VM is assigned" };
    }
    return request.status === "failed"
      ? {
          state: "failed",
          detail:
            typeof request.error === "string"
              ? request.error.slice(0, 1000)
              : "VM provisioning failed",
        }
      : { state: "loading", detail: "VM is provisioning" };
  }
  const result = asRecord(response);
  if (result.absent) {
    if (request && String(request.requestedAt ?? "") > String(worker.created_at ?? "")) {
      return vmStatusFromRecords(undefined, request);
    }
    return { state: "stopped", detail: "VM has been released" };
  }
  const instance = asRecord(result.instance);
  const instanceId = typeof instance.instanceId === "string" ? instance.instanceId : undefined;
  const address = typeof instance.address === "string" ? instance.address : undefined;
  if (instance.state === "running")
    return {
      state: "live",
      detail: "VM is running",
      ...(instanceId ? { instanceId } : {}),
      ...(address ? { address } : {}),
    };
  if (instance.state === "destroyed" || instance.state === "stopped")
    return { state: "stopped", detail: "VM is stopped" };
  if (instance.state === "failed" || instance.state === "error")
    return { state: "failed", detail: "VM failed" };
  if (instance.state === "creating" || instance.state === "starting")
    return { state: "loading", detail: "VM is starting" };
  return { state: "unknown", detail: "VM status unavailable" };
}

export async function readThreadVm(cwd: string, signal?: AbortSignal): Promise<ThreadVmStatus> {
  const stateDir =
    process.env.HYDRA_POOL_HELPER_WORKER_STATE_DIR ??
    NodePath.join(NodeOS.homedir(), ".cache/worktree-helper/workers");
  const provisionDir =
    process.env.HYDRA_POOL_HELPER_PROVISION_STATE_DIR ?? NodePath.join(stateDir, "../provisioning");
  const [workers, requests] = await Promise.all([records(stateDir), records(provisionDir)]);
  const { worker, request } = selectVmRecords(cwd, workers, requests);
  if (!worker) {
    if (
      request &&
      (request.status === "queued" || request.status === "running") &&
      typeof request.unit === "string" &&
      /^t3-worktree-provision-[a-zA-Z0-9-]+\.service$/.test(request.unit)
    ) {
      const unit = await runVmCommand(
        "systemctl",
        ["--user", "show", request.unit, "--property=ActiveState", "--property=Result"],
        undefined,
        signal,
        10_000,
      );
      if (unit.includes("ActiveState=failed") || /Result=(?!success\b)\S+/.test(unit)) {
        return { state: "failed", detail: "VM provisioning service failed" };
      }
      if (unit.includes("ActiveState=inactive")) {
        return {
          state: "unknown",
          detail: "VM provisioning is no longer running; no VM is assigned",
        };
      }
    }
    return vmStatusFromRecords(worker, request);
  }
  if (typeof worker.instance_id !== "string" || !/^microvm-[a-f0-9]+$/.test(worker.instance_id)) {
    return { state: "unknown", detail: "Invalid VM assignment" };
  }
  const output = await runVmCommand(
    process.env.T3CODE_MICROVM_DRIVER ?? "/usr/local/bin/hydra-microvm-driver",
    ["get"],
    JSON.stringify({ instanceId: worker.instance_id }),
    signal,
    10_000,
  );
  return vmStatusFromRecords(worker, request, JSON.parse(output));
}

export const VNC_START_COMMAND = `set -eu
test -S /tmp/.X11-unix/X99 || { echo 'The VM desktop is not running'; exit 1; }
if ! command -v x11vnc >/dev/null; then
  sudo -n apt-get update -qq
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq x11vnc
fi
if ! sudo -n systemctl is-active --quiet t3-vnc.service; then
  sudo -n systemd-run --unit=t3-vnc --collect --uid=will --property=RuntimeMaxSec=2h --property=Type=forking /usr/bin/x11vnc -bg -display :99 -localhost -rfbport 5909 -forever -shared -nopw -noxdamage
fi`;

export async function startVmDesktop(status: ThreadVmStatus, signal?: AbortSignal) {
  if (status.state !== "live" || !status.address || !/^[0-9a-fA-F.:]+$/.test(status.address)) {
    throw new Error("The VM is not ready for a desktop connection");
  }
  await runVmCommand(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=10",
      `will@${status.address}`,
      VNC_START_COMMAND,
    ],
    undefined,
    signal,
  );
  return status.address;
}
