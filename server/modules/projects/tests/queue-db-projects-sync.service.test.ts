import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import {
  readActiveProjectsFromQueueDb,
  slugToDisplayName,
  syncProjectsFromQueueDb,
  type QueueDbProjectEntry,
} from '@/modules/projects/services/queue-db-projects-sync.service.js';
import type { CreateProjectPathResult, ProjectRepositoryRow } from '@/shared/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ProjectRepositoryRow> = {}): ProjectRepositoryRow {
  return {
    project_id: 'project-1',
    project_path: '/home/user/workplace/sample-app',
    custom_project_name: 'Old Name',
    isStarred: 0,
    isArchived: 0,
    ...overrides,
  };
}

const SAMPLE_ENTRIES: QueueDbProjectEntry[] = [
  { displayName: 'Sample App', path: '/home/user/workplace/sample-app' },
  { displayName: 'Skincare Tracker', path: '/home/user/workplace/skincare-tracker' },
  { displayName: 'Workout Tracker', path: '/home/user/workplace/workout-tracker' },
];

function makeSyncDeps(overrides: {
  readProjects?: (p: string) => QueueDbProjectEntry[];
  pathExists?: (p: string) => Promise<boolean>;
  createProjectPath?: (p: string, n: string | null) => CreateProjectPathResult;
  updateCustomProjectNameById?: (id: string, n: string | null) => void;
  getProjectByPath?: (p: string) => ProjectRepositoryRow | null;
} = {}) {
  return {
    readProjects: overrides.readProjects ?? (() => [...SAMPLE_ENTRIES]),
    pathExists: overrides.pathExists ?? (() => Promise.resolve(true)),
    createProjectPath: overrides.createProjectPath ?? (() => ({
      outcome: 'created' as const,
      project: makeRow(),
    })),
    updateCustomProjectNameById: overrides.updateCustomProjectNameById ?? (() => undefined),
    getProjectByPath: overrides.getProjectByPath ?? (() => null),
  };
}

// ---------------------------------------------------------------------------
// slugToDisplayName
// ---------------------------------------------------------------------------

test('slugToDisplayName converts kebab-case to Title Case', () => {
  assert.equal(slugToDisplayName('racket-reel'), 'Racket Reel');
  assert.equal(slugToDisplayName('workout-tracker'), 'Workout Tracker');
  assert.equal(slugToDisplayName('vi-ui'), 'Vi Ui');
});

test('slugToDisplayName leaves slugs without dashes unchanged', () => {
  assert.equal(slugToDisplayName('ToPathMapSwift'), 'ToPathMapSwift');
  assert.equal(slugToDisplayName('placeholder1'), 'placeholder1');
});

test('slugToDisplayName handles snake_case', () => {
  assert.equal(slugToDisplayName('some_app_name'), 'Some App Name');
});

test('slugToDisplayName handles empty segments from repeated dashes', () => {
  assert.equal(slugToDisplayName('foo--bar'), 'Foo Bar');
});

// ---------------------------------------------------------------------------
// readActiveProjectsFromQueueDb
// ---------------------------------------------------------------------------

function withTempQueueDb(setup: (db: Database.Database) => void, run: (dbPath: string) => void) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-db-sync-'));
  const dbPath = path.join(tmpDir, 'queue.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      repo_path TEXT NOT NULL,
      description TEXT,
      github_url TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  setup(db);
  db.close();
  try {
    run(dbPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('readActiveProjectsFromQueueDb returns only non-archived rows', () => {
  withTempQueueDb(
    (db) => {
      db.prepare('INSERT INTO projects (name, repo_path, archived) VALUES (?, ?, ?)').run(
        'racket-reel',
        '/home/teo/workplace/racket-reel',
        0,
      );
      db.prepare('INSERT INTO projects (name, repo_path, archived) VALUES (?, ?, ?)').run(
        'vi-ui',
        '/home/teo/workplace/vi-ui',
        0,
      );
      db.prepare('INSERT INTO projects (name, repo_path, archived) VALUES (?, ?, ?)').run(
        'old-project',
        '/home/teo/workplace/old-project',
        1,
      );
    },
    (dbPath) => {
      const rows = readActiveProjectsFromQueueDb(dbPath);
      assert.equal(rows.length, 2);
      assert.deepEqual(rows[0], { displayName: 'Racket Reel', path: '/home/teo/workplace/racket-reel' });
      assert.deepEqual(rows[1], { displayName: 'Vi Ui', path: '/home/teo/workplace/vi-ui' });
    },
  );
});

test('readActiveProjectsFromQueueDb returns empty array when table has no active rows', () => {
  withTempQueueDb(
    (db) => {
      db.prepare('INSERT INTO projects (name, repo_path, archived) VALUES (?, ?, ?)').run(
        'archived-only',
        '/tmp/archived',
        1,
      );
    },
    (dbPath) => {
      const rows = readActiveProjectsFromQueueDb(dbPath);
      assert.deepEqual(rows, []);
    },
  );
});

test('readActiveProjectsFromQueueDb throws when the file does not exist', () => {
  assert.throws(() => readActiveProjectsFromQueueDb('/nonexistent/queue.db'));
});

// ---------------------------------------------------------------------------
// syncProjectsFromQueueDb
// ---------------------------------------------------------------------------

test('syncProjectsFromQueueDb logs warning and returns when readProjects throws', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(String(args[0])); };

  try {
    await syncProjectsFromQueueDb('/nonexistent/queue.db', makeSyncDeps({
      readProjects: () => { throw new Error('ENOENT: no such file'); },
    }));
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnings.some((w) => w.includes('queue-db-projects-sync')));
  assert.ok(warnings.some((w) => w.includes('skipping project sync')));
});

test('syncProjectsFromQueueDb skips entries whose path does not exist on disk', async () => {
  const createdPaths: string[] = [];
  const deps = makeSyncDeps({
    pathExists: () => Promise.resolve(false),
    createProjectPath: (p) => {
      createdPaths.push(p);
      return { outcome: 'created', project: makeRow({ project_path: p }) };
    },
  });

  await syncProjectsFromQueueDb(undefined, deps);
  assert.equal(createdPaths.length, 0);
});

test('syncProjectsFromQueueDb inserts new projects (created outcome)', async () => {
  const calls: Array<{ path: string; name: string | null }> = [];
  const updateCalls: string[] = [];

  const deps = makeSyncDeps({
    createProjectPath: (p, n) => {
      calls.push({ path: p, name: n });
      return { outcome: 'created', project: makeRow({ project_path: p, custom_project_name: n ?? '' }) };
    },
    updateCustomProjectNameById: (id) => { updateCalls.push(id); },
  });

  await syncProjectsFromQueueDb(undefined, deps);

  assert.equal(calls.length, 3);
  assert.equal(calls[0].name, 'Sample App');
  assert.equal(calls[1].name, 'Skincare Tracker');
  assert.equal(updateCalls.length, 0);
});

test('syncProjectsFromQueueDb passes queue.db path through to readProjects', async () => {
  const seenPaths: string[] = [];
  const deps = makeSyncDeps({
    readProjects: (p) => {
      seenPaths.push(p);
      return [];
    },
  });

  await syncProjectsFromQueueDb('/custom/queue.db', deps);
  assert.deepEqual(seenPaths, ['/custom/queue.db']);
});

test('syncProjectsFromQueueDb updates name for active_conflict when name changed', async () => {
  const existingRow = makeRow({ custom_project_name: 'Old Name' });
  const updateCalls: Array<{ id: string; name: string | null }> = [];

  const deps = makeSyncDeps({
    createProjectPath: () => ({ outcome: 'active_conflict', project: existingRow }),
    updateCustomProjectNameById: (id, name) => { updateCalls.push({ id, name }); },
  });

  await syncProjectsFromQueueDb(undefined, deps);

  assert.equal(updateCalls.length, 3);
  assert.equal(updateCalls[0].name, 'Sample App');
  assert.equal(updateCalls[0].id, existingRow.project_id);
});

test('syncProjectsFromQueueDb does NOT update name when it already matches', async () => {
  const updateCalls: string[] = [];

  const deps = makeSyncDeps({
    createProjectPath: (_p, name) => ({
      outcome: 'active_conflict',
      project: makeRow({ custom_project_name: name ?? '' }),
    }),
    updateCustomProjectNameById: (id) => { updateCalls.push(id); },
  });

  await syncProjectsFromQueueDb(undefined, deps);
  assert.equal(updateCalls.length, 0);
});

test('syncProjectsFromQueueDb updates name for reactivated_archived when name changed', async () => {
  const existingRow = makeRow({ custom_project_name: 'Stale Name', isArchived: 0 });
  const updateCalls: Array<{ id: string; name: string | null }> = [];

  const deps = makeSyncDeps({
    createProjectPath: () => ({ outcome: 'reactivated_archived', project: existingRow }),
    updateCustomProjectNameById: (id, name) => { updateCalls.push({ id, name }); },
  });

  await syncProjectsFromQueueDb(undefined, deps);

  assert.ok(updateCalls.length > 0);
  assert.equal(updateCalls[0].name, 'Sample App');
});

test('syncProjectsFromQueueDb falls back to getProjectByPath when result.project is null', async () => {
  const fallbackRow = makeRow({ custom_project_name: 'Old Name' });
  const updateCalls: string[] = [];

  const deps = makeSyncDeps({
    createProjectPath: () => ({ outcome: 'active_conflict', project: null }),
    getProjectByPath: () => fallbackRow,
    updateCustomProjectNameById: (id) => { updateCalls.push(id); },
  });

  await syncProjectsFromQueueDb(undefined, deps);
  assert.equal(updateCalls.length, 3);
});

test('syncProjectsFromQueueDb does not crash when both result.project and getProjectByPath return null', async () => {
  const deps = makeSyncDeps({
    createProjectPath: () => ({ outcome: 'active_conflict', project: null }),
    getProjectByPath: () => null,
  });

  await assert.doesNotReject(() => syncProjectsFromQueueDb(undefined, deps));
});
