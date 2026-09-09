import { afterEach, expect, it, vi } from "vitest";
import { signOutBetterAuth } from "./auth";
afterEach(() => vi.unstubAllGlobals());
it("revokes the hosted session before leaving and clears local credentials", async () => {
  const removeItem = vi.fn();
  const replace = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => "session-token", removeItem });
  vi.stubGlobal("window", { location: { replace, reload: vi.fn() } });
  const fetchMock = vi.fn().mockResolvedValue({});
  vi.stubGlobal("fetch", fetchMock);
  signOutBetterAuth(true);
  await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledWith("/logout", expect.objectContaining({ method:"POST", credentials:"same-origin", headers:{authorization:"Bearer session-token"} }));
  expect(removeItem).toHaveBeenCalledWith("magicteams-auth-token");
  expect(removeItem).toHaveBeenCalledWith("magicteams-auth-user");
  expect(replace).toHaveBeenCalledWith("/logout");
});
it("retains local app sign-out behavior", () => {
  const reload = vi.fn();
  vi.stubGlobal("localStorage", { getItem: () => null, removeItem: vi.fn() });
  vi.stubGlobal("window", { location: { reload } });
  signOutBetterAuth();
  expect(reload).toHaveBeenCalledOnce();
});
