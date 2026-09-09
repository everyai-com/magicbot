import { expect, it } from "vitest";
import { voiceLanguageName } from "./voice-language";

it("groups Telugu locale variants without including other languages", () => {
  const voices = [
    { primaryLanguage: "te-IN" },
    { primaryLanguage: "te" },
    { languageLabel: "🇮🇳 Telugu (India)" },
    { primaryLanguage: "ta-IN" },
    { primaryLanguage: "en-US" },
  ];
  expect(voices.filter((voice) => voiceLanguageName(voice) === "Telugu")).toHaveLength(3);
});

it("groups regional labels and handles missing metadata", () => {
  expect(voiceLanguageName({ languageLabel: "🇺🇸 English (United States)" })).toBe("English");
  expect(voiceLanguageName({ primaryLanguage: "en_GB" })).toBe("English");
  expect(voiceLanguageName({ primaryLanguage: "Telugu" })).toBe("Telugu");
  expect(voiceLanguageName({})).toBe("Unknown language");
});
