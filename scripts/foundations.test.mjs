import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync, chmodSync} from 'node:fs';
import {resolve, dirname, join, delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const kit=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const keys=['lint','typecheck','test','build','test:e2e','test:a11y','test:visual','test:security','test:license','test:perf'];
const outputs={test:'unit.json','test:e2e':'e2e.json','test:a11y':'a11y.json','test:visual':'visual.json','test:security':'security.json','test:license':'license.json','test:perf':'perf.json'};
function write(root,path,content){const p=join(root,path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,content);}
function json(root,path,data){write(root,path,JSON.stringify(data));}
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'kawing-governance-fixture-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const p of ['AGENTS.md','DESIGN.md','ARCHITECTURE.md','ENGINEERING-BASELINE.md','QUALITY.md','SKILLS.md','README.md','TECHNICAL-OVERVIEW.md','CHANGELOG.md','docs/evidence/README.md','docs/references/RESEARCH.md','docs/specs/FEATURE.md','.github/workflows/quality.yml','.github/workflows/metrics.yml','.github/pull_request_template.md','.github/CODEOWNERS','quality/README.md','quality/delivery-events.json','quality/.gitignore','.githooks/pre-commit','.githooks/pre-push'])write(root,p,'Synthetic fixture only\n');
 for(const p of ['scripts/check-governance.mjs','scripts/release-readiness.mjs','scripts/foundations.test.mjs','scripts/check-docs.mjs','scripts/adopt-governance.mjs','scripts/delivery-metrics.mjs']){mkdirSync(join(root,'scripts'),{recursive:true});cpSync(join(kit,p),join(root,p));}
 const layout={};
 for(const role of ['routes','components','styles','tests']){layout[role]='app/'+role;write(root,layout[role]+'/fixture.txt','Synthetic fixture content\n');}
 for(const role of ['features','server','lib','contracts','assets','migrations','stories'])layout[role]={notApplicable:true,reason:'Synthetic fixture',approval:'Fixture-only approval'};
 const g={schemaVersion:1,project:'Synthetic fixture',repository:'fixture/example',owner:'Fixture owner',approval:'Fixture-only approval',profile:'web',appRoot:'.',layout,release:{trigger:'none',target:'not-applicable',approval:'Fixture-only approval'}};
 json(root,'governance.json',g);
 const fill=(file)=>readFileSync(join(kit,file),'utf8').replace(/__REQUIRED_[A-Za-z0-9_-]+__/g,'Synthetic fixture only');
 const current=fill('docs/CURRENT.md').replace(/^Status:.*$/m,'Status: idle').replace(/^Accepted specification:.*$/m,'Accepted specification: none');
 const spec=fill('docs/specs/FEATURE.md').replace(/^Status:.*$/m,'Status: accepted');
 write(root,'docs/CURRENT.md',current);
 write(root,'.node-version',process.versions.node);
 json(root,'package-lock.json',{lockfileVersion:3});
 const pkg={scripts:Object.fromEntries(keys.map(k=>[k,'node synthetic-fixture.mjs '+k]))};
 json(root,'package.json',pkg);
 // Test double for npm: no network, dependencies or product checks. Never use this outside fixture.
 const shimDir=join(root,'fixture-bin');mkdirSync(shimDir);
 write(root,'fixture-bin/shim.mjs',`import {writeFileSync} from 'node:fs';import {join} from 'node:path';const [op,name]=process.argv.slice(2);const outputs=${JSON.stringify(outputs)};if(op==='audit')process.exit(0);if(op!=='run')process.exit(2);if(process.env.FIXTURE_FAIL===name)process.exit(7);if(outputs[name]&&process.env.FIXTURE_MISSING!==name)writeFileSync(join(process.env.KAWING_EVIDENCE_DIR,outputs[name]),JSON.stringify({fixture:true,case:name}));`);
 if(process.platform==='win32')write(root,'fixture-bin/npm.cmd','@echo off\r\n"%KAWING_TEST_NODE%" "%~dp0shim.mjs" %*\r\nexit /b %errorlevel%\r\n');
 else {write(root,'fixture-bin/npm','#!/bin/sh\nexec "$KAWING_TEST_NODE" "$(dirname "$0")/shim.mjs" "$@"\n');chmodSync(join(shimDir,'npm'),0o755);}
 const env={...process.env,GITHUB_REPOSITORY:'fixture/example',KAWING_TEST_NODE:process.execPath};
 const originalPath=Object.entries(env).find(([k])=>k.toLowerCase()==='path')?.[1]||'';
 for(const k of Object.keys(env))if(k.toLowerCase()==='path')delete env[k];
 if(process.platform==='win32'){
   const windows=process.env.SystemRoot||'C:\\Windows';
   env.Path=[shimDir,join(windows,'System32'),windows,originalPath].join(delimiter);
   for(const k of Object.keys(env))if(k.toLowerCase()==='pathext')delete env[k];
   env.PATHEXT='.COM;.EXE;.BAT;.CMD';
 }else env.PATH=shimDir+delimiter+originalPath;
 for(const k of Object.keys(env))if(['GITHUB_OUTPUT','GITHUB_STEP_SUMMARY','GITHUB_SHA','FIXTURE_FAIL','FIXTURE_MISSING','CLAUDE_CODE_SUBAGENT_MODEL'].includes(k))delete env[k];
 const run=(file,more={},args=[])=>spawnSync(process.execPath,[join(root,file),...args],{cwd:root,env:{...env,...more},encoding:'utf8',timeout:30000});
 const check=()=>run('scripts/check-governance.mjs');
 const release=(more={})=>run('scripts/release-readiness.mjs',more);
 const report=()=>JSON.parse(readFileSync(join(root,'quality/release-report.json'),'utf8'));
 return {root,g,pkg,current,spec,check,release,report,run};
}
function status(result,expected){assert.equal(result.status,expected,(result.stdout||'')+'\n'+(result.stderr||'')+'\n'+(result.error||''));}
test('approved fixture passes structural preflight',t=>{const f=fixture(t);status(f.check(),0);});
test('missing frontend research reference fails',t=>{const f=fixture(t);rmSync(join(f.root,'docs/references/RESEARCH.md'));status(f.check(),1);});
test('missing skills policy fails',t=>{const f=fixture(t);rmSync(join(f.root,'SKILLS.md'));status(f.check(),1);});
test('missing or unresolved technical overview fails',t=>{const f=fixture(t);rmSync(join(f.root,'TECHNICAL-OVERVIEW.md'));status(f.check(),1);write(f.root,'TECHNICAL-OVERVIEW.md','__REQUIRED_ACTUAL_STACK_AND_VERSIONS__');status(f.check(),1);});
test('unresolved placeholder fails',t=>{const f=fixture(t);write(f.root,'DESIGN.md','__REQUIRED_VISUAL_BASELINE__');status(f.check(),1);});
test('missing or conflicting lockfiles fail preflight',t=>{const f=fixture(t);rmSync(join(f.root,'package-lock.json'));status(f.check(),1);json(f.root,'package-lock.json',{lockfileVersion:3});write(f.root,'pnpm-lock.yaml','fixture');status(f.check(),1);});
test('missing directory fails',t=>{const f=fixture(t);f.g.layout.routes='app/not-present';json(f.root,'governance.json',f.g);status(f.check(),1);});
test('unapproved missing layout role fails',t=>{const f=fixture(t);delete f.g.layout.server;json(f.root,'governance.json',f.g);status(f.check(),1);});
test('invalid and escaping config fails',t=>{const f=fixture(t);json(f.root,'governance.json',null);status(f.check(),1);f.g.appRoot='../outside';json(f.root,'governance.json',f.g);status(f.check(),1);});
test('active checkpoint requires complete accepted spec and plan reference',t=>{const f=fixture(t);const active=f.current.replace('Status: idle','Status: active').replace('Accepted specification: none','Accepted specification: docs/specs/001.md');write(f.root,'docs/CURRENT.md',active);write(f.root,'docs/specs/001.md','Status: accepted\n');status(f.check(),1);write(f.root,'docs/specs/001.md',f.spec.replace('Status: accepted','Status: proposed'));status(f.check(),1);write(f.root,'docs/specs/001.md',f.spec.replace(/^Owner PLAN\.md reference \(or accepted continuation\):.*$/m,'Owner PLAN.md reference (or accepted continuation): PLAN.md'));status(f.check(),1);write(f.root,'PLAN.md','Synthetic owner plan');status(f.check(),0);write(f.root,'docs/CURRENT.md',active.replace('Status: active','Status: blocked'));status(f.check(),1);});
test('missing checkpoint preview record fails',t=>{const f=fixture(t);write(f.root,'docs/CURRENT.md',f.current.replace(/^Local preview command.*\n/m,''));status(f.check(),1);});
test('empty or shared mandatory folders fail unless sharing approved',t=>{const f=fixture(t);rmSync(join(f.root,'app/routes/fixture.txt'));status(f.check(),1);write(f.root,'app/routes/fixture.txt','fixture');f.g.layout.components=f.g.layout.routes;json(f.root,'governance.json',f.g);status(f.check(),1);f.g.layoutShared={'app/routes':{reason:'Fixture routes and UI intentionally co-located',approval:'Fixture-only approval'}};json(f.root,'governance.json',f.g);status(f.check(),0);});
test('release rejects invalid governance',t=>{const f=fixture(t);write(f.root,'DESIGN.md','__REQUIRED_VISUAL_BASELINE__');status(f.release(),1);assert.equal(f.report().ready,false);});
test('release rejects missing script and no-op script',t=>{const f=fixture(t);delete f.pkg.scripts.lint;f.pkg.scripts.typecheck='echo fake pass';json(f.root,'package.json',f.pkg);status(f.release(),1);const r=f.report();assert.equal(r.checks.find(x=>x.name==='lint').status,'fail');assert.equal(r.checks.find(x=>x.name==='typecheck').status,'fail');});
test('release rejects failed task and missing evidence',t=>{const f=fixture(t);status(f.release({FIXTURE_FAIL:'test:e2e',FIXTURE_MISSING:'test:a11y'}),1);const r=f.report();assert.equal(r.checks.find(x=>x.name==='test:e2e').status,'fail');assert.match(r.checks.find(x=>x.name==='test:a11y').detail,/Missing or invalid evidence/);});
test('release accepts passing synthetic scripts with all reports',t=>{const f=fixture(t);status(f.release(),0);assert.equal(f.report().ready,true);});
test('documentation gate requires changelog, checkpoint, README and affected design/module docs',async()=>{const {requiredDocs}=await import('./check-docs.mjs');const tracked=new Set(['README.md','CHANGELOG.md','docs/CURRENT.md','DESIGN.md','src/ui/README.md','src/ui/button.tsx']);const changed=['src/ui/button.tsx'];assert.deepEqual(requiredDocs(changed,tracked),['CHANGELOG.md','DESIGN.md','README.md','docs/CURRENT.md','src/ui/README.md']);assert.deepEqual(requiredDocs([...changed,...tracked],tracked),[]);assert.deepEqual(requiredDocs(['docs/CURRENT.md'],tracked),[]);});
test('documentation gate requires architecture and quality documents for affected paths',async()=>{const {requiredDocs}=await import('./check-docs.mjs');const tracked=new Set(['README.md','CHANGELOG.md','docs/CURRENT.md','ARCHITECTURE.md','QUALITY.md']);assert.deepEqual(requiredDocs(['src/server/service.ts','.github/workflows/quality.yml','README.md','CHANGELOG.md','docs/CURRENT.md'],tracked),['ARCHITECTURE.md','QUALITY.md','TECHNICAL-OVERVIEW.md']);});
test('technical configuration change requires overview, ordinary code change does not',async()=>{const {requiredDocs}=await import('./check-docs.mjs');const tracked=new Set(['README.md','CHANGELOG.md','docs/CURRENT.md','TECHNICAL-OVERVIEW.md']);const docs=['README.md','CHANGELOG.md','docs/CURRENT.md'];assert.deepEqual(requiredDocs(['package.json',...docs],tracked),['TECHNICAL-OVERVIEW.md']);assert.deepEqual(requiredDocs(['package.json','TECHNICAL-OVERVIEW.md',...docs],tracked),[]);assert.deepEqual(requiredDocs(['app/lib/util.ts',...docs],tracked),[]);assert.deepEqual(requiredDocs(['TECHNICAL-OVERVIEW.md'],tracked),['CHANGELOG.md','docs/CURRENT.md']);});
test('custom layout and fresh unchanged-document review',async()=>{const {requiredDocs,freshReviews}=await import('./check-docs.mjs');const tracked=new Set(['README.md','CHANGELOG.md','docs/CURRENT.md','DESIGN.md','frontend/widgets/README.md']);const changed=['frontend/widgets/button.tsx','CHANGELOG.md','docs/CURRENT.md'];const layout={components:'frontend/widgets'};assert.deepEqual(requiredDocs(changed,tracked,layout),['DESIGN.md','README.md','frontend/widgets/README.md']);const old='- Reviewed unchanged: DESIGN.md — Previous change did not affect tokens.';const after=old+'\n- Reviewed unchanged: README.md — Commands and application purpose are unchanged by this button fix.\n- Reviewed unchanged: frontend/widgets/README.md — The component interface and usage remain unchanged.';assert.deepEqual(requiredDocs(changed,tracked,layout,freshReviews(old,after)),['DESIGN.md']);const fresh=after+'\n- Reviewed unchanged: DESIGN.md — Corrects event handling without changing appearance.';assert.deepEqual(requiredDocs(changed,tracked,layout,freshReviews(old,fresh)),[]);assert.deepEqual(requiredDocs(['README.md'],tracked),['CHANGELOG.md','docs/CURRENT.md']);});
test('Git snapshot checks staged and committed candidate, not worktree',t=>{const f=fixture(t);const exe=process.platform==='win32'&&existsSync('C:\\Program Files\\Git\\bin\\git.exe')?'C:\\Program Files\\Git\\bin\\git.exe':'git';const git=(...args)=>{const r=spawnSync(exe,args,{cwd:f.root,encoding:'utf8'});status(r,0);return r.stdout.trim();};git('init','--initial-branch=main');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline');const sha=git('rev-parse','HEAD');write(f.root,'DESIGN.md','__REQUIRED_BAD_STAGED__');git('add','DESIGN.md');write(f.root,'DESIGN.md','Restored worktree only');status(f.run('scripts/check-governance.mjs',{},['--staged']),1);status(f.run('scripts/check-governance.mjs',{},['--ref',sha]),0);git('add','DESIGN.md');status(f.run('scripts/check-governance.mjs',{},['--staged']),0);write(f.root,'docs/CURRENT.md',f.current.replace('Status: idle','Status: blocked'));git('add','docs/CURRENT.md');status(f.run('scripts/check-governance.mjs',{},['--staged']),0);status(f.check(),1);});
const guard=join(kit,'.claude/hooks/delegation-guard.mjs');
if(existsSync(guard)){
 const call=(event,extra={})=>{const env={...process.env};delete env.CLAUDE_CODE_SUBAGENT_MODEL;delete env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS;return spawnSync(process.execPath,[guard],{input:JSON.stringify(event),env:{...env,...extra},encoding:'utf8'});};
 const before=(type,rest={})=>({hook_event_name:'PreToolUse',tool_input:{subagent_type:type,run_in_background:false,...rest}});
 test('Claude guard allows pinned worker requests only',()=>{status(call(before('kawing-writer')),0);status(call(before('kawing-auditor')),0);status(call(before('Explore')),2);status(call(before('kawing-writer',{model:'sonnet'})),2);status(call(before('kawing-auditor',{run_in_background:true})),2);status(call(before('kawing-auditor'),{CLAUDE_CODE_SUBAGENT_MODEL:'opus'}),2);});
 test('Desktop omitted foreground argument requires effective background-disable setting',()=>{const env={CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1'};for(const worker of ['kawing-writer','kawing-auditor']){const event=before(worker,{run_in_background:undefined});status(call(event),2);status(call(event,env),0);status(call(before(worker,{run_in_background:true}),env),2);status(call(before(worker,{run_in_background:null}),env),2);status(call(before(worker,{run_in_background:undefined,model:'opus'}),env),2);}const post={hook_event_name:'PostToolUse',tool_input:{subagent_type:'kawing-writer'},tool_response:{status:'async_launched',resolvedModel:'claude-sonnet-5-5'}};status(call(post,env),2);});
 test('Claude guard accepts exact completed model telemetry and rejects fallback',()=>{const post={hook_event_name:'PostToolUse',tool_input:{subagent_type:'kawing-writer'},tool_response:{status:'completed',resolvedModel:'claude-sonnet-5-5'}};status(call(post),0);status(call({...post,tool_response:{status:'completed',resolvedModel:'claude-opus-5-5'}}),2);status(call({...post,tool_response:{...post.tool_response,modelsUsed:['claude-sonnet-5-5','claude-haiku-5-5']}}),2);status(call({...post,tool_response:{status:'completed'}}),2);});
}
