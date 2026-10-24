import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeActionRequest,parseActionRequest,parseBrowserAction,parseCondition,ProtocolError,MAX_PAYLOAD_BYTES} from '../src/index.mts';
const target={documentId:'document-1',frameId:'main',observationId:'observation-1',ref:'r-1'};
const request=(action={kind:'click',target})=>({actionId:'action-1',action,timeoutMs:10000});
const invalid=fn=>assert.throws(fn,error=>error instanceof ProtocolError && error.code==='MODEL_INVALID_OUTPUT');
test('valid actions survive JSON decoding without sharing input references',()=>{
  for(const action of [{kind:'click',target},{kind:'fill',target,value:''},{kind:'pressKey',target,key:'Enter'},{kind:'scroll',direction:'down',pixels:2000},{kind:'navigate',url:'https://example.test/path'}]) {
    const input=request(action);const parsed=decodeActionRequest(JSON.stringify(input));assert.deepEqual(parsed,input);assert.notEqual(parsed,input);
  }
  const original=request();const parsed=parseActionRequest(original);original.action.target.ref='changed';assert.equal(parsed.action.target.ref,'r-1');target.ref='r-1';
});
test('unknown action and executable fields are rejected',()=>{
  invalid(()=>parseBrowserAction({kind:'evaluate',script:'alert(1)'}));
  invalid(()=>parseBrowserAction({kind:'click',target,javascript:'alert(1)'}));
  invalid(()=>parseActionRequest({...request(),approved:true}));
});
test('all target identity scopes are mandatory',()=>{
  for(const key of Object.keys(target)){const partial={...target};delete partial[key];invalid(()=>parseBrowserAction({kind:'click',target:partial}));}
  invalid(()=>parseBrowserAction({kind:'click',target:{...target,ref:''}}));
});
test('navigation disallows script URLs, credentials and malformed URLs',()=>{
  for(const url of ['javascript:alert(1)','file:///tmp/x','data:text/html,x','https://user:secret@example.test','relative-path'])invalid(()=>parseBrowserAction({kind:'navigate',url}));
});
test('timeouts and scrolling reject unbounded, fractional and nonfinite values',()=>{
  for(const value of [0,-1,30001,Infinity,NaN,0.5,'10']) invalid(()=>parseActionRequest({...request(),timeoutMs:value}));
  for(const value of [0,-1,2001,1.5,NaN]) invalid(()=>parseBrowserAction({kind:'scroll',direction:'down',pixels:value}));
});
test('fill values are bounded and errors do not expose the submitted value',()=>{
  const secret='sensitive-value'.repeat(1000);try{parseBrowserAction({kind:'fill',target,value:secret});assert.fail('accepted overlong value')}catch(error){assert.ok(error instanceof ProtocolError);assert.ok(!error.message.includes('sensitive-value'));}
});
test('key allowlist excludes browser shortcuts',()=>{
  for(const key of ['Control+L','Control+W','F12','Alt+F4','eval(x)']) invalid(()=>parseBrowserAction({kind:'pressKey',target,key}));
});
test('conditions validate strictly including empty comparison values',()=>{
  const conditions=[{kind:'url',equals:'https://example.test'},{kind:'element',role:'button',name:'Save',state:'visible'},{kind:'text',includes:'Saved'},{kind:'value',target,equals:''}];
  assert.deepEqual(parseActionRequest({...request(),expected:conditions}).expected,conditions);
  invalid(()=>parseCondition({kind:'text',includes:''}));invalid(()=>parseCondition({kind:'element',role:'button',name:'Save',state:'anything'}));
  invalid(()=>parseActionRequest({...request(),expected:Array(17).fill(conditions[0])}));
  invalid(()=>parseActionRequest({...request(),expected:Array(1)}));
});
test('wire payload uses UTF-8 byte limit before JSON parsing',()=>{
  invalid(()=>decodeActionRequest(' '.repeat(MAX_PAYLOAD_BYTES+1)));
  invalid(()=>decodeActionRequest('中'.repeat(Math.ceil(MAX_PAYLOAD_BYTES/3))));
  invalid(()=>decodeActionRequest('{broken'));invalid(()=>decodeActionRequest(null));
});
test('prototype fields, arrays and nonplain request objects are rejected',()=>{
  invalid(()=>decodeActionRequest(JSON.stringify(request()).replace('"actionId"','"__proto__":{},"actionId"')));
  for(const value of [[],null,new Date(),Object.create({actionId:'inherited'})]) invalid(()=>parseActionRequest(value));
});
