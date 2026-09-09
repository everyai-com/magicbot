import { expect, it } from "vitest";
import { hostedCallSettings } from "./call-settings.ts";
it("maps saved call settings to the hosted agent contract", () => {
  expect(hostedCallSettings({ voices: "voice-id", model: "MagicTeams v0.7", temperature: 0, firstSpeaker: "caller", maxDuration: 600, language: "te" }, "Use my knowledge")).toEqual({ voice: "voice-id", model: "fixie-ai/ultravox-v0.7", temperature: 0, first_speaker: "FIRST_SPEAKER_USER", max_duration: 600, language_hint: "te", system_prompt: "Use my knowledge" });
});
it("preserves absent hosted defaults and rejects invalid durations", () => {
  expect(hostedCallSettings()).toEqual({});
  expect(() => hostedCallSettings({ maxDuration: -5 })).toThrow("duration");
});
