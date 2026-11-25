import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const lock=JSON.parse(readFileSync("package-lock.json","utf8"));
const assets=JSON.parse(readFileSync("licenses/assets.json","utf8"));
const allowed=new Set(["MIT","Apache-2.0","MIT OR Apache-2.0","BSD-2-Clause","BSD-3-Clause","ISC","0BSD","CC0-1.0","OFL-1.1"]);
const dependencies=Object.entries(lock.packages).filter(([name])=>name).map(([name,entry])=>({name,version:entry.version,license:entry.license??null,reviewed:allowed.has(entry.license)}));
const files=execFileSync("git",["ls-files","public"],{encoding:"utf8"}).trim().split(/\r?\n/).filter(Boolean);
const assetRecords=files.map(file=>({file,...(assets[file]??{status:"unverified",reason:"No approved provenance record"}),actualSha256:createHash("sha256").update(readFileSync(file)).digest("hex")}));
const failures=[...dependencies.filter(x=>!x.reviewed).map(x=>({dependency:x.name,license:x.license})),...assetRecords.filter(x=>x.status!=="approved"||!x.evidence||!x.license||x.sha256!==x.actualSha256).map(x=>({asset:x.file,reason:x.sha256!==x.actualSha256?"Asset hash missing or changed":x.reason??"Missing verified license/provenance"}))];
const report={dependencies,assets:assetRecords,failures};
const dir=process.env.KAWING_EVIDENCE_DIR;
if(dir){mkdirSync(dir,{recursive:true});writeFileSync(resolve(dir,"license.json"),JSON.stringify(report,null,2)+"\n");}
console.log(JSON.stringify({dependencies:dependencies.length,assets:assetRecords.length,failures},null,2));
process.exitCode=failures.length?1:0;
