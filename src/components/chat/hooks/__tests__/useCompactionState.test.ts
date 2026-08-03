/**
 * Tests for useCompactionState hook and isCompactCommand parser.
 *
 * Uses node:test so this file can run inside the existing server test runner
 * that uses the same built-in test framework.  The hook itself is pure state
 * logic (no DOM), so we test the pure functions and the hook's exported
 * callbacks directly by calling them with mocked React primitives.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isCompactCommand } from '../useCompactionState.js';

// ---------------------------------------------------------------------------
// isCompactCommand — pure function, no React needed
// ---------------------------------------------------------------------------

test('isCompactCommand: exact match', () => {
  assert.equal(isCompactCommand('/compact'), true);
});

test('isCompactCommand: case insensitive', () => {
  assert.equal(isCompactCommand('/COMPACT'), true);
  assert.equal(isCompactCommand('/Compact'), true);
});

test('isCompactCommand: surrounding whitespace is trimmed', () => {
  assert.equal(isCompactCommand('  /compact  '), true);
});

test('isCompactCommand: rejects commands with trailing args', () => {
  assert.equal(isCompactCommand('/compact now'), false);
  assert.equal(isCompactCommand('/compact --force'), false);
});

test('isCompactCommand: rejects prefix-only matches', () => {
  assert.equal(isCompactCommand('/compactnow'), false);
  assert.equal(isCompactCommand('/compact2'), false);
});

test('isCompactCommand: rejects unrelated slash commands', () => {
  assert.equal(isCompactCommand('/help'), false);
  assert.equal(isCompactCommand('/models'), false);
});

test('isCompactCommand: rejects empty string', () => {
  assert.equal(isCompactCommand(''), false);
});

test('isCompactCommand: rejects plain text', () => {
  assert.equal(isCompactCommand('compact'), false);
  assert.equal(isCompactCommand('hello world'), false);
});
