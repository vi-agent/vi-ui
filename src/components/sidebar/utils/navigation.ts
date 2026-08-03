import type { Project } from '../../../types/app';
import type { SidebarNavItem } from '../types/types';
import { getAllSessions, sortProjects, readProjectSortOrder } from './utils';

/**
 * Builds the ordered list of navigatable sidebar sessions.
 *
 * Returns one `SidebarNavItem` per session that belongs to an *expanded*
 * project, in the order they appear in the sidebar (projects sorted by the
 * user's chosen sort order, sessions within each project sorted by recency).
 *
 * This is a pure function so it can be unit-tested independently of React.
 *
 * @param projects    The full project list (pre-filtered by search if applicable).
 * @param expandedIds Set of projectId strings whose project panels are open.
 * @param sortOrder   Project sort order ('name' | 'date'). Defaults to the
 *                    value stored in localStorage via readProjectSortOrder().
 */
export function buildSidebarNavItems(
  projects: Project[],
  expandedIds: Set<string>,
  sortOrder?: 'name' | 'date',
): SidebarNavItem[] {
  const order = sortOrder ?? readProjectSortOrder();
  const sorted = sortProjects(projects, order);
  const items: SidebarNavItem[] = [];

  for (const project of sorted) {
    if (!expandedIds.has(project.projectId)) {
      continue;
    }

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
