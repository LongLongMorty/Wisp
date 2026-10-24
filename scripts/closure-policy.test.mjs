import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reviewFingerprints,sha256} from './closure-policy.mjs';
const document = '# Spec\r\n状态：完成\r\n固定门槛\r\n';
const originalStatus = '状态：待完成';
const baseline = {file:'spec.md',originalStatus,frozenSha256:sha256(document),originalSha256:sha256(document.replace('状态：完成',originalStatus))};
const current = {'code.mjs':'abc','spec.md':baseline.frozenSha256};
const recorded = {...current,'spec.md':baseline.originalSha256};
test('accepts exact fingerprints and frozen status-only transition',()=>{
    assert.equal(reviewFingerprints(current,current,document,baseline).passed,true);
    assert.equal(reviewFingerprints(current,recorded,document,baseline).statusLineOnly,true);
});
for (const [name,now,old,text] of [
    ['code change',{...current,'code.mjs':'changed'},recorded,document],
    ['new file',{...current,extra:'new'},recorded,document],
    ['missing file',{'spec.md':current['spec.md']},recorded,document],
    ['wrong old hash',current,{...recorded,'spec.md':'wrong'},document],
    ['non-status change',{...current,'spec.md':sha256(document+'new requirement')},recorded,document+'new requirement'],
    ['unfrozen status',{...current,'spec.md':sha256(document.replace('完成','其他'))},recorded,document.replace('完成','其他')]
]) test('rejects '+name,()=>assert.equal(reviewFingerprints(now,old,text,baseline).passed,false));
