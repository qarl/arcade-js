// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3114 — memory-equivalent to the frozen oracle at ROM 0x3114.
 *
 * GATE: poked-natural dispatch through unitEquivalence, with a negative control. Three bytes,
 *   `jp 0x307F`, so all a gate can check is that control arrives where the original sends it and
 *   the machine comes out the same — on an entry the GAME produced, no register forced.
 *
 * WHY A POKE. The two `jp nz,0x3114` sites at 0x311D and 0x3129 test the sentinel pair at
 *   0xAD39/0xAD3A that routine 0x15FE plants from an (address, value) table at ROM 0x163F; on an
 *   untampered image both tests pass and the arm is dead, at any frame budget. The poke writes
 *   0x00 over one sentinel from frame 260, and the round-scenery setup then dispatches it itself.
 *
 * ARMS. Negative control: unpoked, it dispatches zero times and the harness throws "never entered".
 *   Equal: RAM and the whole register file identical. Teeth: a no-op and a transfer-elsewhere twin,
 *   both caught in RAM, since entering the destination writes work RAM.
 *
 * HOLE: this proves the rewrite goes where the original goes, not what is there. 0x307F..0x3089 is
 *   a CAPTION RECORD — entry two of the pointer table at 0x0C50: a video-RAM destination, a
 *   colour, then glyphs ending on drawTextRun's 0xB9. So the arm hands control to data, and
 *   against a control poking the sentinel to the value it holds anyway, they end 35 bytes apart.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3114.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3114 } from "../loc_3114.js";
import { loc_3114 as oracle } from "../../translated/loc_3114.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { TAMPER_WITNESS } from "../names.js";

const TARGET = 0x3114;

/** One of the two sentinel bytes the guard tests. Neither is named in names.js. */
const CORRUPT_FROM_FRAME = 260;

const A_REAL_ROUTINE_NEARBY = 0x308a;

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function attract(corrupt) {
  return (overrides) => {
    const m = makeMachine(overrides, { tape: [] });
    if (corrupt) m.pokes = [{ addr: TAMPER_WITNESS, val: 0x00, frame: CORRUPT_FROM_FRAME, dur: null }];
    return m;
  };
}

function gate(candidate, corrupt = true) {
  return unitEquivalence(attract(corrupt), TARGET, oracle, candidate, { maxFrames: ENTRY_FRAMES });
}

test("NEGATIVE CONTROL: with the sentinel intact the game never dispatches it", { skip: SKIP }, () => {
  assert.throws(
    () => gate(loc_3114, false),
    /never entered/,
    "an untampered attract run must not reach this arm — if it does, the poke below proves nothing",
  );
  console.log("  CONTROL: zero dispatches in an untampered attract run");
});

test("EQUAL at the poked dispatch: loc_3114 == oracle on RAM and registers", { skip: SKIP }, () => {
  const r = gate(loc_3114);
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  assert.equal(r.regs, null, `a register diverged — ${JSON.stringify(r.regs)}`);
  assert.equal(r.equal, true, "a bare transfer must reproduce its destination exactly");
  console.log(`  EQUAL: dispatched with ${hex4(TAMPER_WITNESS)} corrupt; RAM and registers identical`);
});

for (const [label, twin] of [
  ["no-op", () => {}],
  ["transfers-elsewhere", (m) => m.call(A_REAL_ROUTINE_NEARBY)],
]) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip: SKIP }, () => {
    const r = gate(twin);
    assert.notEqual(r.ram, null, `the gate PASSED the ${label} twin — it has no teeth`);
    assert.equal(r.equal, false, "a RAM divergence must fail the whole comparison");
    console.log(`  TEETH/${label}: caught — ${show(r.ram)}`);
  });
}
