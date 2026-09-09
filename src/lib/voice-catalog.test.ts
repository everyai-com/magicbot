import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn(), token: "one" }));
vi.mock("@/state/store", () => ({ api: mocks.api }));
vi.mock("@/lib/auth", () => ({ betterAuthToken: () => mocks.token }));

beforeEach(() => {
  vi.resetModules();
  mocks.api.mockReset();
  mocks.token = "one";
});

it("shares requests and reuses the catalog until explicitly refreshed", async () => {
  const catalog = [{ voiceId: "1", name: "Voice" }];
  mocks.api.mockResolvedValue({ voices: catalog });
  const { loadVoiceCatalog, cachedVoices } = await import("./voice-catalog");
  const first = loadVoiceCatalog();
  expect(loadVoiceCatalog()).toBe(first);
  await first;
  await loadVoiceCatalog();
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(cachedVoices()).toEqual(catalog);
  await loadVoiceCatalog(true);
  expect(mocks.api).toHaveBeenCalledTimes(2);
});

it("keeps the successful list on refresh failure and clears it on account change", async () => {
  mocks.api.mockResolvedValueOnce({ voices: [{ voiceId: "1", name: "Voice" }] });
  const { loadVoiceCatalog, cachedVoices } = await import("./voice-catalog");
  await loadVoiceCatalog();
  mocks.api.mockRejectedValueOnce(new Error("offline"));
  await expect(loadVoiceCatalog(true)).rejects.toThrow("offline");
  expect(cachedVoices()).toHaveLength(1);
  mocks.token = "two";
  expect(cachedVoices()).toBeUndefined();
  mocks.api.mockResolvedValueOnce({ voices: [] });
  await loadVoiceCatalog();
  expect(cachedVoices()).toEqual([]);
});
