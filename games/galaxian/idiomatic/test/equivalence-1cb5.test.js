// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1cb5 — crafted-entry equivalence vs the frozen translated oracle at ROM 0x1cb5 (silence the sound
 * hardware and stop the interrupt/starfield). Every live-out is a board device latch (sound LFO/registers/
 * pitch and the irq/stars control latches), NONE of which appears in the state dump, so ramDiff is blind to
 * them: EQUAL is asserted on the observable io state, and ramDiff==null is asserted separately to prove no
 * work/video/OBJ RAM is touched. The idiomatic form clears the two mapped control latches (irq, stars)
 * directly instead of block-filling the gaps between them; the dropped writes hit unmapped addresses, so
 * the observable io state is identical. Teeth: no-op and wrong-value on the io, plus a RAM-scribble twin.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_1cb5 as cand } from "../loc_1cb5.js";
import { loc_1cb5 as oracle } from "../../translated/loc_1cb5.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const SCRATCH_RAM = 0x4180; // a plain work-RAM cell for the ramDiff-teeth twin

// Seed every latch away from its target value so each move is observable; push a ret for the oracle.
const seeded = () => craft((mem8, m) => {
  m.push16(0x9999);
  for (let i = 0; i < 4; i++) m.io.soundLfo[i] = 9;
  for (let i = 0; i < 8; i++) m.io.soundReg[i] = 9;
  m.io.irqEnable = 1;
  m.io.starsEnable = 1;
  m.io.soundPitchVal = 0;
});

// The live-out is board latches (not in dumpState); snapshot them off the io device.
function ioAfter(fn, entry) {
  const m = entry.clone(); m.routines = STUBS; fn(m);
  return {
    lfo: [...m.io.soundLfo],
    reg: [...m.io.soundReg],
    irq: m.io.irqEnable,
    stars: m.io.starsEnable,
    pitch: m.io.soundPitchVal,
  };
}

test("EQUAL (crafted): loc_1cb5 silences the sound + control latches like the oracle", { skip }, () => {
  const want = { lfo: [1, 1, 1, 1], reg: [0, 0, 0, 0, 0, 0, 0, 0], irq: 0, stars: 0, pitch: 255 };
  assert.deepEqual(ioAfter(oracle, seeded()), want, "positive control: oracle drives the latches to target");
  assert.deepEqual(ioAfter(cand, seeded()), ioAfter(oracle, seeded()), "candidate/oracle io disagree");
  assert.equal(ramDiff(oracle, cand, seeded()), null, "loc_1cb5 wrote RAM the oracle did not");
  console.log("  EQUAL: LFO=1, sound regs=0, irq/stars=0, pitch=255; no RAM touched");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongLfo = (m) => { for (let i = 0; i < 4; i++) m.mem8[0x6004 + i] = 0; }; // 0 not 1
  const wrongPitch = (m) => { cand(m); m.mem8[0x7800] = 0; }; // pitch left at 0
  const scribble = (m) => { cand(m); m.mem8[SCRATCH_RAM] = m.mem8[SCRATCH_RAM] ^ 0xff; };
  assert.notDeepEqual(ioAfter(noOp, seeded()), ioAfter(oracle, seeded()), "no-op twin escaped (io)");
  assert.notDeepEqual(ioAfter(wrongLfo, seeded()), ioAfter(oracle, seeded()), "wrong-LFO twin escaped (io)");
  assert.notDeepEqual(ioAfter(wrongPitch, seeded()), ioAfter(oracle, seeded()), "wrong-pitch twin escaped (io)");
  assert.ok(ramDiff(oracle, scribble, seeded()), "scribble twin escaped (ramDiff teeth)");
  console.log("  TEETH: io no-op + wrong-LFO + wrong-pitch caught, ramDiff scribble caught");
});
