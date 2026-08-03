import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { runArchivePurge } from '@/modules/providers/services/archive-purge.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'archive-purge-test-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/**
 * Backdates a session's archivedAt to simulate it having been archived N days ago.
 * We do this by directly manipulating the archivedAt value after archiving.
 */
function backdateArchivedAt(sessionId: string, daysAgo: number): void {
  const db = getConnection();
  const past = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  db.prepare(
    `UPDATE sessions SET archivedAt = ? WHERE session_id = ?`
  ).run(past.toISOString(), sessionId);
}

test('runArchivePurge deletes sessions archived >= 7 days ago', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    // Create and archive three sessions.
    sessionsDb.createAppSession('old-1', 'claude', '/workspace/project');
    sessionsDb.createAppSession('old-2', 'claude', '/workspace/project');
    sessionsDb.createAppSession('recent', 'claude', '/workspace/project');

    sessionsDb.updateSessionIsArchived('old-1', true);
    sessionsDb.updateSessionIsArchived('old-2', true);
    sessionsDb.updateSessionIsArchived('recent', true);

    // Backdate old sessions to 8 days ago; recent is 1 day ago.
    backdateArchivedAt('old-1', 8);
    backdateArchivedAt('old-2', 9);
    backdateArchivedAt('recent', 1);

    const result = await runArchivePurge();

    assert.equal(result.purgedCount, 2, 'should delete 2 old sessions');
    assert.equal(result.filesDeleted, 0, 'no transcript files were recorded');

    // old-1 and old-2 must be gone.
    assert.equal(sessionsDb.getSessionById('old-1'), null);
    assert.equal(sessionsDb.getSessionById('old-2'), null);

    // 'recent' is still present (archived < 7 days ago).
    const remaining = sessionsDb.getSessionById('recent');
    assert.ok(remaining, 'recent session should still exist');
    assert.equal(remaining?.isArchived, 1);
  });
});

test('runArchivePurge leaves non-archived sessions untouched', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('active-session', 'claude', '/workspace/project');

    const result = await runArchivePurge();

    assert.equal(result.purgedCount, 0);
    assert.ok(sessionsDb.getSessionById('active-session'), 'active session must survive');
  });
});

test('runArchivePurge leaves sessions archived < 7 days ago untouched', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('new-archive', 'claude', '/workspace/project');
    sessionsDb.updateSessionIsArchived('new-archive', true);
    // archivedAt is set to CURRENT_TIMESTAMP — well within the 7-day window.

    const result = await runArchivePurge();

    assert.equal(result.purgedCount, 0);
    const session = sessionsDb.getSessionById('new-archive');
    assert.ok(session, 'recently archived session must survive');
  });
});

test('runArchivePurge deletes transcript file when one is recorded', { concurrency: false }, async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'purge-file-test-'));
  const transcriptPath = path.join(tempDir, 'session.jsonl');

  try {
    await writeFile(transcriptPath, '{"type":"text"}\n');

    await withIsolatedDatabase(async () => {
      // Create a session manually via the upsert path so we can set a jsonl_path.
      sessionsDb.createSession(
        'file-session',
        'claude',
        '/workspace/project',
        undefined,
        undefined,
        undefined,
        transcriptPath,
      );
      sessionsDb.updateSessionIsArchived('file-session', true);
      backdateArchivedAt('file-session', 8);

      const result = await runArchivePurge();

      assert.equal(result.purgedCount, 1);
      assert.equal(result.filesDeleted, 1);
      assert.equal(sessionsDb.getSessionById('file-session'), null);

      // Verify the file is gone.
      await assert.rejects(
        () => access(transcriptPath),
        'transcript file should have been deleted',
      );
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('runArchivePurge returns zeros when no sessions are eligible', { concurrency: false }, async () => {
  await withIsolatedDatabase(async () => {
    const result = await runArchivePurge();
    assert.equal(result.purgedCount, 0);
    assert.equal(result.filesDeleted, 0);
  });
});

test('updateSessionIsArchived sets archivedAt on archive and clears it on restore', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('toggle-session', 'claude', '/workspace/project');

    // Archive: archivedAt should be set.
    sessionsDb.updateSessionIsArchived('toggle-session', true);
    const archived = sessionsDb.getSessionById('toggle-session');
    assert.ok(archived?.archivedAt, 'archivedAt should be set after archive');
    assert.equal(archived?.isArchived, 1);

    // Restore: archivedAt should be cleared.
    sessionsDb.updateSessionIsArchived('toggle-session', false);
    const restored = sessionsDb.getSessionById('toggle-session');
    assert.equal(restored?.archivedAt, null, 'archivedAt should be cleared after restore');
    assert.equal(restored?.isArchived, 0);
  });
});

test('getSessionsArchivedBefore only returns sessions with archivedAt before the cutoff', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('before-cutoff', 'claude', '/workspace/project');
    sessionsDb.createAppSession('after-cutoff', 'claude', '/workspace/project');
    sessionsDb.createAppSession('not-archived', 'claude', '/workspace/project');

    sessionsDb.updateSessionIsArchived('before-cutoff', true);
    sessionsDb.updateSessionIsArchived('after-cutoff', true);

    // Set archivedAt to 10 days ago for 'before-cutoff'.
    backdateArchivedAt('before-cutoff', 10);
    // 'after-cutoff' keeps archivedAt = CURRENT_TIMESTAMP (just now).

    // Cutoff: 7 days ago.
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const eligible = sessionsDb.getSessionsArchivedBefore(cutoff.toISOString());

    const ids = eligible.map((s) => s.session_id);
    assert.ok(ids.includes('before-cutoff'), 'before-cutoff should be eligible');
    assert.ok(!ids.includes('after-cutoff'), 'after-cutoff should not be eligible');
    assert.ok(!ids.includes('not-archived'), 'non-archived should not be eligible');
  });
});
