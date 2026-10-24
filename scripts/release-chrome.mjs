import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { root } from './tools.mjs';
export const machine = () => ({ release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version });
export async function launchReleaseChrome() {
    const cache = path.join(root, '.cache/t014'); await mkdir(cache, { recursive: true });
    const profile = await mkdtemp(path.join(cache, 'chrome-'));
    const child = spawn(process.env.WISP_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-software-rasterizer', '--no-first-run', '--no-default-browser-check', '--window-size=1280,720', '--remote-debugging-pipe', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    let stderr = '', buffer = '', next = 0, closed = false; const pending = new Map();
    function rejectAll(error) { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); }
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.once('error', rejectAll); child.once('exit', () => rejectAll(Error('Chrome exited')));
    child.stdio[3].on('error', rejectAll); child.stdio[4].on('error', rejectAll);
    child.stdio[4].on('data', chunk => {
        buffer += chunk; let end;
        while ((end = buffer.indexOf('\0')) >= 0) {
            const part = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!part) continue;
            const message = JSON.parse(part), p = pending.get(message.id); if (!p) continue;
            pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(Object.assign(Error('CDP ' + message.error.code), { transient: /Execution context was destroyed|Cannot find context with specified id/.test(message.error.message ?? '') })) : p.resolve(message.result);
        }
    });
    function send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            if (closed || child.exitCode !== null || child.killed || child.stdio[3].destroyed) return reject(Error('Chrome exited'));
            const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout')); }, 8000);
            pending.set(id, { resolve, reject, timer }); child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
        });
    }
    return {
        send, stderr: () => stderr,
        async page() {
            const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
            const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
            await send('Page.enable', {}, sessionId);
            async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (r.exceptionDetails) throw Error('PAGE_EVALUATION_FAILED'); return r.result.value; }
            return { targetId, sessionId, evaluate, send: (method, params) => send(method, params, sessionId), async close() { await send('Target.closeTarget', { targetId }).catch(() => {}); } };
        },
        async close() { await send('Browser.close').catch(() => {}); closed = true; child.kill(); rejectAll(Error('Probe closed')); for (const stream of child.stdio) stream?.destroy(); child.unref(); }
    };
}
export async function waitFor(predicate) { const deadline = Date.now() + 5000; while (Date.now() < deadline) { try { if (await predicate()) return; } catch (error) { if (!error.transient) throw error; } await new Promise(r => setTimeout(r, 25)); } throw Error('PAGE_READY_TIMEOUT'); }
export async function navigate(page, url, marker) {
    await page.send('Page.navigate', { url });
    await waitFor(() => page.evaluate('document.readyState==="complete"&&document.body?.dataset.page===' + JSON.stringify(marker)));
}
export function browserFailure(error, stderr) { return error.code === 'ENOENT' || /GPU process|Target crashed/.test(stderr) ? 'environment-blocked' : 'failed'; }
