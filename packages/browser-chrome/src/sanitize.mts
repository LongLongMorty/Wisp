export type Sanitizer = {
    text(value: string, max?: number): string;
    url(value: string): string;
    sensitive(metadata: string): boolean;
};
export function createSanitizer(secrets: readonly string[]): Sanitizer {
    const values = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
    const sensitive = (metadata: string) => /(?:password|passwd|secret|token|authorization|api[\s_-]*key|one-time-code|(?:^|[^a-z])otp(?:[^a-z]|$)|verification[\s_-]*code|密码|口令|验证码|密钥|令牌)/i.test(metadata);
    function clean(value: string, max = 24000) {
        let result = value;
        for (const secret of values)
            result = result.split(secret).join('[REDACTED]');
        return result.slice(0, max);
    }
    return { text: clean, sensitive, url(value) {
            const url = new URL(value);
            url.username = '';
            url.password = '';
            url.hash = '';
            for (const [key, item] of [...url.searchParams])
                if (sensitive(key) || /^(code|access[_-]?key)$/i.test(key) || values.some(secret => item.includes(secret)))
                    url.searchParams.set(key, '[REDACTED]');
            let decoded;
            try {
                decoded = decodeURIComponent(url.pathname);
            }
            catch {
                decoded = '';
                url.pathname = '/[REDACTED]';
            }
            if (values.some(secret => url.pathname.includes(secret) || decoded.includes(secret)))
                url.pathname = '/[REDACTED]';
            return url.href;
        } };
}
