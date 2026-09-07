export function isDemoCallConnected(status: string): boolean {
  return ["idle", "listening", "thinking", "speaking"].includes(status);
}

interface DemoSession extends EventTarget {
  readonly status: string;
  joinCall(url: string): void;
}

/** joinCall returns void: wait for the SDK's connection event, not its return. */
export function joinDemoSession(session: DemoSession, url: string, timeoutMs = 45_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      session.removeEventListener("status", onStatus);
      session.removeEventListener("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onStatus = () => {
      if (isDemoCallConnected(session.status)) finish();
      else if (session.status === "disconnected") finish(new Error("Demo call disconnected before connecting. Please try again."));
    };
    const onError = (event: Event) => finish((event as Event & { error?: Error }).error ?? new Error("Could not connect the demo call. Check microphone access and try again."));
    const timer = setTimeout(() => finish(new Error("Demo call connection timed out. Check microphone access and your connection, then try again.")), timeoutMs);
    session.addEventListener("status", onStatus);
    session.addEventListener("error", onError);
    try {
      session.joinCall(url);
      if (isDemoCallConnected(session.status)) finish();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
