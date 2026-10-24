import assert from 'node:assert/strict';
import {createAgent} from '../../packages/sdk/dist/index.mjs';
import {createMemoryStore} from '../../packages/runtime/dist/index.mjs';
import {createScriptedModel} from '../../packages/models/dist/index.mjs';

// Deterministic, read-only host demonstration. No browser, provider or approval.
const observation={observationId:'demo-observation',documentId:'demo-document',frameId:'main',url:'https://example.test/records/demo',title:'SDK demo',capturedAt:new Date().toISOString(),viewport:{width:800,height:600,dpr:1,scrollX:0,scrollY:0},elements:[],text:'Demo record ready',truncated:false,truncationReasons:[]};
const scripted=createScriptedModel({decisions:[{kind:'ask_user',question:'等待宿主显式恢复'},{kind:'finish',summary:'只读示例完成',expected:[{kind:'url',equals:observation.url}]}]});
const store=createMemoryStore();
const agent=createAgent({store,tabId:1,modelFactory({onAttempt}){return {async decide(input,signal){onAttempt();return scripted.decide(input,signal);},async extract(input,signal){onAttempt();return scripted.extract(input,signal);}};},gatewayFactory:async()=>({async observe(){return structuredClone(observation);},async submit(){throw Error('This demonstration does not execute actions');},async verify(conditions){const results=conditions.map(condition=>{let passed=false;if(condition.kind==='url')passed='equals' in condition?observation.url===condition.equals:observation.url.startsWith(condition.startsWith);if(condition.kind==='text')passed=observation.text.includes(condition.includes);return {condition,status:passed?'passed':'failed',evidence:passed?[{kind:condition.kind,url:observation.url,documentId:observation.documentId,observationId:observation.observationId,capturedAt:observation.capturedAt,actual:'matched'}]:[]};});return {status:results.every(r=>r.status==='passed')?'passed':'failed',conditions:results};},async dispose(){}})});
let handle;
try{
    await agent.ready;
    handle=agent.run({goal:'核对只读示例记录',completionConditions:[{kind:'url',startsWith:'https://example.test/records/'},{kind:'text',includes:'Demo record ready'}]});
    assert.equal(typeof handle.runId,'string');
    handle.result.catch(()=>{});
    const deadline=Date.now()+3000;
    while((await handle.snapshot()).status!=='waiting_user') {if(Date.now()>deadline)throw Error('Demo did not wait for user');await new Promise(r=>setTimeout(r,5));}
    assert.equal((await handle.pending()).kind,'ask_user');
    // A real host invokes these after user input; this read-only demo drives it explicitly.
    await handle.pause();await handle.resume();
    const result=await handle.result;
    assert.equal(result.status,'completed');
    assert.ok(result.evidence.some(e=>e.kind==='text'));
    assert.ok(result.evidence.some(e=>e.kind==='url'));
    const events=await handle.events(),again=await handle.events();
    assert.ok(events.events.length>0);
    assert.ok(events.events.every((e,i,a)=>i===0||e.seq>a[i-1].seq));
    assert.deepEqual(events.events.map(e=>e.eventId),again.events.map(e=>e.eventId));
    console.log(JSON.stringify({kind:'deterministic-sdk-documentation-example',status:result.status,waitingAndResume:true,hostEvidence:true,eventCount:events.events.length}));
}finally{await agent.dispose();store.close();}
