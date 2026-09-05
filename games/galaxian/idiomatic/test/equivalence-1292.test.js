// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1292 — crafted-entry equivalence vs the frozen conditional-increment leaf at ROM 0x1292.
 * This routine writes no RAM; its only live-out is register A, bumped by 1 iff BOTH look-ahead object
 * entries (bit 0 of IX+0x20 and IX+0x40) are inactive, else returned untouched. The seed lays a return
 * word for the oracle's `ret`, seats IX at a work-RAM base and A at the incoming count, and pokes the two
 * probed flag bytes. Live-out is checked on RAM (must stay untouched on both sides — stack window masked)
 * AND register A. Non-vacuous: in the both-inactive case the oracle really moves A from 0x30 to 0x31.
 * Teeth: no-op (never bumps), always-bump (ignores the gate), and off-by-one all leave a wrong A.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff, STUBS } from "./_bootSetup.js";
import { loc_1292 as cand } from "../loc_1292.js";
import { loc_1292 as oracle } from "../../translated/loc_1292.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const IX = 0x4200;           // object-table base in work RAM (0x4000-0x43ff), clear of the masked stack
const NEXT = 0x4220;         // IX+0x20 — first look-ahead entry's flag byte
const AFTER = 0x4240;        // IX+0x40 — second look-ahead entry's flag byte
const COUNT = 0x30;          // incoming running count in A

// A crafted entry: return word for the oracle's ret, IX seated, A = count, and the two probed flag bytes
// poked to `next`/`after` (bit 0 = active). Neither the oracle nor the candidate writes RAM.
function entry(next, after, count = COUNT) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.ix = IX;
    m.regs.a = count;
    mem8[NEXT] = next;
    mem8[AFTER] = after;
  });
}

// null == equivalent on the live-out: RAM untouched (stack masked by ramDiff) AND register A.
function aDiff(twin, e) {
  const ram = ramDiff(oracle, twin, e);
  if (ram) return `RAM ${ram}`;
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.a !== b.regs.a) return `A: ${a.regs.a} vs ${b.regs.a}`;
  return null;
}

test("EQUAL (crafted): loc_1292 == oracle on register A across the gate", { skip }, () => {
  const cases = [
    [0x00, 0x00], // both inactive -> A bumped
    [0x01, 0x00], // first active  -> A untouched
    [0x00, 0x01], // second active -> A untouched
    [0x01, 0x01], // both active   -> A untouched
    [0xfe, 0x02], // even flag bytes read as inactive (bit 0 clear) -> A bumped
  ];
  for (const [next, after] of cases) {
    assert.equal(aDiff(cand, entry(next, after)), null,
      `loc_1292 diverged (next=0x${next.toString(16)} after=0x${after.toString(16)})`);
  }
  // non-vacuous: the both-inactive case actually moves A from 0x30 to 0x31.
  const a = entry(0x00, 0x00).clone(); a.routines = STUBS; oracle(a);
  assert.equal(a.regs.a, 0x31, "oracle did not bump A in the both-inactive case");
  console.log("  EQUAL: loc_1292 == oracle on A; gate honoured, no RAM touched");
});

test("TEETH: broken twins are caught on register A", { skip }, () => {
  const noBump = (m, count = m.regs.a) => { m.regs.a = count; };               // never increments
  const alwaysBump = (m, count = m.regs.a) => { m.regs.a = (count + 1) & 0xff; }; // ignores the gate
  const offByOne = (m, count = m.regs.a) => { m.regs.a = (count + 2) & 0xff; };   // wrong step

  // no-bump escapes the untouched cases but must fail the both-inactive case.
  assert.ok(aDiff(noBump, entry(0x00, 0x00)), "no-bump twin escaped the both-inactive case");
  // always-bump matches both-inactive but must fail whenever a look-ahead entry is active.
  assert.ok(aDiff(alwaysBump, entry(0x01, 0x00)), "always-bump twin escaped the first-active case");
  assert.ok(aDiff(alwaysBump, entry(0x00, 0x01)), "always-bump twin escaped the second-active case");
  // off-by-one must fail the both-inactive case.
  assert.ok(aDiff(offByOne, entry(0x00, 0x00)), "off-by-one twin escaped");
  console.log("  TEETH: no-bump, always-bump, off-by-one all caught on A");
});
