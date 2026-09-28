import fs from "node:fs";
const input=new URL("../data/private/staff.private.json",import.meta.url);
const output=new URL("../data/private/staff.seed.sql",import.meta.url);
if(!fs.existsSync(input)){console.error("Missing data/private/staff.private.json");process.exit(2);}
const rows=JSON.parse(fs.readFileSync(input,"utf8")); if(!Array.isArray(rows)||!rows.length) throw new Error("Staff import must be non-empty");
const esc=v=>"'"+String(v??"").replaceAll("'","''")+"'";
const seen=new Set(),sql=["BEGIN TRANSACTION;"];
for(const [i,r] of rows.entries()){for(const k of ["id","email","displayName","role"])if(!r[k])throw new Error(`Row ${i+1} missing ${k}`);const e=String(r.email).trim().toLowerCase();if(seen.has(e))throw new Error(`Duplicate email: ${e}`);seen.add(e);sql.push(`INSERT INTO staff_users(id,email,display_name,role,department,committee,active,imported_from) VALUES(${esc(r.id)},${esc(e)},${esc(r.displayName)},${esc(r.role)},${r.department?esc(r.department):"NULL"},${r.committee?esc(r.committee):"NULL"},${r.active===false?0:1},'PRIVATE_DOL_ROSTER_IMPORT');`);}sql.push("COMMIT;");fs.writeFileSync(output,sql.join("\n")+"\n",{mode:0o600});console.log(`Prepared ${rows.length} private staff rows`);
