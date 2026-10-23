/** A minimal typed event emitter: `E` maps event names to their payload types. */
export class Emitter<E extends object> {
  private readonly handlers = new Map<keyof E, Set<(payload: never) => void>>();

  /** Call `handler` on every `name` event; returns a function that unsubscribes it. */
  on<K extends keyof E>(name: K, handler: (payload: E[K]) => void): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler);
    this.handlers.set(name, set);
    return () => set.delete(handler);
  }

  /** Call every handler of `name` with `payload`. */
  emit<K extends keyof E>(name: K, payload: E[K]): void {
    for (const handler of this.handlers.get(name) ?? []) (handler as (p: E[K]) => void)(payload);
  }
}
