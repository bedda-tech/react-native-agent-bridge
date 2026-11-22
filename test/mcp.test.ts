import { describe, expect, it } from "vitest";
import { Registry, createAgent } from "../src/index.js";
import { createMcpHandler, serveOverSocket } from "../src/mcp.js";

const build = () => {
  const registry = new Registry();
  registry.register({ component: "button", label: "Go", actions: { press: () => "went" } });
  registry.register({ component: "button", label: "Delete", confirm: "Deletes it.", actions: { press: () => {} } });
  return createMcpHandler(createAgent({ registry, settle: 0 }));
};

describe("mcp handler", () => {
  it("initializes, lists the three tools with act marked consequential", async () => {
    const h = build();
    expect((await h({ id: 1, method: "initialize" }))!.result).toMatchObject({ capabilities: { tools: {} } });
    const list = (await h({ id: 2, method: "tools/list" }))!.result as { tools: { name: string; annotations: any }[] };
    expect(list.tools.map((t) => t.name)).toEqual(["snapshot", "act", "query"]);
    expect(list.tools.find((t) => t.name === "act")!.annotations.consequentialHint).toBe(true);
    expect(list.tools.find((t) => t.name === "snapshot")!.annotations.readOnlyHint).toBe(true);
  });

  it("calls a tool and returns JSON text", async () => {
    const h = build();
    const res = (await h({ id: 3, method: "tools/call", params: { name: "act", arguments: { steps: [{ ref: "Go", action: "press" }] } } }))!.result as any;
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content[0].text).steps[0]).toMatchObject({ ok: true, returned: "went" });
  });

  it("marks a failed act as an error so the model sees it", async () => {
    const h = build();
    const res = (await h({ id: 4, method: "tools/call", params: { name: "act", arguments: { steps: [{ ref: "Delete", action: "press" }] } } }))!.result as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Needs a person/);
  });

  it("answers unknown methods and tools with errors, and notifications with nothing", async () => {
    const h = build();
    expect((await h({ id: 5, method: "nope" }))!.error!.code).toBe(-32601);
    expect((await h({ id: 6, method: "tools/call", params: { name: "tap" } }))!.error!.code).toBe(-32602);
    expect(await h({ method: "notifications/initialized" })).toBeUndefined();
  });

  it("serves over a socket", async () => {
    const sent: string[] = [];
    let fire!: (ev: { data: unknown }) => void;
    serveOverSocket(createAgent({ registry: new Registry() }), { send: (d) => void sent.push(d), addEventListener: (_t, fn) => void (fire = fn) });
    fire({ data: "not json" });
    fire({ data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    await new Promise((r) => setTimeout(r, 5));
    expect(sent.map((s) => JSON.parse(s))).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
  });
});
