import {readFile,writeFile,readdir,stat,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {root} from './tools.mjs';
import {collectRelease,releaseHashes,livePassed,performancePassed,manualPassed,reliabilityPassed} from './release-evidence.mjs';
const base='specs/001-browser-agent/',evidence=base+'evidence/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>readFile(path.join(root,file));
const json=async file=>JSON.parse(await read(file));
const report={timestamp:new Date().toISOString(),kind:'documentation-and-traceability-review',status:'pending',checks:[],files:{}};
async function check(name,fn){try{const detail=await fn();report.checks.push({name,passed:true,...(detail?{detail}:{})});console.log(name+': PASS');}catch(error){report.checks.push({name,passed:false,error:error.message});console.log(name+': FAIL ('+error.message+')');}}
function requireThat(value,message){if(!value)throw Error(message);}
const artifacts=[...['observer-browser','control-browser','policy-browser','runtime-browser','loop-browser','sdk-browser','panel-browser','deterministic','faults','checks'].map(n=>evidence+'t013-'+n+'.json'),...['live','performance','manual','reliability','acceptance','checks'].map(n=>evidence+'t014-'+n+'.json')];
const pinned=Object.fromEntries(await Promise.all(artifacts.map(async f=>[f,hash(await read(f))])));
const docs=['README.md',base+'README.md',base+'documentation-v01.md',base+'traceability.md',base+'tasks.md',base+'t015-report.md'];
async function walk(dir){for(const e of await readdir(path.join(root,dir),{withFileTypes:true})){const file=path.posix.join(dir,e.name);if(e.isDirectory())await walk(file);else if(file.endsWith('.md'))docs.push(file);}}
await walk('docs');
await check('localLinks',async()=>{let links=0;for(const file of docs){const text=(await read(file)).toString();for(const m of text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)){let link=m[1].trim().replace(/^<|>$/g,'');if(/^(?:https?:|mailto:|#)/i.test(link))continue;link=decodeURIComponent(link.split('#')[0]);if(!link)continue;const target=path.resolve(root,path.dirname(file),link),relative=path.relative(root,target);requireThat(!relative.startsWith('..')&&!path.isAbsolute(relative),'Link escapes workspace: '+file);await stat(target);links++;}}return {documents:docs.length,links};});
await check('requirementTraceability',async()=>{const manifest=await json(base+'traceability.json');const expected=new Set();for(const f of [base+'spec.md',base+'acceptance.md'])for(const m of (await read(f)).toString().matchAll(/^\|\s*((?:US|FR|NFR|AC)-\d+)\s*\|/gm))expected.add(m[1]);const rows=manifest.requirements;requireThat(rows.length===expected.size&&new Set(rows.map(r=>r.id)).size===expected.size,'Duplicate/missing requirements');for(const row of rows){requireThat(expected.has(row.id),'Unknown requirement '+row.id);requireThat(row.scope&&row.implementation.length&&row.evidence.length&&row.documentation.length,'Unsubstantiated '+row.id);for(const f of [...row.implementation,...row.documentation])await stat(path.join(root,f));for(const e of row.evidence){const data=await json(e.file);requireThat(e.file.endsWith('t014-checks.json')?data.checks?.length===5&&data.checks.every(c=>c.passed):data.status==='passed','Evidence failed: '+e.file);for(const name of e.checks??[])requireThat(data.checks?.some(c=>c.name===name&&c.passed),'Missing assertion '+name);}}return {requirements:rows.length,counts:Object.fromEntries(['US','FR','NFR','AC'].map(prefix=>[prefix,rows.filter(r=>r.id.startsWith(prefix+'-')).length]))};});
for(const [name,args] of [['static',['scripts/static-check.mjs']],['build',['scripts/build.mjs']],['sdkExample',['packages/sdk/examples/minimal.mjs']],['documentedSdkExample',['docs/examples/sdk-task.mjs']]])await check(name,()=>{execFileSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000,stdio:['ignore','pipe','pipe']});return {command:[process.execPath,...args].join(' ')};});
await check('releaseEvidenceReview',async()=>{
    const expected=await releaseHashes(),strict=await collectRelease(),toolchain=await json(evidence+'t014-checks.json');
    requireThat(toolchain.lockfilePresent&&toolchain.checks.length===5&&toolchain.checks.every(c=>c.passed),'T014 engineering checks incomplete');
    const spec=base+'release-v01.md',current=(await read(spec)).toString();
    const originalStatus='状态：运行器与验收门禁已实现；实际模型、性能与人工验收待完成，T-014未勾选。依赖T-013，关联acceptance.md发布门槛及NFR-005–007。';
    const original=current.replace(/^状态：[^\r\n]*/m,originalStatus),normalizedHash=hash(original),suites={};
    for(const [name,valid] of [['live',livePassed],['performance',performancePassed],['manual',manualPassed],['reliability',reliabilityPassed]]){
        const r=await json(evidence+'t014-'+name+'.json');requireThat(valid(r),name+' outcome does not meet original gate');
        const delta=Object.keys({...expected,...r.files}).filter(f=>expected[f]!==r.files?.[f]);
        requireThat(delta.length===0||delta.length===1&&delta[0]===spec&&r.files[spec]===normalizedHash,name+': executable or non-status document drift');
        suites[name]={status:r.status,implementationHashesMatch:true,strictSourceHashesMatch:delta.length===0,statusLineOnly:delta.length===1,differences:delta};
    }
    requireThat(strict.suites.faultMatrix.status==='passed'&&strict.suites.faultMatrix.sourceHashesMatch,'Fault matrix not current');
    return {strictReleaseStatus:strict.status,originalToolchainStatus:toolchain.status,suites,faultMatrix:strict.suites.faultMatrix,reviewScope:'Independent documentation review; original t014 aggregate and fingerprints are not rewritten'};
});
await check('originalEvidenceUnchanged',async()=>{for(const [f,h] of Object.entries(pinned))requireThat(hash(await read(f))===h,'Modified original report: '+f);return {reports:artifacts.length,sha256:pinned};});
for(const file of [...docs,'docs/examples/sdk-task.mjs',base+'traceability.json','scripts/validate-docs.mjs'])report.files[file]=hash(await read(file));
report.status=report.checks.every(c=>c.passed)?'passed':'incomplete';
const file=path.join(root,evidence+'t015-checks.json');
try{const previous=await readFile(file),archive=path.join(root,evidence+'t015-runs',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(archive,{recursive:true});await writeFile(path.join(archive,'t015-checks.json'),previous);}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(evidence+'t015-checks.json: '+report.status);if(report.status!=='passed')process.exitCode=1;
