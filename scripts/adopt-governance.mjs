import {spawnSync} from 'node:child_process';
import {copyFileSync,constants,existsSync,mkdirSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=realpathSync(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const target=realpathSync(process.argv[2]||'.');
const apply=process.argv.includes('--apply');
const claude=process.argv.includes('--claude');
const paths=['AGENTS.md','README.md','TECHNICAL-OVERVIEW.md','DESIGN.md','ARCHITECTURE.md','ENGINEERING-BASELINE.md','QUALITY.md','SKILLS.md','CHANGELOG.md','governance.json','docs/CURRENT.md','docs/specs/FEATURE.md','docs/evidence/README.md','docs/references/RESEARCH.md','.github/CODEOWNERS','.github/pull_request_template.md','.github/workflows/quality.yml','.github/workflows/metrics.yml','quality/README.md','quality/.gitignore','quality/delivery-events.json','scripts/check-governance.mjs','scripts/check-docs.mjs','scripts/release-readiness.mjs','scripts/delivery-metrics.mjs','scripts/foundations.test.mjs','scripts/adopt-governance.mjs','.githooks/pre-commit','.githooks/pre-push'];
if(claude)paths.push('CLAUDE.md','.claude/settings.json','.claude/README.md','.claude/agents/kawing-orchestrator.md','.claude/agents/kawing-writer.md','.claude/agents/kawing-auditor.md','.claude/hooks/delegation-guard.mjs');
function git(args){const r=spawnSync(process.platform==='win32'&&existsSync('C:\\Program Files\\Git\\bin\\git.exe')?'C:\\Program Files\\Git\\bin\\git.exe':'git',['-C',target,...args],{encoding:'utf8'});if(r.status!==0)throw Error('Git check failed: '+(r.stderr||r.error?.message));return r.stdout.trim();}
if(realpathSync(git(['rev-parse','--show-toplevel']))!==target)throw Error('Target must be repository root');
if(source===target)throw Error('Cannot adopt into master kit');
const master=JSON.parse(readFileSync(resolve(source,'governance.json'),'utf8'));
if(!['project','repository','owner'].every(k=>typeof master[k]==='string'&&master[k].startsWith('__REQUIRED_')&&master[k].endsWith('__')))throw Error('Use verified uninstantiated master kit, not another product repository');
console.log('Target:',target,'\nBranch:',git(['branch','--show-current']),'\nStatus:',git(['status','--short']));
function within(root,path){const rel=relative(root,realpathSync(path));return rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);}
for(const p of paths){
 const src=resolve(source,p),dst=resolve(target,p);
 if(!existsSync(src)||!within(source,src)||!statSync(src).isFile())throw Error('Incomplete or unsafe master kit: '+p);
 let parent=dst;while(!existsSync(parent))parent=dirname(parent);
 if(!within(target,parent)||(existsSync(dst)&&!statSync(dst).isFile()))throw Error('Unsafe target: '+p);
}
for(const p of paths){
 const src=resolve(source,p),dst=resolve(target,p);
 if(existsSync(dst)){console.log(readFileSync(src).equals(readFileSync(dst))?'MATCH ':'RECONCILE ',p);continue;}
 if(apply){mkdirSync(dirname(dst),{recursive:true});copyFileSync(src,dst,constants.COPYFILE_EXCL);}
 console.log(apply?'ADDED ':'MISSING ',p);
}
console.log(apply?'Copied missing files only. Resolve placeholders and merge differing existing documents before feature work.':'Dry-run only. After verified scope and writers, rerun with --apply. No commits, pushes, settings or deployments.');
