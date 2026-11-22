/** One item a list-like component takes, like a picker's option. */
export type Item = { value: string; label: string };

/** What a component tells the bridge about itself. Everything but `component` and `actions` is optional. */
export type ComponentSpec = {
  /** Its kind, like "switch", "text-field", "picker". */
  component: string;
  /** Its accessible name. What an agent says to name it. */
  label?: string;
  /** Other text on its row, like the member's name beside a menu button. */
  row?: string;
  /** Its state: value, checked, open. A function is read fresh on every snapshot. */
  state?: Record<string, unknown> | (() => Record<string, unknown>);
  /** The things an agent can do to it, by name. Each gets the step's `args`. */
  actions: Record<string, (...args: any[]) => unknown>;
  /** The items it takes, when it is a list. */
  items?: Item[] | (() => Item[]);
  /** A person must make this component's change: the step fails, or waits on `allow`. Say what it does. */
  confirm?: string;
  /** Agents never see it. */
  hidden?: boolean;
  /** Its state keys that are filled but private: they read "[redacted]". `true` redacts all of them. */
  secret?: string[] | true;
  /** Disabled: it lists no actions. */
  disabled?: boolean;
};

/** One component as an agent sees it. */
export type AgentComponent = {
  ref: string;
  component: string;
  label?: string;
  row?: string;
  items?: Item[];
  confirm?: string;
  /** The actions it takes now. None while it is disabled. */
  actions: string[];
  [state: string]: unknown;
};

/** What `snapshot` returns after the last component when the screen is long. */
export type MoreEntry = { ref: "more"; component: "more"; left: number; actions: [] };

/** A step for `act`: a component by ref or label, and one of its actions. */
export type AgentStep = { ref: string; action: string; args?: unknown[] };

/** A step resolved to its component, for `allow` to decide. */
export type AgentAction = {
  ref: string;
  component: string;
  label?: string;
  action: string;
  args: unknown[];
  /** Set when the component says a person must make its change. */
  confirm?: string;
};

export type Allow = (step: AgentAction, ctx: { signal: AbortSignal }) => boolean | Promise<boolean>;

export type StepResult = {
  ref: string;
  action: string;
  ok: boolean;
  /** The action's return value, when it returned one that serialises. */
  returned?: unknown;
  error?: string;
};

export type ActResult = {
  /** One per step that ran, the failed one last. */
  steps: StepResult[];
  /** The state of every component the steps touched, as it is after they ran. */
  values: AgentComponent[];
  /** True when every step ran. */
  ok: boolean;
};
