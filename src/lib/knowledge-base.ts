// Knowledge-base plumbing shared by the Bot profile "Add knowledge" form and
// the composer's /attach command: document text extraction, the corpus map
// stored on the bot profile, and the hosted create call.

import { attachmentBasename, type Attachment, type FileAttachment } from "./composer-attachments";
import type { AgentProfileConfig } from "../../shared/agent-config";

export interface PreparedKnowledgeFile {
  name: string;
  content: string;
  error?: string;
}

const UNREADABLE_HINT = "Use PDF, TXT, MD, or DOCX files containing text.";

export async function prepareKnowledgeFile(file: File): Promise<PreparedKnowledgeFile> {
  try {
    if (/\.(txt|md)$/i.test(file.name) || /^text\//i.test(file.type)) {
      return { name: file.name, content: (await file.text()).trim() };
    }
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      const { extractPdfText } = await import("@/lib/knowledge-pdf");
      return { name: file.name, content: await extractPdfText(new Uint8Array(await file.arrayBuffer())) };
    }
    if (/\.docx$/i.test(file.name)) {
      const content = (await extractDocxText(file)).trim();
      return {
        name: file.name,
        content,
        error: content ? undefined : "No text could be extracted from this DOCX file.",
      };
    }
    return {
      name: file.name,
      content: "",
      error: "Only PDF, TXT, MD, and DOCX files can be imported. Convert this file to a supported format first.",
    };
  } catch (caught) {
    return {
      name: file.name,
      content: "",
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

function decodeXmlText(xml: string): string {
  const body = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

async function inflateZipEntry(bytes: Uint8Array): Promise<Uint8Array> {
  const payload = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(payload).set(bytes);
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function extractDocxText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder();
  let eocdOffset = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + index, 4);
    if (view.getUint32(0, true) === 0x06054b50) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset < 0) return "";
  const eocd = new DataView(bytes.buffer, bytes.byteOffset + eocdOffset);
  const centralDirectorySize = eocd.getUint32(12, true);
  const centralDirectoryOffset = eocd.getUint32(16, true);
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  while (offset + 46 <= centralDirectoryEnd && offset + 46 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    if (view.getUint32(0, true) !== 0x02014b50) break;
    const compression = view.getUint16(10, true);
    const compressedSize = view.getUint32(20, true);
    const uncompressedSize = view.getUint32(24, true);
    const fileNameLength = view.getUint16(28, true);
    const extraLength = view.getUint16(30, true);
    const commentLength = view.getUint16(32, true);
    const localHeaderOffset = view.getUint32(42, true);
    const nameStart = offset + 46;
    const fileName = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength));
    if (fileName === "word/document.xml") {
      const local = new DataView(bytes.buffer, bytes.byteOffset + localHeaderOffset);
      if (local.getUint32(0, true) !== 0x04034b50) return "";
      const localNameLength = local.getUint16(26, true);
      const localExtraLength = local.getUint16(28, true);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      const compressed = bytes.slice(dataStart, dataEnd);
      const data = compression === 0
        ? compressed
        : compression === 8
          ? await inflateZipEntry(compressed)
          : new Uint8Array();
      const xml = decoder.decode(data.slice(0, uncompressedSize || undefined));
      return decodeXmlText(xml);
    }
    offset = nameStart + fileNameLength + extraLength + commentLength;
  }
  return "";
}

export function parseKnowledgeCorpusMap(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] =>
        typeof entry[0] === "string" &&
        typeof entry[1] === "string" &&
        entry[1].trim().length > 0,
      ),
    );
  } catch {
    return {};
  }
}

export function stringifyKnowledgeCorpusMap(value: Record<string, string>): string {
  const entries = Object.entries(value).filter(([, corpusId]) => corpusId.trim());
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : "";
}

export interface KnowledgeAttachResult {
  title: string;
  /** file names included in the entry (pastes have none) */
  files: string[];
  /** knowledge record ids created on the hosted agent */
  ids: string[];
  /** knowledge record id → Ultravox corpus id, for the profile's corpus map */
  corpusMap: Record<string, string>;
}

/** Composer chips hold the path the server wrote; the document route is
 * name-locked to the attachments dir, so read the bytes back by basename.
 * (The image route refuses document names by design.) */
async function readComposerAttachment(attachment: FileAttachment): Promise<File> {
  const name = attachmentBasename(attachment.path);
  const response = await fetch(`/api/file-attachments/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`Couldn't read ${attachment.name}. Attach a PDF, TXT, MD, or DOCX file and try again.`);
  const blob = await response.blob();
  return new File([blob], attachment.name, { type: blob.type || "application/octet-stream" });
}

function knowledgeEntryTitle(instructions: string, files: string[]): string {
  const named = instructions.replace(/\s+/g, " ").trim();
  if (named) return named.slice(0, 120);
  if (files.length) return files.join(", ").slice(0, 120);
  return "Attached knowledge";
}

/** Create one hosted knowledge entry from the composer's attachment chips.
 * `request` is the app's authenticated API client (see state/store `api`). */
export async function attachToKnowledgeBase(input: {
  bot: { name: string; remoteAgentId?: string };
  attachments: Attachment[];
  instructions?: string;
  request: (path: string, init?: RequestInit) => Promise<any>;
}): Promise<KnowledgeAttachResult> {
  const { bot } = input;
  const instructions = (input.instructions ?? "").trim();
  if (!bot.remoteAgentId) {
    throw new Error(`${bot.name} isn't connected to a hosted MagicTeams agent, so its knowledge base can't be updated.`);
  }
  if (!input.attachments.length) throw new Error("Attach a file first, then send /attach again.");
  if (input.attachments.some((attachment) => attachment.kind === "image")) {
    throw new Error(`Images can't be added to a knowledge base. ${UNREADABLE_HINT}`);
  }

  const sections: string[] = [];
  const files: string[] = [];
  const unreadable: string[] = [];
  for (const attachment of input.attachments) {
    const prepared = attachment.kind === "paste"
      ? { name: "Pasted text", content: attachment.text.trim(), error: undefined }
      : attachment.kind === "file"
        ? await prepareKnowledgeFile(await readComposerAttachment(attachment))
        : null;
    if (!prepared) continue;
    if (prepared.error || !prepared.content.trim()) {
      unreadable.push(prepared.error ? `${prepared.name} (${prepared.error})` : prepared.name);
      continue;
    }
    sections.push(`## ${prepared.name}\n${prepared.content.trim()}`);
    if (attachment.kind === "file") files.push(attachment.name);
  }
  if (unreadable.length) {
    throw new Error(`Nothing was added. These attachments could not be read: ${unreadable.join(", ")}. ${UNREADABLE_HINT}`);
  }

  const title = knowledgeEntryTitle(instructions, files);
  const content = [
    instructions,
    files.length ? `Files: ${files.join(", ")}` : "",
    ...sections,
  ].filter(Boolean).join("\n\n");
  // SAFETY: this route is the app's own hosted knowledge-base proxy; the
  // create response is the platform's item envelope, read defensively below.
  const result = await input.request(`/api/platform/agents/${encodeURIComponent(bot.remoteAgentId)}/knowledge-base`, {
    method: "POST",
    body: JSON.stringify({
      title,
      type: files.length ? "document" : "text",
      content,
      file_path: files.join(", ") || null,
      description: instructions || null,
    }),
  }) as {
    item?: { id?: string; _id?: string };
    ultravoxKnowledge?: { corpusId?: string };
  };

  const id = result.item?.id ?? result.item?._id ?? "";
  const corpusId = result.ultravoxKnowledge?.corpusId ?? "";
  return {
    title,
    files,
    ids: id ? [id] : [],
    corpusMap: id && corpusId ? { [id]: corpusId } : {},
  };
}

/** Fold a just-created entry into the bot profile's local knowledge metadata
 * so it shows up (and stays deletable) without a round trip through the form. */
export function withKnowledgeEntry(
  config: AgentProfileConfig | undefined,
  result: KnowledgeAttachResult,
): AgentProfileConfig {
  const existing = (config?.knowledgeBase ?? "").trim();
  const entry = [
    `Name: ${result.title}`,
    result.files.length ? `Files: ${result.files.join(", ")}` : "",
  ].filter(Boolean).join("\n");
  const existingIds = (config?.knowledgeBaseIds ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return {
    ...config,
    knowledgeBase: existing ? `${existing}\n\n---\n${entry}` : entry,
    knowledgeBaseIds: [...existingIds, ...result.ids].join(","),
    knowledgeBaseCorpusMap: stringifyKnowledgeCorpusMap({
      ...parseKnowledgeCorpusMap(config?.knowledgeBaseCorpusMap),
      ...result.corpusMap,
    }),
  };
}
