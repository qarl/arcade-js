// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0331 — memory-equivalent to the frozen oracle at ROM 0x0331 (the shared cascade-countdown tick).
 * GATE: crafted-entry. The routine takes its countdown pointer in HL, so a post-attract seed is cloned,
 * HL pointed at a work-RAM timer cell, a return address pushed for the oracle's `ret`, and the cell(s)
 * poked to drive both paths: still-counting (byte > 1) and expiry (byte == 1, which carries into the
 * next cell). Live-out is memory only (the ROM's advanced L / A / flags are dead), so RAM is compared
 * and the stack window masked. Teeth: no-op, a decrement-without-carry twin, and a carry-into-wrong-cell
 * twin — each makes a RAM difference the diff catches.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { tickCascadeCountdown as cand } from "../tickCascadeCountdown.js";
import { loc_0331 as oracle } from "../../translated/loc_0331.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// Low-tier countdown cell (0x4009); its neighbour 0x400a is the phase counter bumped on expiry.
const TIMER = 0x4009;
const NEXT = TIMER + 1;

// HL = the countdown pointer; push a return address so the oracle's `ret` has a target.
const stillCounting = () => craft((mem, m) => { mem[TIMER] = 3; mem[NEXT] = 0x10; m.regs.hl = TIMER; m.push16(0x9999); });
const expiry = () => craft((mem, m) => { mem[TIMER] = 1; mem[NEXT] = 0x10; m.regs.hl = TIMER; m.push16(0x9999); });

test("EQUAL (crafted): loc_0331 == oracle on tick and on expiry-carry", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, stillCounting()), null, "the still-counting path diverged");
  assert.equal(ramDiff(oracle, cand, expiry()), null, "the expiry/carry path diverged");

  // Positive control: the oracle actually mutates RAM on each path (proves the entries are non-vacuous).
  const a = stillCounting(); oracle(a);
  assert.equal(a.mem8[TIMER], 2, "control: countdown 3->2 on a plain tick");
  assert.equal(a.mem8[NEXT], 0x10, "control: no carry while still counting");
  const b = expiry(); oracle(b);
  assert.equal(b.mem8[TIMER], 0, "control: countdown 1->0 on expiry");
  assert.equal(b.mem8[NEXT], 0x11, "control: next cell 0x10->0x11 carried on expiry");
  console.log("  EQUAL: tick 3->2 (no carry) and expiry 1->0 (carry into 0x400a)");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  // decrements the countdown but never carries into the next cell on expiry.
  const noCarry = (m) => { const { mem8 } = m; mem8[m.regs.hl] = (mem8[m.regs.hl] - 1) & 0xff; };
  // carries into the WRONG cell (ptr+2 instead of ptr+1) on expiry.
  const wrongCell = (m) => {
    const { mem8 } = m; const p = m.regs.hl;
    const v = (mem8[p] - 1) & 0xff; mem8[p] = v;
    if (v === 0) mem8[p + 2] = (mem8[p + 2] + 1) & 0xff;
  };
  assert.ok(ramDiff(oracle, noOp, stillCounting()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, noCarry, expiry()), "no-carry twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, expiry()), "wrong-cell twin escaped");
  console.log("  TEETH: no-op, no-carry, wrong-cell all caught by the RAM diff");
});
