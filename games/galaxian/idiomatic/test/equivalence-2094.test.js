// SPDX-License-Identifier: GPL-3.0-only
/**
 * objectGridWalkLoopEpilogue — memory-equivalent to the frozen oracle at ROM 0x2094 (shared loop epilogue of the routeObjectGridCellDraw
 * slot walk). Its base case (B==1 -> djnz not taken -> ret) writes NO RAM; its whole effect is register:
 * the advanced slot pointer HL, the accumulator A, and the count/stride BC left for the routeObjectGridCellDraw head or
 * the loop caller. So the base-case arm asserts BOTH ramDiff==null (no non-stack write) AND the HL/BC/A
 * register live-out via regDiff. The recursive case (B==2 -> djnz taken) delegates through the register
 * bridge into routeObjectGridCellDraw, which walks the remaining slot drawing into the tilemap VRAM page — a sentinel
 * seeds the page so the draw is observable. Teeth: no-op, wrong-stride, wrong-count, wrong-A (registers),
 * and a stale-HL-bridge twin that forgets to re-seat the pointer before delegating (R37).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff as rawRamDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { objectGridWalkLoopEpilogue as cand } from "../objectGridWalkLoopEpilogue.js";
import { loc_2094 as oracle } from "../../translated/loc_2094.js";
import { routeObjectGridCellDraw } from "../routeObjectGridCellDraw.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// The entry is mid-walk: [hl][bc] are the walk's own loop locals (pushed at 0x207d, popped here, re-pushed on
// each djnz pass); the caller's frame starts at the return word above them, so that is the live floor.
const ramDiff = (o, c, e) => rawRamDiff(o, c, e, (e.regs.sp + 4) & 0xffff);

const VRAM_LO = 0x5000; // tilemap VRAM page; the delegated slot draw lands here
const VRAM_HI = 0x5400;
const SENTINEL = 0xee; // pre-poked across the page so each delegated draw is observable (no tile is 0xee)
const STALE_HL = 0x40ff; // a bridge-drop twin delegates with THIS instead of the advanced pointer

// routeObjectGridCellDraw saved BC then HL, so pop hl is on top: push the ret sentinel deepest, then BC, then HL.
function baseEntry(hl, b, c) {
  return craft((mem8, mm) => {
    mm.push16(0x9999); // ret sentinel the terminal ret pops
    mm.push16((b << 8) | c); // BC word (popped second)
    mm.push16(hl); // HL word (popped first)
  });
}

// null == equivalent: non-stack RAM identical AND the HL/BC/A register live-out matches the oracle.
function regDiff(twin, e) {
  const ram = ramDiff(oracle, twin, e);
  if (ram) return `RAM ${ram}`;
  const a = e.clone(); a.routines = STUBS; oracle(a);
  const b = e.clone(); b.routines = STUBS; twin(b);
  if (a.regs.hl !== b.regs.hl) return `HL: 0x${a.regs.hl.toString(16)} vs 0x${b.regs.hl.toString(16)}`;
  if (a.regs.bc !== b.regs.bc) return `BC: 0x${a.regs.bc.toString(16)} vs 0x${b.regs.bc.toString(16)}`;
  if (a.regs.a !== b.regs.a) return `A: 0x${a.regs.a.toString(16)} vs 0x${b.regs.a.toString(16)}`;
  return null;
}

test("EQUAL (base): objectGridWalkLoopEpilogue advances the pointer and spends the count like the oracle", { skip }, () => {
  // B==1 -> djnz not taken -> ret; effect is purely register (advanced HL/A, B spent to 0), no RAM write.
  assert.equal(regDiff(cand, baseEntry(0x5000, 0x01, 0x10)), null, "base-case RAM or registers diverged");
  assert.equal(regDiff(cand, baseEntry(0x42a0, 0x01, 0x08)), null, "base-case diverged (second stride)");
  // non-vacuous: the oracle really advances L by the stride, keeps the page byte, and spends B to 0.
  const a = baseEntry(0x5000, 0x01, 0x10); a.routines = STUBS; oracle(a);
  assert.equal(a.regs.hl, 0x5010, "positive control: L advanced by stride 0x10, page byte kept");
  assert.equal(a.regs.a, 0x10, "positive control: A == advanced low byte");
  assert.equal(a.regs.bc & 0xff, 0x10, "positive control: C (stride) preserved");
  assert.equal(a.regs.bc >> 8, 0x00, "positive control: B spent to 0 by the djnz");
  console.log("  EQUAL: objectGridWalkLoopEpilogue base case advanced HL 0x5000->0x5010, A->0x10, B->0");
});

test("TEETH (base): broken register twins are caught", { skip }, () => {
  const e = () => baseEntry(0x5000, 0x01, 0x10);
  const noOp = () => {};
  const wrongStride = (m) => { cand(m); m.regs.hl = (m.regs.hl - 0x10) & 0xffff; m.regs.a = m.regs.hl & 0xff; };
  const wrongCount = (m) => { cand(m); m.regs.bc = (m.regs.bc + 0x0100) & 0xffff; }; // B not spent
  const wrongA = (m) => { cand(m); m.regs.a = m.regs.a ^ 0xff; }; // right HL/BC, wrong accumulator
  assert.ok(regDiff(noOp, e()), "no-op twin escaped");
  assert.ok(regDiff(wrongStride, e()), "wrong-stride twin escaped (HL/A)");
  assert.ok(regDiff(wrongCount, e()), "wrong-count twin escaped (BC)");
  assert.ok(regDiff(wrongA, e()), "wrong-A twin escaped (register)");
  console.log("  TEETH: no-op, wrong-stride, wrong-count, wrong-A all caught");
});

// The recursive (delegating) entry: B==2, HL at the real slot-table base the walk advances into. A page of
// sentinels makes the delegated slot draw observable; STALE_HL seeds the register bridge so a drop shows.
function recEntry() {
  return craft((mem8, mm) => {
    for (let a = VRAM_LO; a < VRAM_HI; a++) mem8[a] = SENTINEL;
    mm.regs.hl = STALE_HL; // correct code re-seats HL from the pop+advance; a bridge-drop twin keeps this
    mm.push16(0x9999); // ret sentinel
    mm.push16(0x0210); // BC: B=2 slots, C=0x10 stride (drawObjectFigureGridColumn's real loop seed)
    mm.push16(0x4120); // HL: slot-table base; the walk advances it to 0x4130 before delegating
  });
}

// A twin that advances/decrements correctly but FORGETS to re-seat m.regs.hl before delegating (R37): the
// routeObjectGridCellDraw head then reads the stale STALE_HL pointer and draws a different slot into VRAM.
function dropBridge(m) {
  const savedPtr = m.pop16();
  const bc = m.pop16();
  const stride = bc & 0xff;
  const count = ((bc >> 8) - 1) & 0xff;
  const low = (savedPtr + stride) & 0xff;
  const bcOut = (count << 8) | stride;
  return (m.regs.bc = bcOut, m.regs.a = low, count !== 0 ? routeObjectGridCellDraw(m) : undefined);
}

test("EQUAL+TEETH (recursive): objectGridWalkLoopEpilogue bridges HL/BC into routeObjectGridCellDraw and loops equivalently", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, recEntry()), null, "the delegating slot walk diverged from the oracle");
  // non-vacuous: the delegated walk draws into the seeded VRAM page (a no-op twin leaves the sentinel).
  assert.ok(ramDiff(oracle, () => {}, recEntry()), "vacuous: the delegated walk wrote no observable RAM");
  // R37: a twin that delegates with a stale HL bridge draws a different slot -> divergent VRAM.
  assert.ok(ramDiff(oracle, dropBridge, recEntry()), "the stale-HL-bridge twin escaped the RAM diff");
  console.log("  EQUAL+TEETH: objectGridWalkLoopEpilogue delegation equivalent; no-op and stale-bridge twins caught");
});
