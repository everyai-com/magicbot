import { expect, it } from "vitest";
import { prepareEmailContacts } from "./email-campaign";
const message = JSON.stringify({ to: "<<email>>", subject: "Hello <<name>>", body: "Your region: <<Region>>" });
it("prepares selected recipients from metadata, including custom placeholders and updated email", () => {
 const rows = [{ first_name: "Old", email: "old@example.com", metadata: { Name: "Sam", Email: "sam@example.com", Region: "West" } }, { name: "No email" }];
 const result = prepareEmailContacts(rows, [0], message);
 expect(result[0]).toMatchObject({ name: "Sam", first_name: "Sam", email: "sam@example.com", Region: "West" });
 expect(result[1]).toBe(rows[1]);
});
it("rejects selected contacts without emails or placeholder values", () => {
 expect(() => prepareEmailContacts([{ name: "Sam" }], [0], message)).toThrow("no valid email");
 expect(() => prepareEmailContacts([{ name: "Sam", email: "sam@example.com" }], [0], message)).toThrow("<<Region>>");
});
it("does not send a contact's email to a different template recipient", () => {
 expect(() => prepareEmailContacts([{ name: "Sam", email: "sam@example.com", Region: "West" }], [0], JSON.stringify({ to: "other@example.com", subject: "Hello", body: "Hi" }))).toThrow("To field");
});
it("supports serialized metadata and rejects stale or empty selections", () => {
 expect(prepareEmailContacts([{ metadata: JSON.stringify({ name: "Sam", email: "sam@example.com", Region: "West" }) }], [0], message)[0].name).toBe("Sam");
 expect(() => prepareEmailContacts([], [], message)).toThrow("Select");
 expect(() => prepareEmailContacts([], [0], message)).toThrow("selection changed");
});
