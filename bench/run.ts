// Same task, two tool sets, one scripted agent per set. Prints tool calls, text read and an
// estimated token count (characters / 4). No model is involved: this measures what each
// tool set makes an agent READ, not what a model decides. It is a floor for both sides:
// a model needs at least these calls and this text, and usually more.
import { createAgent, call } from "../src/index.js";
import { createScreen, type Screen } from "./screen.js";

type Tally = { calls: number; chars: number };
const tok = (chars: number) => Math.round(chars / 4);

/** Task: rename to Atlas, visibility Internal, Priya Shah admin, remove Tom Becker (confirm), email: Deploy failures on, Weekly digest off, save. */
function check(s: Screen) {
  const r = s.state.saves.at(-1) as ReturnType<Screen["snapshotState"]> | undefined;
  return !!r && s.state.saves.length === 1 && r.name === "Atlas" && r.visibility === "Internal"
    && r.admins.length === 1 && r.admins[0] === "Priya Shah" && !r.members.includes("Tom Becker") && r.members.length === 23
    && r.email["Deploy failures"] === true && r.email["Weekly digest"] === false && r.slack["Deploy failures"] === true && r.slack["Mentions"] === true;
}

async function viaBridge() {
  const s = createScreen();
  s.render();
  const agent = createAgent({ registry: s.registry, settle: 0 });
  const t: Tally = { calls: 0, chars: 0 };
  const run = async (name: string, input?: unknown) => {
    const out = JSON.stringify(await call(agent, { name, input }));
    t.calls++;
    t.chars += out.length + JSON.stringify(input ?? {}).length;
    return out;
  };
  await run("snapshot");
  // Every step the agent can already name goes in one act, as the tool description tells it to,
  // including steps on tabs it has not opened yet.
  await run("act", { steps: [
    { ref: "Project name", action: "setValue", args: ["Atlas"] },
    { ref: "Visibility", action: "setValue", args: ["Internal"] },
    { ref: "Settings", action: "setValue", args: ["Members"] },
    { ref: "Priya Shah", action: "makeAdmin" },
    { ref: "Tom Becker", action: "remove" },
    { ref: "dialog", action: "remove" },
    { ref: "Settings", action: "setValue", args: ["Notifications"] },
    { ref: "Email Deploy failures", action: "setChecked", args: [true] },
    { ref: "Email Weekly digest", action: "setChecked", args: [false] },
    { ref: "Save", action: "press" },
  ] });
  return { s, t };
}

async function main() {
  const b = await viaBridge();

  const a = createScreen();
  const ta: Tally = { calls: 0, chars: 0 };
  // Each tool call is followed by the loop reading the screen again, as AgentLoop does.
  const read = () => { const out = a.serialize(); ta.chars += out.length; return out; };
  const step = (f: () => void, argChars = 40) => { f(); ta.calls++; ta.chars += argChars; read(); };
  read();
  const tapText = (text: string) => step(() => a.tapNode(a.findNode((n) => n.text === text)));
  step(() => a.setText(a.findNode((n) => n.cls === "EditText"), "Atlas"), 60);
  step(() => a.tapNode(a.findNode((n) => n.text === "Private"))); // open picker
  tapText("Internal");
  tapText("Members");
  step(() => a.tapNode(a.findNode((n) => n.desc === "Actions for Priya Shah")));
  tapText("Make admin");
  step(() => a.tapNode(a.findNode((n) => n.desc === "Actions for Tom Becker")));
  tapText("Remove");
  tapText("Remove"); // the dialog's button
  tapText("Notifications");
  // Email's switches come first in the tree, so the first node of that name is Email's.
  const sw = (label: string) => step(() => a.tapNode(a.findNode((n) => n.cls === "Switch" && n.text === label)));
  sw("Deploy failures");
  sw("Weekly digest");
  tapText("Save");

  const rows = [
    ["bridge (snapshot / act)", b.t, check(b.s)],
    ["accessibility tree (tap / type)", ta, check(a)],
  ] as const;
  console.log("| Tools | Tool calls | Text read (chars) | Est. tokens | Correct |");
  console.log("|---|---|---|---|---|");
  for (const [n, t, ok] of rows) console.log(`| ${n} | ${t.calls} | ${t.chars} | ${tok(t.chars)} | ${ok ? "yes" : "NO"} |`);
  console.log(`\nBridge reads ${(ta.chars / b.t.chars).toFixed(1)}x less text than the tree on this screen.`);
}
main();
