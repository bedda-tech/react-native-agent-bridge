import { describe, expect, it } from "vitest";
import { main, runDemo } from "../src/demo.js";

describe("npx react-native-agent-bridge demo", () => {
  it("lists the screen, hides and redacts, refuses a confirm step without a person and runs it with one", async () => {
    const lines: string[] = [];
    expect(await runDemo({ out: (l) => lines.push(l), pace: 0 })).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("sk_live_8f2c1d");
    expect(text).not.toContain("Delete project  ");
    expect(text).toContain("refused: Needs a person");
    expect(text).toContain("person taps Allow");
    expect(text).toContain("members now: Jane Doe");
    expect(text).not.toContain("!! expected");
  });

  it("prints usage and exit codes", async () => {
    const err: string[] = [];
    expect(await main([], { out: () => {}, err: (l) => err.push(l) })).toBe(0);
    expect(await main(["nope"], { out: () => {}, err: (l) => err.push(l) })).toBe(2);
    expect(err.join("\n")).toContain("usage:");
  });
});
