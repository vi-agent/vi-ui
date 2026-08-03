/**
 * Compaction state management for the /compact slash command.
 *
 * Manages the full lifecycle of context compaction:
 * - idle: no compaction happening
 * - pending_stream: /compact was requested while a response is streaming;
 *   will start automatically when streaming finishes
 * - compacting: compaction run is in progress
 * - error: compaction failed; queue is held for retry or cancellation
 */

import { useCallback, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompactionPhase = 'idle' | 'pending_stream' | 'compacting' | 'error';

export interface CompactionQueueItem {
  id: string;
  content: string;
  uploadedAttachments?: unknown[];
  options?: unknown;
}

export interface UseCompactionStateReturn {
  phase: CompactionPhase;
  isCompacting: boolean;
  isPendingCompact: boolean;
  compactionQueue: CompactionQueueItem[];
  compactionError: string | null;

  // Lifecycle actions
  setPhase: (phase: CompactionPhase) => void;
  completeCompaction: (success: boolean, errorMessage?: string) => void;

  // Queue operations
  enqueueMessage: (item: Omit<CompactionQueueItem, 'id'>) => string;
  dequeueMessage: () => CompactionQueueItem | undefined;
  cancelQueue: () => void;
}

// ---------------------------------------------------------------------------
// Slash command parser (pure — no React)
// ---------------------------------------------------------------------------

/**
 * Returns true when the input is exactly the /compact command (after trimming
 * whitespace and lowercasing). Does NOT match '/compact something' or '/compactnow'.
 */
export function isCompactCommand(input: string): boolean {
  return input.trim().toLowerCase() === '/compact';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCompactionState(): UseCompactionStateReturn {
  const [phase, setPhase] = useState<CompactionPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  // The queue is stored in both a ref (for synchronous reads) and state (for
  // render updates). Callers mutate via enqueueMessage / dequeueMessage.
  const queueRef = useRef<CompactionQueueItem[]>([]);
  const [queue, setQueue] = useState<CompactionQueueItem[]>([]);
  const idCounterRef = useRef(0);

  const enqueueMessage = useCallback((item: Omit<CompactionQueueItem, 'id'>): string => {
    const id = `cq_${Date.now()}_${++idCounterRef.current}`;
    const next: CompactionQueueItem = { ...item, id };
    queueRef.current = [...queueRef.current, next];
    setQueue([...queueRef.current]);
    return id;
  }, []);

  const dequeueMessage = useCallback((): CompactionQueueItem | undefined => {
    const [first, ...rest] = queueRef.current;
    queueRef.current = rest;
    setQueue(rest);
    return first;
  }, []);

  const cancelQueue = useCallback(() => {
    queueRef.current = [];
    setQueue([]);
    setPhase('idle');
    setError(null);
  }, []);

  const completeCompaction = useCallback((success: boolean, errorMessage?: string) => {
    if (success) {
      setPhase('idle');
      setError(null);
    } else {
      setPhase('error');
      setError(errorMessage ?? 'Compaction failed');
    }
  }, []);

  return {
    phase,
    isCompacting: phase === 'compacting',
    isPendingCompact: phase === 'pending_stream',
    compactionQueue: queue,
    compactionError: error,

    setPhase,
    completeCompaction,
    enqueueMessage,
    dequeueMessage,
    cancelQueue,
  };
}
