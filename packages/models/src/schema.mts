import type { JsonValue } from '@wisp/protocol';
const keys = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'];
const invalid = (): never => { throw new Error('Invalid extraction schema or data'); };
const equal = (a: JsonValue, b: JsonValue): boolean => {
    if (a === b)
        return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b))
        return false;
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) && equal((a as Record<string, JsonValue>)[k]!, (b as Record<string, JsonValue>)[k]!));
};
export function compileSchema(schema: JsonValue): (data: JsonValue) => void {
    function compile(s: JsonValue, depth = 0): (data: JsonValue) => void {
        if (!s || typeof s !== 'object' || Array.isArray(s) || depth > 8 || Object.keys(s).some(k => !keys.includes(k)))
            return invalid();
        const types = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
        if (typeof s.type !== 'string' || !types.includes(s.type))
            return invalid();
        const applicable: Record<string, string[]> = { object: ['properties', 'required', 'additionalProperties'], array: ['items', 'minItems', 'maxItems'], string: ['minLength', 'maxLength'], number: ['minimum', 'maximum'], integer: ['minimum', 'maximum'], boolean: [], null: [] };
        const type = s.type;
        if (Object.keys(s).some(k => !['type', 'enum', ...applicable[type]!].includes(k)))
            return invalid();
        for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems'])
            if (s[k] !== undefined && (!Number.isSafeInteger(s[k]) || (s[k] as number) < 0))
                return invalid();
        for (const k of ['minimum', 'maximum'])
            if (s[k] !== undefined && (typeof s[k] !== 'number' || !Number.isFinite(s[k])))
                return invalid();
        for (const [min, max] of [['minimum', 'maximum'], ['minItems', 'maxItems'], ['minLength', 'maxLength']])
            if (typeof s[min!] === 'number' && typeof s[max!] === 'number' && (s[min!] as number) > (s[max!] as number))
                return invalid();
        if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length))
            return invalid();
        const props = s.properties;
        if (props !== undefined && (!props || typeof props !== 'object' || Array.isArray(props)))
            return invalid();
        if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(x => typeof x !== 'string')))
            return invalid();
        if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean')
            return invalid();
        const validators = Object.fromEntries(Object.entries(props ?? {}).map(([k, v]) => [k, compile(v, depth + 1)]));
        const item = s.items === undefined ? undefined : compile(s.items, depth + 1);
        return data => {
            const t = data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data;
            if (t !== s.type && !(s.type === 'integer' && typeof data === 'number' && Number.isSafeInteger(data)))
                invalid();
            if (s.enum !== undefined && !(s.enum as JsonValue[]).some(x => equal(x, data)))
                invalid();
            if (typeof data === 'number' && ((typeof s.minimum === 'number' && data < s.minimum) || (typeof s.maximum === 'number' && data > s.maximum)))
                invalid();
            const length = typeof data === 'string' ? [...data].length : Array.isArray(data) ? data.length : undefined;
            if (length !== undefined) {
                const min = s[t === 'array' ? 'minItems' : 'minLength'];
                const max = s[t === 'array' ? 'maxItems' : 'maxLength'];
                if ((typeof min === 'number' && length < min) || (typeof max === 'number' && length > max))
                    invalid();
            }
            if (Array.isArray(data))
                data.forEach(v => item?.(v));
            else if (data && typeof data === 'object') {
                for (const k of (s.required ?? []) as string[])
                    if (!Object.hasOwn(data, k))
                        invalid();
                for (const [k, v] of Object.entries(data)) {
                    if (!Object.hasOwn(validators, k)) {
                        if (s.additionalProperties === false)
                            invalid();
                    }
                    else
                        validators[k]!(v);
                }
            }
        };
    }
    return compile(schema);
}
