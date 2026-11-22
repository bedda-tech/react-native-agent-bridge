// Model-driven benchmark: one model, one task, two tool sets, on a real Android emulator.
//   bridge  = the app's own snapshot / query / act tools, over a socket (MCP, forwarded as-is)
//   a11y    = what a phone agent has today: read the accessibility tree (uiautomator), tap, type, scroll
// Run on the machine that hosts the emulator (needs adb and the bridge-bench app installed):
//   node bench/model/run.ts [runs=3] [model=anthropic/claude-sonnet-5.5] [modes=bridge,a11y]
// Needs OPENROUTER_API_KEY and `ws` (npm i ws). Node 25 runs the .ts directly.
// SCENARIO=live runs one real flow of a production app's branch (sign in, then three switches in Settings) against its
// staging backend instead of the bundled settings screen; it also needs LIVE_URL, LIVE_ANON_KEY,
// LIVE_EMAIL, LIVE_PASSWORD (a staging test account).
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";

const RUNS = Number(process.argv[2] ?? 3);
const MODEL = process.argv[3] ?? "anthropic/claude-sonnet-5.5";
const MODES = (process.argv[4] ?? "bridge,a11y").split(",");
const OUT = process.env.BENCH_OUT ?? "/tmp/bridge-bench-results.json";
const PORT = 8799;
const LIVE = process.env.SCENARIO === "live";
const liveEnv = (k: string) => process.env[k] ?? "";
const PKG = LIVE ? liveEnv("LIVE_PKG") : "ai.bedda.bridgebench";
const ADB = process.env.ADB ?? `${process.env.HOME}/Android/Sdk/platform-tools/adb`;
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) throw new Error("OPENROUTER_API_KEY not set");
const MAX_TURNS = 40;

const TASK = LIVE
  ? "The app is open on the phone and nobody is signed in. Do this: sign in with the email " + liveEnv("LIVE_EMAIL") +
    " and the password " + liveEnv("LIVE_PASSWORD") + "; open the app's Settings (Impostazioni, reached from the profile screen); " +
    "in the privacy section turn ON 'Eventi e offerte' and 'Consigli su misura' and turn OFF 'Trovami nella ricerca'. " +
    "Leave everything else as it is. When all three are set, reply with the single word DONE."
  : "The Project settings app is open on the phone. Do this: rename the project to Atlas; set its visibility to Internal; " +
  "make Priya Shah an admin; remove Tom Becker from the members (it asks you to confirm); in Notifications, turn Email " +
  "'Deploy failures' on and Email 'Weekly digest' off; then Save once. Leave everything else as it is. " +
  "When Save is done, reply with the single word DONE.";

// ---- the app side: a socket for the bridge, an endpoint that records Save -------------------
let saves: any[] = [];
let sock: WebSocket | null = null;
const pending = new Map<number, (v: any) => void>();
let rpcId = 0;
const http = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/saved") {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { saves.push(JSON.parse(b)); } catch {} res.end("ok"); });
  } else res.end("bridge-bench runner");
});
const wss = new WebSocketServer({ server: http, path: "/bridge" });
wss.on("connection", (ws) => {
  sock = ws;
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
});
http.listen(PORT, "0.0.0.0");
const rpc = (method: string, params?: unknown) =>
  new Promise<any>((resolve, reject) => {
    if (!sock) return reject(new Error("app not connected"));
    const id = ++rpcId;
    pending.set(id, resolve);
    sock.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`rpc ${method} timed out`)); }, 30000);
  });

// ---- adb ---------------------------------------------------------------------------------
const adb = (...a: string[]) => execFileSync(ADB, a, { encoding: "utf8", maxBuffer: 20e6 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- Live-app scenario: a staging test account, reset before every run, checked through the backend --------------
const SB = liveEnv("LIVE_URL"), ANON = liveEnv("LIVE_ANON_KEY");
async function sb(path: string, init: RequestInit & { token?: string } = {}) {
  const r = await fetch(`${SB}${path}`, { ...init, headers: { apikey: ANON, "content-type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...(init.headers as object) } });
  if (!r.ok) throw new Error(`staging ${path} ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
async function liveSession() {
  const t = await sb("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: liveEnv("LIVE_EMAIL"), password: liveEnv("LIVE_PASSWORD") }) });
  return { token: t.access_token as string, id: t.user.id as string };
}
async function liveState() {
  const { token, id } = await liveSession();
  const rows = await sb(`/rest/v1/user_consents?select=kind,value&user_id=eq.${id}&order=created_at.desc`, { token });
  const latest: Record<string, boolean> = { marketing: false, personalizzazione: false, addestramento: false };
  const seen = new Set<string>();
  for (const r of rows) { if (!seen.has(r.kind)) { seen.add(r.kind); latest[r.kind] = r.value; } }
  const u = await sb("/rest/v1/rpc/get_my_profile", { method: "POST", token, body: "{}" }); // same call the app makes
  const me = Array.isArray(u) ? u[0] : u;
  return { token, id, latest, searchable: me?.is_searchable !== false, consentRows: rows.length as number };
}
let baselineRows = 0, extraWrites = 0;
/** Put the account in the start state: all three consents off, searchable on. Returns how many consent rows it has. */
async function liveReset() {
  let st = await liveState();
  for (const kind of ["marketing", "personalizzazione", "addestramento"]) {
    if (st.latest[kind]) await sb("/rest/v1/user_consents", { method: "POST", token: st.token, body: JSON.stringify({ user_id: st.id, kind, value: false, doc_version: "reset" }) });
  }
  if (!st.searchable) await sb(`/rest/v1/users?id=eq.${st.id}`, { method: "PATCH", token: st.token, body: JSON.stringify({ is_searchable: true }) });
  st = await liveState();
  baselineRows = st.consentRows;
}

async function freshApp(wantSocket: boolean) {
  sock?.close(); sock = null; saves = [];
  adb("shell", "am", "force-stop", PKG);
  if (LIVE) {
    await liveReset();
    adb("shell", "pm", "clear", PKG); // signed out, first launch
    for (const perm of ["POST_NOTIFICATIONS", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "CAMERA"]) {
      try { adb("shell", "pm", "grant", PKG, `android.permission.${perm}`); } catch {}
    }
  }
  adb("reverse", `tcp:${PORT}`, `tcp:${PORT}`); // not needed for 10.0.2.2, harmless
  adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1");
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    if (wantSocket ? sock : LIVE ? adb("shell", "uiautomator", "dump", "/dev/tty").includes(`package="${PKG}"`) : adb("shell", "uiautomator", "dump", "/dev/tty").includes("Project settings")) break;
    await sleep(1000);
  }
  if (wantSocket && !sock) throw new Error("app never connected");
  await sleep(1500);
}

type Node = { id: number; cls: string; text: string; desc: string; clickable: boolean; editable: boolean; checked: boolean; b: [number, number, number, number] };
function readTree(): Node[] {
  const xml = adb("exec-out", "uiautomator", "dump", "/dev/tty");
  const out: Node[] = [];
  let n = 0;
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const a = (k: string) => (m[0].match(new RegExp(` ${k}="([^"]*)"`))?.[1] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const text = a("text"), desc = a("content-desc"), clickable = a("clickable") === "true", editable = a("class").endsWith("EditText"), checked = a("checked") === "true";
    if (!text && !desc && !clickable && !editable) continue;
    const bm = a("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bm) continue;
    out.push({ id: ++n, cls: a("class").split(".").pop()!, text, desc, clickable, editable, checked, b: [+bm[1], +bm[2], +bm[3], +bm[4]] });
  }
  return out;
}
// Same text format react-native-device-agent's ScreenSerializer writes (and bench/run.ts counts).
function screenText(nodes: Node[]) {
  const lines = ["=== SCREEN STATE ==="];
  for (const x of nodes) {
    const flags = [x.clickable && "clickable", x.editable && "editable", x.checked && "checked"].filter(Boolean).join(",");
    lines.push(`[node:${x.id}] ${x.cls}${x.text ? ` "${x.text}"` : ""}${x.desc ? ` desc="${x.desc}"` : ""}${flags ? ` (${flags})` : ""} bounds(${x.b.join(",")})`);
  }
  return lines.join("\n");
}
let lastNodes: Node[] = [];
const refresh = async () => { await sleep(500); lastNodes = readTree(); return screenText(lastNodes); };
const centre = (x: Node) => [Math.round((x.b[0] + x.b[2]) / 2), Math.round((x.b[1] + x.b[3]) / 2)].map(String);

// ---- the two tool sets -------------------------------------------------------------------
type Tool = { name: string; description: string; parameters: any };
type ToolSet = { tools: Tool[]; run: (name: string, input: any) => Promise<string> };

async function bridgeTools(): Promise<ToolSet> {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bench", version: "0" } });
  const list = (await rpc("tools/list")).result.tools as { name: string; description: string; inputSchema: any }[];
  return {
    tools: list.map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
    async run(name, input) {
      const r = await rpc("tools/call", { name, arguments: input });
      return r.error ? `error: ${r.error.message}` : r.result.content.map((c: any) => c.text).join("\n");
    },
  };
}

function a11yTools(): ToolSet {
  const node = (id: number) => { const x = lastNodes.find((n) => n.id === id); if (!x) throw new Error(`no node ${id} on the last screen`); return x; };
  const obj = (props: any, required: string[]) => ({ type: "object", properties: props, required });
  return {
    tools: [
      { name: "get_screen", description: "Read the current screen as a list of accessibility nodes.", parameters: obj({}, []) },
      { name: "tap", description: "Tap a node by its id. Returns the screen afterwards.", parameters: obj({ node: { type: "number" } }, ["node"]) },
      { name: "type_text", description: "Replace the text of an editable node. Returns the screen afterwards.", parameters: obj({ node: { type: "number" }, text: { type: "string" } }, ["node", "text"]) },
      { name: "scroll", description: "Scroll the screen content. Returns the screen afterwards.", parameters: obj({ direction: { type: "string", enum: ["down", "up"] } }, ["direction"]) },
      { name: "back", description: "Press the Back button. Returns the screen afterwards.", parameters: obj({}, []) },
    ],
    async run(name, input) {
      if (name === "get_screen") return refresh();
      if (name === "tap") { const [x, y] = centre(node(input.node)); adb("shell", "input", "tap", x, y); return refresh(); }
      if (name === "type_text") {
        const n = node(input.node); const [x, y] = centre(n);
        adb("shell", "input", "tap", x, y); await sleep(300);
        adb("shell", "input", "keyevent", "123", ...Array(Math.max(n.text.length, 1) + 2).fill("67"));
        adb("shell", "input", "text", String(input.text).replace(/ /g, "%s"));
        adb("shell", "input", "keyevent", "111"); // close the keyboard
        return refresh();
      }
      if (name === "scroll") {
        const [a, b] = input.direction === "down" ? [1500, 600] : [600, 1500];
        adb("shell", "input", "swipe", "540", String(a), "540", String(b), "300");
        return refresh();
      }
      if (name === "back") { adb("shell", "input", "keyevent", "4"); return refresh(); }
      return `unknown tool ${name}`;
    },
  };
}

// ---- the model loop ----------------------------------------------------------------------
type Result = {
  mode: string; run: number; ok: boolean; why: string; turns: number; toolCalls: number;
  extraWrites: number; promptTokens: number; completionTokens: number; costUsd: number; seconds: number; toolSeconds: number; saves: number; finished: boolean;
};

async function verifyLive(): Promise<{ ok: boolean; why: string }> {
  const st = await liveState();
  const bad: string[] = [];
  if (st.latest.marketing !== true) bad.push("marketing not on");
  if (st.latest.personalizzazione !== true) bad.push("personalizzazione not on");
  if (st.latest.addestramento !== false) bad.push("addestramento changed");
  if (st.searchable !== false) bad.push("still searchable");
  extraWrites = st.consentRows - baselineRows - 2; // consent rows beyond the two that were needed (repeated toggles)
  return { ok: bad.length === 0, why: (bad.join("; ") || "ok") + (extraWrites ? ` (+${extraWrites} extra consent rows)` : "") };
}

function verify(): { ok: boolean; why: string } {
  const r = saves.at(-1);
  if (!r) return { ok: false, why: "never saved" };
  const bad: string[] = [];
  if (r.name !== "Atlas") bad.push(`name=${r.name}`);
  if (r.visibility !== "Internal") bad.push(`visibility=${r.visibility}`);
  if (r.admins.length !== 1 || r.admins[0] !== "Priya Shah") bad.push(`admins=${JSON.stringify(r.admins)}`);
  if (r.members.includes("Tom Becker") || r.members.length !== 23) bad.push(`members=${r.members.length}`);
  if (r.email["Deploy failures"] !== true || r.email["Weekly digest"] !== false || r.email.Billing !== true) bad.push(`email=${JSON.stringify(r.email)}`);
  if (r.slack["Deploy failures"] !== true || r.slack.Mentions !== true) bad.push(`slack=${JSON.stringify(r.slack)}`);
  if (saves.length !== 1) bad.push(`saves=${saves.length}`);
  return { ok: bad.length === 0, why: bad.join("; ") || "ok" };
}

async function chat(messages: any[], tools: Tool[]) {
  const body = {
    model: MODEL, messages, max_tokens: 4096, usage: { include: true },
    tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) return res.json() as Promise<any>;
    if (res.status < 500 && res.status !== 429) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
    await sleep(3000 * (attempt + 1));
  }
  throw new Error("openrouter failed 3 times");
}

async function oneRun(mode: string, run: number): Promise<Result> {
  await freshApp(mode === "bridge");
  const set = mode === "bridge" ? await bridgeTools() : a11yTools();
  if (mode === "a11y") lastNodes = readTree();
  const messages: any[] = [
    { role: "system", content: "You operate a phone app through the tools you are given. Be efficient: do not repeat reads you do not need." },
    { role: "user", content: TASK },
  ];
  const r: Result = { mode, run, ok: false, why: "", turns: 0, toolCalls: 0, extraWrites: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, seconds: 0, toolSeconds: 0, saves: 0, finished: false };
  const t0 = Date.now();
  while (r.turns < MAX_TURNS) {
    const resp = await chat(messages, set.tools);
    r.turns++;
    r.promptTokens += resp.usage?.prompt_tokens ?? 0;
    r.completionTokens += resp.usage?.completion_tokens ?? 0;
    r.costUsd += resp.usage?.cost ?? 0;
    const msg = resp.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) { r.finished = /DONE/i.test(msg.content ?? ""); break; }
    for (const tc of msg.tool_calls) {
      r.toolCalls++;
      const ts = Date.now();
      let out: string;
      try { out = await set.run(tc.function.name, JSON.parse(tc.function.arguments || "{}")); } catch (e) { out = `error: ${(e as Error).message}`; }
      r.toolSeconds += (Date.now() - ts) / 1000;
      messages.push({ role: "tool", tool_call_id: tc.id, content: out });
    }
  }
  r.seconds = (Date.now() - t0) / 1000;
  const v = LIVE ? await verifyLive() : verify();
  r.ok = v.ok; r.why = v.why; r.extraWrites = LIVE ? extraWrites : 0; r.saves = saves.length;
  writeFileSync(`${OUT}.${mode}-${run}.transcript.json`, JSON.stringify(messages, null, 1).split(liveEnv("LIVE_PASSWORD") || "\u0000").join("<test-password>"));
  return r;
}

const results: Result[] = [];
for (let i = 1; i <= RUNS; i++) {
  for (const mode of MODES) {
    try {
      const r = await oneRun(mode, i);
      results.push(r);
      console.log(JSON.stringify(r));
    } catch (e) {
      console.log(JSON.stringify({ mode, run: i, error: (e as Error).message }));
    }
    writeFileSync(OUT, JSON.stringify({ model: MODEL, results }, null, 1));
  }
}
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
console.log("\n| Tools | Correct | Tool calls | Input tokens | Output tokens | Time (s) | Cost (USD) |\n|---|---|---|---|---|---|---|");
for (const mode of MODES) {
  const rs = results.filter((x) => x.mode === mode);
  console.log(`| ${mode} | ${rs.filter((x) => x.ok).length}/${rs.length} | ${med(rs.map((x) => x.toolCalls))} | ${Math.round(med(rs.map((x) => x.promptTokens)))} | ${Math.round(med(rs.map((x) => x.completionTokens)))} | ${med(rs.map((x) => x.seconds)).toFixed(0)} | ${med(rs.map((x) => x.costUsd)).toFixed(4)} |`);
}
http.close(); wss.close(); process.exit(0);
