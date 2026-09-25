import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('HTTPS usa a mesma origem para API e WSS, preservando desenvolvimento local', () => {
  const source = readFileSync(new URL('../../js/config.js', import.meta.url), 'utf8');
  for (const [location, apiOrigin, wsUrl] of [
    [{ protocol: 'https:', origin: 'https://example.onrender.com', hostname: 'example.onrender.com', port: '' }, 'https://example.onrender.com', 'wss://example.onrender.com/ws'],
    [{ protocol: 'http:', origin: 'http://localhost:3100', hostname: 'localhost', port: '3100' }, 'http://localhost:3100', 'ws://localhost:3100/ws'],
    [{ protocol: 'file:', hostname: '' }, 'http://127.0.0.1:3001', 'ws://127.0.0.1:3001/ws'],
    [{ protocol: 'http:', hostname: '127.0.0.1', port: '8322' }, 'http://127.0.0.1:3001', 'ws://127.0.0.1:3001/ws'],
  ]) {
    const window = { location };
    vm.runInNewContext(source, { window });
    assert.equal(window.ChargeGridConfig.apiOrigin, apiOrigin);
    assert.equal(window.ChargeGridConfig.wsUrl, wsUrl);
  }
});
