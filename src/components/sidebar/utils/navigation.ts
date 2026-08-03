import type { Project } from '../../../types/app';
import type { SidebarNavItem } from '../types/types';
import { getAllSessions, sortProjects, readProjectSortOrder } from './utils';

/**
 * Builds the ordered list of navigatable sidebar sessions.
 *
 * Returns one `SidebarNavItem` per session across every project, in the order
 * they appear in the sidebar (projects sorted by the user's chosen sort order,
 * sessions within each project sorted by recency). Projects that are currently
 * collapsed are still included so the keyboard shortcut can traverse them and
 * auto-expand the target when the highlight moves in.
 *
 * This is a pure function so it can be unit-tested independently of React.
 *
 * @param projects  The full project list (pre-filtered by search if applicable).
 * @param sortOrder Project sort order ('name' | 'date'). Defaults to the
 *                  value stored in localStorage via readProjectSortOrder().
 */
export function buildSidebarNavItems(
  projects: Project[],
  sortOrder?: 'name' | 'date',
): SidebarNavItem[] {
  const order = sortOrder ?? readProjectSortOrder();
  const sorted = sortProjects(projects, order);
  const items: SidebarNavItem[] = [];

  for (const project of sorted) {
    const sessions = getAllSessions(project);
    for (const session of sessions) {
      items.push({
        sessionId: session.id,
        projectId: project.projectId,
        session,
        project,
      });
    }
  }

  return items;
}
