// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1733 — crafted-entry equivalence vs the frozen gated-tone tick at ROM 0x1733.
 * Two paths: duration non-zero (0x41ce decremented; tone level = frame flag ^ 1 driven to sound
 * register 5) and duration zero (0 driven to sound register 5, no work-RAM change). The 0x6805 write is
 * memory-mapped I/O (-> io.soundReg[5], NOT in the state dump) and is the routine's whole purpose, so
 * EQUAL asserts BOTH the 0x41ce decrement (ramDiff) AND io.soundReg[5] on each path. RAM compared, stack
 * masked. Teeth (active path): no-op and decrement-by-two twins diverge on 0x41ce; a no-toggle twin
 * (writes the frame flag straight through, skipping ^1) diverges on io.soundReg[5].
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff, STUBS } from "./_bootSetup.js";
import { driveGatedSquareTone as cand } from "../driveGatedSquareTone.js";
import { loc_1733 as oracle } from "../../translated/loc_1733.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const DURATION = 0x41ce;   // remaining tone duration
const FRAME_FLAG = 0x4007; // read-only; its bit 0 ^ 1 becomes the tone level
const SOUND_REG5 = 0x6805; // -> io.soundReg[5]

const active = () => craft((mem) => { mem[DURATION] = 0x05; mem[FRAME_FLAG] = 0x00; });
const spent = () => craft((mem) => { mem[DURATION] = 0x00; mem[FRAME_FLAG] = 0x01; });

// The tone-level write is a board device latch (not in dumpState); read it off the io device.
function reg5After(fn, e) {
  const m = e.clone(); m.routines = STUBS; fn(m); return m.mem.io.soundReg[5];
}

test("EQUAL (crafted): loc_1733 == oracle on active and spent durations", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, active()), null, "the active-tone path diverged");
  assert.equal(ramDiff(oracle, cand, spent()), null, "the spent-tone path diverged");
  assert.equal(reg5After(cand, active()), reg5After(oracle, active()), "active sound-reg write diverged");
  assert.equal(reg5After(cand, spent()), reg5After(oracle, spent()), "spent sound-reg write diverged");

  const a = active().clone(); oracle(a);
  assert.equal(a.mem8[DURATION], 0x04, "duration not decremented");
  assert.equal(a.mem8[FRAME_FLAG], 0x00, "frame flag must be read-only");
  assert.equal(reg5After(oracle, active()), 0x01, "non-vacuous: oracle drives level 1 (flag 0 ^ 1) to reg5");
  console.log("  EQUAL: active decrements 0x41ce 5->4 + reg5=1; spent leaves RAM + drives reg5=0");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const decByTwo = (m) => { // decrements the duration by two instead of one
    const { mem8 } = m;
    const remaining = mem8[DURATION];
    if (remaining !== 0) { mem8[DURATION] = remaining - 2; mem8[SOUND_REG5] = mem8[FRAME_FLAG] ^ 0x01; }
    else mem8[SOUND_REG5] = 0;
  };
  // Decrements correctly but drives the frame flag straight through (skips the ^1 toggle) to reg5.
  const noToggle = (m) => { m.mem8[DURATION] = (m.mem8[DURATION] - 1) & 0xff; m.mem8[SOUND_REG5] = m.mem8[FRAME_FLAG]; };
  assert.ok(ramDiff(oracle, noOp, active()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, decByTwo, active()), "decrement-by-two twin escaped");
  assert.notEqual(reg5After(noToggle, active()), reg5After(oracle, active()), "no-toggle twin escaped (io)");
  console.log("  TEETH: no-op, decrement-by-two (RAM) and no-toggle (io) all caught on the active path");
});
