import { useEffect, useRef } from "react";
import { defaultRegistry, type Handle, type Registry } from "./registry.js";
import type { ComponentSpec } from "./types.js";

/**
 * Register a component with the bridge for as long as it is mounted. Call it
 * in the component that owns the state, passing the state and the actions
 * that change it; the spec is refreshed every render, so actions always see
 * current props and state.
 *
 *   const [on, setOn] = useState(false);
 *   useAgentComponent({
 *     component: "switch", label: "Deploy failures",
 *     state: { checked: on },
 *     actions: { setChecked: (v: boolean) => setOn(v) },
 *   });
 */
export function useAgentComponent(spec: ComponentSpec, registry: Registry = defaultRegistry): void {
  const latest = useRef(spec);
  latest.current = spec;
  const handle = useRef<Handle | null>(null);

  useEffect(() => {
    handle.current = registry.register(latest.current);
    return () => {
      handle.current?.unregister();
      handle.current = null;
    };
  }, [registry]);

  // After every commit, point the entry at this render's spec.
  useEffect(() => {
    handle.current?.update(spec);
  });
}
