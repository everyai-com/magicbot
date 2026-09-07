export interface OperatingProfile {
  roles: string[];
  workingStyle: string;
  priorities: string[];
  communicationStyle: string;
  boundaries: string[];
  timezone: string;
}

const LIST_LIMIT = 12;
const ITEM_LIMIT = 160;
const TEXT_LIMIT = 1_200;

const cleanText = (value: unknown, limit: number) => typeof value === "string"
  ? value.replace(/\u0000/g, "").trim().slice(0, limit)
  : "";

const cleanList = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.map((item) => cleanText(item, ITEM_LIMIT)).filter(Boolean))].slice(0, LIST_LIMIT)
  : [];

export function normalizeOperatingProfile(value: unknown): OperatingProfile {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    roles: cleanList(record.roles),
    workingStyle: cleanText(record.workingStyle, TEXT_LIMIT),
    priorities: cleanList(record.priorities),
    communicationStyle: cleanText(record.communicationStyle, TEXT_LIMIT),
    boundaries: cleanList(record.boundaries),
    timezone: cleanText(record.timezone, 80),
  };
}

export function renderOperatingProfile(profile: OperatingProfile): string {
  const lines: string[] = [];
  if (profile.roles.length) lines.push(`Roles: ${profile.roles.join("; ")}`);
  if (profile.priorities.length) lines.push(`Current priorities: ${profile.priorities.join("; ")}`);
  if (profile.workingStyle) lines.push(`Working style: ${profile.workingStyle}`);
  if (profile.communicationStyle) lines.push(`Communication preferences: ${profile.communicationStyle}`);
  if (profile.boundaries.length) lines.push(`Boundaries: ${profile.boundaries.join("; ")}`);
  if (profile.timezone) lines.push(`Timezone: ${profile.timezone}`);
  return lines.join("\n").slice(0, 4_000);
}
