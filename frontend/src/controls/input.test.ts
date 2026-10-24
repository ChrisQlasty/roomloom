import { describe, expect, it } from 'vitest';
import { Emitter } from './events';
import { isTextEntry, KeyboardInput } from './input';

/** A stand-in for a DOM element: just the fields `isTextEntry` reads. */
const el = (tagName: string, extra: Record<string, unknown> = {}): EventTarget =>
  Object.assign(new EventTarget(), { tagName, isContentEditable: false, ...extra });

function key(
  type: 'keydown' | 'keyup',
  code: string,
  extra: Partial<KeyboardEvent> & { target?: EventTarget } = {},
): Event {
  const event = new Event(type);
  for (const [name, value] of Object.entries({ code, repeat: false, ...extra }))
    Object.defineProperty(event, name, { value });
  return event;
}

describe('isTextEntry', () => {
  it.each([
    [el('INPUT', { type: 'text' }), true],
    [el('input', { type: 'search' }), true],
    [el('TEXTAREA'), true],
    [el('SELECT'), true],
    [el('DIV', { isContentEditable: true }), true],
    [el('INPUT', { type: 'checkbox' }), false],
    [el('BUTTON'), false],
    [el('CANVAS'), false],
    [new EventTarget(), false],
    [null, false],
  ])('%#', (target, expected) => {
    expect(isTextEntry(target)).toBe(expected);
  });
});

describe('KeyboardInput', () => {
  it('tracks held keys and reports single presses', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    const pressed: string[] = [];
    input.onPress((code) => pressed.push(code));
    target.dispatchEvent(key('keydown', 'KeyW'));
    target.dispatchEvent(key('keydown', 'KeyW', { repeat: true }));
    expect(input.isDown('KeyW')).toBe(true);
    expect(input.isDown('KeyA', 'KeyW')).toBe(true);
    target.dispatchEvent(key('keyup', 'KeyW'));
    expect(input.isDown('KeyW')).toBe(false);
    expect(pressed).toEqual(['KeyW']);
  });

  it('ignores keys typed into a text field and releases keys when one gets focus', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    const pressed: string[] = [];
    input.onPress((code) => pressed.push(code));
    target.dispatchEvent(key('keydown', 'KeyD'));
    const chat = el('TEXTAREA');
    const focus = new Event('focusin');
    Object.defineProperty(focus, 'target', { value: chat });
    target.dispatchEvent(focus);
    expect(input.isDown('KeyD')).toBe(false);
    target.dispatchEvent(key('keydown', 'KeyF', { target: chat }));
    expect(input.isDown('KeyF')).toBe(false);
    expect(pressed).toEqual(['KeyD']);
  });

  it('leaves Cmd, Ctrl and Alt shortcuts to the browser', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    const pressed: string[] = [];
    input.onPress((code) => pressed.push(code));
    target.dispatchEvent(key('keydown', 'ControlLeft', { ctrlKey: true }));
    target.dispatchEvent(key('keydown', 'KeyW', { ctrlKey: true }));
    target.dispatchEvent(key('keydown', 'KeyO', { metaKey: true }));
    target.dispatchEvent(key('keydown', 'KeyK', { altKey: true }));
    expect(input.isDown('ControlLeft', 'KeyW', 'KeyO', 'KeyK')).toBe(false);
    expect(pressed).toEqual([]);
  });

  it('releases everything on blur and stops listening on dispose', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'ShiftLeft'));
    target.dispatchEvent(new Event('blur'));
    expect(input.isDown('ShiftLeft')).toBe(false);
    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.isDown('KeyW')).toBe(false);
  });
});

describe('Emitter', () => {
  it('calls handlers until they unsubscribe', () => {
    const emitter = new Emitter<{ ping: number }>();
    const seen: number[] = [];
    const off = emitter.on('ping', (n) => seen.push(n));
    emitter.emit('ping', 1);
    off();
    emitter.emit('ping', 2);
    expect(seen).toEqual([1]);
  });
});
