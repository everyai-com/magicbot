import type { AgentProfileConfig } from "../shared/agent-config.ts";
/** Map only saved settings; absent fields must not overwrite hosted defaults. */
export function hostedCallSettings(config: AgentProfileConfig = {}, prompt?: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (prompt !== undefined) result.system_prompt = prompt;
  if (config.voices?.trim()) result.voice = config.voices.trim();
  if (config.model?.trim()) {
    const model = config.model.trim();
    result.model = /^MagicTeams v([\d.]+)$/.test(model) ? `fixie-ai/ultravox-v${model.match(/^MagicTeams v([\d.]+)$/)![1]}` : model;
  }
  if (config.temperature !== undefined) {
    if (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 1) throw new Error("Temperature must be between 0 and 1.");
    result.temperature = config.temperature;
  }
  if (config.maxDuration !== undefined) {
    if (!Number.isFinite(config.maxDuration) || config.maxDuration <= 0) throw new Error("Call duration must be positive.");
    result.max_duration = Math.floor(config.maxDuration);
  }
  if (config.firstSpeaker) result.first_speaker = config.firstSpeaker === "caller" ? "FIRST_SPEAKER_USER" : "FIRST_SPEAKER_AGENT";
  if (config.language?.trim()) result.language_hint = config.language.trim();
  return result;
}
