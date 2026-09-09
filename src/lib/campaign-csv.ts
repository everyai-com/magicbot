/** Parse contact files without asking a model to reproduce personal data. */
export function parseCampaignCsv(source: string): Array<Record<string, unknown>> {
  const text = source.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = [",", ";", "\t"].sort((a,b) => firstLine.split(b).length-firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if(c === '"') {
      if(quoted && text[i+1] === '"') { field+='"'; i++; }
      else if(quoted || !field.trim()) quoted=!quoted;
      else field+=c;
    } else if(!quoted && c===delimiter) { row.push(field.trim()); field=""; }
    else if(!quoted && (c==="\n" || c==="\r")) {
      if(c==="\r" && text[i+1]==="\n") i++;
      row.push(field.trim()); if(row.some(Boolean)) rows.push(row); row=[];field="";
    } else field+=c;
  }
  if(quoted) throw new Error("The CSV has an unclosed quoted field. Check the file and upload it again.");
  row.push(field.trim());if(row.some(Boolean)) rows.push(row);
  if(rows.length<2) throw new Error("The CSV needs a header row and at least one contact.");
  const headers=rows.shift()!;
  const aliases: Record<string,string> = {
    name:"first_name",fullname:"first_name",contactname:"first_name",firstname:"first_name",
    lastname:"last_name",surname:"last_name",phone:"phone_number",phonenumber:"phone_number",
    mobile:"phone_number",mobilenumber:"phone_number",telephone:"phone_number",contactnumber:"phone_number",
    email:"email",emailaddress:"email",company:"company",companyname:"company",organization:"company"
  };
  const keys=headers.map(h=>aliases[h.toLowerCase().replace(/[^a-z0-9]/g,"")] ?? null);
  if(!keys.some(k=>k==="phone_number" || k==="email")) throw new Error("Add a Phone or Email column header so contacts can be identified.");
  if(new Set(headers).size!==headers.length || headers.some(h=>!h)) throw new Error("Each CSV column needs a unique, non-empty header.");
  return rows.map((values,index)=>{
    if(values.length!==headers.length) throw new Error("CSV row "+(index+2)+" has a different number of columns than the header.");
    const contact: Record<string,unknown>={first_name:"",phone_number:"",email:"",company:""};
    const metadata: Record<string,string>=Object.fromEntries(headers.map((header, i) => [header, values[i]]));
    values.forEach((value,i)=>{
      const key=keys[i];
      if(key && !contact[key]) contact[key]=value;

    });
    contact.metadata=metadata;
    return contact;
  });
}
