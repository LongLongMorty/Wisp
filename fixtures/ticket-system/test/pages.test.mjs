import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {renderPage} from '../pages.mjs';

describe('Page Rendering', () => {
  it('references local vendored scripts only', () => {
    const html = renderPage('sid', 'create', 'http://127.0.0.1:1');
    assert.ok(html.includes('/assets/vendor/react.production.min.js'));
    assert.ok(!html.includes('unpkg.com'));
    assert.ok(!html.includes('cdn'));
    assert.ok(html.includes('data-route="create"'));
  });

  it('escapes attribute values so a hostile session id cannot inject markup', () => {
    const html = renderPage('"><script>alert(1)</script>', 'list', 'http://127.0.0.1:1');
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  });

  it('home route links to create and list for the session', () => {
    const html = renderPage('sid', 'home', 'http://127.0.0.1:1');
    assert.ok(html.includes('/ticket-system/s/sid/create'));
    assert.ok(html.includes('/ticket-system/s/sid/list'));
  });
});
