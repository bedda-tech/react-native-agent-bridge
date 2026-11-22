import type { ComponentSpec } from "./types.js";

export type Entry = {
  id: string;
  /** Stable ref: "c1", "c2"... in order of first appearance. */
  ref: string;
  spec: ComponentSpec;
  mounted: boolean;
};

export type Handle = {
  ref: string;
  /** Replace the spec, like when a label or its actions changed. The ref stays. */
  update(spec: ComponentSpec): void;
  /** The component left the screen. Its last state stays in snapshots as `offPage` until `forget` or the registry's `keepGone` runs out. */
  unregister(): void;
};

/**
 * The components on screen. A module-level default exists so a component can
 * register itself without knowing which agent will read it; tests and
 * multi-window apps make their own.
 */
export class Registry {
  readonly entries = new Map<string, Entry>();
  private n = 0;
  private listeners = new Set<() => void>();
  /** How many unmounted components stay listed as `offPage`. */
  keepGone = 20;

  register(spec: ComponentSpec): Handle {
    const id = `e${++this.n}`;
    const entry: Entry = { id, ref: `c${this.n}`, spec, mounted: true };
    this.entries.set(id, entry);
    this.emit();
    return {
      ref: entry.ref,
      update: (next) => {
        entry.spec = next;
      },
      unregister: () => {
        entry.mounted = false;
        // Freeze its state so a snapshot can still say what it was.
        const frozen = typeof entry.spec.state === "function" ? entry.spec.state() : entry.spec.state;
        entry.spec = { ...entry.spec, state: frozen ?? {}, items: undefined, actions: {} };
        this.trim();
        this.emit();
      },
    };
  }

  private trim() {
    const gone = [...this.entries.values()].filter((e) => !e.mounted);
    for (const e of gone.slice(0, Math.max(0, gone.length - this.keepGone))) this.entries.delete(e.id);
  }

  /** Called when something is registered or leaves. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  clear() {
    this.entries.clear();
    this.emit();
  }
}

export const defaultRegistry = new Registry();

/** Register on the default registry. */
export const registerComponent = (spec: ComponentSpec): Handle => defaultRegistry.register(spec);
