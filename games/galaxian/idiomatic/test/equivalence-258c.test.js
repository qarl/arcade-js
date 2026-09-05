// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_258c — equivalent to the frozen two-cell-writer tail at ROM 0x258c, with its m.call(0x25a0)
 * DISSOLVED to a direct call of the idiomatic stamp primitive. It stamps the second tile pair (writes
 * A at HL and A+1 at HL+1 in VIDEO RAM, advancing A by two and HL past the pair) and then restores the
 * caller's DE from the stack. Live-outs: the two VRAM cells (in the state dump, checked by ramDiff) AND
 * three registers the still-translated callers consume — DE (popped back to the caller's saved value),
 * A and HL (advanced by the stamp), none visible to the RAM diff. So EQUAL asserts ramDiff==null AND
 * regDiff on DE/A/HL. Positive controls: the oracle really stamps the cells, restores DE (seeded foreign
 * as the stride), and advances A by two. Teeth: a no-stamp twin (RAM), and wrong-DE/A/HL twins (regs).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_258c as cand } from "../loc_258c.js";
import { loc_258c as oracle } from "../../translated/loc_258c.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const DEST = 0x5100;   // VIDEO RAM (0x5000-0x53ff), captured by the state dump
const TILE = 0x40;
const STRIDE = 0x001f; // DE at entry (the stamp's row stride)
const SAVED_DE = 0x1234; // the caller's DE, pushed before the pair; the tail must restore it
const SENTINEL = 0xaa;   // pre-dirtied into the two dest cells so the stamp is observable

// A crafted entry: A/HL/DE staged for the stamp, the saved DE on top of the stack, then the return
// address below it, and the two dest cells pre-dirtied.
function entry() {
  return craft((mem8, m) => {
    m.push16(0x9999);     // loc_258c's eventual return address (below)
    m.push16(SAVED_DE);   // the caller's saved DE (top; the tail pops this)
    m.regs.a = TILE; m.regs.hl = DEST; m.regs.de = STRIDE;
    mem8[DEST] = SENTINEL;
    mem8[(DEST + 1) & 0xffff] = SENTINEL;
  });
}

// DE/A/HL are register live-outs the RAM diff cannot see; compare them directly.
function regDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.de !== b.regs.de) return `DE: 0x${a.regs.de.toString(16)} vs 0x${b.regs.de.toString(16)}`;
  if (a.regs.a !== b.regs.a) return `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
  if (a.regs.hl !== b.regs.hl) return `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
  return null;
}

test("EQUAL: loc_258c == oracle (RAM + DE/A/HL)", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_258c VRAM diverged");
  assert.equal(regDiff(cand, entry()), null, "loc_258c DE/A/HL diverged");
  // Positive controls off the oracle run.
  const a = entry().clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.mem8[DEST], TILE, "oracle did not stamp the first cell");
  assert.equal(a.mem8[DEST + 1], (TILE + 1) & 0xff, "oracle did not stamp the second cell");
  assert.equal(a.regs.de, SAVED_DE, "oracle did not restore the caller's DE");
  assert.equal(a.regs.a, (TILE + 2) & 0xff, "oracle did not advance A by two");
  console.log("  EQUAL: loc_258c == oracle — pair stamped, DE restored, A+2");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noStamp = (m) => { m.regs.de = m.pop16(); };                          // skips the VRAM write
  const badDE = (m) => { cand(m); m.regs.de = (m.regs.de + 1) & 0xffff; };
  const badA = (m) => { cand(m); m.regs.a = (m.regs.a + 1) & 0xff; };
  const badHL = (m) => { cand(m); m.regs.hl = (m.regs.hl + 1) & 0xffff; };
  assert.ok(ramDiff(oracle, noStamp, entry()), "the no-stamp twin escaped (RAM)");
  assert.ok(regDiff(badDE, entry()), "the wrong-DE twin escaped (register)");
  assert.ok(regDiff(badA, entry()), "the wrong-A twin escaped (register)");
  assert.ok(regDiff(badHL, entry()), "the wrong-HL twin escaped (register)");
  console.log("  TEETH: no-stamp (RAM), wrong-DE/A/HL (registers) all caught");
});
