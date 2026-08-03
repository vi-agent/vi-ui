import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  expandTilde,
  parseViContextProjects,
  syncViContextProjects,
} from '@/modules/projects/services/vi-context-sync.service.js';
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

const SAMPLE_CONTENT = `
# Vi Context

## About Teo

Some info here.

## Projects

- **Sample App** — Sample project for testing. Path: \`~/workplace/sample-app\`.
- **Skincare Tracker** — Mobile skincare routine. Path: \`~/workplace/skincare-tracker\`. Repo: \`github.com/vi-agent/skincare-tracker\`.
- **Workout Tracker** — Workout app. Path: \`~/workplace/workout-tracker\`.

## Ongoing Work

Nothing here yet.
`;

// ---------------------------------------------------------------------------
// parseViContextProjects
// ---------------------------------------------------------------------------

test('parseViContextProjects returns empty array when ## Projects section is absent', () => {
  const content = '# Vi Context\n\n## About Teo\n\nSome info.';
  const result = parseViContextProjects(content);
  assert.deepEqual(result, []);
});

test('parseViContextProjects parses valid entries', () => {
  const result = parseViContextProjects(SAMPLE_CONTENT);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { displayName: 'Sample App', path: '~/workplace/sample-app' });
  assert.deepEqual(result[1], { displayName: 'Skincare Tracker', path: '~/workplace/skincare-tracker' });
  assert.deepEqual(result[2], { displayName: 'Workout Tracker', path: '~/workplace/workout-tracker' });
});

test('parseViContextProjects skips malformed lines (no Path field)', () => {
  const content = `
## Projects

- **Good App** — Description. Path: \`~/workplace/good-app\`.
- **No Path App** — This entry has no path field at all.
- Just a random line without bold name.
- **Empty Path** — Path: \`\`.
`;
  const result = parseViContextProjects(content);
  assert.equal(result.length, 1);
  assert.equal(result[0].displayName, 'Good App');
});

test('parseViContextProjects stops at next ## heading', () => {
  const content = `
## Projects

- **App One** — Desc. Path: \`~/workplace/app-one\`.

## Other Section

- **App Two** — Desc. Path: \`~/workplace/app-two\`.
`;
  const result = parseViContextProjects(content);
  assert.equal(result.length, 1);
  assert.equal(result[0].displayName, 'App One');
});

test('parseViContextProjects returns empty array for empty projects section', () => {
  const content = `
## Projects

## Ongoing Work

Some content.
`;
  const result = parseViContextProjects(content);
  assert.deepEqual(result, []);
});

test('parseViContextProjects handles entry with extra fields after Path', () => {
  const content = `
## Projects

- **Tennis Tracker** — Tennis app. Path: \`~/workplace/tennis-tracker\`. Repo: \`github.com/vi-agent/tennis-tracker\`. Android: com.area43.tennis.
`;
  const result = parseViContextProjects(content);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { displayName: 'Tennis Tracker', path: '~/workplace/tennis-tracker' });
});

test('parseViContextProjects handles content with no trailing section', () => {
  const content = `
## Projects

- **Solo App** — Only entry. Path: \`~/workplace/solo-app\`.
`;
  const result = parseViContextProjects(content);
  assert.equal(result.length, 1);
  assert.equal(result[0].displayName, 'Solo App');
});

// ---------------------------------------------------------------------------
// expandTilde
// ---------------------------------------------------------------------------

test('expandTilde expands leading ~ to home directory', () => {
  const result = expandTilde('~/workplace/my-app');
  assert.equal(result, path.join(os.homedir(), 'workplace/my-app'));
});

test('expandTilde does not change paths that do not start with ~', () => {
  assert.equal(expandTilde('/absolute/path'), '/absolute/path');
  assert.equal(expandTilde('relative/path'), 'relative/path');
});

test('expandTilde expands bare ~ to home directory', () => {
  assert.equal(expandTilde('~'), os.homedir());
});

// ---------------------------------------------------------------------------
// syncViContextProjects
// ---------------------------------------------------------------------------

function makeSyncDeps(overrides: {
  readFile?: (p: string) => Promise<string>;
  pathExists?: (p: string) => Promise<boolean>;
  createProjectPath?: (p: string, n: string | null) => CreateProjectPathResult;
  updateCustomProjectNameById?: (id: string, n: string | null) => void;
  getProjectByPath?: (p: string) => ProjectRepositoryRow | null;
} = {}) {
  return {
    readFile: overrides.readFile ?? (() => Promise.resolve(SAMPLE_CONTENT)),
    pathExists: overrides.pathExists ?? (() => Promise.resolve(true)),
    createProjectPath: overrides.createProjectPath ?? (() => ({
      outcome: 'created' as const,
      project: makeRow(),
    })),
    updateCustomProjectNameById: overrides.updateCustomProjectNameById ?? (() => undefined),
    getProjectByPath: overrides.getProjectByPath ?? (() => null),
  };
}

test('syncViContextProjects logs warning and returns when file is missing', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(String(args[0])); };

  try {
    await syncViContextProjects('/nonexistent/path/vi-context.md', makeSyncDeps({
      readFile: () => Promise.reject(new Error('ENOENT: no such file')),
    }));
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(warnings.some(w => w.includes('vi-context-sync')));
  assert.ok(warnings.some(w => w.includes('skipping project sync')));
});

test('syncViContextProjects skips entries whose path does not exist on disk', async () => {
  const createdPaths: string[] = [];
  const deps = makeSyncDeps({
    pathExists: () => Promise.resolve(false),
    createProjectPath: (p) => {
      createdPaths.push(p);
      return { outcome: 'created', project: makeRow({ project_path: p }) };
    },
  });

  await syncViContextProjects(undefined, deps);
  assert.equal(createdPaths.length, 0);
});

test('syncViContextProjects inserts new projects (created outcome)', async () => {
  const calls: Array<{ path: string; name: string | null }> = [];
  const updateCalls: string[] = [];

  const deps = makeSyncDeps({
    createProjectPath: (p, n) => {
      calls.push({ path: p, name: n });
      return { outcome: 'created', project: makeRow({ project_path: p, custom_project_name: n ?? '' }) };
    },
    updateCustomProjectNameById: (id) => { updateCalls.push(id); },
  });

  await syncViContextProjects(undefined, deps);

  assert.equal(calls.length, 3);
  assert.equal(calls[0].name, 'Sample App');
  assert.equal(calls[1].name, 'Skincare Tracker');
  // No updateCustomProjectNameById calls for 'created' outcome
  assert.equal(updateCalls.length, 0);
});

test('syncViContextProjects expands tilde paths before calling createProjectPath', async () => {
  const calls: string[] = [];
  const deps = makeSyncDeps({
    createProjectPath: (p) => {
      calls.push(p);
      return { outcome: 'created', project: makeRow({ project_path: p }) };
    },
  });

  await syncViContextProjects(undefined, deps);

  // All paths should be absolute (tilde expanded)
  for (const p of calls) {
    assert.ok(path.isAbsolute(p), `Expected absolute path, got: ${p}`);
    assert.ok(p.startsWith(os.homedir()), `Expected path under home dir: ${p}`);
  }
});

test('syncViContextProjects updates name for active_conflict when name changed', async () => {
  const existingRow = makeRow({ custom_project_name: 'Old Name' });
  const updateCalls: Array<{ id: string; name: string | null }> = [];

  const deps = makeSyncDeps({
    createProjectPath: () => ({ outcome: 'active_conflict', project: existingRow }),
    updateCustomProjectNameById: (id, name) => { updateCalls.push({ id, name }); },
  });

  await syncViContextProjects(undefined, deps);

  // 3 entries, all active_conflict, all have name mismatch ('Sample App' etc vs 'Old Name')
  assert.equal(updateCalls.length, 3);
  assert.equal(updateCalls[0].name, 'Sample App');
  assert.equal(updateCalls[0].id, existingRow.project_id);
});

test('syncViContextProjects does NOT update name when it already matches', async () => {
  const updateCalls: string[] = [];

  const deps = makeSyncDeps({
    createProjectPath: (p, name) => ({
      outcome: 'active_conflict',
      project: makeRow({ custom_project_name: name ?? '' }),
    }),
    updateCustomProjectNameById: (id) => { updateCalls.push(id); },
  });

  await syncViContextProjects(undefined, deps);

  // Name already matches what vi-context.md says — no update needed
  assert.equal(updateCalls.length, 0);
});

test('syncViContextProjects updates name for reactivated_archived when name changed', async () => {
  const existingRow = makeRow({ custom_project_name: 'Stale Name', isArchived: 0 });
  const updateCalls: Array<{ id: string; name: string | null }> = [];

  const deps = makeSyncDeps({
    createProjectPath: () => ({ outcome: 'reactivated_archived', project: existingRow }),
    updateCustomProjectNameById: (id, name) => { updateCalls.push({ id, name }); },
  });

  await syncViContextProjects(undefined, deps);

  assert.ok(updateCalls.length > 0, 'Expected at least one name update for reactivated_archived');
  assert.equal(updateCalls[0].name, 'Sample App');
});

test('syncViContextProjects does not crash when result.project is null (falls back to getProjectByPath)', async () => {
  const fallbackRow = makeRow({ custom_project_name: 'Old Name' });
  const updateCalls: string[] = [];

  const deps = makeSyncDeps({
    createProjectPath: () => ({ outcome: 'active_conflict', project: null }),
    getProjectByPath: () => fallbackRow,
    updateCustomProjectNameById: (id) => { updateCalls.push(id); },
  });

  await syncViContextProjects(undefined, deps);

  assert.equal(updateCalls.length, 3);
});

test('syncViContextProjects does not crash when both result.project and getProjectByPath return null', async () => {
  const deps = makeSyncDeps({
    createProjectPath: () => ({ outcome: 'active_conflict', project: null }),
    getProjectByPath: () => null,
  });

  // Should complete without throwing
  await assert.doesNotReject(() => syncViContextProjects(undefined, deps));
});
