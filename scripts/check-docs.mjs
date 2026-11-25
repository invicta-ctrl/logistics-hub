import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
const housekeeping=new Set(['CHANGELOG.md','docs/CURRENT.md']);
const under=(path,dir)=>typeof dir==='string'&&dir!=='.'&&path.startsWith(dir+'/');
const mapped=(path,layout,roles)=>roles.some(role=>under(path,layout?.[role]));
export function requiredDocs(changed,tracked,layout={},reviewed=new Set()){
 const paths=new Set(changed);
 const material=changed.filter(p=>!housekeeping.has(p)&&!p.startsWith('docs/evidence/'));
 if(!material.length)return [];
 const required=new Set(housekeeping);
 for(const p of material){
  // A documentation-only change still needs a real changelog and checkpoint.
  const docOnly=p==='TECHNICAL-OVERVIEW.md'||/(^|\/)README\.md$/i.test(p)||p.startsWith('docs/specs/')||p==='PLAN.md';
  if(docOnly)continue;
  required.add('README.md');
  if(['AGENTS.md','ENGINEERING-BASELINE.md','governance.json'].includes(p)||p.startsWith('.github/workflows/')||/(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|\.node-version|wrangler\.(jsonc?|toml)|cloudflare\.config\.ts|vite\.config\.[cm]?[jt]s|react-router\.config\.[cm]?[jt]s)$/.test(p))required.add('TECHNICAL-OVERVIEW.md');
  let dir=posix.dirname(p);
  while(dir!=='.'&&dir!=='/'){
   const doc=dir+'/README.md';
   if(tracked.has(doc)){required.add(doc);break;}
   dir=posix.dirname(dir);
  }
  if(mapped(p,layout,['routes','components','styles','stories'])||/(^|\/)(routes|components|ui|patterns|styles|themes|tokens|stories)\//.test(p))required.add('DESIGN.md');
  if(mapped(p,layout,['server','contracts','migrations'])||/(^|\/)(server|contracts|migrations)\//.test(p)||/(^|\/)(wrangler\.(jsonc?|toml)|cloudflare\.config\.ts|vite\.config\.[cm]?[jt]s)$/.test(p))required.add('ARCHITECTURE.md');
  if(p.startsWith('.github/workflows/')||p.startsWith('quality/')||p.startsWith('.githooks/')||/^scripts\/(release-readiness|check-governance|check-docs|delivery-metrics|adopt-governance|foundations\.test)\.mjs$/.test(p))required.add('QUALITY.md');
 }
 return [...required].filter(p=>!tracked.has(p)||(!paths.has(p)&&(housekeeping.has(p)||!reviewed.has(p)))).sort();
}
export function freshReviews(before,after){
 const previous=new Set(before.split(/\r?\n/).map(x=>x.trim()));
 const result=new Set();
 for(const raw of after.split(/\r?\n/)){
  const line=raw.trim();
  if(previous.has(line))continue;
  const m=line.match(/^- Reviewed unchanged: ([A-Za-z0-9_./-]+\.md) — (\S.*)$/);
  if(m&&m[2].trim().length>=15&&!/^(?:n\/?a|unchanged|reviewed|no change|not applicable)[.!]?$/i.test(m[2].trim()))result.add(m[1]);
 }
 return result;
}
function git(args,input){
 const exe=process.platform==='win32'&&existsSync('C:\\Program Files\\Git\\bin\\git.exe')?'C:\\Program Files\\Git\\bin\\git.exe':'git';
 const r=spawnSync(exe,args,{encoding:'utf8',input,maxBuffer:32*1024*1024});
 if(r.status!==0)throw Error('git '+args[0]+' failed: '+(r.stderr||r.error?.message||r.status));
 return r.stdout;
}
const split=s=>s.split('\0').filter(Boolean);
const sha=s=>typeof s==='string'&&/^[a-f0-9]{40,64}$/i.test(s)&&!/^[0]+$/.test(s);
function emptyTree(){return git(['hash-object','-t','tree','-w','--stdin'],'').trim();}
function existsCommit(ref){try{git(['cat-file','-e',ref+'^{commit}']);return true;}catch{return false;}}
function diff(base,head){if(!sha(base)||!sha(head))throw Error('Invalid comparison SHA');return split(git(['diff','--name-only','--no-renames','-z',base,head,'--']));}
function currentHead(){return git(['rev-parse','HEAD']).trim();}
function main(){
 const mode=process.argv[2]||'--worktree';
 const root=git(['rev-parse','--show-toplevel']).trim();process.chdir(root);
 let changed,tracked,base,read;
 if(mode==='--staged'){
  base=existsCommit('HEAD')?currentHead():emptyTree();
  changed=split(git(['diff','--cached','--name-only','--no-renames','-z',base,'--']));
  tracked=new Set(split(git(['ls-files','-z','--cached'])));
  read=p=>tracked.has(p)?git(['show',':'+p]):'';
 }else if(mode==='--worktree'){
  base=existsCommit('HEAD')?currentHead():emptyTree();
  changed=[...new Set([...split(git(['diff','--name-only','--no-renames','-z',base,'--'])),...split(git(['ls-files','--others','--exclude-standard','-z']))])];
  tracked=new Set(split(git(['ls-files','--cached','--others','--exclude-standard','-z'])).filter(p=>existsSync(p)));
  read=p=>tracked.has(p)?readFileSync(p,'utf8'):'';
 }else{
  let head;
  if(mode==='--range'){base=process.argv[3];head=process.argv[4];if(!sha(base)||!sha(head))throw Error('Pass full base and head commit SHAs');}
  else if(mode==='--ci'){
   const ev=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));head=currentHead();
   if(process.env.GITHUB_EVENT_NAME==='pull_request')base=ev.pull_request.base.sha;
   else if(process.env.GITHUB_EVENT_NAME==='merge_group')base=ev.merge_group.base_sha;
   else if(process.env.GITHUB_EVENT_NAME==='push'){base=ev.before;if(!sha(base)&&/^0+$/.test(base||''))base=emptyTree();}
   else if(process.env.GITHUB_EVENT_NAME==='workflow_dispatch'){base=existsCommit(head+'^')?git(['rev-parse',head+'^']).trim():emptyTree();}
   else throw Error('Unsupported CI event');
  }else throw Error('Use --worktree, --staged, --range BASE HEAD or --ci');
  changed=diff(base,head);
  tracked=new Set(split(git(['ls-tree','-r','--name-only','-z',head])));
  read=p=>tracked.has(p)?git(['show',head+':'+p]):'';
 }
 const checkpoint='docs/CURRENT.md';
 const oldHas=split(git(['ls-tree','-r','--name-only','-z',base,'--',checkpoint])).includes(checkpoint);
 const before=oldHas?git(['show',base+':'+checkpoint]):'';
 const reviews=freshReviews(before,read(checkpoint));
 const layout=JSON.parse(read('governance.json')).layout;
 const missing=requiredDocs(changed,tracked,layout,reviews);
 if(missing.length){console.error('Documentation freshness failed. Update facts or record a specific new unchanged-document review (except CHANGELOG/CURRENT): '+missing.join(', '));process.exitCode=1;}
 else console.log('PASS: candidate-linked documentation presence and review (semantic accuracy requires independent review)');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
