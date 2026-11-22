import { agentTools } from "./tools.js";

/**
 * The glue for react-native-device-agent (the accessibility-tree phone agent).
 * It prefers the app's bridge tools when the foreground app exposes them and
 * says plainly when it does not, so the loop falls back to the screen tree.
 * Structurally typed: nothing here imports react-native-device-agent.
 */

/** Sends one MCP-style tool call to the foreground app's bridge. Reject or return null when none is listening. */
export type BridgeClient = (name: "snapshot" | "query" | "act", input: unknown) => Promise<unknown | null>;

/** react-native-device-agent's `Tool`. */
export type DeviceAgentTool = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, { type: "string" | "number" | "boolean" | "object" | "array"; description?: string }>; required?: string[] };
};

export const BRIDGE_UNAVAILABLE = {
  available: false,
  hint: "This app does not expose agent tools. Use the screen tools (read the screen, tap) instead.",
} as const;

const params = (t: (typeof agentTools)[number]): DeviceAgentTool["parameters"] => {
  const props = (t.inputSchema.properties ?? {}) as Record<string, { type?: string; description?: string }>;
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, { type: (v.type ?? "string") as "string", ...(v.description ? { description: v.description } : {}) }])
    ),
    ...(t.inputSchema.required ? { required: t.inputSchema.required } : {}),
  };
};

/** Tool definitions with the `app_` prefix, so they sit beside the phone tools without a name clash. */
export const bridgeToolDefinitions: DeviceAgentTool[] = agentTools.map((t) => ({
  name: `app_${t.name}`,
  description: t.description,
  parameters: params(t),
}));

/**
 * Register the bridge tools on a device-agent ToolRegistry (anything with
 * `register(tool, handler)`). Each handler returns BRIDGE_UNAVAILABLE when the
 * client cannot reach a bridge, which tells the model to use screen tools.
 */
export function registerBridgeTools(
  registry: { register(tool: DeviceAgentTool, handler: (args: Record<string, unknown>) => Promise<unknown>): void },
  client: BridgeClient
): void {
  for (const def of bridgeToolDefinitions) {
    const name = def.name.slice(4) as "snapshot" | "query" | "act";
    registry.register(def, async (args) => {
      try {
        const out = await client(name, args);
        return out == null ? BRIDGE_UNAVAILABLE : out;
      } catch {
        return BRIDGE_UNAVAILABLE;
      }
    });
  }
}

/** One line for the system prompt. */
export const BRIDGE_PROMPT =
  "If app_snapshot answers, drive the app with app_act and app_query: they call its components directly and cost a fraction of reading the screen. Only when app_snapshot says the app exposes no agent tools, read the screen and tap.";
