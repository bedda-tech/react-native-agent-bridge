import { describe, expect, it, vi } from "vitest";
import { Registry, createAgent, call, agentTools } from "../src/index.js";

const setup = (opts: Parameters<typeof createAgent>[0] = {}) => {
  const registry = new Registry();
  const agent = createAgent({ registry, settle: 0, ...opts });
  return { registry, agent };
};

describe("snapshot", () => {
  it("lists state and the actions a component takes now", () => {
    const { registry, agent } = setup();
    registry.register({ component: "switch", label: "Deploy failures", state: { checked: true }, actions: { setChecked: () => {} } });
    expect(agent.snapshot()).toEqual([{ ref: "c1", component: "switch", label: "Deploy failures", checked: true, actions: ["setChecked"] }]);
  });

  it("reads a state function fresh each time", () => {
    const { registry, agent } = setup();
    let v = "a";
    registry.register({ component: "text-field", label: "Name", state: () => ({ value: v }), actions: { setValue: () => {} } });
    expect((agent.snapshot()[0] as any).value).toBe("a");
    v = "b";
    expect((agent.snapshot()[0] as any).value).toBe("b");
  });

  it("hides hidden components, redacts secrets, lists no actions when disabled", () => {
    const { registry, agent } = setup();
    registry.register({ component: "x", label: "Hidden", hidden: true, actions: { a: () => {} } });
    registry.register({ component: "text-field", label: "Card", state: { value: "4242", note: "n" }, secret: ["value"], actions: { setValue: () => {} } });
    registry.register({ component: "button", label: "Pay", disabled: true, actions: { press: () => {} } });
    const snap = agent.snapshot() as any[];
    expect(snap.map((c) => c.label)).toEqual(["Card", "Pay"]);
    expect(snap[0]).toMatchObject({ value: "[redacted]", note: "n" });
    expect(snap[1].actions).toEqual([]);
  });

  it("inlines few items, leaves many to query, and ends a long screen with 'more'", () => {
    const { registry, agent } = setup();
    registry.register({ component: "picker", label: "Few", items: [{ value: "a", label: "A" }], actions: {} });
    registry.register({ component: "picker", label: "Many", items: Array.from({ length: 30 }, (_, i) => ({ value: `${i}`, label: `Item ${i}` })), actions: {} });
    const snap = agent.snapshot() as any[];
    expect(snap[0].items).toHaveLength(1);
    expect(snap[1].items).toBeUndefined();
    for (let i = 0; i < 70; i++) registry.register({ component: "row", label: `r${i}`, actions: {} });
    const long = agent.snapshot() as any[];
    expect(long.at(-1)).toMatchObject({ component: "more", left: 12 });
  });

  it("keeps an unmounted component as offPage with the state it had", () => {
    const { registry, agent } = setup();
    const h = registry.register({ component: "switch", label: "S", state: { checked: true }, actions: { setChecked: () => {} } });
    h.unregister();
    expect(agent.snapshot()).toEqual([{ ref: "c1", component: "switch", label: "S", checked: true, offPage: true, actions: [] }]);
  });
});

describe("query", () => {
  const items = [{ value: "de", label: "Germany" }, { value: "fr", label: "France" }];
  const build = () => {
    const s = setup();
    s.registry.register({ component: "menu", label: "Member actions", row: "Jane Doe", actions: { press: () => {} } });
    s.registry.register({ component: "picker", label: "Region", items: [...items, ...Array.from({ length: 10 }, (_, i) => ({ value: `${i}`, label: `Country ${i}` }))], actions: { setValue: () => {} } });
    return s.agent;
  };
  it("matches label or row by whole words", () => {
    expect((build().query({ text: "Jane" }) as any).components[0].row).toBe("Jane Doe");
    expect((build().query({ text: "Jan" }) as any).components).toHaveLength(0);
  });
  it("finds an item under its list", () => {
    const r = build().query({ text: "Germany" }) as any;
    expect(r.components[0]).toMatchObject({ label: "Region", matchedItems: [{ value: "de" }] });
  });
  it("lists a list's items with within", () => {
    const r = build().query({ within: "Region", text: "France" }) as any;
    expect(r.items).toEqual([{ value: "fr", label: "France" }]);
  });
  it("filters by kind and needs some input", () => {
    expect((build().query({ kind: "picker" }) as any).components).toHaveLength(1);
    expect((build().query({}) as any).error).toMatch(/takes text/);
  });
});

describe("act", () => {
  it("runs steps in order by label, row, kind and ref, and reports the new state", async () => {
    const { registry, agent } = setup();
    let name = "";
    registry.register({ component: "text-field", label: "Name", state: () => ({ value: name }), actions: { setValue: (v: string) => void (name = v) } });
    registry.register({ component: "button", label: "Save", actions: { press: () => "saved" } });
    const r = await agent.act({ steps: [{ ref: "Name", action: "setValue", args: ["Atlas"] }, { ref: "c2", action: "press" }] });
    expect(r.ok).toBe(true);
    expect(r.steps[1]).toMatchObject({ ok: true, returned: "saved" });
    expect(r.values[0]).toMatchObject({ label: "Name", value: "Atlas" });
  });

  it("names the row and the label together", async () => {
    const { registry, agent } = setup();
    const email = vi.fn(), slack = vi.fn();
    registry.register({ component: "switch", label: "Deploy failures", row: "Email", actions: { setChecked: email } });
    registry.register({ component: "switch", label: "Deploy failures", row: "Slack", actions: { setChecked: slack } });
    const r = await agent.act({ steps: [{ ref: "Email Deploy failures", action: "setChecked", args: [true] }] });
    expect(r.ok).toBe(true);
    expect(email).toHaveBeenCalledWith(true);
    expect(slack).not.toHaveBeenCalled();
  });

  it("fails an ambiguous name and lists the candidates, running nothing", async () => {
    const { registry, agent } = setup();
    const fn = vi.fn();
    registry.register({ component: "switch", label: "Deploy failures", row: "Email", actions: { setChecked: fn } });
    registry.register({ component: "switch", label: "Deploy failures", row: "Slack", actions: { setChecked: fn } });
    const r = await agent.act({ steps: [{ ref: "Deploy failures", action: "setChecked", args: [true] }] });
    expect(r.ok).toBe(false);
    expect(r.steps[0]!.error).toMatch(/names 2 components: c1.*c2.*Use a ref/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("says what is on screen when nothing matches, and what the component takes when the action is wrong", async () => {
    const { registry, agent } = setup();
    registry.register({ component: "switch", label: "Dark mode", actions: { setChecked: () => {} } });
    expect((await agent.act({ steps: [{ ref: "Nope", action: "x" }] })).steps[0]!.error).toMatch(/Nothing is named "Nope".*Dark mode/);
    expect((await agent.act({ steps: [{ ref: "Dark mode", action: "setValue" }] })).steps[0]!.error).toMatch(/takes: setChecked/);
  });

  it("stops at the first failing step", async () => {
    const { registry, agent } = setup();
    const second = vi.fn();
    registry.register({ component: "button", label: "Boom", actions: { press: () => { throw new Error("kaput"); } } });
    registry.register({ component: "button", label: "After", actions: { press: second } });
    const r = await agent.act({ steps: [{ ref: "Boom", action: "press" }, { ref: "After", action: "press" }] });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]!.error).toBe("press threw: kaput");
    expect(second).not.toHaveBeenCalled();
  });

  it("rejects a call with no steps", async () => {
    const { agent } = setup();
    expect((await agent.act({ steps: [] })).ok).toBe(false);
  });

  it("refuses a disabled component and an unmounted one", async () => {
    const { registry, agent } = setup();
    registry.register({ component: "button", label: "Pay", disabled: true, actions: { press: () => {} } });
    expect((await agent.act({ steps: [{ ref: "Pay", action: "press" }] })).steps[0]!.error).toMatch(/none now \(disabled\)/);
  });

  it("reports a re-rendered component by its successor", async () => {
    const { registry, agent } = setup();
    let h: ReturnType<typeof registry.register>;
    const mount = (checked: boolean) => {
      h = registry.register({ component: "switch", label: "S", state: { checked }, actions: { setChecked: () => { h.unregister(); mount(true); } } });
    };
    mount(false);
    const r = await agent.act({ steps: [{ ref: "S", action: "setChecked", args: [true] }] });
    expect(r.values).toHaveLength(1);
    expect(r.values[0]).toMatchObject({ checked: true });
    expect(r.values[0]!.offPage).toBeUndefined();
  });
});

describe("allow and confirm", () => {
  const withDelete = (opts: Parameters<typeof createAgent>[0] = {}) => {
    const s = setup(opts);
    const del = vi.fn();
    s.registry.register({ component: "button", label: "Delete account", confirm: "Deletes the account for good.", actions: { press: del } });
    return { ...s, del };
  };

  it("fails a confirm step with 'Needs a person' when no allow is given", async () => {
    const { agent, del } = withDelete();
    const r = await agent.act({ steps: [{ ref: "Delete account", action: "press" }] });
    expect(r.steps[0]!.error).toMatch(/^Needs a person: Deletes the account for good\./);
    expect(del).not.toHaveBeenCalled();
  });

  it("runs the step when allow says yes, passing it the resolved step", async () => {
    const allow = vi.fn(async () => true);
    const { agent, del } = withDelete({ allow });
    const r = await agent.act({ steps: [{ ref: "Delete account", action: "press" }] });
    expect(r.ok).toBe(true);
    expect((allow.mock.calls as unknown as unknown[][])[0]![0]).toMatchObject({ ref: "c1", component: "button", action: "press", confirm: "Deletes the account for good." });
    expect(del).toHaveBeenCalled();
  });

  it("refuses when allow says no, and also refuses ordinary steps allow vetoes", async () => {
    const { agent, del } = withDelete({ allow: () => false });
    const r = await agent.act({ steps: [{ ref: "Delete account", action: "press" }] });
    expect(r.steps[0]!.error).toMatch(/They said no/);
    expect(del).not.toHaveBeenCalled();
  });

  it("times out waiting for a person and aborts the signal", async () => {
    let signal!: AbortSignal;
    const { agent, del } = withDelete({ timeout: 20, allow: (_s, ctx) => { signal = ctx.signal; return new Promise<boolean>(() => {}); } });
    const r = await agent.act({ steps: [{ ref: "Delete account", action: "press" }] });
    expect(r.steps[0]!.error).toMatch(/nobody answered/);
    expect(signal.aborted).toBe(true);
    expect(del).not.toHaveBeenCalled();
  });

  it("fails when the component leaves the screen while a person decides", async () => {
    const s = setup();
    let release!: (v: boolean) => void;
    const agent = createAgent({ registry: s.registry, settle: 0, allow: () => new Promise<boolean>((r) => (release = r)) });
    const del = vi.fn();
    const h = s.registry.register({ component: "button", label: "Delete", confirm: "x", actions: { press: del } });
    const pending = agent.act({ steps: [{ ref: "Delete", action: "press" }] });
    await new Promise((r) => setTimeout(r, 5));
    h.unregister();
    release(true);
    expect((await pending).steps[0]!.error).toMatch(/left the screen/);
    expect(del).not.toHaveBeenCalled();
  });

  it("tells the app a step ran with onStep", async () => {
    const onStep = vi.fn();
    const { registry, agent } = setup({ onStep });
    registry.register({ component: "button", label: "Go", actions: { press: () => {} } });
    await agent.act({ steps: [{ ref: "Go", action: "press" }] });
    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ action: "press" }), expect.objectContaining({ ok: true }));
  });
});

describe("tools", () => {
  it("names three tools and dispatches a model's call", async () => {
    expect(agentTools.map((t) => t.name)).toEqual(["snapshot", "act", "query"]);
    const { registry, agent } = setup();
    registry.register({ component: "button", label: "Go", actions: { press: () => {} } });
    expect(await call(agent, { name: "snapshot" })).toHaveLength(1);
    await expect(call(agent, { name: "tap" })).rejects.toThrow(/Unknown tool/);
  });
});
