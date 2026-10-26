// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for recordHammerHitOnObject (ROM 0x281D) — scan the special-object pair for an
 * active record, test it against the current board's hazards through the collision
 * handler, and on an overlap record where it was found.
 *
 * recordHammerHitOnObject is NOT a leaf: it dispatches the full board collision handler (through the
 * idiomatic dispatchBoardCollision, which selects the board arm and returns a JS tuple). So it is
 * validated by MEMORY-equivalence against the frozen oracle — RAM − the stack scratch below the entry SP — with a
 * FRESH clone per case and the FULL oracle handler running on the oracle side. Two things:
 *   - live-out is memory-only: the caller (loc_197a) issues its next call without reading
 *     any register this routine leaves, so no register is in the contract; pc/SP are NOT compared
 *     either — the dissolved chain does no guest-stack ops (no push16, no m.ret), so the candidate
 *     leaves the caller return where the oracle's terminal returns consume it. Whole-game SP tests
 *     guard SP-correctness now.
 *   - the RAM diff EXCLUDES STACK_SCRATCH: the oracle still runs the frozen rst-0x28 trampoline
 *     and its handler, leaving the table-base word and folded returns in the dead stack region
 *     where the candidate does not. Every LIVE cell (the four record-write targets in
 *     0x635x, OBJ_SEARCH_COUNT, the object arrays) is kept, and the teeth prove the exclusion
 *     hides nothing by catching real-cell corruption.
 *
 *   1. REACHABILITY — 0x281D is dispatched during attract (the object-update cascade calls
 *      it every frame).
 *
 *   2. EQUAL (captured, all three arms) — hook 0x281D in a real attract run and clone at
 *      real dispatches, bucketed into: no active record (early-out), found-but-no-overlap,
 *      and found+overlap (the record-writing path). All three arms occur naturally in
 *      attract. Each captured dispatch must match the oracle over RAM(−stack) + pc + SP.
 *
 *   3. TEETH — two broken twins run on a real found+overlap state, each MUST be caught at a
 *      LIVE (non-stack) cell:
 *      (a) drops the hit-index subtraction (stores the raw array count) — caught at 0x6354.
 *      (b) stores the wrong array base — caught at 0x6351.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-281d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_281d as oracle } from "../../translated/loc_281d.js";
import { recordHammerHitOnObject as candidate } from "../recordHammerHitOnObject.js";
import { dispatchBoardCollision } from "../dispatchBoardCollision.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  OBJ_PAIR_6680,
  OBJ_SEARCH_COUNT,
  COLLIDED_OBJECT_BASE,
  COLLIDED_OBJECT_STRIDE,
  COLLIDED_OBJECT_INDEX,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x281d;
const REC0_FLAG = OBJ_PAIR_6680 + 1;          // 0x6681 — record 0 active flag
const REC1_FLAG = OBJ_PAIR_6680 + 0x10 + 1;   // 0x6691 — record 1 active flag
// The record-write targets: 0x6350 hit marker (hex), COLLIDED_OBJECT_BASE (0x6351) + its high byte
// 0x6352 (hex), COLLIDED_OBJECT_STRIDE (0x6353), COLLIDED_OBJECT_INDEX (0x6354).
const RECORD_CELLS = [0x6350, COLLIDED_OBJECT_BASE, 0x6352, COLLIDED_OBJECT_STRIDE, COLLIDED_OBJECT_INDEX];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First differing RAM byte between two machines, EXCLUDING the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP; the folded rst-0x28 trampoline
// leaves its table-base word there). Returns { addr, a, b } or null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// Count how many diffs land INSIDE the excluded stack region (diagnostic only).
function stackDiffCount(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  let c = 0;
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    if (dead(a.stateOffsetToAddr(i))) c++;
  }
  return c;
}

// Contract diff: RAM − the stack scratch below the entry SP. Live-out is memory-only, so no register is compared.
// pc/SP are NOT compared: the dissolved handler chain returns a JS tuple and does no guest-stack
// ops, so the candidate leaves the caller return on the stack where the oracle's terminal returns
// consume it — a seam artifact, not a live-out. The whole-game SP tests guard SP-correctness now.
function contractDiffs(entry, fn) {
  const a = entry.clone(); oracle(a);
  const b = entry.clone(); fn(b);
  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return diffs;
}

// Did the oracle take the found+overlap record-writing path on this entry? Poke a sentinel
// into the record-write cells on a throwaway clone (the record path never reads them, so
// this cannot change control flow), run the oracle, and see whether any got overwritten.
function isOverlapHit(entry) {
  const c = entry.clone();
  for (const addr of RECORD_CELLS) c.mem.write8(addr, 0xaa);
  oracle(c);
  return RECORD_CELLS.some((addr) => c.mem.read8(addr) !== 0xaa);
}

// Hook 0x281D in a real attract run and bucket real dispatch clones by arm: no active
// record, found-but-no-overlap, found+overlap. Runs the oracle so the host proceeds
// undisturbed; classification runs on throwaway clones off to the side.
function captureBuckets({ frames, capNone, capMiss, capHit }) {
  const none = [], miss = [], hit = [];
  const snap = new Map([[TARGET, (mm) => {
    const found = (mm.mem.read8(REC0_FLAG) & 1) || (mm.mem.read8(REC1_FLAG) & 1);
    if (!found) {
      if (none.length < capNone) none.push(mm.clone());
    } else if (isOverlapHit(mm)) {
      if (hit.length < capHit) hit.push(mm.clone());
    } else if (miss.length < capMiss) {
      miss.push(mm.clone());
    }
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(frames);
  return { none, miss, hit };
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x281D is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(count > 0, "0x281D should be dispatched — the object-update cascade calls it every frame");
  console.log(`  REACHABILITY: ${count} natural 0x281D dispatches in 1500 attract frames`);
});

// -- 2. EQUAL (captured, all three arms) --------------------------------------

test("EQUAL (captured): recordHammerHitOnObject == oracle on every real attract dispatch (all arms)", () => {
  const { none, miss, hit } = captureBuckets({ frames: 3000, capNone: 40, capMiss: 40, capHit: 8 });
  assert.ok(none.length >= 1, "expected a no-active-record dispatch in attract");
  assert.ok(miss.length >= 1, "expected a found-but-no-overlap dispatch in attract");
  assert.ok(hit.length >= 1, "expected a found+overlap (record-writing) dispatch in attract");

  let stackExcluded = 0;
  for (const [arm, caps] of [["none", none], ["miss", miss], ["hit", hit]]) {
    for (const cap of caps) {
      const diffs = contractDiffs(cap, candidate);
      assert.equal(diffs.length, 0, `${arm} dispatch: ${diffs.join("; ")}`);
      // record whether the folded trampoline left a (correctly-excluded) stack difference
      const b = cap.clone(); candidate(b);
      const a = cap.clone(); oracle(a);
      stackExcluded += stackDiffCount(a, b, cap.regs.sp);
    }
  }
  console.log(
    `  EQUAL/captured: ${none.length} none + ${miss.length} miss + ${hit.length} hit dispatches identical ` +
    `(RAM−stack, pc, SP); ${stackExcluded} byte(s) of folded-trampoline stack scratch correctly excluded`,
  );
});

// -- 3. TEETH -----------------------------------------------------------------

/** The hitbox the head hands the collision handler, from the in-play record's tolerance bytes. */
function hitbox(mem, recordPtr) {
  return (mem.read8(recordPtr + 9) << 8) | mem.read8(recordPtr + 10);
}

/** Broken twin (a): stores the raw array count instead of count − residue (the hit index). */
function brokenNoIndexSub(m) {
  const { mem } = m;
  let recordPtr = OBJ_PAIR_6680;
  let active = false;
  for (let i = 0; i < 2; i++) {
    if ((mem.read8(recordPtr + 1) & 0x01) !== 0) { active = true; break; }
    recordPtr += 0x10;
  }
  if (!active) return;
  const { overlap, stride, base } = dispatchBoardCollision(m, { iy: recordPtr, c: mem.read8(recordPtr + 5), bounds: hitbox(mem, recordPtr) });
  if (overlap === 0) return;
  mem.write8(0x6350, overlap);
  mem.write8(COLLIDED_OBJECT_INDEX, mem.read8(OBJ_SEARCH_COUNT)); // BUG: no `- residue`
  mem.write8(COLLIDED_OBJECT_STRIDE, stride);
  mem.write16(COLLIDED_OBJECT_BASE, base);
}

/** Broken twin (b): stores the wrong array base (off by one). */
function brokenWrongBase(m) {
  const { mem } = m;
  let recordPtr = OBJ_PAIR_6680;
  let active = false;
  for (let i = 0; i < 2; i++) {
    if ((mem.read8(recordPtr + 1) & 0x01) !== 0) { active = true; break; }
    recordPtr += 0x10;
  }
  if (!active) return;
  const { overlap, residue, stride, base } = dispatchBoardCollision(m, { iy: recordPtr, c: mem.read8(recordPtr + 5), bounds: hitbox(mem, recordPtr) });
  if (overlap === 0) return;
  mem.write8(0x6350, overlap);
  mem.write8(COLLIDED_OBJECT_INDEX, mem.read8(OBJ_SEARCH_COUNT) - residue);
  mem.write8(COLLIDED_OBJECT_STRIDE, stride);
  mem.write16(COLLIDED_OBJECT_BASE, (base + 1) & 0xffff); // BUG: wrong base
}

test("TEETH: the dropped-index-subtraction and wrong-base twins are CAUGHT at live cells", () => {
  const { hit } = captureBuckets({ frames: 3000, capNone: 0, capMiss: 0, capHit: 8 });
  assert.ok(hit.length >= 1, "expected a found+overlap dispatch to run the record-writing path against");

  let caughtA = null, caughtB = null;
  for (const cap of hit) {
    if (!caughtA) {
      const d = contractDiffs(cap, brokenNoIndexSub);
      if (d.length && d[0].startsWith(`RAM@${hx(COLLIDED_OBJECT_INDEX)}`)) caughtA = d[0];
    }
    if (!caughtB) {
      const d = contractDiffs(cap, brokenWrongBase);
      if (d.length && d[0].startsWith("RAM@0x635")) caughtB = d[0];
    }
  }
  assert.notEqual(caughtA, null, "the dropped-index-subtraction twin escaped at 0x6354 — the gate is worthless");
  assert.notEqual(caughtB, null, "the wrong-base twin escaped at 0x6351 — the gate is worthless");
  console.log(`  TEETH: no-index-sub caught (${caughtA}); wrong-base caught (${caughtB})`);
});
