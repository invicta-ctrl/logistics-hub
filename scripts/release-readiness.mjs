import { readFileSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve('.');
const governance = spawnSync(process.execPath,[resolve(root,'scripts/check-governance.mjs'),root],{stdio:'inherit'});
let config;
try {config=JSON.parse(readFileSync(resolve(root,'governance.json'),'utf8'));} catch {}
const cwd = resolve(root,governance.status===0?config.appRoot:'.');
const reports = {test:'unit.json','test:e2e':'e2e.json','test:a11y':'a11y.json','test:visual':'visual.json','test:security':'security.json','test:license':'license.json','test:perf':'perf.json'};
mkdirSync(resolve(root,'quality/runs'),{recursive:true});
const evidenceDir=mkdtempSync(resolve(root,'quality/runs/check-'));
const environment={...process.env,KAWING_EVIDENCE_DIR:evidenceDir};
const required = ['lint','typecheck','test','build','test:e2e','test:a11y','test:visual','test:security','test:license','test:perf'];
const report = { commit: process.env.GITHUB_SHA || null, createdAt: new Date().toISOString(), checks: [] };
const record = (name,status,durationMs,detail) => report.checks.push({name,status,durationMs,detail});
let pkg, pm;
record('governance',governance.status===0?'pass':'fail',0,'Required governance preflight');
try {
  if(governance.status!==0)throw Error('Governance preflight failed');
  if(process.argv[2]&&resolve(root,process.argv[2])!==cwd)throw Error('Requested app root does not match governance.json');
  const expectedNode=readFileSync(resolve(cwd,'.node-version'),'utf8').trim().replace(/^v/,'');
  if(process.versions.node!==expectedNode)throw Error('Node version mismatch: expected '+expectedNode+' got '+process.versions.node);
  pkg = JSON.parse(readFileSync(resolve(cwd,'package.json'),'utf8'));
  const npm = existsSync(resolve(cwd,'package-lock.json')), pnpm = existsSync(resolve(cwd,'pnpm-lock.yaml'));
  if (npm === pnpm) throw Error('Exactly one npm or pnpm lockfile required');
  pm = pnpm ? 'pnpm' : 'npm';
  if (pnpm && !/^pnpm@\d+\.\d+\.\d+/.test(pkg.packageManager || '')) throw Error('Pin pnpm in packageManager');
} catch (error) { record('configuration','fail',0,error.message); }
function execute(name,args) {
  const start = Date.now();
  // Windows package managers are .cmd shims; invoke only the fixed command/argument allowlist.
  const result = process.platform==='win32'
    ? spawnSync(resolve(process.env.SystemRoot||'C:\\Windows','System32/cmd.exe'),['/d','/s','/c',[pm+'.cmd',...args].join(' ')],{cwd,env:environment,stdio:'inherit'})
    : spawnSync(pm,args,{cwd,env:environment,stdio:'inherit'});
  record(name,result.status===0?'pass':'fail',Date.now()-start,result.error?.message || (result.signal ? 'signal '+result.signal : 'exit '+result.status));
}
if (pm && report.checks.every(c=>c.status==='pass')) {
  execute('dependency-audit',['audit','--audit-level=high']);
  for (const name of required) {
    if (typeof pkg.scripts?.[name] !== 'string' || !pkg.scripts[name].trim()) { record(name,'fail',0,'Missing required script'); continue; }
    if (report.checks.find(c=>c.name==='build')?.status==='fail' && name.startsWith('test:') && !['test:license','test:security'].includes(name)) { record(name,'blocked',0,'Build failed'); continue; }
    if (/^\s*(?:true|echo(?:\s+.*)?|exit\s+0|node\s+-e\s+["']?process\.exit\(0\)["']?)\s*$/i.test(pkg.scripts[name])) {record(name,'fail',0,'Trivial no-op script');continue;}
    execute(name,['run',name]);
    if(reports[name]&&report.checks.at(-1).status==='pass'){
      try{const p=resolve(evidenceDir,reports[name]);if(!statSync(p).isFile())throw Error('Not a file');const data=JSON.parse(readFileSync(p,'utf8'));if(!data||typeof data!=='object'||Object.keys(data).length===0)throw Error('Empty report');}catch(error){report.checks.at(-1).status='fail';report.checks.at(-1).detail='Missing or invalid evidence '+reports[name]+': '+error.message;}
    }
  }
} else for (const name of ['dependency-audit',...required]) record(name,'blocked',0,'Invalid configuration');
report.evidenceDirectory = relativeEvidence();
function relativeEvidence(){return evidenceDir.slice(root.length+1).replaceAll('\\','/');}
report.ready = report.checks.every(c=>c.status==='pass');
mkdirSync('quality',{recursive:true});
writeFileSync('quality/release-report.json',JSON.stringify(report,null,2)+'\n');
const summary = ['## Release readiness: '+(report.ready?'PASS':'FAIL'),'Commit: '+(report.commit||'local (not attested)'),'| Check | Status | Duration (ms) |','|---|---|---:|',...report.checks.map(c=>'| '+c.name+' | '+c.status+' | '+c.durationMs+' |')].join('\n')+'\n';
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
process.exitCode = report.ready?0:1;
