// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_15df — memory-equivalent to the frozen oracle at ROM 0x15df.
 * The routine copies the byte at (DE) into (HL) and increments C. In the live loop (loc_1544) DE walks
 * a ROM reload table and HL a run of work-RAM counters; here we point both at work-RAM cells we seed,
 * so the compared memory live-out is the single destination byte. C is a register live-out the caller
 * reads back (loc_1544 does `ld a,c` after the loop), and it is NOT visible to the RAM diff — so EQUAL
 * asserts BOTH the memory copy (ramDiff) AND register C. We push a return address for the oracle's `ret`.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_15df as cand } from "../loc_15df.js";
import { loc_15df as oracle } from "../../translated/loc_15df.js";

const SRC = 0x4390; // seeded source byte (work RAM, outside the masked stack window)
const DST = 0x424b; // destination counter cell (the loc_1544 run lives near 0x424a)
const C_IN = 5;     // running refill tally seeded into C; the oracle's inc c must leave 6
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed(mem8, m) {
  m.push16(0x9999); // return address the oracle's `ret` pops
  m.regs.de = SRC;
  m.regs.hl = DST;
  m.regs.c = C_IN; // running refill tally
  mem8[SRC] = 0x77; // the byte to copy
  mem8[DST] = 0x00; // pre-seed dest so the copy is observable
}

// The refill tally lives in register C, invisible to ramDiff; observe it directly.
function cDiff(twin, e) {
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  return a.regs.c === b.regs.c ? null : `C: ${a.regs.c} vs ${b.regs.c}`;
}

// TEETH: a twin that copies to the wrong cell must be caught by the RAM diff.
function brokenWrongDest(m) {
  m.mem8[DST + 1] = m.mem8[SRC]; // BUG: writes DST+1 instead of DST
}
// TEETH: a twin that writes a wrong value must be caught.
function brokenWrongValue(m) {
  m.mem8[DST] = (m.mem8[SRC] + 1) & 0xff; // BUG: off-by-one value
}
// TEETH: a twin that copies correctly but botches the tally must be caught on register C.
function brokenTally(m) {
  m.mem8[DST] = m.mem8[SRC];
  m.regs.c = (m.regs.c + 2) & 0xff; // BUG: bumps the tally by two
}

test("EQUAL (crafted): loc_15df copies (DE)->(HL) and bumps C", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, craft(seed)), null);
  assert.equal(cDiff(cand, craft(seed)), null, "loc_15df left a different tally in C");
  const a = craft(seed); a.routines = STUBS; oracle(a);
  assert.equal(a.regs.c, C_IN + 1, "non-vacuous: oracle bumped the tally to 6");
});

test("TEETH: wrong destination diverges", { skip }, () => {
  assert.notEqual(ramDiff(oracle, brokenWrongDest, craft(seed)), null);
});

test("TEETH: wrong value diverges", { skip }, () => {
  assert.notEqual(ramDiff(oracle, brokenWrongValue, craft(seed)), null);
});

test("TEETH: wrong tally diverges on register C", { skip }, () => {
  assert.ok(cDiff(brokenTally, craft(seed)), "the wrong-tally twin escaped the register check");
});
