import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachToKnowledgeBase,
  parseKnowledgeCorpusMap,
  prepareKnowledgeFile,
  stringifyKnowledgeCorpusMap,
  withKnowledgeEntry,
} from "./knowledge-base";
import type { Attachment } from "./composer-attachments";

const textResponse = (body: string, type = "text/plain") =>
  new Response(body, { status: 200, headers: { "content-type": type } });

const fileAttachment = (name: string): Attachment => ({
  kind: "file",
  id: "a1",
  path: `/Users/me/.openmausbot/attachments/${name}`,
  name,
  size: 12,
});

const request = () => vi.fn(async (_path: string, _init?: RequestInit) => ({ item: { id: "k1" }, ultravoxKnowledge: { corpusId: "c1" } }));

/** A minimal ZIP carrying word/document.xml, so a DOCX can be built without a
 * zip dependency. `deflate` matches what Word actually writes. */
function docxZip(documentXml: string, deflate = false): ArrayBuffer {
  const name = Buffer.from("word/document.xml", "utf8");
  const raw = Buffer.from(documentXml, "utf8");
  const body = deflate ? deflateRawSync(raw) : raw;
  const method = deflate ? 8 : 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  const directory = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(local.length + name.length + body.length, 16);
  const bytes = Buffer.concat([local, name, body, directory, eocd]);
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe("prepareKnowledgeFile", () => {
  it("reads plain text and refuses unsupported formats", async () => {
    expect(await prepareKnowledgeFile(new File(["hello"], "notes.txt", { type: "text/plain" }))).toMatchObject({ name: "notes.txt", content: "hello" });
    const bad = await prepareKnowledgeFile(new File(["x"], "data.bin"));
    expect(bad.content).toBe("");
    expect(bad.error).toMatch(/Only PDF/);
  });

  it.each([[false, "stored"], [true, "deflated"]])("extracts the text out of a DOCX (%s)", async (deflate) => {
    const xml = '<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Pricing 4999</w:t></w:r></w:p><w:p><w:r><w:t>Second line</w:t></w:r></w:p></w:body></w:document>';
    const prepared = await prepareKnowledgeFile(new File([docxZip(xml, deflate as boolean)], "sheet.docx"));
    expect(prepared.error).toBeUndefined();
    expect(prepared.content).toContain("Pricing 4999");
    expect(prepared.content).toContain("Second line");
  });
});

describe("attachToKnowledgeBase", () => {
  it("creates a hosted document entry from a composer file chip", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return textResponse("hello world");
    }));
    const api = request();
    const result = await attachToKnowledgeBase({
      bot: { name: "FXBC 1 demo", remoteAgentId: "agent-1" },
      attachments: [fileAttachment("notes.txt")],
      instructions: "Pricing sheet",
      request: api,
    });

    expect(calls).toEqual(["/api/file-attachments/notes.txt"]);
    expect(api).toHaveBeenCalledTimes(1);
    const [path, init] = api.mock.calls[0]!;
    expect(path).toBe("/api/platform/agents/agent-1/knowledge-base");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ title: "Pricing sheet", type: "document", file_path: "notes.txt" });
    expect(body.content).toContain("## notes.txt");
    expect(body.content).toContain("hello world");
    expect(result).toEqual({
      title: "Pricing sheet",
      files: ["notes.txt"],
      ids: ["k1"],
      corpusMap: { k1: "c1" },
    });
  });

  it("stores pasted text as a text entry", async () => {
    const api = request();
    const result = await attachToKnowledgeBase({
      bot: { name: "Bot", remoteAgentId: "agent-2" },
      attachments: [{ kind: "paste", id: "p1", text: "keep this", size: 9, lines: 1 }],
      request: api,
    });
    const body = JSON.parse(String(api.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({ type: "text", file_path: null });
    expect(body.content).toContain("keep this");
    expect(result.files).toEqual([]);
  });

  it("requires a hosted agent and refuses images", async () => {
    const api = request();
    await expect(attachToKnowledgeBase({ bot: { name: "Local" }, attachments: [fileAttachment("a.txt")], request: api }))
      .rejects.toThrow(/isn't connected/);
    const image: Attachment = { kind: "image", id: "i1", path: "/api/attachments/x.png", name: "x.png", size: 1, mime: "image/png" };
    await expect(attachToKnowledgeBase({ bot: { name: "Bot", remoteAgentId: "a" }, attachments: [image], request: api }))
      .rejects.toThrow(/Images/);
    expect(api).not.toHaveBeenCalled();
  });

  it("reports unreadable files instead of posting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => textResponse("")));
    const api = request();
    await expect(attachToKnowledgeBase({ bot: { name: "Bot", remoteAgentId: "a" }, attachments: [fileAttachment("data.bin")], request: api }))
      .rejects.toThrow(/Nothing was added/);
    expect(api).not.toHaveBeenCalled();
  });
});

describe("knowledge metadata", () => {
  it("appends the entry and records ids and corpora", () => {
    const config = { knowledgeBase: "Name: Old", knowledgeBaseIds: "old-1", knowledgeBaseCorpusMap: JSON.stringify({ "old-1": "c-old" }) };
    const next = withKnowledgeEntry(config, {
      title: "New",
      files: ["a.pdf"],
      ids: ["k1"],
      corpusMap: { k1: "c1" },
    });
    expect(next.knowledgeBase).toBe("Name: Old\n\n---\nName: New\nFiles: a.pdf");
    expect(next.knowledgeBaseIds).toBe("old-1,k1");
    expect(parseKnowledgeCorpusMap(next.knowledgeBaseCorpusMap)).toEqual({ "old-1": "c-old", k1: "c1" });
    expect(stringifyKnowledgeCorpusMap({ a: " ", b: "c" })).toBe(JSON.stringify({ b: "c" }));
  });
});
