import { object, text, boolean, origin, httpUrl, fail } from './validation.mts';
export type PolicyTarget = {
    ref: string;
    tag: string;
    role: string;
    name: string;
    hint: string;
    enabled: boolean;
    editable: boolean;
    sensitive: boolean;
    formSensitive: boolean;
    inputType: string;
    destinationOrigins: string[];
    newWindow: boolean;
    fingerprint: string;
};
export type PolicyContext = {
    origin: string;
    url: string;
    documentId: string;
    frameId: string;
    documentDigest: string;
    complete: boolean;
    target?: PolicyTarget;
};
export function parsePolicyContext(v: unknown): PolicyContext {
    object(v, ['origin', 'url', 'documentId', 'frameId', 'documentDigest', 'complete'], ['target'], 'policyContext');
    function digest(value: unknown) { const s = text(value, 'policy.digest', 64); if (!/^[a-f0-9]{64}$/.test(s))
        fail('policy.digest'); return s; }
    const result: PolicyContext = { origin: origin(v.origin, 'policy.origin'), url: httpUrl(v.url, 'policy.url'), documentId: text(v.documentId, 'policy.documentId'), frameId: text(v.frameId, 'policy.frameId'), documentDigest: digest(v.documentDigest), complete: boolean(v.complete, 'policy.complete') };
    if (new URL(result.url).origin !== result.origin)
        fail('policy.origin');
    if (Object.hasOwn(v, 'target')) {
        const t = v.target;
        object(t, ['ref', 'tag', 'role', 'name', 'hint', 'enabled', 'editable', 'sensitive', 'formSensitive', 'inputType', 'destinationOrigins', 'newWindow', 'fingerprint'], [], 'policy.target');
        if (!Array.isArray(t.destinationOrigins) || t.destinationOrigins.length > 4)
            fail('policy.destinations');
        result.target = { ref: text(t.ref, 'policy.ref'), tag: text(t.tag, 'policy.tag', 64), role: text(t.role, 'policy.role', 128), name: text(t.name, 'policy.name', 1024, true), hint: text(t.hint, 'policy.hint', 2048, true), enabled: boolean(t.enabled, 'policy.enabled'), editable: boolean(t.editable, 'policy.editable'), sensitive: boolean(t.sensitive, 'policy.sensitive'), formSensitive: boolean(t.formSensitive, 'policy.formSensitive'), inputType: text(t.inputType, 'policy.inputType', 64, true), destinationOrigins: t.destinationOrigins.map(value => origin(value, 'policy.destination')), newWindow: boolean(t.newWindow, 'policy.newWindow'), fingerprint: digest(t.fingerprint) };
    }
    return result;
}
