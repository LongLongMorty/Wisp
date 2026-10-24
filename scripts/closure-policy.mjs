import {createHash} from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// The only exception is a frozen, byte-verifiable status-line transition.
export function reviewFingerprints(current, recorded, document, baseline) {
    const differences = Object.keys({...current,...recorded}).filter(f => current[f] !== recorded?.[f]);
    if (!differences.length) return {passed:true,differences,statusLineOnly:false};
    const restored = document.replace(/^状态：[^\r\n]*/m, baseline.originalStatus);
    const passed = differences.length === 1 && differences[0] === baseline.file &&
        current[baseline.file] === baseline.frozenSha256 && sha256(document) === baseline.frozenSha256 &&
        restored !== document && sha256(restored) === baseline.originalSha256 &&
        recorded?.[baseline.file] === baseline.originalSha256;
    return {passed,differences,statusLineOnly:passed};
}
