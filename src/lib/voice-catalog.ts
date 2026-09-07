import { api } from "@/state/store";
import { betterAuthToken } from "@/lib/auth";

export interface CatalogVoice {
  voiceId: string;
  name: string;
  languageLabel?: string;
  primaryLanguage?: string;
  provider?: string;
  previewUrl?: string;
}

// Share successful catalog requests across settings and every agent profile.
// Scope to the signed-in session; never persist authentication tokens.
let scope: string | null | undefined;
let voices: CatalogVoice[] | undefined;
let pending: Promise<{ voices: CatalogVoice[] }> | undefined;

export function cachedVoices(): CatalogVoice[] | undefined {
  const nextScope = betterAuthToken();
  if (nextScope !== scope) {
    scope = nextScope;
    voices = undefined;
    pending = undefined;
  }
  return voices;
}

export function loadVoiceCatalog(refresh = false): Promise<{ voices: CatalogVoice[] }> {
  const cached = cachedVoices();
  if (pending) return pending;
  if (cached && !refresh) return Promise.resolve({ voices: cached });
  const requestScope = scope;
  const request = api("/api/ultravox/voices")
    .then((result: { voices?: CatalogVoice[]; error?: string }) => {
      if (result.error) throw new Error(result.error);
      if (!Array.isArray(result.voices)) throw new Error("Could not load voices.");
      if (scope === requestScope) voices = result.voices;
      return { voices: result.voices };
    })
    .finally(() => {
      if (pending === request) pending = undefined;
    });
  pending = request;
  return request;
}
