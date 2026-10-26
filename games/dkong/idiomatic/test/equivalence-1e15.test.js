// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stageAwardPopupAtHitObject (ROM 0x1E15) — post the queued task, read the effect
 * sprite's X/Y from the indirect parameter block, then tail into the record-stamp
 * stampScorePopupSprite.
 *
 * stageAwardPopupAtHitObject WRITES memory (the task ring via enqueueTask, the block[0] clear at
 * *(0x6343), and — through its stampScorePopupSprite tail — the sprite record 0x6A30..0x6A33 and the
 * gated sound 0x6085) and is NOT a leaf, so it is gated by capture / clone / replay
 * (docs/decompiler-pipeline) with a FRESH clone per case. Its own body is straight-line; the only
 * branches live in its callees (enqueueTask's full-ring drop, stampScorePopupSprite's board gate).
 * Attract only ever dispatches it on 25m (BOARD 1) with a free ring slot, so the closed
 * arms are reached with crafted entries:
 *
 *   1. REALISM (real captured dispatch) — attract dispatches 0x1e15 on 25m. Run the
 *      ORACLE on one clone and idiomatic stageAwardPopupAtHitObject on another and confirm every
 *      game-visible byte matches — the residual diff is confined to STACK_SCRATCH.
 *      That confinement is the whole point: the oracle models `call 0x309f … jp 0x1e36`
 *      (push/call/ret, so its SP/pc move); stageAwardPopupAtHitObject uses the JS call stack and models
 *      neither, so the ONLY residual is stack-scratch bytes. Its deepest push lands at
 *      SP-4 (measured), which must sit inside STACK_SCRATCH for the exclusion to be
 *      sound; stageAwardPopupAtHitObject must leave SP/pc unchanged.
 *
 *   2. BOARD (exhaustive crafted) — stampScorePopupSprite's gate is the chain's only board-dependent
 *      logic and attract exercises only BOARD 1, so on a real entry poke BOARD to EVERY
 *      byte 0..255 identically on both sides and compare game-visible RAM. This pins the
 *      50m/100m CLOSED arms (no 0x6085 write) attract never reaches.
 *
 *   3. PARAM BLOCK (edge crafted) — poke the four block bytes at *(0x6343) to distinct
 *      edge tuples on both sides. This pins stageAwardPopupAtHitObject's own logic: block[0]->A (0x6A30),
 *      block[3]->C (0x6A33), and the byte-0 CLEAR (*(0x6343) -> 0). A wrong offset or a
 *      missing clear would show here.
 *
 *   4. DROP arm (crafted) — occupy the ring slot at the tail so enqueueTask silently
 *      drops (bit7 clear), exercising the composition on the drop path attract's
 *      free-slot writes never reach; the tail must stay put on both sides.
 *
 *   5. TEETH — three twins the sweeps MUST catch: (a) reads C from block[2] not block[3]
 *      — caught by the PARAM sweep at 0x6A33; (b) DROPS the byte-0 clear — caught by the
 *      PARAM sweep at the block address; (c) DROPS the enqueueTask — caught on a real
 *      write-arm entry at TASK_TAIL (0x60B0).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e15.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e15 as oracle } from "../../translated/loc_1e15.js";
import { stageAwardPopupAtHitObject as idiomatic } from "../stageAwardPopupAtHitObject.js";
import { enqueueTask } from "../enqueueTask.js"; // idiomatic callee, for the teeth twins
import { stampScorePopupSprite } from "../stampScorePopupSprite.js";       // idiomatic callee, for the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e15;
const BOARD = 0x6227;
const PARAM_PTR = 0x6343; // indirect word: HL = the parameter block address
const REC = 0x6a30;       // sprite-record slot (written by the stampScorePopupSprite tail)
const SND = 0x6085;       // sound latch (gate-open, written by stampScorePopupSprite)
const TASK_TAIL = 0x60b0; // low byte of the task ring's next write slot
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns the first
 * game-visible difference { addr, a, b } or null, plus the count tolerated in stack.
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Replay one entry state through the oracle and a candidate on independent FRESH clones
 * (stageAwardPopupAtHitObject writes RAM), and return the game-visible diff + both machines.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Run attract and clone the machine at each real 0x1e15 dispatch (reached via the
 * stageAward300Popup/1e08/1e10 setters' `jp 0x1e15` while the 25m demo plays). The wrapper
 * delegates to the oracle so the host run proceeds to a clean stop.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

/** A real captured 0x1e15 entry (BOARD 1, free ring slot) to craft arms onto. */
function craftedBase() {
  const caps = captureDispatches(1, 4000);
  assert.ok(caps.length >= 1, "expected a real 0x1e15 entry to craft from");
  return caps[0];
}

// -- 1. REALISM (real captured dispatch) --------------------------------------

test("REALISM: real captured 25m 0x1e15 dispatch — game-visible RAM identical, SP/pc unmodelled", () => {
  const caps = captureDispatches(8, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1e15 dispatch during 25m attract");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract dispatches 0x1e15 on 25m (BOARD==1)");

    const { bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on B=${hx(entry.regs.b)} DE=${hx(entry.regs.de)} block=${hx(entry.mem.read16(PARAM_PTR))}`,
    );
    // The oracle's chain pushes down to SP-4 (its own call-0x309f return address, then
    // sub_309f's push hl); that target must sit inside STACK_SCRATCH, so excluding the
    // region cannot mask a real diff.
    assert.ok(
      (entry.regs.sp - 4) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's deepest push must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    // stageAwardPopupAtHitObject must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    idiomatic(b);
    assert.equal(b.regs.sp, sp0, "stageAwardPopupAtHitObject must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "stageAwardPopupAtHitObject must leave pc unchanged (no ret modelling)");
  }
  console.log(`  REALISM: ${caps.length} real 25m dispatch(es) — game-visible RAM identical to the oracle`);
});

// -- 2. BOARD (exhaustive crafted) --------------------------------------------

test("BOARD (exhaustive): stageAwardPopupAtHitObject == oracle over all 256 BOARD values (open + closed gate arms)", () => {
  const base = craftedBase();
  let count = 0, opened = 0, closed = 0, mismatch = null;
  for (let v = 0; v < 256 && !mismatch; v++) {
    const a = base.clone(); const b = base.clone();
    for (const m of [a, b]) { m.mem.write8(BOARD, v); m.mem.write8(SND, 0x00); } // clean SND probe
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
    count++;
    if (a.mem.read8(SND) === 3) opened++; else closed++; // stampScorePopupSprite's gate fired or not
    if (bad) mismatch = { v, bad };
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at BOARD=${hx(mismatch.v)}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 BOARD values");
  assert.ok(opened > 0 && closed > 0, `sweep must exercise BOTH gate arms (opened=${opened} closed=${closed})`);
  console.log(`  BOARD/exhaustive: 256 values — game-visible RAM identical (sound gate opened on ${opened}, closed on ${closed})`);
});

// -- 3. PARAM BLOCK (edge crafted) --------------------------------------------

// Distinct block bytes so a wrong-offset read or a missing clear must diverge: b0 != 0
// (the clear must zero it) and b2 != b3 (so reading block[2] instead of block[3] shows).
const BLOCK_TUPLES = [
  [0x11, 0x22, 0x33, 0x44],
  [0xff, 0x01, 0x55, 0xaa],
  [0x80, 0x40, 0x0f, 0xf0],
  [0xaa, 0xbb, 0xcc, 0xdd],
  [0x01, 0x02, 0x03, 0x04],
];

/** Sweep the crafted parameter-block tuples; return the first game-visible diff or null. */
function paramSweep(base, candidate) {
  const block = base.mem.read16(PARAM_PTR);
  for (const [b0, b1, b2, b3] of BLOCK_TUPLES) {
    const a = base.clone(); const b = base.clone();
    for (const m of [a, b]) {
      m.mem.write8((block + 0) & 0xffff, b0);
      m.mem.write8((block + 1) & 0xffff, b1);
      m.mem.write8((block + 2) & 0xffff, b2);
      m.mem.write8((block + 3) & 0xffff, b3);
    }
    oracle(a);
    candidate(b);
    const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
    if (bad) return { bad, tuple: [b0, b1, b2, b3], block };
  }
  return null;
}

test("PARAM BLOCK (edges): block[0]->A, block[3]->C, and the byte-0 clear match the oracle", () => {
  const base = craftedBase();
  const miss = paramSweep(base, idiomatic);
  assert.equal(
    miss,
    null,
    miss && `mismatch on block ${JSON.stringify(miss.tuple)}: RAM diff at ${hx(miss.bad.addr)} ` +
      `(oracle=${miss.bad.a} idiomatic=${miss.bad.b})`,
  );
  console.log(`  PARAM/edges: ${BLOCK_TUPLES.length} block tuples — A/C offsets + byte-0 clear identical to the oracle`);
});

// -- 4. DROP arm (crafted) ----------------------------------------------------

test("DROP arm: an occupied ring slot makes enqueueTask drop — composition matches, tail held", () => {
  const base = craftedBase();
  const tail = base.mem.read8(TASK_TAIL);
  const slot = 0x6000 | tail; // page 0x60 is fixed
  const a = base.clone(); const b = base.clone();
  for (const m of [a, b]) m.mem.write8(slot, 0x00); // bit7 clear -> slot occupied -> drop
  oracle(a);
  idiomatic(b);
  const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
  assert.equal(bad, null, bad && `drop-arm RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  // Prove we actually took the drop arm: the tail did NOT advance on either side.
  assert.equal(a.mem.read8(TASK_TAIL), tail, "oracle must leave TASK_TAIL untouched on the drop arm");
  assert.equal(b.mem.read8(TASK_TAIL), tail, "idiomatic must leave TASK_TAIL untouched on the drop arm");
  console.log(`  DROP arm: occupied slot ${hx(slot)} — enqueueTask dropped, composition identical to the oracle`);
});

// -- 5. TEETH -----------------------------------------------------------------

/** Twin (a): reads C from block[2] instead of block[3]. Only 0x6A33 diverges. */
function brokenWrongCOffset(m) {
  const { regs, mem } = m;
  enqueueTask(m);
  const block = mem.read16(PARAM_PTR);
  regs.a = mem.read8(block);
  mem.write8(block, 0x00);
  regs.c = mem.read8((block & 0xff00) | ((block + 2) & 0xff)); // BUG: +2, should be +3
  stampScorePopupSprite(m);
}

/** Twin (b): drops the byte-0 clear. The block byte stays non-zero. */
function brokenNoClear(m) {
  const { regs, mem } = m;
  enqueueTask(m);
  const block = mem.read16(PARAM_PTR);
  regs.a = mem.read8(block);
  // BUG: no `mem.write8(block, 0x00)` — block[0] never cleared
  regs.c = mem.read8((block & 0xff00) | ((block + 3) & 0xff));
  stampScorePopupSprite(m);
}

/** Twin (c): drops the enqueueTask. The task ring + tail are left untouched. */
function brokenDropTask(m) {
  const { regs, mem } = m;
  // BUG: no `enqueueTask(m)` — the deferred message is never posted
  const block = mem.read16(PARAM_PTR);
  regs.a = mem.read8(block);
  mem.write8(block, 0x00);
  regs.c = mem.read8((block & 0xff00) | ((block + 3) & 0xff));
  stampScorePopupSprite(m);
}

test("TEETH (wrong-C-offset): the +2 twin is CAUGHT by the PARAM sweep and names 0x6A33", () => {
  const base = craftedBase();
  const miss = paramSweep(base, brokenWrongCOffset);
  assert.notEqual(miss, null, "the PARAM sweep FAILED to catch a wrong block[3] offset — it is worthless");
  assert.equal(miss.bad.addr, REC + 3, `expected the caught diff at 0x6A33, got ${hx(miss.bad.addr)}`);
  console.log(`  TEETH/wrong-C-offset: caught on block ${JSON.stringify(miss.tuple)} (0x6A33 oracle=${miss.bad.a} broken=${miss.bad.b})`);
});

test("TEETH (no-clear): the missing byte-0 clear is CAUGHT by the PARAM sweep and names the block", () => {
  const base = craftedBase();
  const block = base.mem.read16(PARAM_PTR);
  const miss = paramSweep(base, brokenNoClear);
  assert.notEqual(miss, null, "the PARAM sweep FAILED to catch a missing byte-0 clear — it is worthless");
  assert.equal(miss.bad.addr, block, `expected the caught diff at the block byte ${hx(block)}, got ${hx(miss.bad.addr)}`);
  console.log(`  TEETH/no-clear: caught at block ${hx(block)} (oracle=${miss.bad.a} broken=${miss.bad.b})`);
});

test("TEETH (drop-task): the missing enqueueTask is CAUGHT on a real write-arm entry and names 0x60B0", () => {
  const base = craftedBase();
  const tail = base.mem.read8(TASK_TAIL);
  const slot = 0x6000 | tail;
  assert.equal(base.mem.read8(slot) & 0x80, 0x80, "the base entry must be a WRITE arm (ring slot free) for this teeth");
  const { bad } = replay(base, brokenDropTask);
  assert.notEqual(bad, null, "the write-arm replay FAILED to catch a dropped enqueueTask — it is worthless");
  assert.equal(bad.addr, TASK_TAIL, `expected the caught diff at TASK_TAIL 0x60B0, got ${hx(bad.addr)}`);
  console.log(`  TEETH/drop-task: caught at 0x60B0 (oracle tail advanced ${bad.a}, broken held ${bad.b})`);
});
