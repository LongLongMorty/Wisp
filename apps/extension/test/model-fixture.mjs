import {createServer} from 'node:http';
import {once} from 'node:events';
const server=createServer(async(req,res)=>{try{let body='';for await(const c of req){body+=c;if(body.length>65536){res.writeHead(413);res.end();return;}}const {input}=JSON.parse(JSON.parse(body).messages[1].content);if(input.goal==='PANEL_HANG')return;const o=input.observation;let decision;
 if(input.goal==='PANEL_WAIT')decision={kind:'ask_user',question:'请先接管并核对网页，再恢复任务。'};
 else if(input.goal==='PANEL_CONFIRM'&&!o.text.includes('操作已记录')){const el=o.elements.find(e=>e.role==='button'&&e.name==='普通按钮');decision={kind:'action',request:{action:{kind:'click',target:{documentId:o.documentId,frameId:o.frameId,observationId:o.observationId,ref:el.ref}},timeoutMs:3000}};}
 else decision={kind:'finish',summary:'本地页面验证通过',expected:[{kind:'url',equals:o.url},{kind:'text',includes:input.goal==='PANEL_CONFIRM'?'操作已记录':'普通按钮'}]};
 res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision)}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}}));
 }catch{res.writeHead(400);res.end('Invalid fixture request');}});
server.listen(0,'127.0.0.1');await once(server,'listening');console.log(JSON.stringify({endpoint:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',model:'fixture-model',apiKey:'PANEL_TEST_KEY (fake fixture key; any value works)',goals:['PANEL_READ','PANEL_CONFIRM','PANEL_WAIT','PANEL_HANG'],purpose:'manual local fixture only; no real provider'}));
