interface VoiceLanguage {
  primaryLanguage?: string;
  languageLabel?: string;
}

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

/** Group regional voices under their base language (te-IN → Telugu). */
export function voiceLanguageName(voice: VoiceLanguage): string {
  const primary = voice.primaryLanguage?.trim() ?? "";
  const base = primary.split(/[-_]/)[0].toLowerCase();
  if (/^[a-z]{2,3}$/.test(base)) {
    const name = languageNames.of(base);
    if (name && name !== base) return name;
  }
  const label = (voice.languageLabel || primary)
    .replace(/^[^\p{L}]+/u, "")
    .split(/[([]/)[0].trim();
  return label || "Unknown language";
}
