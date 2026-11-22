// One project-settings screen, exposed two ways from the same state: through the
// bridge (components registered with their actions) and as the accessibility tree
// a phone agent reads (the text format react-native-device-agent's ScreenSerializer
// produces). The screen follows UI SDK's agent benchmark: three tabs, 24 members
// with a menu on each row, a confirm dialog, switches grouped by channel.
import { Registry } from "../src/index.js";

export type Member = { name: string; role: "member" | "admin" };

export const NAMES = [
  "Ada Lovelace", "Alan Turing", "Grace Hopper", "Priya Shah", "Tom Becker", "Linus Berg", "Mara Ionescu", "Joon Park",
  "Sofia Rossi", "Ken Thompson", "Radia Perlman", "Dennis Ritchie", "Barbara Liskov", "Edsger Dijkstra", "Margaret Hamilton",
  "Leslie Lamport", "Frances Allen", "Donald Knuth", "Shafi Goldwasser", "Vint Cerf", "Katherine Johnson", "Tim Berners",
  "Hedy Lamarr", "John McCarthy",
];

export type Screen = ReturnType<typeof createScreen>;

export function createScreen() {
  const state = {
    tab: "General" as "General" | "Members" | "Notifications",
    name: "Apollo",
    visibility: "Private",
    members: NAMES.map((name): Member => ({ name, role: "member" })),
    dialog: null as null | { title: string; confirm: () => void },
    email: { "Deploy failures": false, "Weekly digest": true, "Billing": true },
    slack: { "Deploy failures": true, "Mentions": true },
    menuOpen: null as null | string,
    pickerOpen: false,
    saves: [] as unknown[],
  };
  const registry = new Registry();
  const handles: { unregister(): void }[] = [];

  /** Re-register what is on screen now; what a React tree does as it renders. */
  function render() {
    handles.splice(0).forEach((h) => h.unregister());
    registry.clear();
    const add = (spec: Parameters<Registry["register"]>[0]) => handles.push(registry.register(spec));
    add({
      component: "tabs", label: "Settings", state: { value: state.tab },
      items: ["General", "Members", "Notifications"].map((v) => ({ value: v, label: v })),
      actions: { setValue: (v: string) => { state.tab = v as typeof state.tab; render(); } },
    });
    add({ component: "button", label: "Save", actions: { press: () => { state.saves.push(snapshotState()); } } });
    if (state.tab === "General") {
      add({ component: "text-field", label: "Project name", state: { value: state.name }, actions: { setValue: (v: string) => { state.name = v; render(); } } });
      add({
        component: "picker", label: "Visibility", state: { value: state.visibility },
        items: ["Private", "Internal", "Public"].map((v) => ({ value: v, label: v })),
        actions: { setValue: (v: string) => { state.visibility = v; render(); } },
      });
    }
    if (state.tab === "Members") {
      for (const m of state.members) {
        add({
          component: "menu", label: "Member actions", row: m.name, state: { role: m.role },
          actions: {
            makeAdmin: () => { m.role = "admin"; render(); },
            remove: () => {
              state.dialog = { title: `Remove ${m.name}?`, confirm: () => { state.members = state.members.filter((x) => x !== m); state.dialog = null; render(); } };
              render();
            },
          },
        });
      }
      if (state.dialog) {
        const d = state.dialog;
        add({ component: "dialog", label: d.title, row: d.title, actions: { remove: () => d.confirm(), cancel: () => { state.dialog = null; render(); } } });
      }
    }
    if (state.tab === "Notifications") {
      for (const [group, sw] of [["Email", state.email], ["Slack", state.slack]] as const) {
        for (const key of Object.keys(sw) as (keyof typeof sw)[]) {
          add({
            component: "switch", label: key as string, row: group, state: { checked: sw[key] },
            actions: { setChecked: (v: boolean) => { (sw as Record<string, boolean>)[key as string] = v; render(); } },
          });
        }
      }
    }
  }

  const snapshotState = () => ({
    name: state.name, visibility: state.visibility,
    admins: state.members.filter((m) => m.role === "admin").map((m) => m.name),
    members: state.members.map((m) => m.name),
    email: { ...state.email }, slack: { ...state.slack },
  });

  // ---- the accessibility-tree view ------------------------------------------------
  type Node = { id: string; cls: string; text?: string; desc?: string; clickable?: boolean; editable?: boolean; checked?: boolean; bounds: [number, number, number, number]; tap?: () => void };
  let nodeN = 0;
  function tree(): Node[] {
    nodeN = 0;
    const out: Node[] = [];
    let y = 80;
    const node = (n: Omit<Node, "id" | "bounds">, h = 56): Node => {
      const full: Node = { ...n, id: String(++nodeN), bounds: [0, y, 1080, y + h] };
      y += h;
      out.push(full);
      return full;
    };
    node({ cls: "TextView", text: "Project settings" });
    for (const t of ["General", "Members", "Notifications"] as const)
      node({ cls: "Button", text: t, clickable: true, tap: () => { state.tab = t; state.menuOpen = null; } });
    if (state.dialog) {
      const d = state.dialog;
      node({ cls: "TextView", text: d.title });
      node({ cls: "Button", text: "Cancel", clickable: true, tap: () => { state.dialog = null; } });
      node({ cls: "Button", text: "Remove", clickable: true, tap: () => d.confirm() });
      return out;
    }
    if (state.tab === "General") {
      node({ cls: "TextView", text: "Project name" });
      node({ cls: "EditText", text: state.name, editable: true, tap: () => {} });
      node({ cls: "TextView", text: "Visibility" });
      node({ cls: "Button", text: state.visibility, clickable: true, tap: () => { state.pickerOpen = !state.pickerOpen; } });
      if (state.pickerOpen)
        for (const v of ["Private", "Internal", "Public"])
          node({ cls: "CheckedTextView", text: v, clickable: true, tap: () => { state.visibility = v; state.pickerOpen = false; } });
    }
    if (state.tab === "Members") {
      for (const m of state.members) {
        node({ cls: "TextView", text: m.name });
        node({ cls: "TextView", text: m.role });
        node({ cls: "Button", desc: `Actions for ${m.name}`, clickable: true, tap: () => { state.menuOpen = state.menuOpen === m.name ? null : m.name; } });
        if (state.menuOpen === m.name) {
          node({ cls: "MenuItem", text: "Make admin", clickable: true, tap: () => { m.role = "admin"; state.menuOpen = null; } });
          node({
            cls: "MenuItem", text: "Remove", clickable: true,
            tap: () => { state.menuOpen = null; state.dialog = { title: `Remove ${m.name}?`, confirm: () => { state.members = state.members.filter((x) => x !== m); state.dialog = null; } }; },
          });
        }
      }
    }
    if (state.tab === "Notifications") {
      for (const [group, sw] of [["Email", state.email], ["Slack", state.slack]] as const) {
        node({ cls: "TextView", text: group });
        for (const key of Object.keys(sw))
          node({ cls: "Switch", text: key, checked: (sw as Record<string, boolean>)[key], clickable: true, tap: () => { (sw as Record<string, boolean>)[key] = !(sw as Record<string, boolean>)[key]; } });
      }
    }
    node({ cls: "Button", text: "Save", clickable: true, tap: () => { state.saves.push(snapshotState()); } });
    return out;
  }

  /** The text react-native-device-agent's ScreenSerializer writes for a tree like this one. */
  function serialize(): string {
    const lines = ["=== SCREEN STATE ==="];
    for (const n of tree()) {
      const flags = [n.clickable && "clickable", n.editable && "editable", n.checked && "checked"].filter(Boolean).join(",");
      lines.push(
        `[node:${n.id}] ${n.cls}${n.text ? ` "${n.text}"` : ""}${n.desc ? ` desc="${n.desc}"` : ""}${flags ? ` (${flags})` : ""} bounds(${n.bounds.join(",")})`
      );
    }
    return lines.join("\n");
  }

  return {
    state, registry, render, snapshotState, serialize,
    tapNode(id: string) { const n = tree().find((x) => x.id === id); if (!n?.tap) throw new Error(`no node ${id}`); n.tap(); },
    setText(id: string, text: string) { const n = tree().find((x) => x.id === id && x.editable); if (!n) throw new Error(`no field ${id}`); state.name = text; },
    findNode(pred: (n: { cls: string; text?: string; desc?: string }) => boolean) { const n = tree().find(pred); if (!n) throw new Error("node not found"); return n.id; },
  };
}
