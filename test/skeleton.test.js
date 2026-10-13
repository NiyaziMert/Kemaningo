import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../web/thresholds.js';

test('thresholds.js Node içinden doğrudan içe aktarılabiliyor', () => {
  assert.equal(T.T_GAP_MS, 80);
  assert.equal(T.T_MIN_STROKE_MS, 100);
  assert.equal(typeof T.USE_IMU, 'boolean');
});
