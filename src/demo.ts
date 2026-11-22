import { createAgent } from "./agent.js";
import { Registry } from "./registry.js";
import type { AgentAction, AgentComponent } from "./types.js";

export interface DemoIO {
  out: (line: string) => void;
  /** Pause between steps, in ms. Tests pass 0. */
  pace?: number;
  /** Redraw the screen between sections (given only on a terminal) so the last frame fits 92x30. */
  clear?: () => void;
}

/** Wrap `text` at 88 columns under a two-space indent, so a line never wraps in a 92-column terminal. */
const wrap = (text: string, indent = "  "): string[] => {
  const lines: string[] = [];
  let cur = indent;
  for (const w of text.split(" ")) {
    if (cur.length + w.length + 1 > 88 && cur.trim()) {
      lines.push(cur.trimEnd());
      cur = indent;
    }
    cur += (cur === indent ? "" : " ") + w;
  }
  lines.push(cur);
  return lines;
};

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** A "Project settings" screen as React Native components would register it, with no device and no React. */
function settingsScreen() {
  const registry = new Registry();
  const state = { name: "Apollo", visibility: "Private", deploy: false, digest: true, token: "sk_live_8f2c1d", members: ["Jane Doe", "Tom Becker"], saved: 0 };
  const mount = () => {
    registry.clear();
    registry.register({ component: "text-field", label: "Project name", state: () => ({ value: state.name }), actions: { setValue: (v: string) => (state.name = v) } });
    registry.register({
      component: "picker",
      label: "Visibility",
      state: () => ({ value: state.visibility }),
      items: [{ value: "Private", label: "Private" }, { value: "Internal", label: "Internal" }, { value: "Public", label: "Public" }],
      actions: { setValue: (v: string) => (state.visibility = v) },
    });
    registry.register({ component: "switch", label: "Deploy failures", row: "Email", state: () => ({ checked: state.deploy }), actions: { setChecked: (v: boolean) => (state.deploy = v) } });
    registry.register({ component: "switch", label: "Weekly digest", row: "Email", state: () => ({ checked: state.digest }), actions: { setChecked: (v: boolean) => (state.digest = v) } });
    registry.register({ component: "text-field", label: "API token", state: () => ({ value: state.token }), secret: true, actions: { setValue: (v: string) => (state.token = v) } });
    for (const m of state.members) {
      registry.register({
        component: "button",
        label: "Remove",
        row: m,
        confirm: `Removes ${m} from the project. Cannot be undone from the app.`,
        actions: {
          press: () => {
            state.members = state.members.filter((x) => x !== m);
            mount();
          },
        },
      });
    }
    registry.register({ component: "button", label: "Delete project", hidden: true, actions: { press: () => (state.name = "(deleted)") } });
    registry.register({ component: "button", label: "Save", actions: { press: () => (state.saved += 1) } });
  };
  mount();
  return { registry, state };
}

const brief = (c: AgentComponent) => {
  const { ref, component, label, row, actions, items, confirm, ...rest } = c as AgentComponent & Record<string, unknown>;
  void items;
  const bits = Object.entries(rest).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  return `  ${String(ref).padEnd(3)} ${String(component).padEnd(10)} ${`${row ? row + " / " : ""}${label ?? ""}`.padEnd(24)} ${bits.join(" ").padEnd(18)} ${confirm ? "[needs a person] " : ""}${(actions as string[]).join(",")}`;
};

/**
 * `npx react-native-agent-bridge demo`: an agent reads a settings screen and drives it through the components' own actions.
 * The caller is a script, not a model (no key, no device, no network): it shows what the three tools return and how
 * `confirm`, `secret` and `hidden` behave. Returns 0 when every step behaved as documented.
 */
export async function runDemo({ out, pace = 1800, clear }: DemoIO): Promise<number> {
  const { registry, state } = settingsScreen();
  let approvals = 0;
  const askPerson = async (step: AgentAction) => {
    if (!step.confirm) return true; // only what the app marked `confirm` needs a person
    approvals++;
    wrap(`phone> "${step.confirm}"`).forEach((l) => out(l));
    out("  [Allow] [Deny]   -> person taps Allow");
    return true;
  };
  const withoutPerson = createAgent({ registry, settle: 0 });
  const agent = createAgent({ registry, settle: 0, allow: askPerson });
  let ok = true;
  const check = (cond: boolean, what: string) => {
    if (!cond) {
      ok = false;
      out(`  !! expected: ${what}`);
    }
  };

  out("react-native-agent-bridge demo: an agent drives a React Native screen by its components");
  out("A fixture Project settings screen, no device and no model: a script plays the agent.\n");
  await sleep(pace);

  out("agent> snapshot()");
  const snap = withoutPerson.snapshot() as AgentComponent[];
  snap.forEach((c) => out(brief(c)));
  out(`  (${snap.length} components listed. The "Delete project" button is hidden from agents.)`);
  check(!snap.some((c) => c.label === "Delete project"), "hidden component not listed");
  check(snap.find((c) => c.label === "API token")?.value === "[redacted]", "secret reads [redacted]");
  await sleep(pace);

  clear?.();
  out('agent> act: one call, three steps, by the words in the task');
  const r1 = await withoutPerson.act({
    steps: [
      { ref: "Project name", action: "setValue", args: ["Atlas"] },
      { ref: "Visibility", action: "setValue", args: ["Internal"] },
      { ref: "Email Deploy failures", action: "setChecked", args: [true] },
    ],
  });
  r1.values.forEach((c) => out(`  ${c.label}: ${JSON.stringify(c.value ?? c.checked)}`));
  check(r1.ok && state.name === "Atlas" && state.visibility === "Internal" && state.deploy, "three steps ran");
  await sleep(pace);

  out('\nagent> act: remove Tom Becker   (the app marked this confirm)');
  const r2 = await withoutPerson.act({ steps: [{ ref: "Tom Becker", action: "press" }] });
  wrap(`refused: ${r2.steps.at(-1)?.error}`).forEach((l) => out(l));
  check(!r2.ok && state.members.includes("Tom Becker"), "confirm step refused without a person");
  await sleep(pace);

  out("\nagent> same step, with an allow callback that asks the person on the device");
  const r3 = await agent.act({ steps: [{ ref: "Tom Becker", action: "press" }, { ref: "Save", action: "press" }] });
  out(`  ran: ${r3.steps.map((s) => `${s.action} ${s.ref}`).join(", ")}   members now: ${state.members.join(", ")}   saved: ${state.saved}`);
  check(r3.ok && !state.members.includes("Tom Becker") && approvals === 1 && state.saved === 1, "approved step ran once");
  await sleep(pace);

  clear?.();
  out('agent> query({ text: "Jane" })');
  const q = withoutPerson.query({ text: "Jane" });
  q.components.forEach((c) => out(brief(c)));
  check(q.components.length === 1, "one match for Jane");
  out('\nagent> act on a name that is not there: "Remove all"');
  const r4 = await withoutPerson.act({ steps: [{ ref: "Remove all", action: "press" }] });
  wrap(`${r4.steps.at(-1)?.error?.slice(0, 120)}...`).forEach((l) => out(l));
  check(!r4.ok, "unknown name fails and lists what is there");

  out("");
  wrap("Put it in your app: useAgentComponent({ component, label, state, actions }) in each component (react-native-agent-bridge/react).", "").forEach((l) => out(l));
  out("Measured with a real model on an Android emulator: see the table in the README.");
  return ok ? 0 : 1;
}

export async function main(argv: string[], io: { out: (l: string) => void; err: (l: string) => void }): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "demo") {
    const at = rest.indexOf("--pace");
    const pace = at >= 0 ? Number(rest[at + 1]) : undefined;
    return runDemo({ out: io.out, ...(process.stdout.isTTY ? { clear: () => process.stdout.write("\x1b[2J\x1b[H") } : {}), ...(pace !== undefined && Number.isFinite(pace) ? { pace } : {}) });
  }
  io.err("usage: react-native-agent-bridge demo [--auto] [--pace ms]\n  demo   a script reads and drives a fixture React Native screen through the bridge (no device, no model, no key)");
  return cmd === undefined || cmd === "help" || cmd === "--help" ? 0 : 2;
}
