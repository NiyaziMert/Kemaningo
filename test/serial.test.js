import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineSplitter } from '../web/sources/serial.js';

test('satır bölücü: parçalı gelen satırlar, \\r\\n ve yarım satır', () => {
  const got = [];
  const s = createLineSplitter((l) => got.push(l));
  s.push('S,0,4,0,0');
  s.push(',0,0,0,0\r\nS,5000,');
  assert.deepEqual(got, ['S,0,4,0,0,0,0,0,0']);
  s.push('0,0,0,0,0,0,0\nH,1,0.8.0,0,0\n');
  assert.deepEqual(got.slice(1), ['S,5000,0,0,0,0,0,0,0', 'H,1,0.8.0,0,0']);
});

test('satır bölücü: sonu gelmeyen 1 kB\'lik gürültü atılır', () => {
  const got = [];
  const s = createLineSplitter((l) => got.push(l));
  s.push('x'.repeat(1100));
  s.push('S,0,0,0,0,0,0,0,0\n');
  assert.deepEqual(got, ['S,0,0,0,0,0,0,0,0']);
});
