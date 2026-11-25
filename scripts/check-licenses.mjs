import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const lock=JSON.parse(readFileSync("package-lock.json","utf8"));
const assets=JSON.parse(readFileSync("licenses/assets.json","utf8"));
const allowed=new Set(["MIT","Apache-2.0","MIT OR Apache-2.0","BSD-2-Clause","BSD-3-Clause","ISC","0BSD","CC0-1.0","OFL-1.1"]);
// The reviewed exception is exact-version and local development/CI tooling only.
// Do not infer that a devDependency may be distributed in the application.
const reviewedTools = new Map([
  ["node_modules/@axe-core/playwright", {version:"4.14.1",license:"MPL-2.0",notice:"LICENSE",scope:"Playwright accessibility testing only"}],
  ["node_modules/axe-core", {version:"4.14.1",license:"MPL-2.0",notice:"LICENSE",scope:"Playwright accessibility testing only"}],
  ["node_modules/minimatch", {version:"11.0.9",license:"BlueOak-1.0.0",notice:"LICENSE.md",scope:"ESLint tooling only"}],
  ["node_modules/@isaacs/nonrecursive-glob-match", {version:"1.1.0",license:"BlueOak-1.0.0",notice:"LICENSE.md",scope:"ESLint tooling only"}],
]);
const dependencies=Object.entries(lock.packages).filter(([name])=>name).map(([name,entry])=>{
  const tool=reviewedTools.get(name);
  const noticePresent=tool ? existsSync(resolve(name,tool.notice)) : false;
  const reviewedLocalTool=Boolean(tool && entry.dev===true && entry.version===tool.version && entry.license===tool.license && noticePresent);
  return {name,version:entry.version,license:entry.license??null,devOnly:entry.dev===true,reviewed:allowed.has(entry.license)||reviewedLocalTool,reviewScope:reviewedLocalTool?tool.scope:null,noticePresent:tool?noticePresent:null};
});
const files=execFileSync("git",["ls-files","public"],{encoding:"utf8"}).trim().split(/\r?\n/).filter(Boolean);
const assetRecords=files.map(file=>({file,...(assets[file]??{status:"unverified",reason:"No approved provenance record"}),actualSha256:createHash("sha256").update(readFileSync(file)).digest("hex")}));
const failures=[...dependencies.filter(x=>!x.reviewed).map(x=>({dependency:x.name,license:x.license})),...assetRecords.filter(x=>x.status!=="approved"||!x.evidence||!x.license||x.sha256!==x.actualSha256).map(x=>({asset:x.file,reason:x.sha256!==x.actualSha256?"Asset hash missing or changed":x.reason??"Missing verified license/provenance"}))];
const report={dependencies,assets:assetRecords,failures};
const dir=process.env.KAWING_EVIDENCE_DIR;
if(dir){mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,"license.json"),JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify({dependencies:dependencies.length,assets:assetRecords.length,failures},null,2));
process.exitCode=failures.length?1:0;
