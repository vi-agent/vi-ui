import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { projectsDb } from '@/modules/database/index.js';
import type { CreateProjectPathResult, ProjectRepositoryRow } from '@/shared/types.js';

export type ViContextEntry = {
  displayName: string;
  path: string;
};

/**
 * Parses the '## Projects' section of a vi-context.md file.
 *
 * Each bullet must have a bold name and a Path field, e.g.:
 *   - **My App** — Description. Path: `~/workplace/my-app`. Repo: ...
 *
 * Lines that do not match this pattern are silently skipped.
 * Returns an array of { displayName, path } pairs (path is unexpanded).
 */
export function parseViContextProjects(content: string): ViContextEntry[] {
  // Locate the ## Projects heading
  const projectsMatch = content.match(/^## Projects\s*$/m);
  if (!projectsMatch || projectsMatch.index === undefined) return [];

  const afterHeading = content.slice(projectsMatch.index + projectsMatch[0].length);

  // Take only the content up to the next ## heading (or end of file)
  const nextHeadingIdx = afterHeading.search(/^## /m);
  const section = nextHeadingIdx === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIdx);

  const results: ViContextEntry[] = [];

  for (const line of section.split('\n')) {
    // Must start with "- **Name**" and contain "Path: `...`"
    const match = line.match(/^-\s+\*\*([^*]+)\*\*.*Path:\s*`([^`]+)`/);
    if (!match) continue;

    const displayName = match[1].trim();
    const rawPath = match[2].trim();

    if (!displayName || !rawPath) continue;

    results.push({ displayName, path: rawPath });
  }

  return results;
}

/**
 * Expands a leading ~ to the user's home directory.
 */
export function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

type SyncDependencies = {
  readFile: (filePath: string) => Promise<string>;
  pathExists: (filePath: string) => Promise<boolean>;
  createProjectPath: (projectPath: string, customName: string | null) => CreateProjectPathResult;
  updateCustomProjectNameById: (projectId: string, customName: string | null) => void;
  getProjectByPath: (projectPath: string) => ProjectRepositoryRow | null;
};

const defaultDependencies: SyncDependencies = {
  readFile: (filePath) => fs.readFile(filePath, 'utf8'),
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
 * Reads ~/agent-system/context/vi-context.md, parses the ## Projects section,
 * and upserts every listed project whose path exists on disk.
 *
 * - New projects are inserted with the vi-context.md display name.
 * - Existing projects (active or reactivated from archived) have their
 *   custom_project_name updated if the vi-context.md name changed.
 * - isStarred and isArchived flags are never touched for existing projects.
 * - If the file is missing, a warning is logged and the function is a no-op.
 */
export async function syncViContextProjects(
  viContextPath?: string,
  dependencies: SyncDependencies = defaultDependencies,
): Promise<void> {
  const filePath =
    viContextPath ??
    path.join(os.homedir(), 'agent-system', 'context', 'vi-context.md');

  let content: string;
  try {
    content = await dependencies.readFile(filePath);
  } catch (err) {
    console.warn(
      `[vi-context-sync] vi-context.md not found at ${filePath} — skipping project sync`,
    );
    return;
  }

  const entries = parseViContextProjects(content);
  if (entries.length === 0) {
    console.log('[vi-context-sync] No project entries found in vi-context.md');
    return;
  }

  let synced = 0;
  let skipped = 0;

  for (const entry of entries) {
    const expandedPath = expandTilde(entry.path);

    const exists = await dependencies.pathExists(expandedPath);
    if (!exists) {
      skipped++;
      continue;
    }

    const result = dependencies.createProjectPath(expandedPath, entry.displayName);

    if (result.outcome === 'created') {
      // Name was set correctly during INSERT — nothing more to do.
      synced++;
      continue;
    }

    // For active_conflict and reactivated_archived, the name in the DB may
    // differ from the vi-context.md name — update it if so.
    const existingRow = result.project ?? dependencies.getProjectByPath(expandedPath);
    if (existingRow && existingRow.custom_project_name !== entry.displayName) {
      dependencies.updateCustomProjectNameById(existingRow.project_id, entry.displayName);
    }

    synced++;
  }

  console.log(
    `[vi-context-sync] Synced ${synced} project(s) from vi-context.md` +
      (skipped > 0 ? ` (${skipped} skipped — path not found on disk)` : ''),
  );
}
