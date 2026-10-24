import assert from 'node:assert/strict';
import {createAgent} from '../dist/index.mjs';
import {createMemoryStore} from '@wisp/runtime';
import {createScriptedModel} from '@wisp/models';
const observation={observationId:'o',documentId:'d',frameId:'main',url:'https://example.test/',title:'Example',capturedAt:new Date().toISOString(),viewport:{width:800,height:600,dpr:1,scrollX:0,scrollY:0},elements:[],text:'Ready',truncated:false,truncationReasons:[]};
const store=createMemoryStore();
// 可执行的确定性宿主示例；不是Chrome或真实模型验收。
const agent=createAgent({store,tabId:1,modelFactory:()=>createScriptedModel({decisions:[{kind:'finish',summary:'Example verified',expected:[{kind:'url',equals:observation.url}]}]}),gatewayFactory:async()=>({async observe(){return observation;},async verify(conditions){return {status:'passed',conditions:conditions.map(condition=>({condition,status:'passed',evidence:[{kind:'url',url:observation.url,documentId:'d',observationId:'o',capturedAt:observation.capturedAt,actual:'matched'}]}))};},async submit(){throw Error('Read-only example');},async dispose(){}})});
try{const run=agent.run({goal:'Verify example URL'});const result=await run.result;assert.equal(result.status,'completed');const replay=await run.events();assert.ok(replay.events.length>0);console.log(JSON.stringify({runId:run.runId,status:result.status,replayedEvents:replay.events.length}));}finally{await agent.dispose();store.close();}
