// SPDX-License-Identifier: GPL-3.0-only
/**
 * The done-bar gates' own selftests (no ROM, no MAME, no Chrome): each drives its verdict logic over
 * synthetic inputs with must-FAIL mutants beside a control -- done_gate (DONE.md record, comment floor,
 * long golden, browser runtime, live probe), naming_gate, audio_gate (the tests run, a skipped arm with the
 * ROM present), long_golden (RAM/pixel verdicts, the tape) and input_map_gate (the manifest-vs-MAME
 * comparison). Plus long_render's tape keying through the raw manifest {port, bit}.
 * Run: node --test tools/test/done-bar-selftests.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { tapeAsserts } from "../long_render.mjs";

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

for (const tool of ["done_gate.py", "naming_gate.py", "audio_gate.py", "long_golden.py", "input_map_gate.py"]) {
  test(`${tool} selftest passes`, () => {
    const r = spawnSync("python3", [join(REPO, "tools", tool), "selftest"], { cwd: REPO, encoding: "utf8", timeout: 600_000 });
    assert.equal(r.status, 0, `${tool} selftest failed:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /^selftest OK$/m);
  });
}

test("long_render keys a tape action through the manifest's raw {port, bit}", () => {
  const actions = { coin: { port: 0xc300, bit: 0x01 }, left: { port: 0xc320, bit: 0x01 }, fire: { port: 0xc320, bit: 0x10 } };
  const a = tapeAsserts([[2, 4, ["coin"]], [3, 5, ["left", "fire"]]], actions, 6);
  assert.deepEqual(a.slice(0, 6), [null, null, { 0xc300: 1 }, { 0xc300: 1, 0xc320: 0x11 }, { 0xc320: 0x11 }, null]);
  assert.throws(() => tapeAsserts([[0, 1, ["jump"]]], actions, 2), /not in manifest.inputs.actions/);
});
