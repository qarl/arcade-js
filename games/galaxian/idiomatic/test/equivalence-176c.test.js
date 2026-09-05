// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_176c — crafted-entry equivalence vs the frozen translated oracle at ROM 0x176c (one sound-sequence
 * channel step). The descriptor pointer is the HL input; all live-out is work RAM (the shadow pair
 * 0x41c0/0x41c1, the tone 0x41d5, the duration timer 0x41d6, the sequence pointer 0x41d3, and the
 * descriptor byte cleared on the end path), so ramDiff covers it fully (stack window masked). Four paths:
 *   IDLE      descriptor byte 0 -> no-op.
 *   RUN       active, timer > 1  -> stage the shadow pair, decrement the timer, no sequence fetch.
 *   END       active, timer hits 0, next command is the end marker -> deactivate the descriptor.
 *   COMMAND   active, timer hits 0, normal command -> advance the cursor, reload tone + duration.
 * Teeth: a no-op (RUN), a descriptor-not-cleared twin (END), and a cursor-not-advanced twin (COMMAND).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_176c as cand } from "../loc_176c.js";
import { loc_176c as oracle } from "../../translated/loc_176c.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const DESC = 0x4100; // descriptor byte (HL) — a scratch work-RAM cell so the clear path is observable
const SHADOW0 = 0x41c0; // output-shadow byte forced to 2 on every active step
const PITCH = 0x41c1; // output-shadow pitch, fed from the current tone
const TONE = 0x41d5; // current tone value
const TIMER = 0x41d6; // duration timer
const SEQ_PTR = 0x41d3; // 16-bit sequence cursor
const CMDPTR = 0x4102; // scratch cell the cursor points at, holding the next command byte
const TONE_TABLE = 0x17a9; // ROM: low-5-bit tone lookup
const DUR_TABLE = 0x17c8; // ROM: high-3-bit duration lookup

// Common seed: active descriptor, a distinctive tone, sentinel shadow bytes, and a ret for the oracle.
function base(mem, m) {
  m.push16(0x9999);
  m.regs.hl = DESC;
  mem[DESC] = 1;
  mem[SHADOW0] = 0xaa;
  mem[PITCH] = 0xaa;
  mem[TONE] = 0x33;
}

const idle = () => craft((mem, m) => { base(mem, m); mem[DESC] = 0; });
const run = () => craft((mem, m) => { base(mem, m); mem[TIMER] = 5; });
const end = () => craft((mem, m) => {
  base(mem, m); mem[TIMER] = 1; m.mem16[SEQ_PTR] = CMDPTR; mem[CMDPTR] = 0xe0;
});
const command = () => craft((mem, m) => {
  base(mem, m); mem[TIMER] = 1; m.mem16[SEQ_PTR] = CMDPTR; mem[CMDPTR] = 0x25; // low5=5 high3=1
});

test("EQUAL (crafted): loc_176c == oracle on all four channel paths", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, idle()), null, "IDLE path diverged");
  assert.equal(ramDiff(oracle, cand, run()), null, "RUN path diverged");
  assert.equal(ramDiff(oracle, cand, end()), null, "END path diverged");
  assert.equal(ramDiff(oracle, cand, command()), null, "COMMAND path diverged");

  // Positive controls: the oracle really moves each path's live-out.
  const i = idle(); oracle(i);
  assert.equal(i.mem8[SHADOW0], 0xaa, "IDLE: shadow must stay untouched");

  const r = run(); oracle(r);
  assert.equal(r.mem8[SHADOW0], 2, "RUN: shadow byte set to 2");
  assert.equal(r.mem8[PITCH], 0x33, "RUN: current tone published to the shadow");
  assert.equal(r.mem8[TIMER], 4, "RUN: timer decremented");

  const e = end(); oracle(e);
  assert.equal(e.mem8[DESC], 0, "END: descriptor deactivated");
  assert.equal(e.mem8[TIMER], 1, "END: timer not stored on the end path");

  const c = command(); oracle(c);
  assert.equal(c.mem16[SEQ_PTR], CMDPTR + 1, "COMMAND: cursor advanced past the byte");
  assert.equal(c.mem8[TONE], c.mem8[TONE_TABLE + 5], "COMMAND: tone reloaded from its table");
  assert.equal(c.mem8[TIMER], c.mem8[DUR_TABLE + 1], "COMMAND: duration reloaded from its table");
  console.log("  EQUAL: loc_176c == oracle across IDLE/RUN/END/COMMAND");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const dontClear = (m) => { cand(m); m.mem8[DESC] = 1; }; // END: leave the descriptor active
  const dontAdvance = (m) => { cand(m); m.mem16[SEQ_PTR] = CMDPTR; }; // COMMAND: rewind the cursor
  assert.ok(ramDiff(oracle, noOp, run()), "no-op twin escaped (RUN)");
  assert.ok(ramDiff(oracle, dontClear, end()), "descriptor-not-cleared twin escaped (END)");
  assert.ok(ramDiff(oracle, dontAdvance, command()), "cursor-not-advanced twin escaped (COMMAND)");
  console.log("  TEETH: no-op, descriptor-not-cleared, cursor-not-advanced all caught");
});
