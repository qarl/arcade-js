// SPDX-License-Identifier: GPL-3.0-only
//
// The map and comment gates have teeth: each selftest runs its mutants (an invented routine in the
// map, a [code] tag off the grounding-debt list, a module comment contradicting names.js, a rename
// or retired export the map was not threaded for) beside a passing control, and exits non-zero
// when a mutant slips through or a control is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const gate of ["understanding_gate.py", "names_consistency.py"]) {
  test(`${gate} selftest catches its mutants`, () => {
    const r = spawnSync("python3", [join(TOOLS, gate), "selftest"], { encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, `${gate} selftest exit ${r.status}\n${r.stdout}${r.stderr}`);
  });
}
