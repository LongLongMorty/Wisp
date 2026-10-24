import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {root} from './tools.mjs';
import {collectRelease,releaseHashes,livePassed,performancePassed,manualPassed,reliabilityPassed} from './release-evidence.mjs';
import {sha256,reviewFingerprints} from './closure-policy.mjs';
const base='specs/001-browser-agent/',dir=base+'evidence/';
const read=file=>readFile(path.join(root,file));
const json=async file=>JSON.parse(await read(file));
const baseline=await json(base+'closure-baseline.json');
const report={timestamp:new Date().toISOString(),kind:'release-evidence-closure',status:'pending',mode:'reuse-existing-acceptance-with-frozen-status-line-review',checks:[],inputs:{},suites:{},scope:'Acceptance closure only; no new browser/model/human run and no public release'};
function requireThat(ok,message){if(!ok)throw Error(message);}
async function check(name,fn){try{const detail=await fn();report.checks.push({name,passed:true,detail});console.log(name+': PASS');}catch(error){report.checks.push({name,passed:false,error:error.message});console.log(name+': FAIL ('+error.message+')');}}
await check('originalEvidence',async()=>{requireThat(Object.keys(baseline.artifacts).length===16,'Expected 16 original reports');for(const [file,hash] of Object.entries(baseline.artifacts)){requireThat(sha256(await read(file))===hash,'Original report changed: '+file);report.inputs[file]=hash;}return {reports:16};});
await check('frozenSpecification',async()=>{for(const [file,hash] of Object.entries(baseline.specifications)){requireThat(sha256(await read(file))===hash,'Frozen specification changed: '+file);}return baseline.specifications;});
await check('policyRegression',()=>{execFileSync(process.execPath,['--test','scripts/closure-policy.test.mjs'],{cwd:root,windowsHide:true,stdio:'pipe',timeout:60000});return {tests:7};});
await check('releaseEvidence',async()=>{
    const current=await releaseHashes(),document=(await read(baseline.transition.file)).toString('utf8');
    for(const [name,validate] of [['live',livePassed],['performance',performancePassed],['manual',manualPassed],['reliability',reliabilityPassed]]){
        const saved=await json(dir+'t014-'+name+'.json');
        requireThat(validate(saved),name+': original acceptance gate failed');
        const review=reviewFingerprints(current,saved.files,document,baseline.transition);
        requireThat(review.passed,name+': unapproved fingerprint difference');
        report.suites[name]={outcome:'passed',...review,evidence:dir+'t014-'+name+'.json'};
    }
    const strict=await collectRelease();report.originalStrictStatus=strict.status;
    requireThat(strict.suites.faultMatrix.status==='passed'&&strict.suites.faultMatrix.sourceHashesMatch,'Fault matrix not current');
    report.suites.faultMatrix=strict.suites.faultMatrix;
    report.implementationFiles=current;
    return {originalStrictStatus:strict.status,exception:baseline.transition.file};
});
await check('engineeringAndDocumentation',async()=>{
    const original=await json(dir+'t014-checks.json'),docs=await json(dir+'t015-checks.json');
    requireThat(original.lockfilePresent&&original.checks.length===5&&original.checks.every(c=>c.passed),'Original engineering checks failed');
    requireThat(docs.status==='passed'&&docs.checks.length===8&&docs.checks.every(c=>c.passed),'Documentation checks failed');
    for(const [file,hash] of Object.entries(docs.files))requireThat(sha256(await read(file))===hash,'Documentation evidence stale: '+file);
    report.inputs[dir+'t015-checks.json']=sha256(await read(dir+'t015-checks.json'));
    return {engineeringChecks:5,documentationChecks:8};
});
await check('originalEvidenceUnchanged',async()=>{for(const [file,hash] of Object.entries(baseline.artifacts))requireThat(sha256(await read(file))===hash,'Original report changed: '+file);return {reports:16};});
for(const file of [base+'closure-baseline.json',base+'closure-v01.md',base+'t016-report.md','scripts/closure-policy.mjs','scripts/closure-policy.test.mjs','scripts/validate-closure.mjs'])report.inputs[file]=sha256(await read(file));
report.status=report.checks.every(c=>c.passed)?'passed':'incomplete';
const target=dir+'t016-closure.json';
try{const previous=await read(target),archive=dir+'t016-runs/'+new Date().toISOString().replace(/[:.]/g,'-');await mkdir(path.join(root,archive),{recursive:true});await writeFile(path.join(root,archive,'t016-closure.json'),previous);}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(path.join(root,target),JSON.stringify(report,null,2)+'\n');console.log(target+': '+report.status);if(report.status!=='passed')process.exitCode=1;
