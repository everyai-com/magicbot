export const BOT_PERSONALITIES = [
  "calm",
  "energetic",
  "curious",
  "analytical",
  "creative",
  "friendly",
] as const;

export type BotPersonality = (typeof BOT_PERSONALITIES)[number];

export const AUTO_BOT_COLORS = [
  "green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral",
] as const;

export const AUTO_BOT_EXPRESSIONS = [
  "idle", "happy", "excited", "curious", "thinking", "surprised", "working",
  "shy", "drowsy", "celebrate", "confused", "sad",
] as const;

export const BOT_PERSONALITY_DETAILS = {
  calm: { label: "Calm", description: "Slow, steady and deliberate" },
  energetic: { label: "Energetic", description: "Quick, springy and reactive" },
  curious: { label: "Curious", description: "Leans in and looks around" },
  analytical: { label: "Analytical", description: "Precise, measured scanning" },
  creative: { label: "Creative", description: "Playful, elastic movement" },
  friendly: { label: "Friendly", description: "Soft blinks and warm reactions" },
} satisfies Record<BotPersonality, { label: string; description: string }>;

export function normalizeBotPersonality(value?: BotPersonality): BotPersonality {
  switch (value) {
    case "calm":
    case "energetic":
    case "curious":
    case "analytical":
    case "creative":
      return value;
    default:
      return "friendly";
  }
}

/** Stable pseudo-random appearance from an opaque bot id. Different salts
 * create a fresh shuffle; the same stored id always restores the same look. */
export function automaticBotAppearance(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const pick = <T>(values: readonly T[], shift: number): T =>
    values[Math.abs((hash ^ Math.imul(shift, 0x9e3779b1)) | 0) % values.length]!;
  return {
    color: pick(AUTO_BOT_COLORS, 1),
    mascotExpression: pick(AUTO_BOT_EXPRESSIONS, 2),
    personality: pick(BOT_PERSONALITIES, 3),
  };
}
