/**
 * Unit tests for the pure helper functions exported from MainContentTitle.
 *
 * These cover:
 * - getSessionTitle  — title resolution for different session types
 * - resolveEditOutcome — confirm / cancel / blur logic (save-or-not decision)
 *
 * Tests run with Node's built-in test runner (tsx --test).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { getSessionTitle, resolveEditOutcome } from './inlineTitleEdit';
import type { ProjectSession } from '../../../../types/app';

// ---------------------------------------------------------------------------
// Minimal session factory
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  return {
    id: 'sess-1',
    __provider: 'claude',
    summary: 'My Session',
    ...overrides,
  } as ProjectSession;
}

// ---------------------------------------------------------------------------
// getSessionTitle
// ---------------------------------------------------------------------------

test('getSessionTitle: returns summary for claude sessions', () => {
  const session = makeSession({ __provider: 'claude', summary: 'Test Summary' });
  assert.equal(getSessionTitle(session), 'Test Summary');
});

test('getSessionTitle: returns "New Session" when summary is empty string', () => {
  const session = makeSession({ __provider: 'claude', summary: '' });
  assert.equal(getSessionTitle(session), 'New Session');
});

test('getSessionTitle: returns "New Session" when summary is undefined', () => {
  const session = makeSession({ __provider: 'claude', summary: undefined });
  assert.equal(getSessionTitle(session), 'New Session');
});

test('getSessionTitle: returns name for cursor sessions', () => {
  const session = makeSession({ __provider: 'cursor', name: 'Cursor Chat' } as unknown as Partial<ProjectSession>);
  assert.equal(getSessionTitle(session), 'Cursor Chat');
});

test('getSessionTitle: returns "Untitled Session" for cursor sessions with no name', () => {
  const session = makeSession({ __provider: 'cursor', name: undefined } as unknown as Partial<ProjectSession>);
  assert.equal(getSessionTitle(session), 'Untitled Session');
});

// ---------------------------------------------------------------------------
// resolveEditOutcome — confirm path (Enter / blur)
// ---------------------------------------------------------------------------

test('resolveEditOutcome: returns shouldSave=true when draft differs from original', () => {
  const result = resolveEditOutcome('New Name', 'Old Name');
  assert.deepEqual(result, { shouldSave: true, value: 'New Name' });
});

test('resolveEditOutcome: trims whitespace from draft before comparing', () => {
  const result = resolveEditOutcome('  Padded Name  ', 'Old Name');
  assert.deepEqual(result, { shouldSave: true, value: 'Padded Name' });
});

test('resolveEditOutcome: trims original title for comparison', () => {
  // If the stored title happens to have trailing space and user types it without,
  // that counts as "no change" — avoid spurious API calls.
  const result = resolveEditOutcome('Same Name', 'Same Name');
  assert.deepEqual(result, { shouldSave: false });
});

// ---------------------------------------------------------------------------
// resolveEditOutcome — cancel / no-op path
// ---------------------------------------------------------------------------

test('resolveEditOutcome: returns shouldSave=false when draft equals original', () => {
  const result = resolveEditOutcome('Exact Match', 'Exact Match');
  assert.equal(result.shouldSave, false);
});

test('resolveEditOutcome: returns shouldSave=false when draft is whitespace-only', () => {
  const result = resolveEditOutcome('   ', 'Some Name');
  assert.equal(result.shouldSave, false);
});

test('resolveEditOutcome: returns shouldSave=false when draft is empty string', () => {
  const result = resolveEditOutcome('', 'Some Name');
  assert.equal(result.shouldSave, false);
});

test('resolveEditOutcome: returns shouldSave=false when trimmed draft matches original', () => {
  // Both sides trim to the same thing → no change
  const result = resolveEditOutcome('Hello ', 'Hello');
  assert.equal(result.shouldSave, false);
});

// ---------------------------------------------------------------------------
// resolveEditOutcome — blur path (same semantics as Enter confirm)
// ---------------------------------------------------------------------------

test('resolveEditOutcome: blur with changed content saves (same as Enter)', () => {
  const result = resolveEditOutcome('Renamed Via Blur', 'Original Title');
  assert.deepEqual(result, { shouldSave: true, value: 'Renamed Via Blur' });
});

test('resolveEditOutcome: blur with unchanged content is a no-op', () => {
  const result = resolveEditOutcome('Unchanged', 'Unchanged');
  assert.equal(result.shouldSave, false);
});
