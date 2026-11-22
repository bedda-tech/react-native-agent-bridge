import { describe, expect, it } from "vitest";
import { BRIDGE_UNAVAILABLE, bridgeToolDefinitions, registerBridgeTools, type DeviceAgentTool } from "../src/device-agent.js";

const fakeRegistry = () => {
  const handlers = new Map<string, (a: Record<string, unknown>) => Promise<unknown>>();
  return { handlers, register: (t: DeviceAgentTool, h: (a: Record<string, unknown>) => Promise<unknown>) => void handlers.set(t.name, h) };
};

describe("device-agent glue", () => {
  it("defines app_snapshot, app_act and app_query in the device agent's tool shape", () => {
    expect(bridgeToolDefinitions.map((t) => t.name)).toEqual(["app_snapshot", "app_act", "app_query"]);
    const act = bridgeToolDefinitions.find((t) => t.name === "app_act")!;
    expect(act.parameters).toMatchObject({ type: "object", properties: { steps: { type: "array" } }, required: ["steps"] });
  });

  it("forwards to the client and strips the prefix", async () => {
    const r = fakeRegistry();
    const seen: unknown[] = [];
    registerBridgeTools(r, async (name, input) => (seen.push([name, input]), { ok: 1 }));
    expect(await r.handlers.get("app_query")!({ text: "x" })).toEqual({ ok: 1 });
    expect(seen).toEqual([["query", { text: "x" }]]);
  });

  it("answers 'unavailable' when the app has no bridge, by null or by throwing", async () => {
    const a = fakeRegistry();
    registerBridgeTools(a, async () => null);
    expect(await a.handlers.get("app_snapshot")!({})).toBe(BRIDGE_UNAVAILABLE);
    const b = fakeRegistry();
    registerBridgeTools(b, async () => { throw new Error("ECONNREFUSED"); });
    expect(await b.handlers.get("app_act")!({ steps: [] })).toBe(BRIDGE_UNAVAILABLE);
  });
});
