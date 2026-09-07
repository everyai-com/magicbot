import { expect, it } from "vitest";
import { gmailDraftUrl } from "./crm-email";
const template = { to: "<<email>>", subject: "Follow up for <<name>>", body: "Hi <<name>>,\nCompany: <<company>>\nEmail: <<email>>" };
it("renders campaign metadata and first_name into a Gmail draft", () => {
  const url = new URL(gmailDraftUrl(template, { first_name: "Rahul", metadata: { email: "rahul@example.com", company: "ABC Realty" } }));
  expect(url.searchParams.get("to")).toBe("rahul@example.com");
  expect(url.searchParams.get("su")).toBe("Follow up for Rahul");
  expect(url.searchParams.get("body")).toBe("Hi Rahul,\nCompany: ABC Realty\nEmail: rahul@example.com");
});
it("encodes special characters without changing draft fields", () => {
  const url = new URL(gmailDraftUrl(template, { name: "A & B", email: "a+b@example.com", company: "తెలుగు #1? &to=other@example.com" }));
  expect(url.searchParams.get("to")).toBe("a+b@example.com");
  expect(url.searchParams.get("body")).toContain("తెలుగు #1? &to=other@example.com");
});
it("blocks missing fields and malformed recipients", () => {
  expect(() => gmailDraftUrl(template, { name: "Rahul", email: "rahul@example.com" })).toThrow("company");
  expect(() => gmailDraftUrl(template, { name: "Rahul", email: "bad\n@example.com", company: "ABC" })).toThrow("valid recipient");
});
it("does not resolve inherited properties or recursively expand contact text", () => {
  expect(() => gmailDraftUrl({ ...template, body: "<<constructor>>" }, { name: "A", email: "a@example.com" })).toThrow("Missing");
  const url = new URL(gmailDraftUrl({ ...template, body: "<<name>>" }, { name: "<<company>>", email: "a@example.com" }));
  expect(url.searchParams.get("body")).toBe("<<company>>");
});
