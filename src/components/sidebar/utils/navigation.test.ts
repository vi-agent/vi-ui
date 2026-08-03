import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSidebarNavItems } from './navigation';
import type { Project } from '../../../types/app';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeProject(overrides: Partial<Project> & { projectId: string }): Project {
  const { projectId, displayName, isStarred, sessions, sessionMeta, ...rest } = overrides;
  return {
    projectId,
    path: `/workspace/${projectId}`,
    fullPath: `/workspace/${projectId}`,
    displayName: displayName ?? projectId,
    isStarred: isStarred ?? false,
    sessions: sessions ?? [],
    sessionMeta: sessionMeta ?? { total: 0, hasMore: false },
    ...rest,
  };
}

function makeSession(id: string, lastActivity?: string) {
  const ts = lastActivity ?? new Date().toISOString();
  return {
    id,
    summary: `Session ${id}`,
    lastActivity: ts,
    created_at: ts,
    updated_at: ts,
    messageCount: 0,
    __provider: 'claude' as const,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('buildSidebarNavItems: returns empty array when there are no projects', () => {
  const items = buildSidebarNavItems([], 'name');
  assert.deepEqual(items, []);
});

test('buildSidebarNavItems: includes sessions from ALL projects, ignoring expand state', () => {
  const projects = [
    makeProject({
      projectId: 'proj-a',
      sessions: [makeSession('s-a1'), makeSession('s-a2')],
    }),
    makeProject({
      projectId: 'proj-b',
      sessions: [makeSession('s-b1')],
    }),
  ];

  const items = buildSidebarNavItems(projects, 'name');
  const sessionIds = items.map((i) => i.sessionId);
  assert.ok(sessionIds.includes('s-a1'));
  assert.ok(sessionIds.includes('s-a2'));
  assert.ok(sessionIds.includes('s-b1'), 'collapsed projects must still contribute sessions');
});

test('buildSidebarNavItems: each item carries correct projectId and project ref', () => {
  const projA = makeProject({
    projectId: 'proj-a',
    sessions: [makeSession('s-a1')],
  });

  const items = buildSidebarNavItems([projA], 'name');

  assert.equal(items.length, 1);
  assert.equal(items[0]?.projectId, 'proj-a');
  assert.equal(items[0]?.project, projA);
  assert.equal(items[0]?.sessionId, 's-a1');
});

test('buildSidebarNavItems: sorts sessions within a project by recency (newest first)', () => {
  const older = makeSession('old-session', '2024-01-01T00:00:00Z');
  const newer = makeSession('new-session', '2024-06-01T00:00:00Z');
  const newest = makeSession('newest-session', '2024-12-01T00:00:00Z');

  const project = makeProject({
    projectId: 'proj-a',
    sessions: [older, newest, newer],
  });

  const items = buildSidebarNavItems([project], 'name');
  const sessionIds = items.map((i) => i.sessionId);

  assert.deepEqual(sessionIds, ['newest-session', 'new-session', 'old-session']);
});

test('buildSidebarNavItems: sorts projects alphabetically when sortOrder=name', () => {
  const projC = makeProject({ projectId: 'proj-c', displayName: 'Charlie', sessions: [makeSession('c1')] });
  const projA = makeProject({ projectId: 'proj-a', displayName: 'Alpha', sessions: [makeSession('a1')] });
  const projB = makeProject({ projectId: 'proj-b', displayName: 'Bravo', sessions: [makeSession('b1')] });

  const items = buildSidebarNavItems([projC, projA, projB], 'name');
  const sessionIds = items.map((i) => i.sessionId);

  assert.deepEqual(sessionIds, ['a1', 'b1', 'c1']);
});

test('buildSidebarNavItems: starred projects sort before non-starred (name order)', () => {
  const unstarred = makeProject({
    projectId: 'zzz',
    displayName: 'Zzz',
    isStarred: false,
    sessions: [makeSession('z1')],
  });
  const starred = makeProject({
    projectId: 'aaa-star',
    displayName: 'Aaa (starred)',
    isStarred: true,
    sessions: [makeSession('star1')],
  });

  const items = buildSidebarNavItems([unstarred, starred], 'name');
  const sessionIds = items.map((i) => i.sessionId);

  assert.equal(sessionIds[0], 'star1', 'starred project sessions should come first');
  assert.equal(sessionIds[1], 'z1');
});

test('buildSidebarNavItems: projects with no sessions contribute a project-only item', () => {
  const emptyProject = makeProject({ projectId: 'empty', sessions: [] });
  const items = buildSidebarNavItems([emptyProject], 'name');
  assert.equal(items.length, 1);
  assert.equal(items[0]?.projectId, 'empty');
  assert.equal(items[0]?.sessionId, null);
  assert.equal(items[0]?.session, null);
  assert.equal(items[0]?.project, emptyProject);
});

test('buildSidebarNavItems: project-only items are interleaved in sidebar order', () => {
  const projA = makeProject({
    projectId: 'proj-a',
    displayName: 'Alpha',
    sessions: [makeSession('a1'), makeSession('a2')],
  });
  const projB = makeProject({
    projectId: 'proj-b',
    displayName: 'Bravo',
    sessions: [],
  });
  const projC = makeProject({
    projectId: 'proj-c',
    displayName: 'Charlie',
    sessions: [makeSession('c1')],
  });

  const items = buildSidebarNavItems([projA, projB, projC], 'name');

  assert.equal(items.length, 4);
  assert.equal(items[0]?.sessionId, 'a1');
  assert.equal(items[1]?.sessionId, 'a2');
  assert.equal(items[2]?.projectId, 'proj-b');
  assert.equal(items[2]?.sessionId, null);
  assert.equal(items[3]?.sessionId, 'c1');
});

test('buildSidebarNavItems: walks projects in sidebar order with mixed session counts', () => {
  const proj1 = makeProject({
    projectId: 'p1',
    displayName: 'Alpha',
    sessions: [makeSession('s11'), makeSession('s12')],
  });
  const proj2 = makeProject({
    projectId: 'p2',
    displayName: 'Beta',
    sessions: [makeSession('s21')],
  });
  const proj3 = makeProject({
    projectId: 'p3',
    displayName: 'Gamma',
    sessions: [makeSession('s31'), makeSession('s32'), makeSession('s33')],
  });

  const items = buildSidebarNavItems([proj3, proj1, proj2], 'name');

  assert.equal(items.length, 6);
  assert.equal(items[0]?.projectId, 'p1');
  assert.equal(items[1]?.projectId, 'p1');
  assert.equal(items[2]?.projectId, 'p2');
  assert.equal(items[3]?.projectId, 'p3');
});
