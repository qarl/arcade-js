// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1060 — equivalent to the frozen path-walk step at ROM 0x1060.
 * Advances one object record (base IX) from a step-table pointer (HL): adds the step byte to the Y
 * field, advances the walk cursor, ticks the move throttle, and — on throttle then leg expiry —
 * advances the dispatch state and reloads the leg's throttle/counter/heading/cursor. Every live-out
 * is a record byte in work RAM (in the state dump); register A and HL are shadow-set scratch discarded
 * by the dispatcher's exx, so a pure ramDiff has full teeth. Paths covered:
 *   - THROTTLE HOLD: throttle > 1, so only Y, cursor and throttle change.
 *   - LEG TICK: throttle expires but the leg survives — heading steps, throttle reloads.
 *   - LEG RESET: throttle and leg both expire — full state advance and reload.
 *   - WRAP: throttle already 0 (dec wraps to 0xff, hold) and a cursor pointer whose low byte wraps.
 * Positive controls: the oracle really moves Y and, on reset, advances the state. Teeth: a no-op, a
 * wrong-Y-delta twin, and a wrong-state twin, all caught by the RAM diff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_1060 as cand } from "../loc_1060.js";
import { loc_1060 as oracle } from "../../translated/loc_1060.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const OBJ = 0x4200; // object record, work RAM, clear of the step cell and the stack
const STEP_CELL = 0x4100; // holds the step-table byte HL points at (kept out of the record)
const STEP = 0x07;

// A crafted entry: record fields seeded, the step byte laid at `ptr`, IX/HL set, and a ret pushed.
function entry({ throttle, leg, ptr = STEP_CELL, y = 0x30, angle = 0x02, state = 0x04 }) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.ix = OBJ; m.regs.hl = ptr;
    mem8[ptr] = STEP;
    mem8[OBJ + 0x04] = y; mem8[OBJ + 0x05] = angle; mem8[OBJ + 0x02] = state;
    mem8[OBJ + 0x10] = throttle; mem8[OBJ + 0x11] = leg; mem8[OBJ + 0x13] = 0x00;
  });
}

function fieldsAfter(e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  return {
    y: a.mem8[OBJ + 0x04], angle: a.mem8[OBJ + 0x05], state: a.mem8[OBJ + 0x02],
    throttle: a.mem8[OBJ + 0x10], leg: a.mem8[OBJ + 0x11], cursor: a.mem8[OBJ + 0x13],
  };
}

test("EQUAL: loc_1060 == oracle on the throttle-hold path", { skip }, () => {
  const e = () => entry({ throttle: 0x05, leg: 0x03 });
  assert.equal(ramDiff(oracle, cand, e()), null, "throttle-hold path diverged");
  const f = fieldsAfter(e());
  assert.equal(f.y, (0x30 + STEP) & 0xff, "positive control: oracle added the step to Y");
  assert.equal(f.throttle, 0x04, "positive control: oracle ticked the throttle");
  console.log("  EQUAL: loc_1060 == oracle (RAM), throttle held");
});

test("EQUAL: loc_1060 == oracle on the leg-tick path", { skip }, () => {
  const e = () => entry({ throttle: 0x01, leg: 0x05 });
  assert.equal(ramDiff(oracle, cand, e()), null, "leg-tick path diverged");
  const f = fieldsAfter(e());
  assert.equal(f.throttle, 0x04, "positive control: oracle reloaded the throttle");
  assert.equal(f.leg, 0x04, "positive control: oracle ticked the leg counter");
  console.log("  EQUAL: loc_1060 == oracle (RAM), leg ticked");
});

test("EQUAL: loc_1060 == oracle on the leg-reset path", { skip }, () => {
  const e = () => entry({ throttle: 0x01, leg: 0x01, state: 0x04 });
  assert.equal(ramDiff(oracle, cand, e()), null, "leg-reset path diverged");
  const f = fieldsAfter(e());
  assert.equal(f.state, 0x05, "positive control: oracle advanced the dispatch state");
  assert.equal(f.angle, 0xf4, "positive control: oracle reset the heading");
  assert.equal(f.cursor, 0x00, "positive control: oracle reset the cursor");
  console.log("  EQUAL: loc_1060 == oracle (RAM), leg reset");
});

test("EQUAL: loc_1060 == oracle on throttle-wrap and cursor-wrap", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry({ throttle: 0x00, leg: 0x03 })), null,
    "throttle-wrap path diverged");
  assert.equal(ramDiff(oracle, cand, entry({ throttle: 0x05, leg: 0x03, ptr: 0x41ff })), null,
    "cursor-wrap path diverged");
  const f = fieldsAfter(entry({ throttle: 0x00, leg: 0x03 }));
  assert.equal(f.throttle, 0xff, "positive control: oracle wrapped the throttle to 0xff");
  const g = fieldsAfter(entry({ throttle: 0x05, leg: 0x03, ptr: 0x41ff }));
  assert.equal(g.cursor, 0x00, "positive control: cursor wrapped from a 0xff low byte");
  console.log("  EQUAL: loc_1060 == oracle (RAM), throttle wrap + cursor wrap");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const badStep = (m) => { cand(m); m.mem8[OBJ + 0x04] = m.mem8[OBJ + 0x04] ^ 0xff; };
  const badState = (m) => { cand(m); m.mem8[OBJ + 0x02] = m.mem8[OBJ + 0x02] ^ 0xff; };
  assert.ok(ramDiff(oracle, noOp, entry({ throttle: 0x05, leg: 0x03 })), "no-op twin escaped");
  assert.ok(ramDiff(oracle, badStep, entry({ throttle: 0x05, leg: 0x03 })), "wrong-Y twin escaped");
  assert.ok(ramDiff(oracle, badState, entry({ throttle: 0x01, leg: 0x01 })), "wrong-state twin escaped");
  console.log("  TEETH: no-op, wrong-Y-delta, wrong-state all caught (RAM)");
});
