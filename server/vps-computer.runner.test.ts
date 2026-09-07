import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultRunner, type SpawnFn } from "./vps-computer.ts";

type FakeChild = EventEmitter & {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

// The spawn seam is a real interface: the fake below is a faithful child
// process (EventEmitter + stdio streams), injected through defaultRunner's
// third parameter instead of replacing the node:child_process module.
function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn(() => true);
  // Drain piped input so `child.stdin.end(...)` never raises EPIPE against
  // the fake; the real assertions below drive stdin through `emit("error")`.
  child.stdin.on("error", () => {});
  child.stdout.on("error", () => {});
  child.stderr.on("error", () => {});
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

describe("default VPS command runner", () => {
  let spawnMock: ReturnType<typeof vi.fn>;
  let spawn: SpawnFn;
  let child: FakeChild;

  beforeEach(() => {
    spawnMock = vi.fn();
    child = fakeChild();
    spawn = ((...args: unknown[]) => {
      spawnMock(...args);
      return child;
    }) as SpawnFn;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collects output and resolves after the child closes", async () => {
    const result = defaultRunner(["info"], { input: "request" }, spawn);

    child.stdout.write("out");
    child.stderr.write("err");
    child.emit("close", 0, null);

    await expect(result).resolves.toEqual({ stdout: "out", stderr: "err" });
    expect(spawnMock).toHaveBeenCalledWith("docker", ["info"], expect.objectContaining({ shell: false }));
  });

  it("turns stdin EPIPE into a rejected command instead of an unhandled error", async () => {
    const result = defaultRunner(["build", "-"], { input: "Dockerfile" }, spawn);

    child.stdin.emit("error", new Error("write EPIPE"));

    await expect(result).rejects.toThrow("Docker-over-SSH stdin failed: write EPIPE");
    child.emit("close", 1, null);
  });

  it("escalates a timed-out command from SIGTERM to SIGKILL", async () => {
    vi.useFakeTimers();
    const result = defaultRunner(["info"], { timeoutMs: 100 }, spawn);
    const rejection = expect(result).rejects.toThrow("Docker-over-SSH command timed out");

    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");

    // the WAN-sized grace window: ssh + docker get 5s to tear down cleanly
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });
});
