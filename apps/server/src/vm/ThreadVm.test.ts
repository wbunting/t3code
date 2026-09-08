import { describe, expect, it } from "vite-plus/test";
import { selectVmRecords, vmStatusFromRecords } from "./ThreadVm.ts";
import { createVmConsole, resolveVmConsole } from "./Console.ts";

describe("thread VM status", () => {
  const worker = {
    provider: "microvm",
    worktree: "/work/a",
    instance_id: "microvm-abc",
    created_at: "2026-09-08",
  };
  it("matches the exact worktree and newest assignment", () => {
    const newer = { ...worker, created_at: "2026-09-09" };
    expect(
      selectVmRecords("/work/a", [worker, { ...worker, worktree: "/work/ab" }, newer], []).worker,
    ).toBe(newer);
    expect(selectVmRecords("/work/b", [worker], []).worker).toBeUndefined();
  });
  it("distinguishes no VM, pending provisioning and failure", () => {
    expect(vmStatusFromRecords(undefined, undefined).state).toBe("none");
    expect(vmStatusFromRecords(undefined, { status: "queued" }).state).toBe("loading");
    expect(
      vmStatusFromRecords(undefined, { status: "failed", error: "Capacity exceeded" }),
    ).toEqual({ state: "failed", detail: "Capacity exceeded" });
  });
  it("uses authoritative driver state instead of cached worker status", () => {
    expect(vmStatusFromRecords(worker, undefined, { absent: true }).state).toBe("stopped");
    expect(vmStatusFromRecords(worker, undefined, {}).state).toBe("unknown");
    for (const state of ["stopped", "destroyed"])
      expect(vmStatusFromRecords(worker, undefined, { instance: { state } }).state).toBe("stopped");
    expect(
      vmStatusFromRecords(worker, undefined, {
        instance: { state: "running", instanceId: "microvm-abc", address: "100.1.2.3" },
      }),
    ).toEqual({
      state: "live",
      instanceId: "microvm-abc",
      address: "100.1.2.3",
      detail: "VM is running",
    });
  });
  it("shows a new provisioning attempt after the old VM was released", () => {
    const request = { status: "queued", requestedAt: "2026-09-09" };
    expect(vmStatusFromRecords(worker, request, { absent: true }).state).toBe("loading");
    expect(
      vmStatusFromRecords(worker, { ...request, status: "failed" }, { absent: true }).state,
    ).toBe("failed");
    expect(vmStatusFromRecords(undefined, { status: "succeeded" }).state).toBe("stopped");
  });
});

describe("VM console access", () => {
  it("uses an expiring capability without putting the address in the URL", () => {
    const { path } = createVmConsole("100.1.2.3", 1000);
    const token = path.split("#")[1]!;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(path).not.toContain("100.1.2.3");
    expect(resolveVmConsole(token, 1001)?.address).toBe("100.1.2.3");
    expect(resolveVmConsole(token, 1000 + 30 * 60 * 1000)).toBeNull();
    expect(resolveVmConsole("unknown", 1000)).toBeNull();
  });
});
