import { expect, it } from "vitest";
import { editableContactColumns } from "./CampaignContacts";

it("offers empty email and serial number fields for contacts with only a name and phone", () => {
  expect(editableContactColumns({ metadata: { Name: "Sam", "Phone Number": "+123" } })).toEqual({
    Name: "Sam", "Phone Number": "+123", "S.No": "", Email: "",
  });
});

it("preserves original aliases and custom fields without duplicate standard fields", () => {
  const metadata = { "Full Name": "Sam", Mobile: "+123", "Email Address": "sam@example.com", "Serial No": "8", Notes: "", Region: "West" };
  expect(editableContactColumns({ metadata })).toEqual(metadata);
});

it("uses the saved email when it is outside the imported metadata", () => {
  expect(editableContactColumns({ email: "sam@example.com", metadata: { Name: "Sam", Phone: "+123" } }).Email).toBe("sam@example.com");
});
