import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { projectsDb } from '@/modules/database/index.js';
import type { CreateProjectPathResult, ProjectRepositoryRow } from '@/shared/types.js';

export type QueueDbProjectEntry = {
  displayName: string;
  path: string;
};

type QueueDbProjectRow = {
  name: string;
  repo_path: string;
};

/**
 * Turns a kebab-case project slug into a Title Case display name.
 * `racket-reel` -> `Racket Reel`, `vi-ui` -> `Vi Ui`.
 * Names without dashes are returned unchanged (e.g. `ToPathMapSwift`).
 */
export function slugToDisplayName(slug: string): string {
  if (!slug.includes('-') && !slug.includes('_')) return slug;
  return slug
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Opens ~/agent-system/queue.db read-only and returns all non-archived projects.
 */
export function readActiveProjectsFromQueueDb(queueDbPath: string): QueueDbProjectEntry[] {
  const db = new Database(queueDbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare('SELECT name, repo_path FROM projects WHERE archived = 0 ORDER BY name')
      .all() as QueueDbProjectRow[];

    return rows
      .filter((row) => row.name && row.repo_path)
      .map((row) => ({
        displayName: slugToDisplayName(row.name),
        path: row.repo_path,
      }));
  } finally {
    db.close();
  }
}

type SyncDependencies = {
  readProjects: (queueDbPath: string) => QueueDbProjectEntry[];
  pathExists: (filePath: string) => Promise<boolean>;
  createProjectPath: (projectPath: string, customName: string | null) => CreateProjectPathResult;
  updateCustomProjectNameById: (projectId: string, customName: string | null) => void;
  getProjectByPath: (projectPath: string) => ProjectRepositoryRow | null;
};

const defaultDependencies: SyncDependencies = {
  readProjects: readActiveProjectsFromQueueDb,
  pathExists: async (filePath) => {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  },
  createProjectPath: (projectPath, customName) =>
    projectsDb.createProjectPath(projectPath, customName),
  updateCustomProjectNameById: (projectId, customName) =>
    projectsDb.updateCustomProjectNameById(projectId, customName),
  getProjectByPath: (projectPath) => projectsDb.getProjectPath(projectPath),
};

/**
 * Reads the agent-system queue.db projects table and upserts every non-archived
 * project whose repo_path exists on disk into vi-ui's own projects DB.
 *
 * - New projects are inserted with the derived display name.
 * - Existing projects have their custom_project_name updated if the derived
 *   name has changed.
 * - isStarred and isArchived flags on vi-ui's side are never touched.
 * - If queue.db is missing or unreadable, a warning is logged and the function
 *   is a no-op.
 */
export async function syncProjectsFromQueueDb(
  queueDbPath?: string,
  dependencies: SyncDependencies = defaultDependencies,
): Promise<void> {
  const dbPath =
    queueDbPath ?? path.join(os.homedir(), 'agent-system', 'queue.db');

  let entries: QueueDbProjectEntry[];
  try {
    entries = dependencies.readProjects(dbPath);
  } catch (err) {
    console.warn(
      `[queue-db-projects-sync] Could not read projects from ${dbPath} — skipping project sync:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }

  if (entries.length === 0) {
    console.log('[queue-db-projects-sync] No active projects found in queue.db');
    return;
  }

  let synced = 0;
  let skipped = 0;

  for (const entry of entries) {
    const exists = await dependencies.pathExists(entry.path);
    if (!exists) {
      skipped++;
      continue;
    }

    const result = dependencies.createProjectPath(entry.path, entry.displayName);

    if (result.outcome === 'created') {
      synced++;
      continue;
    }

    const existingRow = result.project ?? dependencies.getProjectByPath(entry.path);
    if (existingRow && existingRow.custom_project_name !== entry.displayName) {
      dependencies.updateCustomProjectNameById(existingRow.project_id, entry.displayName);
    }

    synced++;
  }

  console.log(
    `[queue-db-projects-sync] Synced ${synced} project(s) from queue.db` +
      (skipped > 0 ? ` (${skipped} skipped — path not found on disk)` : ''),
  );
}
