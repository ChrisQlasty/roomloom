/** `<input>` types that take no typed text, so movement keys still work while they have focus. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Whether `target` takes typed text (text fields, text areas, selects, contenteditable). */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as Partial<HTMLInputElement> | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUTS.has((el.type ?? 'text').toLowerCase());
}

/**
 * Keyboard state by physical key (`KeyboardEvent.code`, so WASD works on any layout).
 * Keys typed into a text field are ignored, and held keys are released when focus moves into
 * one or the window loses focus, so typing in the chat never moves the camera.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private readonly pressHandlers = new Set<(code: string) => void>();
  private readonly listeners: [string, (event: Event) => void][];

  constructor(private readonly target: EventTarget = window) {
    this.listeners = [
      ['keydown', (e) => this.keyDown(e as KeyboardEvent)],
      ['keyup', (e) => this.held.delete((e as KeyboardEvent).code)],
      ['focusin', (e) => isTextEntry(e.target) && this.held.clear()],
      ['blur', () => this.held.clear()],
    ];
    for (const [type, listener] of this.listeners) target.addEventListener(type, listener);
  }

  /** Whether any of `codes` is held down. */
  isDown(...codes: string[]): boolean {
    return codes.some((code) => this.held.has(code));
  }

  /** Call `handler` once per key press (not on auto-repeat); returns an unsubscribe function. */
  onPress(handler: (code: string) => void): () => void {
    this.pressHandlers.add(handler);
    return () => this.pressHandlers.delete(handler);
  }

  /** Stop listening. */
  dispose(): void {
    for (const [type, listener] of this.listeners) this.target.removeEventListener(type, listener);
    this.held.clear();
  }

  private keyDown(event: KeyboardEvent): void {
    if (isTextEntry(event.target)) return;
    // Cmd/Ctrl/Alt shortcuts belong to the browser; Ctrl alone is the fly-down key.
    if (event.metaKey || event.altKey) return;
    this.held.add(event.code);
    if (event.repeat || event.ctrlKey) return;
    for (const handler of this.pressHandlers) handler(event.code);
  }
}
