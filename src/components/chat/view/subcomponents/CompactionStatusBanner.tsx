/**
 * Status banner shown during /compact operations.
 *
 * Renders different states:
 * - pending_stream: compact was requested but a response is still streaming
 * - compacting: compaction is actively running (spinner + progress text)
 * - error: compaction failed (with option to cancel queued messages)
 */

import { Loader2, Clock, XCircle } from 'lucide-react';
import type { CompactionPhase, CompactionQueueItem } from '../../hooks/useCompactionState';
import QueuedMessageCard from './QueuedMessageCard';

interface CompactionStatusBannerProps {
  phase: CompactionPhase;
  compactionQueue: CompactionQueueItem[];
  compactionError: string | null;
  onCancelQueue: () => void;
}

export default function CompactionStatusBanner({
  phase,
  compactionQueue,
  compactionError,
  onCancelQueue,
}: CompactionStatusBannerProps) {
  if (phase === 'idle') return null;

  return (
    <div className="mx-auto mb-2 w-full max-w-[54.25rem]">
      {/* Pending: waiting for current response to finish */}
      {phase === 'pending_stream' && (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5">
          <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500/70" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Compact queued — waiting for current response to finish
          </p>
        </div>
      )}

      {/* Compacting: actively running */}
      {phase === 'compacting' && (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-primary/25 bg-primary/[0.04] px-3 py-2.5">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary/60" />
          <p className="text-sm text-foreground/80">Compacting context…</p>
        </div>
      )}

      {/* Error: compaction failed */}
      {phase === 'error' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-destructive/30 bg-destructive/[0.04] px-3 py-2.5">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/70" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-destructive">
              {compactionError ?? 'Compaction failed'}
            </p>
            {compactionQueue.length > 0 && (
              <button
                type="button"
                onClick={onCancelQueue}
                className="mt-1 text-xs font-medium text-destructive underline underline-offset-2 hover:text-destructive/80"
              >
                Cancel {compactionQueue.length} queued{' '}
                {compactionQueue.length === 1 ? 'message' : 'messages'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Queued messages during compaction (or error hold) */}
      {(phase === 'compacting' || phase === 'error') &&
        compactionQueue.map((item, index) => (
          <div key={item.id} className="mt-1.5">
            <QueuedMessageCard
              content={item.content}
              onEdit={() => {/* queued compaction messages are not editable */}}
              onDelete={index === 0 ? onCancelQueue : () => {/* only cancel all */}}
            />
          </div>
        ))}
    </div>
  );
}
