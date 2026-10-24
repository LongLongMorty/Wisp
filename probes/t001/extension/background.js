const bootId=crypto.randomUUID();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('runner.html'))) return;
  handle(message).then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message})); return true;
});
async function handle(message){
  if(message.kind==='checkpoint') return {bootId,...await chrome.storage.local.get('checkpoint')};
  if(message.kind!=='probe') throw Error('Unknown request');
  const tabs=await chrome.tabs.query({url:message.origin+'/*'});
  if(tabs.length!==1) throw Error('Expected one local fixture tab');
  const tabId=tabs[0].id,target={tabId};let attached=false;const results=[];
  const check=(name,pass,detail)=>{results.push({name,pass,detail});if(!pass)throw Error(name+': '+detail)};
  const command=(method,params={})=>chrome.debugger.sendCommand(target,method,params);
  let contextId;
  const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,contextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
  const evaluateMain=async expression=>{const r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value};
  const click=async point=>{await command('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});await command('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1})};
  const waitFor=async(expression,timeout=4000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50))}throw Error('Timed out waiting for '+expression)};
  try{
    await chrome.debugger.attach(target,'1.3');attached=true;check('debugger.attach',true,'attached');
    const tree=await command('Page.getFrameTree');const frameId=tree.frameTree.frame.id;
    ({executionContextId:contextId}=await command('Page.createIsolatedWorld',{frameId,worldName:'wisp-probe'}));
    await evaluate('globalThis.refs=new Map([["original",document.querySelector("#target")]]);true');
    await evaluate('document.querySelector("#counter").textContent="1";true');
    check('reference.unrelatedMutation',await evaluate('refs.get("original")===document.querySelector("#target") && refs.get("original").isConnected'),'same node stays valid');
    await evaluate('document.querySelector("#target").replaceWith(document.querySelector("#target").cloneNode(true));true');
    check('reference.replacedNodeRejected',await evaluate('!refs.get("original").isConnected && refs.get("original")!==document.querySelector("#target")'),'old node disconnected');
    const point=await evaluate('(()=>{const r=document.querySelector("#name").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await click(point);await command('Input.insertText',{text:'Wisp input'});
    check('input.nativeEvent',await evaluate('document.querySelector("#name").value==="Wisp input" && document.querySelector("#echo").textContent==="Wisp input"'),'input listener reflected text; not a React verification');
    const editor=await evaluate('(()=>{const r=document.querySelector("#editor").getBoundingClientRect();return {x:r.x+5,y:r.y+5}})()');await click(editor);await command('Input.insertText',{text:'contenteditable'});
    check('input.contenteditable',await evaluate('document.querySelector("#editor").textContent.includes("contenteditable")'),'text inserted');
    const shadow=await evaluate('(()=>{const r=document.querySelector("#host").shadowRoot.querySelector("button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await click(shadow);
    check('input.openShadow',await evaluateMain('window.shadowClicks')===1,'shadow button clicked');
    await waitFor('!!document.querySelector("#react-name") && !!document.querySelector("#react-echo")');
    const reactPoint=await evaluate('(()=>{const r=document.querySelector("#react-name").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await click(reactPoint);await command('Input.insertText',{text:'React input'});
    check('input.reactControlled',await evaluate('document.querySelector("#react-name").value==="React input" && document.querySelector("#react-echo").textContent==="React input"'),'CDP trusted input drove React 18 controlled state through onChange');
    const semantics=await evaluateMain('(async()=>{const el=document.querySelector("#react-name"),echo=()=>document.querySelector("#react-echo").textContent,before=echo();el.value="sameWorld";el.dispatchEvent(new Event("input",{bubbles:true}));await new Promise(r=>setTimeout(r,30));const afterPlainChange=echo();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"bypass");el.dispatchEvent(new Event("input",{bubbles:true}));await new Promise(r=>setTimeout(r,30));return {hasTracker:!!el._valueTracker,before,afterPlainChange,afterBypassChange:echo()}})()');
    check('input.reactControlledSemantics',semantics.hasTracker && semantics.before==="React input" && semantics.afterPlainChange==="React input" && semantics.afterBypassChange==="bypass",JSON.stringify(semantics));
    await chrome.storage.local.set({checkpoint:{status:'dispatching',actionId:'probe-unknown',bootId}});
    check('checkpoint.persisted',!!(await chrome.storage.local.get('checkpoint')).checkpoint,'storage.local probe only; production IndexedDB pending');
    const destination=message.origin+'/next';
    const navigation=await command('Page.navigate',{url:destination});
    if(navigation.errorText)throw Error('Navigation failed: '+navigation.errorText);
    const deadline=Date.now()+4000;let reached=false;
    while(Date.now()<deadline){
      const current=await command('Page.getFrameTree');
      if(current.frameTree.frame.url===destination){reached=true;break}
      await new Promise(r=>setTimeout(r,20));
    }
    if(!reached)throw Error('Navigation did not reach expected URL');
    let invalid=false,contextError='';
    try{await evaluate('refs.get("original").isConnected')}
    catch(error){
      contextError=error.message;
      if(!/Cannot find context with specified id|Execution context was destroyed/i.test(contextError))throw error;
      invalid=true;
    }
    check('navigation.invalidatesContext',invalid,'destination URL confirmed; '+contextError);
    return {bootId,results};
  }catch(error){return {bootId,results,error:error.message}}
  finally{if(attached)await chrome.debugger.detach(target).catch(()=>{})}
}
