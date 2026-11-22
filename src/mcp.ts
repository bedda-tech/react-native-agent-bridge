import { call, agentTools } from "./tools.js";
import type { Agent } from "./agent.js";

type Req = { jsonrpc?: "2.0"; id?: string | number | null; method?: string; params?: any };
export type Res = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const PROTOCOL = "2025-06-18";

/**
 * A Model Context Protocol server for one agent, with no transport of its
 * own: feed it each JSON-RPC message the transport receives, send back what it
 * returns (nothing for notifications). Works over a WebSocket, a local HTTP
 * endpoint or a dev-server relay.
 */
export function createMcpHandler(agent: Agent, info = { name: "react-native-agent-bridge", version: "0.1.0" }) {
  return async function handle(msg: Req): Promise<Res | undefined> {
    const id = msg.id ?? null;
    const ok = (result: unknown): Res => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, message: string): Res => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (msg.id === undefined) return undefined; // notification
    switch (msg.method) {
      case "initialize":
        return ok({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: info });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({
          tools: agentTools.map((t) => ({
            ...t,
            annotations: { readOnlyHint: t.name !== "act", untrustedContentHint: true, consequentialHint: t.name === "act" },
          })),
        });
      case "tools/call": {
        const name = msg.params?.name;
        if (!agentTools.some((t) => t.name === name)) return fail(-32602, `Unknown tool "${String(name)}"`);
        try {
          const out = await call(agent, { name, input: msg.params?.arguments });
          const failed = name === "act" && (out as { ok?: boolean }).ok === false;
          return ok({ content: [{ type: "text", text: JSON.stringify(out) }], isError: failed });
        } catch (e) {
          return ok({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
        }
      }
      default:
        return fail(-32601, `Method not found: ${String(msg.method)}`);
    }
  };
}

/** The part of a WebSocket the helper uses; React Native's global WebSocket fits. */
export type SocketLike = {
  send(data: string): void;
  addEventListener(type: "message", fn: (ev: { data: unknown }) => void): void;
};

/** Serve an agent over a socket the app opened to a relay or test runner. */
export function serveOverSocket(agent: Agent, socket: SocketLike): void {
  const handle = createMcpHandler(agent);
  socket.addEventListener("message", async (ev) => {
    let msg: Req;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const res = await handle(msg);
    if (res) socket.send(JSON.stringify(res));
  });
}
