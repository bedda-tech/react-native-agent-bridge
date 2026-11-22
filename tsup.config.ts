import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", react: "src/react.ts", mcp: "src/mcp.ts", "device-agent": "src/device-agent.ts", bin: "src/bin.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  target: "node20",
  external: ["react"],
});
