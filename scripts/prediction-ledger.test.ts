import assert from 'node:assert/strict';
import { easternKickoffIso, payloadSha256, snapshotWindowStatus } from '../api/prediction-ledger';

assert.equal(
  easternKickoffIso('2026-10-11', '13:00'),
  '2026-10-11T17:00:00.000Z',
  'October NFL kickoff should resolve through EDT.'
);

assert.equal(
  easternKickoffIso('2026-12-06', '13:00'),
  '2026-12-06T18:00:00.000Z',
  'December NFL kickoff should resolve through EST.'
);

assert.equal(easternKickoffIso('bad-date', '13:00'), null);
assert.equal(snapshotWindowStatus('2026-10-11T17:00:00.000Z', Date.parse('2026-10-11T16:59:59.000Z')), 'eligible');
assert.equal(snapshotWindowStatus('2026-10-11T17:00:00.000Z', Date.parse('2026-10-11T17:00:00.000Z')), 'kickoff_passed');
assert.equal(snapshotWindowStatus('not-a-date'), 'invalid');

const payload = { game: 'BUF@NE', p: 0.6123, model: 'v2.2' };
assert.equal(payloadSha256(payload), payloadSha256({ game: 'BUF@NE', p: 0.6123, model: 'v2.2' }));
assert.notEqual(payloadSha256(payload), payloadSha256({ game: 'BUF@NE', p: 0.6124, model: 'v2.2' }));
assert.match(payloadSha256(payload), /^[0-9a-f]{64}$/);

console.log('Immutable prediction-ledger regression checks passed.');
