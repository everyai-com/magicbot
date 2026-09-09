import { expect, it } from "vitest";
import { matchOutcomeContact } from "./campaign-outcomes";
it("uses contact ID before phone and never falls back from a missing ID", () => {
 const contacts = [{id: "a", phone_number: "+123"}, {id: "b", phone_number: "+123"}];
 expect(matchOutcomeContact({contact_id: "b", phone_number: "123"}, contacts)).toBe(contacts[1]);
 expect(matchOutcomeContact({contact_id: "missing", phone_number: "123"}, contacts)).toBeUndefined();
});
it("matches formatted phones only when unique", () => {
 const contact = {id: "a", phone_number: "+1 (234) 567"};
 expect(matchOutcomeContact({phone_number: "1234567"}, [contact])).toBe(contact);
 expect(matchOutcomeContact({phone_number: "1234567"}, [contact, {...contact, id: "b"}])).toBeUndefined();
 expect(matchOutcomeContact({}, [contact])).toBeUndefined();
});
