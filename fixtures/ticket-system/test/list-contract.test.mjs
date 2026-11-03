import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

describe('TicketList contract (spec section 6, scenario 2)', () => {
  it('renders explicit 筛选 button', () => {
    assert.ok(source.includes("'筛选'") || source.includes('"筛选"'), 'list must render a 筛选 button');
  });
});
