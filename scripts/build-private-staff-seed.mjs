import fs from "node:fs";
const staffInput=new URL("../data/private/staff.private.json",import.meta.url);
const legacyInput=new URL("../data/private/legacy-access.private.json",import.meta.url);
const output=new URL("../data/private/staff.seed.sql",import.meta.url);
if(!fs.existsSync(staffInput)){console.error("Missing data/private/staff.private.json");process.exit(2);}
const rows=JSON.parse(fs.readFileSync(staffInput,"utf8"));
if(!Array.isArray(rows)||!rows.length)throw new Error("Staff import must be non-empty");
const esc=v=>"'"+String(v??"").replaceAll("'","''")+"'";
const q=v=>v==null||String(v).trim()===""?"NULL":esc(String(v).trim());
const seen=new Set(),sql=["BEGIN TRANSACTION;"];
for(const [i,r] of rows.entries()){
 for(const k of ["id","displayName","role"])if(!r[k])throw new Error(`Row ${i+1} missing ${k}`);
 const email=r.email?String(r.email).trim().toLowerCase():null;
 if(email){if(seen.has(email))throw new Error(`Duplicate email: ${email}`);seen.add(email);}
 const loginEnabled=r.loginEnabled===true;
 if(loginEnabled&&!email)throw new Error(`Row ${i+1} enables login without email`);
 sql.push(`INSERT INTO staff_users(id,email,display_name,role,department,committee,active,login_enabled,imported_from) VALUES(${esc(r.id)},${q(email)},${esc(r.displayName)},${esc(r.role)},${q(r.department)},${q(r.committee)},${r.active===false?0:1},${loginEnabled?1:0},'PRIVATE_DOL_ROSTER_IMPORT');`);
}
if(fs.existsSync(legacyInput)){
 const legacy=JSON.parse(fs.readFileSync(legacyInput,"utf8"));
 if(!Array.isArray(legacy))throw new Error("legacy-access.private.json must be an array");
 for(const [i,r] of legacy.entries()){
  for(const k of ["legacyUserId","email","sourceLabel"])if(!r[k])throw new Error(`Legacy row ${i+1} missing ${k}`);
  sql.push(`INSERT INTO legacy_access_accounts(legacy_user_id,email,display_name,legacy_role,active,source_label) VALUES(${esc(r.legacyUserId)},${esc(String(r.email).trim().toLowerCase())},${q(r.displayName)},${q(r.legacyRole)},${r.active===false?0:1},${esc(r.sourceLabel)});`);
 }
}
sql.push("COMMIT;");
fs.writeFileSync(output,sql.join("\n")+"\n",{mode:0o600});
console.log(`Prepared ${rows.length} staff directory rows${fs.existsSync(legacyInput)?" plus legacy access rows":""}`);
