import {readFileSync} from 'node:fs';
const models={'kawing-writer':'claude-sonnet-5-5','kawing-auditor':'claude-haiku-5-5'};
function deny(message){console.error('Kawing delegation blocked or rejected: '+message);process.exit(2);}
let event;try{event=JSON.parse(readFileSync(0,'utf8'));}catch{deny('Invalid hook input');}
const input=event.tool_input||{};
const expected=Object.hasOwn(models,input.subagent_type)?models[input.subagent_type]:null;
if(!expected)deny('Unapproved subagent type');
if(event.hook_event_name==='PreToolUse'){
  if(process.env.CLAUDE_CODE_SUBAGENT_MODEL)deny('Remove the global subagent model override first');
  if(input.model!=null)deny('No per-invocation model overrides; use pinned definition');
  // Newer runtimes omit this parameter when background functionality is disabled.
  const foreground=input.run_in_background===false||(input.run_in_background===undefined&&process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS==='1');
  if(!foreground)deny('Foreground delegation required. Start a new local Desktop Code session with project background tasks disabled; explicit background launches remain prohibited');
}else if(event.hook_event_name==='PostToolUse'){
  const output=event.tool_response||{};
  if(output.status!=='completed'||output.resolvedModel!==expected)deny('Resolved model not verified; stop and inspect worker output/diff before continuing');
  if(output.modelsUsed&&(!Array.isArray(output.modelsUsed)||output.modelsUsed.some(m=>m!==expected)))deny('Model changed during worker execution; stop and inspect output/diff');
}else deny('Unexpected hook event');
