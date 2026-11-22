#!/usr/bin/env node
import { main } from "./demo.js";

main(process.argv.slice(2), { out: (l) => process.stdout.write(l + "\n"), err: (l) => process.stderr.write(l + "\n") }).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(String(e instanceof Error ? e.message : e) + "\n");
    process.exit(1);
  },
);
