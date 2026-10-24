import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createChromeAdapter } from '../packages/browser-chrome/dist/index.mjs';
import { createPolicyGateway } from '../packages/policy/dist/index.mjs';
import { createTaskRuntime, createMemoryStore } from '../packages/runtime/dist/index.mjs';
import { createFixtureServer } from '../fixtures/web/server.mjs';
import { createController, assertNoEffects } from '../fixtures/web/oracle.mjs';
import { launchReleaseChrome, machine, navigate, waitFor, browserFailure } from './release-chrome.mjs';
import { releaseHashes, archiveRelease, writeRelease, reliabilityPassed } from './release-evidence.mjs';
import { siteRules } from './release-cases.mjs';
await archiveRelease(['reliability']);
const report={timestamp:new Date().toISOString(),kind:'scripted-reliability-probe',status:'pending',machine:machine(),files:await releaseHashes(),checks:[]};
let chrome,server,adapter,gateway,runtime,store;
const check=(name,passed)=>{assert.ok(passed,name);report.checks.push({name,passed:true});};
try {
    chrome=await launchReleaseChrome();report.browser=await chrome.send('Browser.getVersion');server=await createFixtureServer();report.fixtureVersion=server.version;
    const control=createController(server),session=await control.create(),page=await chrome.page(),origin=new URL(session.baseUrl).origin;
    const makeAdapter=()=>createChromeAdapter({send:(m,p)=>page.send(m,p)},{allowedOrigins:[origin]});adapter=makeAdapter();
    const request=(action)=>({actionId:crypto.randomUUID(),action,timeoutMs:3000});
    async function target(role,name){const o=await adapter.observe(),e=o.elements.find(e=>e.role===role&&e.name===name);assert.ok(e);return {documentId:o.documentId,frameId:o.frameId,observationId:o.observationId,ref:e.ref};}
    await navigate(page,session.baseUrl+'/form','form');
    await adapter.execute(request({kind:'fill',target:await target('textbox','标题'),value:'观察状态标题'}));
    await adapter.execute(request({kind:'fill',target:await target('textbox','描述'),value:'描述已填写'}));
    let o=await adapter.observe();check('observe.formValues',o.elements.find(e=>e.name==='标题').value==='观察状态标题'&&o.elements.find(e=>e.name==='描述').value==='描述已填写');
    await page.evaluate('document.querySelector("[name=description]").value="x".repeat(3000)');o=await adapter.observe();
    check('observe.valueBounds',o.elements.find(e=>e.name==='描述').value.length===2048&&o.elements.find(e=>e.name==='描述').valueTruncated&&JSON.stringify(o).length<=24000);
    await navigate(page,session.baseUrl+'/safety','safety');
    await page.evaluate('document.querySelector("input[type=password]").value="PRIVATE_RELIABILITY_SECRET"');o=await adapter.observe();
    check('observe.sensitiveExcluded',o.elements.some(e=>e.sensitive&&!Object.hasOwn(e,'value'))&&!JSON.stringify(o).includes('PRIVATE_RELIABILITY_SECRET'));
    await navigate(page,session.baseUrl+'/table','table');await waitFor(()=>page.evaluate('document.querySelectorAll("#rows tr").length===12'));
    o=await adapter.observe();let e=o.elements.find(e=>e.name==='状态');
    check('observe.selectState',e.value==='all'&&e.options.some(option=>option.value==='pending'&&option.label==='待处理')&&e.options.some(option=>option.value==='all'&&option.selected));
    const extensionId='a'.repeat(32),ui={id:extensionId,url:'chrome-extension://'+extensionId+'/sidepanel.html'};
    gateway=createPolicyGateway({browser:adapter,readContext:(r,s)=>adapter.readPolicyContext(r,s),extensionId,uiUrl:ui.url,tabId:1,rules:siteRules(session.baseUrl)});gateway.grantOrigin(origin,ui);
    for(const [name,value] of [['状态','pending'],['优先级','high']]){const d=await gateway.submit('filters',request({kind:'selectOption',target:await target('combobox',name),value}));check('select.'+value,d.kind==='executed'&&d.result.dispatched==='yes'&&d.result.verified==='passed');}
    await waitFor(()=>page.evaluate('document.querySelectorAll("#rows tr").length===5'));
    check('select.actualFilteredRows',JSON.stringify(await page.evaluate('[...document.querySelectorAll("#rows tr")].map(r=>r.cells[0].textContent)'))===JSON.stringify((await control.state(session.sessionId)).expected.pendingHighIds));
    let r=await adapter.execute(request({kind:'selectOption',target:await target('combobox','状态'),value:'missing'}));check('select.missingRejected',r.dispatched==='no'&&r.error.code==='NOT_ACTIONABLE');
    await page.evaluate('document.querySelector("#status-filter option[value=closed]").disabled=true');
    r=await adapter.execute(request({kind:'selectOption',target:await target('combobox','状态'),value:'closed'}));check('select.disabledRejected',r.dispatched==='no'&&r.error.code==='NOT_ACTIONABLE');
    await page.evaluate('document.getElementById("status-filter").append(document.querySelector("#status-filter option[value=pending]").cloneNode(true))');
    r=await adapter.execute(request({kind:'selectOption',target:await target('combobox','状态'),value:'pending'}));check('select.ambiguousRejected',r.dispatched==='no'&&r.error.code==='AMBIGUOUS_TARGET');
    const stale=await target('combobox','状态');await page.evaluate('const el=document.getElementById("status-filter");el.replaceWith(el.cloneNode(true))');
    r=await adapter.execute(request({kind:'selectOption',target:stale,value:'all'}));check('select.staleRejected',r.dispatched==='no'&&r.error.code==='STALE_TARGET');
    await gateway.dispose();gateway=undefined;adapter=makeAdapter();
    await navigate(page,session.baseUrl+'/controls','controls');
    const react=await readFile(new URL('../probes/t001/vendor/react.production.min.js',import.meta.url),'utf8'),reactDom=await readFile(new URL('../probes/t001/vendor/react-dom.production.min.js',import.meta.url),'utf8');
    await page.evaluate(react+';'+reactDom+';(()=>{const root=document.createElement("div");document.body.prepend(root);function App(){const [v,set]=React.useState("all");return React.createElement("label",null,"React状态",React.createElement("select",{value:v,onChange:e=>set(e.target.value)},React.createElement("option",{value:"all"},"全部"),React.createElement("option",{value:"pending"},"待处理")),React.createElement("output",{id:"react-select-echo"},v))}ReactDOM.createRoot(root).render(React.createElement(App))})()');
    await waitFor(()=>page.evaluate('!!document.getElementById("react-select-echo")'));
    // Label has an output sibling, so use the observed role rather than invent a node ID.
    o=await adapter.observe();e=o.elements.find(e=>e.role==='combobox');assert.ok(e);
    r=await adapter.execute(request({kind:'selectOption',target:{documentId:o.documentId,frameId:o.frameId,observationId:o.observationId,ref:e.ref},value:'pending'}));
    await waitFor(()=>page.evaluate('document.getElementById("react-select-echo").textContent==="pending"'));
    check('select.reactControlled',r.verified==='passed');await adapter.dispose();adapter=undefined;
    await navigate(page,session.baseUrl+'/records/W-104','detail');await waitFor(()=>page.evaluate('document.getElementById("record-title").textContent.includes("报表访问异常")'));
    store=createMemoryStore();let hostTitle='报表访问异常';
    runtime=await createTaskRuntime({store,loop:{modelFactory({onAttempt}){return {async decide(input){onAttempt();return {decision:{kind:'finish',summary:'URL-only model',expected:[{kind:'url',equals:input.observation.url}]}}}};}},gatewayFactory:async()=>{const b=makeAdapter(),g=createPolicyGateway({browser:b,readContext:(r,s)=>b.readPolicyContext(r,s),extensionId,uiUrl:ui.url,tabId:1});g.grantOrigin(origin,ui);return g;}});
    for(const [id,title,pass] of [['good',hostTitle,true],['bad','ABSENT_REQUIRED_TITLE',false]]){await runtime.create({runId:id,tabId:1,goal:'验证宿主条件'});await runtime.configureLoop(id,{completionConditions:[{kind:'url',startsWith:session.baseUrl+'/records/'},{kind:'text',includes:title}]});await runtime.start(id);const step=await runtime.step(id),snap=(await runtime.get(id)).snapshot;check('completion.'+id,pass?snap.status==='completed'&&snap.result.evidence.some(e=>e.kind==='text'):step.kind==='unverified'&&snap.status==='running');if(!pass)await runtime.cancel(id);}
    assertNoEffects(await control.state(session.sessionId));check('oracle.zeroEffects',true);
    report.status='passed';if(!reliabilityPassed(report))report.status='failed';
} catch(error){report.status=report.checks.length===0&&chrome?browserFailure(error,chrome.stderr()):'failed';report.error={code:/^[A-Z_]+$/.test(error.code??'')?error.code:'ASSERTION_OR_BROWSER_ERROR',completed:report.checks.length};if(chrome)report.browserStderr=chrome.stderr();}
finally{await runtime?.dispose();store?.close();await gateway?.dispose().catch(()=>{});await adapter?.dispose().catch(()=>{});await chrome?.close();await server?.close();await writeRelease('reliability',report);console.log('Reliability browser: '+report.status+'; checks='+report.checks.length);if(report.status!=='passed')process.exitCode=1;}
