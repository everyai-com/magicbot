// Shared JSON-domain vocabulary for the anti-slop lint contract.
//
// `unknown` may only appear at a parsing boundary; `Record<string, unknown>`
// is an unsafe dictionary everywhere. These named types let boundary code
// name what it holds (JSON text, decoded payloads, string maps) and let the
// type-guard helpers below replace `typeof` narrowing in ordinary code.

/** Any value JSON can carry. Prefer this over `unknown` once input is decoded. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A decoded JSON object whose members may be absent. */
export type JsonRecord = Record<string, JsonValue | undefined>;

/** A decoded JSON object with all members present. */
export type JsonObject = Record<string, JsonValue>;

/** A string-valued environment / header / query map. */
export type StringMap = Record<string, string>;

/** A string map whose entries may be absent (e.g. `process.env`). */
export type OptionalStringMap = Record<string, string | undefined>;

/** Guard: the value is a JSON object (never an array, never null). */
export function isJsonRecord(value: JsonValue | undefined): value is JsonRecord {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === "object";
}

/** Guard: the value is a JSON array. */
export function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

/** Guard: the value is a usable string (narrows `JsonValue | undefined`). */
export function isJsonString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** Guard: the value is a finite number (narrows `JsonValue | undefined`). */
export function isJsonNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Guard: the value is a boolean (narrows `JsonValue | undefined`). */
export function isJsonBoolean(value: JsonValue | undefined): value is boolean {
  return typeof value === "boolean";
}

/** Read a string member, falling back when absent or mistyped. */
export function jsonString(value: JsonValue | undefined, fallback = ""): string {
  return isJsonString(value) ? value : fallback;
}

/** Read an optional string member: string or undefined, never another shape. */
export function optionalJsonString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) ? value : undefined;
}

/** Read a finite-number member, falling back when absent or mistyped. */
export function jsonNumber(value: JsonValue | undefined, fallback = 0): number {
  return isJsonNumber(value) ? value : fallback;
}

/** Read an optional finite-number member: number or undefined. */
export function optionalJsonNumber(value: JsonValue | undefined): number | undefined {
  return isJsonNumber(value) ? value : undefined;
}

/** Read a boolean member; only an explicit `true` counts. */
export function jsonBoolean(value: JsonValue | undefined): boolean {
  return value === true;
}

/** Read an array member, falling back to empty when absent or mistyped. */
export function jsonArray(value: JsonValue | undefined): JsonValue[] {
  return isJsonArray(value) ? value : [];
}

/** Read an object member, falling back to empty when absent or mistyped. */
export function jsonRecord(value: JsonValue | undefined): JsonRecord {
  return isJsonRecord(value) ? value : {};
}
