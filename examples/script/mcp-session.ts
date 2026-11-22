// An MCP client talking to the bridge, the way a test agent would over a socket, against the
// settings screen the benchmark uses. Run: npx tsx examples/script/mcp-session.ts
import { createAgent } from "../../src/index.js";
import { createMcpHandler } from "../../src/mcp.js";
import { createScreen } from "../../bench/screen.js";

const screen = createScreen();
screen.render();
const handle = createMcpHandler(createAgent({ registry: screen.registry, settle: 0 }));

let id = 0;
const rpc = async (method: string, params?: unknown) => (await handle({ jsonrpc: "2.0", id: ++id, method, params }))!.result as any;

console.log("tools:", (await rpc("tools/list")).tools.map((t: { name: string }) => t.name).join(", "));
const out = await rpc("tools/call", {
  name: "act",
  arguments: { steps: [
    { ref: "Project name", action: "setValue", args: ["Atlas"] },
    { ref: "Visibility", action: "setValue", args: ["Internal"] },
    { ref: "Save", action: "press" },
  ] },
});
console.log("isError:", out.isError);
console.log("saved:", JSON.stringify(screen.state.saves.at(-1)).slice(0, 80) + "...");
