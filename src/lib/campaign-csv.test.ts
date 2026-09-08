import {expect,it} from "vitest";
import {parseCampaignCsv} from "./campaign-csv";
it("preserves phone numbers and quoted multiline fields",()=>{
 expect(parseCampaignCsv('Name,Phone,Notes\r\nAlice,+001234,"hello, world\nsecond line"')[0]).toMatchObject({first_name:"Alice",phone_number:"+001234",metadata:{Notes:"hello, world\nsecond line"}});
});
it("handles BOM, alternate delimiters and escaped quotes",()=>{
 expect(parseCampaignCsv('\uFEFFName;Email;Company\nBob;b@example.com;"A ""B"""')[0]).toMatchObject({email:"b@example.com",company:'A "B"'});
});
it("rejects incomplete files instead of silently losing rows",()=>{
 expect(()=>parseCampaignCsv('Name,Phone\nAlice,"123')).toThrow("unclosed");
 expect(()=>parseCampaignCsv('Name,Phone\nAlice,123,extra')).toThrow("row 2");
});
it("preserves all contacts in a large file without model output limits",()=>{
 expect(parseCampaignCsv('Name,Phone\n'+Array.from({length:1000},(_,i)=>'Person '+i+',+001'+i).join('\n'))).toHaveLength(1000);
});

it("keeps every original header and value in metadata for persistence", () => {
 const row = parseCampaignCsv('Full Name,Email,Company,Favorite Color,Empty\nAlice,a@example.com,Example,Blue,')[0];
 expect(row.metadata).toEqual({"Full Name":"Alice",Email:"a@example.com",Company:"Example","Favorite Color":"Blue",Empty:""});
});
