import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchesShortcut,
  getShortcutDefinitions,
  type ShortcutDescriptor,
} from './useKeyboardShortcuts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

function makeEvent(overrides: Partial<FakeKeyEvent> = {}): FakeKeyEvent {
  return {
    key: 'a',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// matchesShortcut — Mac mode (meta = Cmd = event.metaKey)
// ---------------------------------------------------------------------------

test('matchesShortcut: matches simple Cmd+/ on Mac', () => {
  const shortcut: ShortcutDescriptor = { meta: true, key: '/' };
  const event = makeEvent({ key: '/', metaKey: true });
  assert.ok(matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: rejects when Cmd not pressed for Cmd+/ on Mac', () => {
  const shortcut: ShortcutDescriptor = { meta: true, key: '/' };
  const event = makeEvent({ key: '/', metaKey: false });
  assert.ok(!matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: matches Ctrl+Shift+Cmd+T on Mac', () => {
  const shortcut: ShortcutDescriptor = { meta: true, ctrl: true, shift: true, key: 't' };
  const event = makeEvent({ key: 't', metaKey: true, ctrlKey: true, shiftKey: true });
  assert.ok(matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: rejects Ctrl+Cmd+T on Mac when shift is required', () => {
  const shortcut: ShortcutDescriptor = { meta: true, ctrl: true, shift: true, key: 't' };
  const event = makeEvent({ key: 't', metaKey: true, ctrlKey: true, shiftKey: false });
  assert.ok(!matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: matches Ctrl+Cmd+Backspace on Mac', () => {
  const shortcut: ShortcutDescriptor = { meta: true, ctrl: true, key: 'backspace' };
  const event = makeEvent({ key: 'Backspace', metaKey: true, ctrlKey: true });
  assert.ok(matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: key comparison is case-insensitive', () => {
  const shortcut: ShortcutDescriptor = { meta: true, key: 'backspace' };
  const event = makeEvent({ key: 'BACKSPACE', metaKey: true });
  assert.ok(matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: rejects when extra modifier is pressed (alt)', () => {
  const shortcut: ShortcutDescriptor = { meta: true, key: '/' };
  const event = makeEvent({ key: '/', metaKey: true, altKey: true });
  assert.ok(!matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: rejects wrong key', () => {
  const shortcut: ShortcutDescriptor = { meta: true, key: 't' };
  const event = makeEvent({ key: 'x', metaKey: true });
  assert.ok(!matchesShortcut(event, shortcut, true));
});

// ---------------------------------------------------------------------------
// matchesShortcut — non-Mac mode (meta and ctrl both collapse to ctrlKey)
// ---------------------------------------------------------------------------

test('matchesShortcut: matches Ctrl+/ on non-Mac (meta maps to ctrlKey)', () => {
  const shortcut: ShortcutDescriptor = { meta: true, key: '/' };
  // On non-Mac: meta => ctrlKey. So { meta: true } needs event.ctrlKey = true.
  const event = makeEvent({ key: '/', ctrlKey: true });
  assert.ok(matchesShortcut(event, shortcut, false));
});

test('matchesShortcut: rejects when ctrlKey not pressed on non-Mac', () => {
  const shortcut: ShortcutDescriptor = { meta: true, key: '/' };
  const event = makeEvent({ key: '/', ctrlKey: false });
  assert.ok(!matchesShortcut(event, shortcut, false));
});

test('matchesShortcut: rejects stray metaKey (Win key) on non-Mac', () => {
  const shortcut: ShortcutDescriptor = { meta: true, key: '/' };
  // ctrlKey=true satisfies meta, but metaKey=true is the Windows key — should reject.
  const event = makeEvent({ key: '/', ctrlKey: true, metaKey: true });
  assert.ok(!matchesShortcut(event, shortcut, false));
});

test('matchesShortcut: handles Ctrl+Shift+Ctrl+T on non-Mac (meta+ctrl both collapse to ctrlKey)', () => {
  // { meta: true, ctrl: true, shift: true } on non-Mac:
  // meta || ctrl => ctrlKey must be true; shift => shiftKey must be true.
  const shortcut: ShortcutDescriptor = { meta: true, ctrl: true, shift: true, key: 't' };
  const event = makeEvent({ key: 't', ctrlKey: true, shiftKey: true });
  assert.ok(matchesShortcut(event, shortcut, false));
});

// ---------------------------------------------------------------------------
// matchesShortcut — ArrowUp / ArrowDown
// ---------------------------------------------------------------------------

test('matchesShortcut: matches ArrowUp shortcut', () => {
  const shortcut: ShortcutDescriptor = { meta: true, ctrl: true, shift: true, key: 'arrowup' };
  const event = makeEvent({ key: 'ArrowUp', metaKey: true, ctrlKey: true, shiftKey: true });
  assert.ok(matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: matches ArrowDown shortcut', () => {
  const shortcut: ShortcutDescriptor = { meta: true, ctrl: true, shift: true, key: 'arrowdown' };
  const event = makeEvent({ key: 'ArrowDown', metaKey: true, ctrlKey: true, shiftKey: true });
  assert.ok(matchesShortcut(event, shortcut, true));
});

test('matchesShortcut: does not confuse ArrowUp and ArrowDown', () => {
  const upShortcut: ShortcutDescriptor = { meta: true, ctrl: true, shift: true, key: 'arrowup' };
  const downEvent = makeEvent({ key: 'ArrowDown', metaKey: true, ctrlKey: true, shiftKey: true });
  assert.ok(!matchesShortcut(downEvent, upShortcut, true));
});

// ---------------------------------------------------------------------------
// getShortcutDefinitions — smoke tests
// ---------------------------------------------------------------------------

test('getShortcutDefinitions: returns all 5 shortcuts', () => {
  const defs = getShortcutDefinitions(true);
  assert.equal(defs.length, 5);

  const ids = defs.map((d) => d.id);
  assert.ok(ids.includes('new-session'));
  assert.ok(ids.includes('archive-session'));
  assert.ok(ids.includes('navigate-prev'));
  assert.ok(ids.includes('navigate-next'));
  assert.ok(ids.includes('open-shortcuts-modal'));
});

test('getShortcutDefinitions: archive-session has alwaysFires = true', () => {
  const defs = getShortcutDefinitions(true);
  const archiveDef = defs.find((d) => d.id === 'archive-session');
  assert.ok(archiveDef?.alwaysFires === true);
});

test('getShortcutDefinitions: only archive-session has alwaysFires', () => {
  const defs = getShortcutDefinitions(true);
  const alwaysFireDefs = defs.filter((d) => d.alwaysFires);
  assert.equal(alwaysFireDefs.length, 1);
  assert.equal(alwaysFireDefs[0]?.id, 'archive-session');
});

test('getShortcutDefinitions: archive-session descriptor has ctrl and meta both true', () => {
  const defs = getShortcutDefinitions(true);
  const archiveDef = defs.find((d) => d.id === 'archive-session');
  assert.ok(archiveDef?.descriptor.ctrl === true);
  assert.ok(archiveDef?.descriptor.meta === true);
  assert.equal(archiveDef?.descriptor.key, 'backspace');
});

test('getShortcutDefinitions: open-shortcuts-modal has meta=true and key="/"', () => {
  const defs = getShortcutDefinitions(true);
  const modalDef = defs.find((d) => d.id === 'open-shortcuts-modal');
  assert.ok(modalDef?.descriptor.meta === true);
  assert.equal(modalDef?.descriptor.key, '/');
  assert.ok(!modalDef?.descriptor.ctrl);
});

test('getShortcutDefinitions: navigate-prev and navigate-next both have meta+ctrl+shift', () => {
  const defs = getShortcutDefinitions(true);
  const prevDef = defs.find((d) => d.id === 'navigate-prev');
  const nextDef = defs.find((d) => d.id === 'navigate-next');

  for (const def of [prevDef, nextDef]) {
    assert.ok(def?.descriptor.meta === true);
    assert.ok(def?.descriptor.ctrl === true);
    assert.ok(def?.descriptor.shift === true);
  }

  assert.equal(prevDef?.descriptor.key, 'arrowup');
  assert.equal(nextDef?.descriptor.key, 'arrowdown');
});

test('getShortcutDefinitions: Mac display strings use ⌘ symbol', () => {
  const defs = getShortcutDefinitions(true);
  const modalDef = defs.find((d) => d.id === 'open-shortcuts-modal');
  assert.ok(modalDef?.display.includes('⌘'), `Expected ⌘ in "${modalDef?.display}"`);
});

test('getShortcutDefinitions: non-Mac display strings use Ctrl text', () => {
  const defs = getShortcutDefinitions(false);
  const modalDef = defs.find((d) => d.id === 'open-shortcuts-modal');
  assert.ok(modalDef?.display.includes('Ctrl'), `Expected Ctrl in "${modalDef?.display}"`);
});

// ---------------------------------------------------------------------------
// Focus suppression logic — verify via matchesShortcut + alwaysFires
// ---------------------------------------------------------------------------

test('focus suppression: non-alwaysFires shortcuts should be suppressible by checking alwaysFires flag', () => {
  const defs = getShortcutDefinitions(true);

  // Simulate "focus is in an input" suppression: shortcuts without alwaysFires
  // should be skipped. Only archive-session has alwaysFires.
  const inputFocused = true;

  const newSessionDef = defs.find((d) => d.id === 'new-session')!;
  const archiveDef = defs.find((d) => d.id === 'archive-session')!;

  // Simulate: would this shortcut fire when inputFocused?
  const wouldNewSessionFire = !inputFocused || Boolean(newSessionDef.alwaysFires);
  const wouldArchiveFire = !inputFocused || Boolean(archiveDef.alwaysFires);

  assert.equal(wouldNewSessionFire, false, 'new-session should be suppressed when input is focused');
  assert.equal(wouldArchiveFire, true, 'archive-session should always fire');
});
