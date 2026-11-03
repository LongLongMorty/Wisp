import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {describe, it} from 'node:test';

const start = fileURLToPath(new URL('../start.mjs', import.meta.url));

describe('start.mjs launched from an unrelated working directory', () => {
  it('still serves the page assets', async () => {
    const child = spawn(process.execPath, [start], {cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe']});
    try {
      const info = await new Promise((resolve, reject) => {
        let out = '';
        child.stdout.on('data', chunk => {
          out += chunk;
          const end = out.indexOf('\n}');
          if (end >= 0) resolve(JSON.parse(out.slice(0, end + 2)));
        });
        child.once('error', reject);
        child.once('exit', code => reject(Error('start.mjs exited early: ' + code)));
      });
      for (const asset of ['/assets/app.js', '/assets/style.css', '/assets/vendor/react.production.min.js', '/assets/vendor/react-dom.production.min.js']) {
        const res = await fetch(info.origin + asset);
        assert.strictEqual(res.status, 200, asset);
      }
    } finally {
      child.kill();
    }
  });
});
