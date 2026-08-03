import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { WebSocket } from 'ws';

import { handleShellConnection } from '@/modules/websocket/services/shell-websocket.service.js';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: string[];
    send: (data: string) => void;
  };
  socket.readyState = WebSocket.OPEN;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(data);
  return socket;
}

function createFakePty() {
  let dataListener: ((data: string) => void) | null = null;
  let exitListener: ((event: { exitCode: number; signal?: number }) => void) | null = null;

  return {
    killed: false,
    onData(listener: (data: string) => void) {
      dataListener = listener;
      return { dispose: () => undefined };
    },
    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      exitListener = listener;
      return { dispose: () => undefined };
    },
    emitData(data: string) {
      dataListener?.(data);
    },
    emitExit() {
      exitListener?.({ exitCode: 0 });
    },
    write() {},
    resize() {},
    kill() {
      this.killed = true;
    },
  };
}

test('a stale socket close cannot detach the socket that replaced it', () => {
  const pty = createFakePty();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };
  const initMessage = JSON.stringify({
    type: 'init',
    projectPath: process.cwd(),
    sessionId: `stale-close-${Date.now()}`,
    hasSession: false,
    provider: 'plain-shell',
    isPlainShell: true,
    initialCommand: 'test-command',
  });

  const firstSocket = createFakeSocket();
  handleShellConnection(firstSocket as never, dependencies);
  firstSocket.emit('message', initMessage);

  const replacementSocket = createFakeSocket();
  handleShellConnection(replacementSocket as never, dependencies);
  replacementSocket.emit('message', initMessage);
  replacementSocket.frames.length = 0;

  // This ordering reproduces a delayed close from a backgrounded mobile tab.
  firstSocket.emit('close');
  pty.emitData('output-after-stale-close');

  assert.equal(pty.killed, false);
  assert.equal(replacementSocket.frames.length, 1);
  assert.match(replacementSocket.frames[0], /output-after-stale-close/);

  pty.emitExit();
});

// Helper to capture the shell command string passed to spawnPty
function captureShellCommand(
  message: Record<string, unknown>,
  resolveProviderSessionId: (sessionId: string, provider: string) => string | null = () => null
): string {
  const pty = createFakePty();
  let capturedArgs: string[] = [];
  const dependencies = {
    resolveProviderSessionId,
    spawnPty: (_shell: string, args: string | string[]) => {
      capturedArgs = Array.isArray(args) ? args : [args];
      return pty as never;
    },
  };
  const socket = createFakeSocket();
  handleShellConnection(socket as never, dependencies);
  socket.emit('message', JSON.stringify({ type: 'init', projectPath: process.cwd(), ...message }));
  pty.emitExit();
  // On non-Windows, shell args are ['-c', '<command>']
  return capturedArgs[1] ?? '';
}

test('buildShellCommand — claude fresh session includes vi flags', () => {
  const cmd = captureShellCommand({
    sessionId: `vi-fresh-${Date.now()}`,
    hasSession: false,
    provider: 'claude',
  });
  assert.match(cmd, /--dangerously-skip-permissions/);
  assert.match(cmd, /--append-system-prompt-file \$HOME\/agent-system\/context\/vi-context\.md/);
  // Must NOT start a resume session
  assert.doesNotMatch(cmd, /--resume/);
});

test('buildShellCommand — claude resume session includes vi flags on both branches', () => {
  const resumeId = `resume-session-${Date.now()}`;
  const cmd = captureShellCommand(
    {
      sessionId: `vi-resume-${Date.now()}`,
      hasSession: true,
      provider: 'claude',
    },
    () => resumeId
  );
  // The resume invocation must carry the flags
  assert.match(cmd, new RegExp(`--resume "${resumeId}".*--dangerously-skip-permissions`));
  // The fallback invocation (after ||) must also carry the flags
  assert.match(cmd, /\|\|.*claude.*--dangerously-skip-permissions/);
  assert.match(cmd, /--append-system-prompt-file \$HOME\/agent-system\/context\/vi-context\.md/);
});

test('shell output detects and normalizes a wrapped authentication URL', () => {
  const pty = createFakePty();
  const socket = createFakeSocket();
  const dependencies = {
    resolveProviderSessionId: () => null,
    spawnPty: () => pty as never,
  };

  handleShellConnection(socket as never, dependencies);
  socket.emit(
    'message',
    JSON.stringify({
      type: 'init',
      projectPath: process.cwd(),
      sessionId: `wrapped-url-${Date.now()}`,
      hasSession: false,
      provider: 'plain-shell',
      isPlainShell: true,
      initialCommand: 'test-command',
    })
  );
  socket.frames.length = 0;

  pty.emitData("Continue in your browser: https://example.com/authorize?\ncode=abc\x1b[0m");

  const frames = socket.frames.map((frame) => JSON.parse(frame) as Record<string, unknown>);
  const authenticationFrame = frames.find((frame) => frame.type === 'auth_url');
  assert.deepEqual(authenticationFrame, {
    type: 'auth_url',
    url: 'https://example.com/authorize?code=abc',
    autoOpen: false,
  });

  pty.emitExit();
});
