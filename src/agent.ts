import { defaultRegistry, type Entry, type Registry } from "./registry.js";
import type {
  ActResult,
  AgentAction,
  AgentComponent,
  AgentStep,
  Allow,
  Item,
  MoreEntry,
  StepResult,
} from "./types.js";

const REDACTED = "[redacted]";
/** Past this many components, snapshot ends with a "more" entry and `query` finds the rest. */
const MAX_LISTED = 60;
/** A list with more items than this leaves them out of the snapshot; `query` within it finds them. */
const MAX_INLINE_ITEMS = 8;
const MAX_QUERY_ITEMS = 50;

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const cap = (s: string, n = 200) => (s.length > n ? s.slice(0, n) : s);

export type AgentOptions = {
  registry?: Registry;
  /**
   * Whether a step may run. Return false (or a promise of false) to refuse.
   * `signal` aborts when the step stops waiting, so a confirm the app shows can close.
   * A step on a component with `confirm` set fails with "Needs a person" unless `allow` is given.
   */
  allow?: Allow;
  /** How long a step waits for `allow`, in ms. Default 5 minutes. */
  timeout?: number;
  /** Ms to wait after an action so the app has rendered it. Default 50. */
  settle?: number;
  /** Called after each step that ran, for `on<Key>Change`-style handling: the app can tell the agent did it. */
  onStep?: (step: AgentAction, result: StepResult) => void;
};

export type Agent = ReturnType<typeof createAgent>;

/**
 * The agent bridge. `snapshot` lists what is on screen with its state and the
 * actions it takes now, `query` finds components and list items, `act` runs
 * steps through the components' own actions, many in one call. Same three
 * names and step shape as UI SDK's browser bridge.
 */
export function createAgent(options: AgentOptions = {}) {
  const registry = options.registry ?? defaultRegistry;
  const timeout = options.timeout ?? 5 * 60_000;
  const settle = options.settle ?? 50;

  const stateOf = (e: Entry): Record<string, unknown> => {
    const s = e.spec.state;
    return (typeof s === "function" ? s() : s) ?? {};
  };
  const itemsOf = (e: Entry): Item[] | undefined => {
    const i = e.spec.items;
    return typeof i === "function" ? i() : i;
  };
  const listed = () => [...registry.entries.values()].filter((e) => !e.spec.hidden);

  function describe(e: Entry): AgentComponent {
    const { spec } = e;
    const out: AgentComponent = { ref: e.ref, component: spec.component, actions: [] };
    if (spec.label) out.label = cap(spec.label);
    if (spec.row) out.row = cap(spec.row);
    const st = stateOf(e);
    for (const [k, v] of Object.entries(st)) {
      if (k in out) continue;
      out[k] = spec.secret === true || spec.secret?.includes(k) ? (v == null || v === "" ? v : REDACTED) : v;
    }
    const items = itemsOf(e);
    if (items && items.length <= MAX_INLINE_ITEMS) out.items = items;
    if (spec.confirm) out.confirm = cap(spec.confirm);
    if (!e.mounted) out.offPage = true;
    out.actions = spec.disabled || !e.mounted ? [] : Object.keys(spec.actions);
    return out;
  }

  /** Every component on screen with its state and actions. */
  function snapshot(): (AgentComponent | MoreEntry)[] {
    const all = listed();
    // Components on screen first, gone ones after.
    all.sort((a, b) => Number(!a.mounted) - Number(!b.mounted));
    const out: (AgentComponent | MoreEntry)[] = all.slice(0, MAX_LISTED).map(describe);
    if (all.length > MAX_LISTED) out.push({ ref: "more", component: "more", left: all.length - MAX_LISTED, actions: [] });
    return out;
  }

  /** Find components without listing the screen. `text` matches label or row by whole words, and list items. */
  function query(input: { text?: string; within?: string; kind?: string } = {}) {
    const { text, within, kind } = input;
    if (!text && !within && !kind) return { error: "query takes text, within or kind", components: [] as AgentComponent[] };
    if (within) {
      const target = resolve(within);
      if ("error" in target) return { error: target.error, components: [] as AgentComponent[] };
      const items = itemsOf(target.entry);
      if (!items) return { note: `${within} has no items to list.`, components: [describe(target.entry)] };
      const q = text ? words(text) : [];
      const hit = items.filter((i) => q.every((w) => words(`${i.label} ${i.value}`).includes(w)));
      return { within: target.entry.ref, items: hit.slice(0, MAX_QUERY_ITEMS), total: hit.length, components: [] as AgentComponent[] };
    }
    const q = text ? words(text) : [];
    const found: { c: AgentComponent; via?: Item[] }[] = [];
    for (const e of listed()) {
      if (kind && fold(e.spec.component) !== fold(kind)) continue;
      const own = words(`${e.spec.label ?? ""} ${e.spec.row ?? ""}`);
      const ownHit = q.every((w) => own.includes(w));
      if (ownHit) {
        found.push({ c: describe(e) });
        continue;
      }
      const items = itemsOf(e)?.filter((i) => q.every((w) => words(i.label).includes(w)));
      if (q.length && items?.length) found.push({ c: describe(e), via: items.slice(0, MAX_QUERY_ITEMS) });
    }
    return {
      components: found.slice(0, MAX_LISTED).map(({ c, via }) => (via ? { ...c, matchedItems: via } : c)),
      total: found.length,
    };
  }

  /** By ref first, then by label, row or kind, as exact whole-string matches. */
  function resolve(name: string): { entry: Entry } | { error: string } {
    const byRef = [...registry.entries.values()].find((e) => e.ref === name && !e.spec.hidden);
    if (byRef) return { entry: byRef };
    const f = fold(name);
    const mountedFirst = listed().filter((e) => e.mounted);
    for (const pick of [
      (e: Entry) => fold(e.spec.label ?? "") === f,
      (e: Entry) => fold(e.spec.row ?? "") === f,
      // "Email Deploy failures": the row text and the label together, either way round.
      (e: Entry) => !!e.spec.row && !!e.spec.label && (fold(`${e.spec.row} ${e.spec.label}`) === f || fold(`${e.spec.label} ${e.spec.row}`) === f),
      (e: Entry) => fold(e.spec.component) === f,
      (e: Entry) => !!e.spec.label && words(e.spec.label).join(" ").includes(words(name).join(" ")) && words(name).length > 0,
    ]) {
      const hits = mountedFirst.filter(pick);
      if (hits.length === 1) return { entry: hits[0]! };
      if (hits.length > 1)
        return {
          error: `"${name}" names ${hits.length} components: ${hits.map((h) => `${h.ref} (${h.spec.component}${h.spec.label ? ` "${h.spec.label}"` : ""}${h.spec.row ? `, row "${h.spec.row}"` : ""})`).join("; ")}. Use a ref.`,
        };
    }
    const have = mountedFirst.slice(0, 15).map((e) => `${e.ref} ${e.spec.component}${e.spec.label ? ` "${e.spec.label}"` : ""}`);
    return { error: `Nothing is named "${name}". On screen: ${have.join("; ")}${mountedFirst.length > 15 ? `; and ${mountedFirst.length - 15} more (use query)` : ""}.` };
  }

  async function allowed(step: AgentAction): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!options.allow) {
      return step.confirm
        ? { ok: false, error: `Needs a person: ${step.confirm} Tell them what it does and let them do it.` }
        : { ok: true };
    }
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<"timeout">((r) => {
      timer = setTimeout(() => r("timeout"), timeout);
    });
    try {
      const answer = await Promise.race([Promise.resolve(options.allow(step, { signal: ctl.signal })), waited]);
      if (answer === "timeout") return { ok: false, error: `Not allowed: nobody answered within ${Math.round(timeout / 1000)}s.` };
      return answer ? { ok: true } : { ok: false, error: step.confirm ? `Needs a person: ${step.confirm} They said no.` : "Not allowed." };
    } finally {
      ctl.abort();
      if (timer) clearTimeout(timer);
    }
  }

  function jsonSafe(v: unknown): unknown {
    if (v === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(v));
    } catch {
      return undefined;
    }
  }

  /** Run steps in order, stop at the first that fails and say why. */
  async function act(input: { steps: AgentStep[] }): Promise<ActResult> {
    const steps = input?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      return { steps: [{ ref: "", action: "", ok: false, error: "act takes steps: [{ ref, action, args }]" }], values: [], ok: false };
    }
    const results: StepResult[] = [];
    const touched = new Set<Entry>();
    for (const step of steps) {
      const r: StepResult = { ref: String(step?.ref ?? ""), action: String(step?.action ?? ""), ok: false };
      results.push(r);
      const found = resolve(r.ref);
      if ("error" in found) {
        r.error = found.error;
        break;
      }
      const { entry } = found;
      r.ref = entry.ref;
      const actions = entry.spec.disabled || !entry.mounted ? [] : Object.keys(entry.spec.actions);
      const fn = actions.includes(r.action) ? entry.spec.actions[r.action] : undefined;
      if (!fn) {
        r.error = entry.mounted
          ? `${entry.ref} ${entry.spec.component}${entry.spec.label ? ` "${entry.spec.label}"` : ""} has no action "${r.action}". It takes: ${actions.join(", ") || "none now (disabled)"}.`
          : `${entry.ref} left the screen.`;
        break;
      }
      const args = Array.isArray(step.args) ? step.args : [];
      const resolved: AgentAction = { ref: entry.ref, component: entry.spec.component, action: r.action, args };
      if (entry.spec.label) resolved.label = entry.spec.label;
      if (entry.spec.confirm) resolved.confirm = entry.spec.confirm;
      const verdict = await allowed(resolved);
      if (!verdict.ok) {
        r.error = verdict.error;
        break;
      }
      // The screen can change while a person decides.
      if (!entry.mounted) {
        r.error = `${entry.ref} left the screen while waiting.`;
        break;
      }
      try {
        const returned = await fn(...args);
        const safe = jsonSafe(returned);
        if (safe !== undefined) r.returned = safe;
        r.ok = true;
        touched.add(entry);
        await new Promise((res) => setTimeout(res, settle));
      } catch (e) {
        r.error = `${r.action} threw: ${e instanceof Error ? e.message : String(e)}`;
      }
      options.onStep?.(resolved, r);
      if (!r.ok) break;
    }
    // A screen that re-rendered replaced the components a step touched: report their successors.
    const now = new Map<string, AgentComponent>();
    for (const e of touched) {
      const live = e.mounted
        ? e
        : listed().find((x) => x.mounted && x.spec.component === e.spec.component && x.spec.label === e.spec.label && x.spec.row === e.spec.row);
      if (live) now.set(live.ref, describe(live));
    }
    return { steps: results, values: [...now.values()], ok: results.every((r) => r.ok) && results.length === steps.length };
  }

  return { snapshot, query, act, registry };
}
