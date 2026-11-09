import test from 'node:test';
import assert from 'node:assert/strict';
import './setup';
import { GET as healthCheck } from '../src/app/api/health/route';

test('health check: returns 200 with status ok and uptime', async () => {
  const res = await healthCheck();
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.status, 'healthy');
  assert.ok(typeof data.uptimeSeconds === 'number');
  assert.ok(data.timestamp);
  assert.ok(data.database);
});
