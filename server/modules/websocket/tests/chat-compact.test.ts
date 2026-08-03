/**
 * Tests for the chat.compact WebSocket message handler.
 *
 * Validates:
 * - Empty history (no provider_session_id) returns compact_done with emptyHistory: true
 * - Happy path: sends compact_start, calls runtime.run with '/compact', then compact_done
 * - In-progress run returns RUN_IN_PROGRESS protocol error
 * - Missing sessionId returns SESSION_ID_REQUIRED protocol error
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

// ---------------------------------------------------------------------------
// Minimal test doubles
// ---------------------------------------------------------------------------

class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];
  listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners[event] ?? []) {
      listener(...args);
    }
  }

  /** Simulate receiving a raw message from the client. */
  receive(payload: unknown): void {
    const raw = Buffer.from(JSON.stringify(payload));
    this.emit('message', raw);
  }
}

type RuntimeCall = { provider: string; command: string; options: Record<string, unknown> };

function makeRuntime(opts: { runShouldThrow?: string } = {}) {
  const calls: RuntimeCall[] = [];

  return {
    calls,
    runtime: {
      hasRuntime: (_provider: string) => true,
      run: async (
        provider: string,
        command: string,
        options: Record<string, unknown>,
        _writer: unknown,
      ): Promise<void> => {
        calls.push({ provider, command, options });
        if (opts.runShouldThrow) {
          throw new Error(opts.runShouldThrow);
        }
      },
      abort: async () => false,
      resolveToolApproval: () => {},
      getPendingApprovalsForSession: () => [],
    },
  };
}

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'chat-compact-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('chat.compact: missing sessionId returns SESSION_ID_REQUIRED', async () => {
  await withIsolatedDatabase(async () => {
    const ws = new FakeConnection();
    const { runtime } = makeRuntime();

    handleChatConnection(ws as never, {} as never, { runtime });

    ws.receive({ type: 'chat.compact' });
    // Let the async handler resolve.
    await new Promise((r) => setImmediate(r));

    const errors = ws.frames.filter((f) => f.kind === 'protocol_error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'SESSION_ID_REQUIRED');
  });
});

test('chat.compact: unknown sessionId returns SESSION_NOT_FOUND', async () => {
  await withIsolatedDatabase(async () => {
    const ws = new FakeConnection();
    const { runtime } = makeRuntime();

    handleChatConnection(ws as never, {} as never, { runtime });
    ws.receive({ type: 'chat.compact', sessionId: 'no-such-session' });
    await new Promise((r) => setImmediate(r));

    const errors = ws.frames.filter((f) => f.kind === 'protocol_error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'SESSION_NOT_FOUND');
  });
});

test('chat.compact: no provider_session_id returns compact_done with emptyHistory', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('compact-empty-1', 'claude', '/workspace/demo');

    const ws = new FakeConnection();
    const { runtime, calls } = makeRuntime();

    handleChatConnection(ws as never, {} as never, { runtime });
    ws.receive({ type: 'chat.compact', sessionId: 'compact-empty-1' });
    await new Promise((r) => setImmediate(r));

    // No runtime.run should be called for empty history.
    assert.equal(calls.length, 0);

    const done = ws.frames.filter((f) => f.kind === 'compact_done');
    assert.equal(done.length, 1);
    assert.equal(done[0]?.sessionId, 'compact-empty-1');
    assert.equal(done[0]?.emptyHistory, true);
  });
});

test('chat.compact: happy path — compact_start → runtime.run(\'/compact\') → compact_done', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('compact-ok-1', 'claude', '/workspace/demo');
    // Simulate an existing provider session.
    sessionsDb.assignProviderSessionId('compact-ok-1', 'claude-native-42');

    const ws = new FakeConnection();
    const { runtime, calls } = makeRuntime();

    handleChatConnection(ws as never, {} as never, { runtime });
    ws.receive({ type: 'chat.compact', sessionId: 'compact-ok-1' });
    // Allow the async handler to complete.
    await new Promise((r) => setTimeout(r, 0));

    // compact_start must precede compact_done.
    const startIdx = ws.frames.findIndex((f) => f.kind === 'compact_start');
    const doneIdx = ws.frames.findIndex((f) => f.kind === 'compact_done');
    assert.ok(startIdx !== -1, 'compact_start not sent');
    assert.ok(doneIdx !== -1, 'compact_done not sent');
    assert.ok(startIdx < doneIdx, 'compact_start must come before compact_done');

    // The runtime was called with '/compact'.
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, '/compact');
    assert.equal(calls[0]?.options?.sessionId, 'compact-ok-1');

    // No error frames.
    assert.equal(ws.frames.filter((f) => f.kind === 'compact_error').length, 0);
  });
});

test('chat.compact: runtime error produces compact_error instead of compact_done', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('compact-err-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('compact-err-1', 'claude-native-43');

    const ws = new FakeConnection();
    const { runtime } = makeRuntime({ runShouldThrow: 'SDK exploded' });

    handleChatConnection(ws as never, {} as never, { runtime });
    ws.receive({ type: 'chat.compact', sessionId: 'compact-err-1' });
    await new Promise((r) => setTimeout(r, 0));

    const errors = ws.frames.filter((f) => f.kind === 'compact_error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.error, 'SDK exploded');

    // No compact_done for a failed run.
    assert.equal(ws.frames.filter((f) => f.kind === 'compact_done').length, 0);
  });
});

test('chat.compact: RUN_IN_PROGRESS when a run is already active', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('compact-busy-1', 'claude', '/workspace/demo');
    sessionsDb.assignProviderSessionId('compact-busy-1', 'claude-native-44');

    const ws = new FakeConnection();
    const { runtime } = makeRuntime();

    // Start a run manually so the session is marked as processing.
    const existingRun = chatRunRegistry.startRun({
      appSessionId: 'compact-busy-1',
      provider: 'claude',
      providerSessionId: 'claude-native-44',
      connection: ws as never,
      userId: null,
    });
    assert.ok(existingRun, 'pre-existing run should start');

    handleChatConnection(ws as never, {} as never, { runtime });
    ws.receive({ type: 'chat.compact', sessionId: 'compact-busy-1' });
    await new Promise((r) => setImmediate(r));

    const errors = ws.frames.filter((f) => f.kind === 'protocol_error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.code, 'RUN_IN_PROGRESS');
  });
});
