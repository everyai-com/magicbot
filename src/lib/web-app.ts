import { useSyncExternalStore } from "react";

type InstallChoice = { outcome: "accepted" | "dismissed"; platform: string };
type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<InstallChoice>;
};

type WebAppSnapshot = {
  installable: boolean;
  installed: boolean;
};

let promptEvent: InstallPromptEvent | null = null;
let snapshot: WebAppSnapshot = { installable: false, installed: false };
const listeners = new Set<() => void>();

function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

function publish() {
  snapshot = { installable: Boolean(promptEvent), installed: isInstalled() };
  for (const listener of listeners) listener();
}

if (!window.ogb) {
  snapshot = { ...snapshot, installed: isInstalled() };
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    // SAFETY: beforeinstallprompt is Chromium's install event; this listener
    // only runs for that named event and the interface mirrors its contract.
    promptEvent = event as InstallPromptEvent;
    publish();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", publish);
  window.addEventListener("pageshow", publish);
  window.addEventListener("focus", publish);
  window.addEventListener("appinstalled", () => {
    promptEvent = null;
    publish();
  });
}

export function initializeWebApp(): void {
  if (window.ogb || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // The app remains a normal website when registration is unavailable.
  });
}

export function useWebAppInstall(): WebAppSnapshot & { install(): Promise<boolean> } {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
  return { ...state, install: promptWebAppInstall };
}

async function promptWebAppInstall(): Promise<boolean> {
  const event = promptEvent;
  if (!event) return false;
  // Each browser prompt can be used only once, even when dismissed.
  promptEvent = null;
  publish();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome === "accepted";
}
