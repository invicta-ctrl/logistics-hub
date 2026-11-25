import { existsSync, readFileSync, statSync, readdirSync, realpathSync, appendFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import {spawnSync} from 'node:child_process';
const mode=process.argv[2];
const snapshot=mode==='--staged'||mode==='--ref';
const ref=mode==='--ref'?process.argv[3]:null;
if(ref!==null&&(!/^[a-f0-9]{40,64}$/i.test(ref||'')||/^0+$/.test(ref)))throw Error('Expected full candidate commit SHA');
const root=realpathSync(snapshot?'.':mode||'.');
function git(args){
 const exe=process.platform==='win32'&&existsSync('C:\\Program Files\\Git\\bin\\git.exe')?'C:\\Program Files\\Git\\bin\\git.exe':'git';
 const r=spawnSync(exe,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
 if(r.status!==0)throw Error('git '+args[0]+' failed: '+(r.stderr||r.error?.message));
 return r.stdout;
}
let entries;
if(snapshot){
 const records=git(mode==='--staged'?['ls-files','--stage','-z']:['ls-tree','-r','-z',ref]).split('\0').filter(Boolean);
 entries=new Map();
 for(const record of records){
  const tab=record.indexOf('\t'),meta=record.slice(0,tab).split(' '),name=record.slice(tab+1);
  if(mode==='--staged'&&meta[2]!=='0')throw Error('Unmerged index entry: '+name);
  entries.set(name,meta[0]);
 }
}
const regular=p=>/^100(?:644|755)$/.test(entries?.get(p)||'');
const read=p=>snapshot?git(['show',mode==='--staged'?':'+p:ref+':'+p]):readFileSync(resolve(root,p),'utf8');
const present=p=>snapshot?entries.has(p):existsSync(resolve(root,p));
const errors=[];
const fail=s=>errors.push(s);
const required=['AGENTS.md','DESIGN.md','ARCHITECTURE.md','ENGINEERING-BASELINE.md','QUALITY.md','SKILLS.md','README.md','TECHNICAL-OVERVIEW.md','CHANGELOG.md','docs/CURRENT.md','docs/evidence/README.md','docs/references/RESEARCH.md','docs/specs/FEATURE.md','governance.json','.github/workflows/quality.yml','.github/workflows/metrics.yml','quality/README.md','quality/delivery-events.json','quality/.gitignore','scripts/delivery-metrics.mjs','.github/pull_request_template.md','.github/CODEOWNERS','scripts/check-governance.mjs','scripts/release-readiness.mjs','scripts/check-docs.mjs','scripts/adopt-governance.mjs','scripts/foundations.test.mjs','.githooks/pre-commit','.githooks/pre-push'];
const pending=/__REQUIRED_[A-Za-z0-9_-]+__/;
const valid=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&!pending.test(v);
const safe=p=>valid(p)&&(p==='.'||(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)&&!p.split('/').some(x=>x==='.'||x==='..')));
function inside(p,kind){
  if(!safe(p)){fail('Invalid relative path: '+String(p));return false;}
  if(snapshot){
    const ok=kind==='file'?regular(p):[...entries.keys()].some(x=>x.startsWith(p==='.'?'':p+'/')&&regular(x));
    if(!ok)fail('Missing '+kind+' in candidate: '+p);
    return ok;
  }
  const abs=resolve(root,p);
  if(!existsSync(abs)){fail('Missing '+kind+': '+p);return false;}
  const rel=relative(root,realpathSync(abs));
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep)){fail('Path escapes repository: '+p);return false;}
  if(kind==='directory'?!statSync(abs).isDirectory():!statSync(abs).isFile()){fail('Wrong path kind: '+p);return false;}
  return true;
}
for(const p of required){
  if(!inside(p,'file'))continue;
  // The reusable blank feature specification is intentionally exempt.
  if(p!=='docs/specs/FEATURE.md'&&p!=='scripts/foundations.test.mjs'&&pending.test(read(p)))fail('Unresolved required placeholder: '+p);
}
if(present('.codex/CURRENT.md'))fail('Legacy checkpoint remains; reconcile and migrate to docs/CURRENT.md');
let g;
if(inside('governance.json','file'))try{g=JSON.parse(read('governance.json'));}catch{fail('Cannot parse governance.json');}
if(!g||typeof g!=='object'||Array.isArray(g))fail('Governance config must be a JSON object');
else{
  if(g.schemaVersion!==1)fail('Unsupported governance schema');
  for(const key of ['project','repository','owner','approval','profile','appRoot'])if(!valid(g[key]))fail('Missing approved field: '+key);
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(g.repository||''))fail('repository must be owner/repo');
  if(process.env.GITHUB_REPOSITORY&&String(g.repository).toLowerCase()!==process.env.GITHUB_REPOSITORY.toLowerCase())fail('Repository identity mismatch');
  if(!['web','component-library'].includes(g.profile))fail('Select approved profile: web or component-library');
  const appOK=inside(g.appRoot,'directory');
  if(appOK){const prefix=g.appRoot==='.'?'':g.appRoot+'/';if(inside(prefix+'package.json','file'))try{const p=JSON.parse(read(prefix+'package.json'));if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Expected object');}catch{fail('Invalid package.json');}const locks=['package-lock.json','pnpm-lock.yaml'].filter(p=>present(prefix+p));if(locks.length!==1)fail('Exactly one supported lockfile required');else inside(prefix+locks[0],'file');if(inside(prefix+'.node-version','file')&&!/^v?\d+\.\d+\.\d+$/.test(read(prefix+'.node-version').trim()))fail('Pin an exact Node version in .node-version');}
  const roles=['routes','components','features','styles','server','lib','contracts','assets','tests','migrations'];
  const mandatory=new Set(['components','styles','tests',...(g.profile==='web'?['routes']:[])]);
  if(g.profile==='component-library')mandatory.add('stories');
  roles.push('stories');
  const mapped=new Map();
  for(const role of roles){
    const item=g.layout?.[role];
    if(typeof item==='string'){if(item==='.')fail('Layout role '+role+' cannot map to repository root');else if(inside(item,'directory')&&mandatory.has(role)){if(!snapshot&&!readdirSync(resolve(root,item)).length)fail('Empty mandatory layout directory: '+item);mapped.set(item,[...(mapped.get(item)||[]),role]);}}
    else if(mandatory.has(role)||!item||item.notApplicable!==true||!valid(item.reason)||!valid(item.approval))fail('Missing layout '+role+'; resolve path or approved non-applicability');
  }
  for(const [path,roles] of mapped)if(roles.length>1){const approval=g.layoutShared?.[path];if(!valid(approval?.reason)||!valid(approval?.approval))fail('Shared mandatory layout '+path+' ('+roles.join(', ')+') requires approved reason');}
  if(!['workers-builds','github-actions','none'].includes(g.release?.trigger))fail('Select approved release trigger');
  if(!valid(g.release?.target)||!valid(g.release?.approval))fail('Release target/policy approval missing');
  if(g.release?.trigger==='none'&&g.release?.target!=='not-applicable')fail('No deployment requires target not-applicable');
  if(g.release?.trigger!=='none'&&g.release?.target==='not-applicable')fail('Deployment requires an exact target');
}
function field(c,label){
  const lines=c.split(/\r?\n/).filter(line=>line.startsWith(label+':'));
  return lines.length===1?lines[0].slice(label.length+1).trim():'';
}
function fields(c,labels,path){for(const label of labels)if(!valid(field(c,label)))fail('Missing or unresolved '+label+' in '+path);}
const current='docs/CURRENT.md';
if(inside(current,'file')){
  const c=read(current);
  fields(c,['Status','Accepted specification','Idle reason','Target root/repo, branch and baseline SHA','Working tree / active writers / owned paths','PLAN.md / accepted scope and grilling evidence','Local preview command, URL, owned process and verified state (or reason unavailable/inapplicable)','Current objective and exclusions','Visual baseline if applicable','Acceptance and verification','Results / evidence / unrun checks','Next exact action and stop condition','Release status'],current);
  const state=c.match(/^Status:\s*(idle|active|blocked)\s*$/m)?.[1];
  if(!state)fail('CURRENT.md needs Status: idle, active or blocked');
  if(state==='blocked'&&!snapshot)fail('Active checkpoint blocked; resolve before implementation/release (local candidate snapshots may record blockers)');
  if(state==='active'||(state==='blocked'&&field(c,'Accepted specification')!=='none')){
    const value=field(c,'Accepted specification');
    const spec=/^docs\/specs\/[A-Za-z0-9_.-]+\.md$/.test(value)?value:null;
    if(!spec||spec==='docs/specs/FEATURE.md'||!inside(spec,'file'))fail('Active checkpoint must reference a real accepted spec');
    else {const s=read(spec);if(pending.test(s)||!['accepted','verified'].includes(field(s,'Status')))fail('Specification is unresolved or unaccepted: '+spec);
      fields(s,['Owner and approval reference','Baseline commit and target','Owner PLAN.md reference (or accepted continuation)','Requirements grilling and planning evidence, resolved decisions and remaining blockers','Objective and user problem','Scope and exclusions','Authority / dependencies / writer paths','Behavior, edge cases and invariants','Visual baseline if applicable','Acceptance criteria (observable)','Local preview command/route and isolated resources (or justified non-applicability)','Verification (commands, regression, negative tests, visual evidence, runtime)','Release/data impact and rollback','Stop','Results'],spec);
      if(field(s,'Owner PLAN.md reference (or accepted continuation)')==='PLAN.md')inside('PLAN.md','file');
    }
  }
  if(state==='idle'&&!/^Idle reason:[ \t]*\S[^\r\n]*$/m.test(c))fail('Idle checkpoint needs an explicit reason');
  if(state==='idle'&&!/^Accepted specification:[ \t]*none[ \t]*$/m.test(c))fail('Idle checkpoint must explicitly say Accepted specification: none');
}
if(errors.length){console.error(errors.map(x=>'FAIL: '+x).join('\n'));process.exitCode=1;}
else{
  console.log('PASS: governance structure, approved configuration and active checkpoint');
  if(!snapshot&&process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'app_dir='+g.appRoot+'\n');
}
