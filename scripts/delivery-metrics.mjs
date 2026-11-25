import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
const input = process.argv[2] || 'quality/delivery-events.json';
const ledger=JSON.parse(readFileSync(input,'utf8'));
const now = new Date();
const coverageEnd = Date.parse(ledger.completeThrough);
const end = new Date(process.argv[3] || (Number.isFinite(coverageEnd) && coverageEnd <= +now ? coverageEnd : +now));
if (!Number.isFinite(+end)) throw Error('Invalid end time');
const start = new Date(+end-30*86400000);
if(ledger.schemaVersion!==1 || !Array.isArray(ledger.deployments)) throw Error('Invalid ledger schema');
const date=(s)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const ids=new Set();
for(const d of ledger.deployments){
  if(typeof d.id!=='string'||!d.id||ids.has(d.id)||!(/^[a-f0-9]{40}$/i.test(d.sha||''))||!date(d.committedAt)||!date(d.deployedAt)||Date.parse(d.committedAt)>Date.parse(d.deployedAt)||typeof d.failed!=='boolean'||typeof d.rework!=='boolean'||typeof d.evidence!=='string'||!/^https:\/\//.test(d.evidence)||(!d.failed&&d.recoveredAt!=null)||(d.recoveredAt!=null&&(!date(d.recoveredAt)||Date.parse(d.recoveredAt)<Date.parse(d.deployedAt)))) throw Error('Invalid or duplicate deployment: '+d.id);
  ids.add(d.id);
}
const complete=date(ledger.completeFrom)&&date(ledger.completeThrough)&&Date.parse(ledger.completeFrom)<=+start&&Date.parse(ledger.completeThrough)>=+end;
const rows=ledger.deployments.filter(d=>Date.parse(d.deployedAt)>=+start&&Date.parse(d.deployedAt)<+end);
const failed=rows.filter(d=>d.failed);
const recovered=failed.filter(d=>date(d.recoveredAt)&&Date.parse(d.recoveredAt)<=+end);
const median=xs=>{if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const hrs=(a,b)=>(Date.parse(b)-Date.parse(a))/3600000;
const report={generatedAt:now.toISOString(),coverageAgeHours:Math.max(0,(+now-+end)/3600000),window:{start:start.toISOString(),end:end.toISOString()},complete,observedDeployments:rows.length,metrics:{
  deploymentsPerWeek:complete?rows.length*7/30:null,
  medianDeploymentLeadTimeProxyHours:complete?median(rows.map(d=>hrs(d.committedAt,d.deployedAt))):null,
  medianRecoveredFailureHours:complete?median(recovered.map(d=>hrs(d.deployedAt,d.recoveredAt))):null,
  changeFailureRate:complete&&rows.length?failed.length/rows.length:null,
  deploymentReworkRate:complete&&rows.length?rows.filter(d=>d.rework).length/rows.length:null
},unrecoveredFailuresObserved:failed.length-recovered.length,notes:'Null = unknown or undefined; lead time is deployment-level proxy; recovery includes recovered failures only.'};
mkdirSync('quality',{recursive:true});writeFileSync('quality/delivery-metrics.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Delivery metrics — 30 days\n'+(complete?'Reconciled interval.':'Incomplete ledger; metrics unknown.')+'\n\n| Metric | Value |\n|---|---:|\n'+Object.entries(report.metrics).map(([k,v])=>'| '+k+' | '+(v??'unknown')+' |').join('\n')+'\n');
