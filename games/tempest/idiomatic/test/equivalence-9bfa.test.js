// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for jumpScriptCursorWhenFlagClear (ROM 0x9bfa) -- bumps counter $10b, and while gate $10c is zero reloads
// $10b from the ROM table $a0f7,Y. Live-out is RAM only (A/Y scratch), so every arm compares RAM (-stack).
// Pure leaf (no dispatch): the seam completes it by omitting the ROM ret. The table read is plain ROM, not
// POKEY, so the crafted arms are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-9bfa.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9bfa } from "../../translated/loc_9bfa.js";
import { jumpScriptCursorWhenFlagClear } from "../jumpScriptCursorWhenFlagClear.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SCRIPT_CURSOR, SCRIPT_BRANCH_FLAG, MOTION_SCRIPT_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9bfa;
const oracle = atEntry(loc_9bfa);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0x9bfa dispatches -- jumpScriptCursorWhenFlagClear == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); jumpScriptCursorWhenFlagClear(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  m.mem8[SCRIPT_CURSOR] = s.counter;
  m.mem8[SCRIPT_BRANCH_FLAG] = s.gate;
}

test("CRAFTED: gated (plain inc) and ungated (table reload) == oracle (RAM -stack)", () => {
  const cases = [
    { tag: "gated: $10c != 0 -> plain inc", counter: 0x10, gate: 0x01 },
    { tag: "ungated: $10c == 0 -> table reload", counter: 0x10, gate: 0x00 },
    { tag: "ungated: counter wraps 0xff -> 0x00 then reload", counter: 0xff, gate: 0x00 },
    { tag: "gated at counter 0xff (wrap, no reload)", counter: 0xff, gate: 0x80 },
  ];
  for (const s of cases) {
    const o = new Machine(ROM, OPTS); seed(o, s);
    const c = new Machine(ROM, OPTS); seed(c, s);
    oracle(o); jumpScriptCursorWhenFlagClear(c);
    assert.equal(ramDiff(o, c), null, `RAM: ${s.tag}`);
  }
});

test("TEETH: a rewrite that ignores the gate (never reloads) diverges from the oracle", () => {
  // Pick an ungated counter where the table value differs from the plain increment, so skipping the
  // reload is observable. Probe the ROM table through a Machine instance to choose it deterministically.
  const probe = new Machine(ROM, OPTS);
  let counter = 0x10;
  for (let cand = 0; cand < 256; cand++) {
    const incd = (cand + 1) & 0xff;
    if (probe.mem8[(MOTION_SCRIPT_TABLE + incd) & 0xffff] !== incd) { counter = cand; break; }
  }
  const s = { counter, gate: 0x00 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const brokenNoReload = (m) => { // BUG: bumps the counter but never applies the table reload
    m.mem8[SCRIPT_CURSOR] = (m.mem8[SCRIPT_CURSOR] + 1) & 0xff;
  };
  brokenNoReload(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a skipped table reload");
});
