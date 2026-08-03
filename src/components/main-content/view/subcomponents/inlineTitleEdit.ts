/**
 * Pure helpers for the inline session-title edit flow.
 *
 * Extracted into a dependency-free module so they can be unit-tested without
 * pulling in React, api.js, or any Vite/browser-only globals.
 */

import type { ProjectSession } from '../../../../types/app';

// ---------------------------------------------------------------------------
// Session title resolution
// ---------------------------------------------------------------------------

/**
 * Derive the display title for a session.
 */
export function getSessionTitle(session: ProjectSession): string {
  if (session.__provider === 'cursor') {
    return (session.name as string) || 'Untitled Session';
  }

  return (session.summary as string) || 'New Session';
}

// ---------------------------------------------------------------------------
// Edit outcome resolution
// ---------------------------------------------------------------------------

/**
 * Decide whether an in-progress edit should be saved and what value to use.
 *
 * - Empty (or whitespace-only) drafts → no-save.
 * - Drafts that equal the original title (after trimming both) → no-save.
 * - Any other non-empty draft → save with the trimmed value.
 *
 * This function covers all three UX paths (Enter / blur / Esc):
 * - Enter  → call resolveEditOutcome(), act on the result
 * - Blur   → same as Enter
 * - Esc    → caller skips resolveEditOutcome() entirely and just cancels
 */
export function resolveEditOutcome(
  draft: string,
  originalTitle: string,
): { shouldSave: true; value: string } | { shouldSave: false } {
  const trimmed = draft.trim();
  if (!trimmed || trimmed === originalTitle.trim()) {
    return { shouldSave: false };
  }
  return { shouldSave: true, value: trimmed };
}
