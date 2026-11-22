import { describe, expect, it } from "vitest";
import React, { useState } from "react";
import TestRenderer, { act as rAct } from "react-test-renderer";
import { Registry, createAgent } from "../src/index.js";
import { useAgentComponent } from "../src/react.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("useAgentComponent", () => {
  it("registers on mount, acts on current state, and leaves on unmount", async () => {
    const registry = new Registry();
    const agent = createAgent({ registry, settle: 0 });
    function Toggle() {
      const [on, setOn] = useState(false);
      useAgentComponent({ component: "switch", label: "Dark mode", state: { checked: on }, actions: { toggle: () => setOn((v) => !v) } }, registry);
      return React.createElement("view", { on });
    }
    let tree!: TestRenderer.ReactTestRenderer;
    await rAct(async () => { tree = TestRenderer.create(React.createElement(Toggle)); });
    expect(agent.snapshot()).toMatchObject([{ label: "Dark mode", checked: false }]);

    await rAct(async () => { await agent.act({ steps: [{ ref: "Dark mode", action: "toggle" }] }); });
    expect(agent.snapshot()).toMatchObject([{ checked: true }]);
    // A second toggle works from the new state: the action is not stale.
    await rAct(async () => { await agent.act({ steps: [{ ref: "Dark mode", action: "toggle" }] }); });
    expect((agent.snapshot()[0] as any).checked).toBe(false);

    await rAct(async () => { tree.unmount(); });
    expect(agent.snapshot()).toMatchObject([{ label: "Dark mode", offPage: true }]);
  });
});
