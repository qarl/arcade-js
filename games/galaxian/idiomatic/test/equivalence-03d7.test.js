// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_03d7 — crafted-entry equivalence vs the frozen gated state-reset.
 * Live-out is memory only: when the gate byte is nonzero it bumps the game-state counter and clears five
 * state/flag cells; a zero gate does nothing. A post-attract seed is cloned, the gate + touched cells poked
 * to distinct values, and a return address laid for the oracle's ret. EQUAL asserts ramDiff==null on the
 * gate-open and gate-closed paths, with a non-vacuous positive control. Teeth: no-op, no-increment,
 * missing-clear, and gate-ignoring twins each make a RAM difference.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { loc_03d7 as cand } from "../loc_03d7.js";
import { loc_03d7 as oracle } from "../../translated/loc_03d7.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const GATE = 0x4002;
const STATE = 0x4005; // game-state counter, bumped
const FRAME = 0x4007;
const SEQ = 0x400a;
const FLAG = 0x41c2;
const SWEEP = 0x41df;
const SCROLL = 0x40b0;

function seedCells(mem) {
  mem[STATE] = 0x05; mem[FRAME] = 0x22; mem[SEQ] = 0x33; mem[FLAG] = 0x44; mem[SWEEP] = 0x55; mem[SCROLL] = 0x66;
}
const gateOpen = () => craft((mem, m) => { m.push16(0x9999); mem[GATE] = 0x01; seedCells(mem); });
const gateClosed = () => craft((mem, m) => { m.push16(0x9999); mem[GATE] = 0x00; seedCells(mem); });

test("EQUAL (crafted): loc_03d7 == oracle on gate-open and gate-closed", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, gateOpen()), null, "the gate-open path diverged");
  assert.equal(ramDiff(oracle, cand, gateClosed()), null, "the gate-closed path diverged");

  // Non-vacuous: gate open bumps the counter and clears the cluster; gate closed leaves everything.
  const a = gateOpen(); oracle(a);
  assert.equal(a.mem8[STATE], 0x06, "control: gate open bumped the game-state counter");
  assert.equal(a.mem8[FRAME], 0, "control: frame flag cleared");
  assert.equal(a.mem8[SWEEP], 0, "control: sweep countdown cleared");
  assert.equal(a.mem8[SCROLL], 0, "control: scroller enable cleared");
  const b = gateClosed(); oracle(b);
  assert.equal(b.mem8[STATE], 0x05, "control: gate closed left the counter untouched");
  console.log("  EQUAL: loc_03d7 == oracle (RAM), gate open bumps+clears, gate closed no-op");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const noBump = (m) => { const { mem8 } = m; mem8[FRAME] = 0; mem8[SEQ] = 0; mem8[FLAG] = 0; mem8[SWEEP] = 0; mem8[SCROLL] = 0; };
  const missClear = (m) => { const { mem8 } = m; mem8[STATE] += 1; mem8[FRAME] = 0; mem8[SEQ] = 0; mem8[FLAG] = 0; mem8[SCROLL] = 0; }; // skips SWEEP
  const ignoreGate = (m) => { m.mem8[STATE] += 1; }; // acts even when the gate is closed
  assert.ok(ramDiff(oracle, noOp, gateOpen()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, noBump, gateOpen()), "the no-increment twin escaped");
  assert.ok(ramDiff(oracle, missClear, gateOpen()), "the missing-clear twin escaped");
  assert.ok(ramDiff(oracle, ignoreGate, gateClosed()), "the gate-ignoring twin escaped");
  console.log("  TEETH: no-op, no-increment, missing-clear, gate-ignoring all caught by the RAM diff");
});
