import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDisplayTimestamp, parseTimestampToMs } from '../src/utils/dateUtils';
import { parsePublicTechnicalSaveDto, parsePublicPathologySaveDto } from '../src/server/middleware/publicPersistenceDto';

const draft = {
  assessmentId: 'draft-regression',
  tooth: { fdiNumber: '11' },
  technique: 'Paralleling',
  receptorType: 'Digital Sensor',
  sessionStatus: 'INCOMPLETE',
  lastCompletedStep: 3,
  finalConfirmedErrors: [],
};

for (const [name, parse] of [
  ['technical', (payload: unknown) => parsePublicTechnicalSaveDto({ payload })],
  ['pathology', parsePublicPathologySaveDto],
] as const) {
  test(`${name} allows step 3 drafts without inference proof`, () => {
    assert.equal(parse(draft).record.lastCompletedStep, 3);
  });
  test(`${name} rejects completed status on a draft without proof`, () => {
    assert.throws(() => parse({ ...draft, sessionStatus: 'COMPLETED' }));
  });
}

test('out-of-range dates fall back instead of crashing report rendering', () => {
  assert.equal(parseTimestampToMs('2026-01-01T00:00:00Z', 1e20), 1767225600000);
  assert.doesNotThrow(() => formatDisplayTimestamp(1e20));
});
