import { expect, it } from "vitest";
import { customToolNotes } from "./custom-tool-entries";

const tool = [
  "Tool Name: magic_bots",
  "Base URL Pattern: https://example.com/webhook",
  "HTTP Method: POST",
  "Timeout: 20s",
  "Agent End Behavior: Default",
  "Static Response: Disabled",
  "Parameters:",
  "- company (Dynamic, Body, String, required): Company name",
].join("\n");

it("keeps a saved tool and all its configuration in one entry", () => {
  expect(customToolNotes(tool)).toEqual([tool]);
});

it("splits multiple saved tools only at their separator", () => {
  const second = tool.replace("magic_bots", "lookup_contact");
  expect(customToolNotes(`${tool}\n\n---\n${second}`)).toEqual([tool, second]);
  expect(customToolNotes(`${tool}\n\n---\n${second}`.replaceAll("\n", "\r\n")))
    .toEqual([tool.replaceAll("\n", "\r\n"), second.replaceAll("\n", "\r\n")]);
});

it("does not count empty configurations as tools", () => {
  expect(customToolNotes(undefined)).toEqual([]);
  expect(customToolNotes(" \n ")).toEqual([]);
});
