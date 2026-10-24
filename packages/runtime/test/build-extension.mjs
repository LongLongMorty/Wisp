import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { root } from '../../../scripts/tools.mjs';
export async function buildRuntimeExtension() {
    const target = path.join(root, '.cache/t008/extension');
    await mkdir(target, { recursive: true });
    for (const name of ['protocol', 'browser-chrome', 'policy', 'models', 'runtime']) {
        const out = path.join(target, 'modules', name);
        await mkdir(out, { recursive: true });
        for (const file of await readdir(path.join(root, 'packages', name, 'dist'))) {
            if (!file.endsWith('.mjs'))
                continue;
            let code = await readFile(path.join(root, 'packages', name, 'dist', file), 'utf8');
            for (const dependency of ['protocol', 'policy','models'])
                code = code.replaceAll("'@wisp/" + dependency + "'", "'../" + dependency + "/index.mjs'");
            await writeFile(path.join(out, file), code);
        }
    }
    for (const [source, file] of [['extension-background.mjs', 'background.mjs'], ['extension-runner.mjs', 'runner.mjs'], ['extension-peer.mjs', 'peer.mjs']])
        await writeFile(path.join(target, file), await readFile(path.join(root, 'packages/runtime/test', source)));
    await writeFile(path.join(target, 'sidepanel.html'), '<!doctype html><meta charset="utf-8"><title>Wisp T008 test runner</title><script type="module" src="runner.mjs"></script>');
    await writeFile(path.join(target, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Wisp T008 recovery probe', version: '0.0.1', minimum_chrome_version: '125', permissions: ['debugger', 'tabs', 'storage'], host_permissions: ['http://127.0.0.1/*'], background: { service_worker: 'background.mjs', type: 'module' } }));
    return target;
}
