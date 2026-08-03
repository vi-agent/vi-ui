import fsp from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';

const ARCHIVE_PURGE_DAYS = 7;

/**
 * Removes a file from disk if it exists. Returns true when the file was
 * deleted, false when it was not found (no-op), and throws on unexpected errors.
 */
async function removeFileIfExists(filePath: string): Promise<boolean> {
  try {
    await fsp.unlink(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Hard-deletes all sessions that have been archived for at least 7 days.
 *
 * For each eligible session the purge job:
 *   1. Deletes the JSONL transcript file from disk (if one is recorded).
 *   2. Removes the session row from the database.
 *
 * This mirrors the existing hard-delete code path used by
 * `sessionsService.deleteOrArchiveSessionById({ force: true, deletedFromDisk: true })`,
 * but batches the operation for all stale archived rows at once.
 *
 * Called on server startup and on an hourly interval.
 *
 * @returns An object with `purgedCount` (sessions deleted) and `filesDeleted` counts.
 */
export async function runArchivePurge(): Promise<{ purgedCount: number; filesDeleted: number }> {
  const cutoff = new Date(Date.now() - ARCHIVE_PURGE_DAYS * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoff.toISOString();

  let sessions: ReturnType<typeof sessionsDb.getSessionsArchivedBefore>;
  try {
    sessions = sessionsDb.getSessionsArchivedBefore(cutoffIso);
  } catch (error) {
    console.error('[archive-purge] Failed to query sessions for purge:', error);
    return { purgedCount: 0, filesDeleted: 0 };
  }

  if (sessions.length === 0) {
    return { purgedCount: 0, filesDeleted: 0 };
  }

  let purgedCount = 0;
  let filesDeleted = 0;

  for (const session of sessions) {
    try {
      // Delete transcript file first (best-effort).
      if (session.jsonl_path) {
        const removed = await removeFileIfExists(session.jsonl_path);
        if (removed) {
          filesDeleted++;
        }
      }

      // Hard-delete the DB row.
      const deleted = sessionsDb.deleteSessionById(session.session_id);
      if (deleted) {
        purgedCount++;
      }
    } catch (error) {
      console.error(
        `[archive-purge] Failed to purge session "${session.session_id}":`,
        error,
      );
      // Continue with the next session rather than aborting the whole run.
    }
  }

  console.log(
    `[archive-purge] Purge complete: ${purgedCount} session(s) deleted, ${filesDeleted} file(s) removed.`,
  );

  return { purgedCount, filesDeleted };
}

/**
 * Schedules the archive purge to run on an hourly interval.
 * Call once after server startup. Returns a cleanup function that stops the interval.
 */
export function scheduleArchivePurge(): () => void {
  const HOUR_MS = 60 * 60 * 1000;
  const intervalId = setInterval(() => {
    void runArchivePurge().catch((error) => {
      console.error('[archive-purge] Unexpected error during scheduled purge:', error);
    });
  }, HOUR_MS);

  return () => clearInterval(intervalId);
}
