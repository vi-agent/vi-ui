import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import type { AppTab, Project, ProjectSession } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import { api } from '../../../../utils/api';
import { getSessionTitle, resolveEditOutcome } from './inlineTitleEdit';

// Re-export pure helpers so importers don't need to know about the helper module.
export { getSessionTitle, resolveEditOutcome };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function getTabTitle(
  activeTab: AppTab,
  shouldShowTasksTab: boolean,
  t: (key: string) => string,
  pluginDisplayName?: string,
) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return 'Project';
}

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  /** Called after a successful rename so callers can refresh their session lists. */
  onAfterRename?: () => void;
};

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  onAfterRename,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Track the current title in a ref so the event handler always has the
  // latest value without needing it as a dependency (avoids re-registering
  // the listener on every keystroke while the input is mounted).
  const currentTitleRef = useRef<string>('');
  if (selectedSession) {
    currentTitleRef.current = getSessionTitle(selectedSession);
  }

  const sessionIdRef = useRef<string | undefined>(undefined);
  sessionIdRef.current = selectedSession?.id;

  // Listen for the global rename trigger dispatched by the keyboard shortcut.
  useEffect(() => {
    const handler = () => {
      if (activeTab !== 'chat' || !sessionIdRef.current) return;
      const title = currentTitleRef.current;
      setDraft(title);
      setIsEditing(true);
    };

    window.addEventListener('vi:start-title-rename', handler);
    return () => window.removeEventListener('vi:start-title-rename', handler);
  }, [activeTab]);

  // Focus and select all text when editing begins.
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Stop editing (and optionally reset) when the session changes.
  useEffect(() => {
    setIsEditing(false);
    setDraft('');
  }, [selectedSession?.id]);

  const confirmEdit = async () => {
    const sessionId = sessionIdRef.current;
    const originalTitle = currentTitleRef.current;
    setIsEditing(false);

    if (!sessionId) return;

    const outcome = resolveEditOutcome(draft, originalTitle);
    if (!outcome.shouldSave) return;

    try {
      const response = await api.renameSession(sessionId, outcome.value);
      if (response.ok) {
        onAfterRename?.();
      } else {
        console.error('[MainContentTitle] Failed to rename session:', response.status);
      }
    } catch (error) {
      console.error('[MainContentTitle] Error renaming session:', error);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraft('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void confirmEdit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  };

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => void confirmEdit()}
                className="w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm font-semibold leading-tight text-foreground focus:outline-none focus:ring-1 focus:ring-primary/60"
                aria-label="Rename session"
              />
            ) : (
              <h2
                title={getSessionTitle(selectedSession)}
                className="truncate text-sm font-semibold leading-tight text-foreground"
              >
                {getSessionTitle(selectedSession)}
              </h2>
            )}
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              {selectedProject.displayName}
            </div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">
              {t('mainContent.newSession')}
            </h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">
              {selectedProject.displayName}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              {selectedProject.displayName}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
