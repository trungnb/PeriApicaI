import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterRecordsByDateRange } from '../../src/server/utils/metadataHelpers';

describe('Admin Server-Side Export Mapping & Bulk Processing', () => {
  it('Reports: exports all matching rows when matching raw rows > 50', () => {
    const mockReports = Array.from({ length: 120 }, (_, i) => ({
      assessmentId: `eval-${i}`,
      timestamp: '2026-03-10T10:00:00.000Z',
      userValidation: { concurred: true },
      stage: 'ANALYSIS',
    }));

    const filtered = filterRecordsByDateRange(mockReports, {
      preset: 'custom',
      startDate: '2026-03-01',
      endDate: '2026-03-15',
    });

    assert.equal(filtered.length, 120, 'Reports must export all 120 matching records without 50-item display truncation');
  });

  it('Reports: combined date + status filter correctly isolates COMPLETED logs', () => {
    const mockReports = [
      { assessmentId: 'r1', timestamp: '2026-03-10T10:00:00.000Z', isError: false, isCompleted: true },
      { assessmentId: 'r2', timestamp: '2026-03-10T11:00:00.000Z', isError: true, isCompleted: false }, // FAILED_NON_DENTAL
      { assessmentId: 'r3', timestamp: '2026-01-01T10:00:00.000Z', isError: false, isCompleted: true }, // Out of date range
    ];

    const dateFiltered = filterRecordsByDateRange(mockReports, {
      preset: 'custom',
      startDate: '2026-03-01',
      endDate: '2026-03-15',
    });

    const completedOnly = dateFiltered.filter((r) => !r.isError && r.isCompleted);
    assert.equal(completedOnly.length, 1);
    assert.equal(completedOnly[0].assessmentId, 'r1');
  });

  it('Pathology (seg_reports): exports all matching rows when matching raw rows > 50', () => {
    const mockPathology = Array.from({ length: 85 }, (_, i) => ({
      assessmentId: `path-${i}`,
      timestamp: '2026-03-10T12:00:00.000Z',
      confirmedPathologies: [{ pathologyKey: 'CARIES', confidence: 95 }],
    }));

    const filtered = filterRecordsByDateRange(mockPathology, {
      preset: 'custom',
      startDate: '2026-03-01',
      endDate: '2026-03-15',
    });

    assert.equal(filtered.length, 85, 'Pathology must export all 85 matching records from seg_reports');
  });

  it('Pathology (seg_reports): combined date + status filter isolates INCOMPLETE logs', () => {
    const mockPathology = [
      { assessmentId: 'p1', timestamp: '2026-03-10T10:00:00.000Z', isIncomplete: false },
      { assessmentId: 'p2', timestamp: '2026-03-10T11:00:00.000Z', isIncomplete: true },
      { assessmentId: 'p3', timestamp: '2026-02-01T10:00:00.000Z', isIncomplete: true },
    ];

    const dateFiltered = filterRecordsByDateRange(mockPathology, {
      preset: 'custom',
      startDate: '2026-03-01',
      endDate: '2026-03-15',
    });

    const incompleteOnly = dateFiltered.filter((p) => p.isIncomplete);
    assert.equal(incompleteOnly.length, 1);
    assert.equal(incompleteOnly[0].assessmentId, 'p2');
  });

  it('Bugs: exports all matching rows when matching raw rows > 50', () => {
    const mockBugs = Array.from({ length: 95 }, (_, i) => ({
      bugId: `bug-${i}`,
      timestamp: '2026-03-10T14:00:00.000Z',
      source: i % 2 === 0 ? 'SYSTEM_AUTO' : 'USER_SUBMITTED',
      description: `Bug description ${i}`,
    }));

    const filtered = filterRecordsByDateRange(mockBugs, {
      preset: 'custom',
      startDate: '2026-03-01',
      endDate: '2026-03-15',
    });

    assert.equal(filtered.length, 95, 'Bugs must export all 95 matching records');
  });

  it('Bugs: combined date + source filter isolates USER_SUBMITTED bugs', () => {
    const mockBugs = [
      { bugId: 'b1', timestamp: '2026-03-10T10:00:00.000Z', source: 'USER_SUBMITTED' },
      { bugId: 'b2', timestamp: '2026-03-10T11:00:00.000Z', source: 'SYSTEM_AUTO' },
      { bugId: 'b3', timestamp: '2026-01-01T10:00:00.000Z', source: 'USER_SUBMITTED' },
    ];

    const dateFiltered = filterRecordsByDateRange(mockBugs, {
      preset: 'custom',
      startDate: '2026-03-01',
      endDate: '2026-03-15',
    });

    const userSubmittedOnly = dateFiltered.filter((b) => b.source === 'USER_SUBMITTED');
    assert.equal(userSubmittedOnly.length, 1);
    assert.equal(userSubmittedOnly[0].bugId, 'b1');
  });
});

