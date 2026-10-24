import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createChatModel} from '../packages/models/dist/index.mjs';
import {input,extractInput} from '../packages/models/test/input.mjs';
import {modelHashes} from './models-evidence.mjs';
import {root} from './tools.mjs';
const report={timestamp:new Date().toISOString(),kind:'actual-model-endpoint',status:'not-configured',checks:[],files:await modelHashes()};
const endpoint=process.env.WISP_MODEL_ENDPOINT,model=process.env.WISP_MODEL_NAME,apiKey=process.env.WISP_MODEL_API_KEY;
if(endpoint && model){
 try {
  const provider=createChatModel({endpoint,model,...(apiKey?{apiKey}:{}),jsonMode:process.env.WISP_MODEL_JSON_MODE!=='off',onAttempt(){report.requestCount=(report.requestCount??0)+1;}});
  report.configuration={endpointSha256:createHash('sha256').update(endpoint).digest('hex'),model,jsonMode:process.env.WISP_MODEL_JSON_MODE!=='off'};
  const decide=await provider.decide(input);
  report.checks.push({name:'decide',passed:decide.decision.kind==='ask_user',...(decide.usage?{usage:decide.usage}:{})});
  const extract=await provider.extract(extractInput);
  report.checks.push({name:'extract',passed:extract.data.name==='Wisp' && extract.data.price===12 && extract.source[0].observationId==='o',...(extract.usage?{usage:extract.usage}:{})});
  report.status=report.checks.every(c=>c.passed)?'passed':'failed';
 } catch(error){report.status='failed';report.error={code:['MODEL_INVALID_OUTPUT','TIMEOUT','ABORTED','DISCONNECTED','BUDGET_EXCEEDED'].includes(error.code)?error.code:'CONFIGURATION_OR_PROTOCOL_ERROR',...(Array.isArray(error.attempts)?{attempts:error.attempts}:{})};}
}
await writeFile(path.join(root,'specs/001-browser-agent/evidence/t009-model-live.json'),JSON.stringify(report,null,2)+'\n');
console.log('Actual endpoint: '+report.status+'; evidence/t009-model-live.json');
if(report.status!=='passed')process.exitCode=1;
