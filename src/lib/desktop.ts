import { speechInput } from "./speech-input";

function makeBrowserCapabilities(): DesktopCapabilities {
  const speechAvailable = speechInput.available();
  return {
    host: {
      platform: "other",
      label: "Browser",
      session: "unknown",
      packaged: false,
    },
    windowChrome: "native",
    screenPreview: {
      available: false,
      interaction: "none",
      reasonCode: "desktop-app-required",
    },
    dictation: {
      available: speechAvailable,
      engine: speechAvailable ? "browser-speech" : "none",
      onDevice: false,
      reasonCode: speechAvailable ? undefined : "browser-speech-unavailable",
    },
    localComputer: {
      available: false,
      support: "unsupported",
      enabled: false,
      status: "unavailable",
      reasonCode: "desktop-app-required",
    },
  };
}

let cached: DesktopCapabilities | null = null;
let cacheRevision = 0;

export function browserDesktopCapabilities(): DesktopCapabilities {
  return makeBrowserCapabilities();
}

export function initialDesktopCapabilities(): DesktopCapabilities {
  const platform = window.ogb?.platform;
  if (!platform) return makeBrowserCapabilities();
  const browserCapabilities = makeBrowserCapabilities();
  const isMac = platform === "darwin";
  const dictation: DesktopCapabilities["dictation"] = {
    available: isMac,
    engine: isMac ? "apple-speech" : "none",
    onDevice: isMac,
  };
  if (!isMac) dictation.reasonCode = "unsupported-platform";
  return {
    ...browserCapabilities,
    host: {
      ...browserCapabilities.host,
      platform: platform === "darwin" || platform === "linux" || platform === "win32" ? platform : "other",
      label: platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform === "win32" ? "Windows" : "Desktop",
    },
    windowChrome: isMac ? "mac-inset" : "native",
    dictation,
  };
}

export async function loadDesktopCapabilities(): Promise<DesktopCapabilities> {
  if (cached) return cached;
  if (!window.ogb?.getCapabilities) return makeBrowserCapabilities();
  const revisionAtStart = cacheRevision;
  let loaded: DesktopCapabilities;
  try {
    loaded = await window.ogb.getCapabilities();
  } catch {
    loaded = makeBrowserCapabilities();
  }
  // An IPC push may deliver newer runtime readiness while the initial query is
  // still pending. Never let that older response replace the pushed state.
  if (cacheRevision !== revisionAtStart && cached) return cached;
  cached = loaded;
  return cached;
}

export function cacheDesktopCapabilities(capabilities: DesktopCapabilities): DesktopCapabilities {
  cacheRevision += 1;
  cached = capabilities;
  return capabilities;
}
