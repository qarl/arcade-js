// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stageAward500Popup (ROM 0x1E08) — the middle of the three effect setters:
 * stage B = 0x7E, DE = 0x0005, then tail-jump into the shared handler stageAwardPopupAtHitObject.
 *
 * stageAward500Popup WRITES memory (through stageAwardPopupAtHitObject: the task ring via enqueueTask, the block[0]
 * clear at *(0x6343), and — via stampScorePopupSprite — the sprite record 0x6A30..0x6A33 + the gated
 * sound 0x6085) and is NOT a leaf, so it is gated by capture / clone / replay (docs/decompiler-pipeline)
 * with a FRESH clone per case. Its own body is two register loads and a delegate; every
 * branch lives in its callees (enqueueTask's full-ring drop, stampScorePopupSprite's board gate).
 *
 * Attract NEVER dispatches stageAward500Popup — its callers armScorePopupAndSelectAward / pickRandomAwardTier are level-2+ paths
 * the 25m demo doesn't take (confirmed: attract's only 0x1e15 dispatches arrive via the
 * sibling stageAward300Popup, B=0x7D). So there is no "real stageAward500Popup dispatch" to capture. Instead
 * we capture REAL stageAwardPopupAtHitObject entry states — the exact live-in a `jp 0x1e15` lands in — and
 * run the oracle vs idiomatic stageAward500Popup on each. Because stageAward500Popup's ENTIRE contribution is
 * to overwrite B and DE with fixed constants (identically on both sides), a real stageAwardPopupAtHitObject
 * entry is a faithful crafted base for stageAward500Popup: both sides start the chain from the exact
 * same (B=0x7E, DE=0x0005) over a real ring / param block / board state.
 *
 *   1. REALISM (crafted base) — on each real captured 25m entry, oracle vs idiomatic
 *      stageAward500Popup leave byte-identical game-visible RAM (residual confined to STACK_SCRATCH:
 *      the oracle models `jp`/`call`/`ret`, so its SP/pc move; idiomatic uses the JS call
 *      stack and models neither). The oracle's deepest push (SP-4) must sit inside
 *      STACK_SCRATCH for the exclusion to be sound; idiomatic must leave SP/pc unchanged.
 *
 *   2. BOARD (exhaustive crafted) — stampScorePopupSprite's gate is the chain's only board-dependent
 *      logic and attract exercises only BOARD 1, so poke BOARD to every byte 0..255
 *      identically on both sides. This pins the 50m/100m CLOSED arms (no 0x6085 write).
 *
 *   3. PARAM BLOCK (edge crafted) — poke the four block bytes at *(0x6343) to distinct
 *      edge tuples on both sides, pinning the inherited block[0]->A (0x6A30), block[3]->C
 *      (0x6A33), and the byte-0 CLEAR — none of which stageAward500Popup changes, but all of which
 *      it must faithfully carry through.
 *
 *   4. DROP arm (crafted) — occupy the ring slot at the tail so enqueueTask silently drops
 *      (bit7 clear), exercising the composition on the drop path; the tail must stay put.
 *
 *   5. TEETH — two twins on stageAward500Popup's OWN constants (what distinguishes it from its
 *      siblings), each on a real write-arm base the whole-RAM replay MUST catch:
 *        (a) wrong B constant (0x7D instead of 0x7E) — caught at record byte 0x6A31.
 *        (b) wrong DE constant (0x0003 instead of 0x0005) — caught at the ring argument
 *            slot (the E byte at tail+1), proving the queued message value matters.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e08.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e08 as oracle } from "../../translated/loc_1e08.js";
import { stageAward500Popup as idiomatic } from "../stageAward500Popup.js";
import { loc_1e15 as oracle15 } from "../../translated/loc_1e15.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

// We capture at stageAwardPopupAtHitObject's entry (attract reaches it; stageAward500Popup does not), then re-enter
// through stageAward500Popup. stageAward500Popup overwrites B/DE, so the captured base is faithful.
const CAPTURE = 0x1e15;
const BOARD = 0x6227;
const PARAM_PTR = 0x6343; // indirect word: HL = the parameter block address
const REC = 0x6a30;       // sprite-record slot (written by the stampScorePopupSprite tail)
const SND = 0x6085;       // sound latch (gate-open, written by stampScorePopupSprite)
const TASK_TAIL = 0x60b0; // low byte of the task ring's next write slot
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// stageAward500Popup's fixed payload — the two constants that distinguish it from its siblings.
const B_CONST = 0x7e;
const DE_CONST = 0x0005;

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch region
 * (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns the first game-visible
 * difference { addr, a, b } or null, plus the count tolerated in stack.
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
 * (stageAward500Popup writes RAM), and return the game-visible diff + both machines.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle stageAward500Popup
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Run attract and clone the machine at each real 0x1e15 dispatch (reached via a sibling
 * setter's `jp 0x1e15` while the 25m demo plays). The wrapper delegates to the stageAwardPopupAtHitObject
 * oracle so the host run proceeds to a clean stop. Each snapshot is a faithful crafted
 * base for stageAward500Popup, which re-stages B/DE before running the identical chain.
 */
function captureBases(K, maxFrames) {
  const caps = [];
  const snap = new Map([[CAPTURE, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle15(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

/** A single real captured base (BOARD 1, free ring slot) to craft arms onto. */
function craftedBase() {
  const caps = captureBases(1, 4000);
  assert.ok(caps.length >= 1, "expected a real 0x1e15 entry to craft a stageAward500Popup base from");
  return caps[0];
}

// -- 1. REALISM (crafted base) ------------------------------------------------

test("REALISM: oracle vs idiomatic stageAward500Popup on real 25m bases — game-visible RAM identical, SP/pc unmodelled", () => {
  const caps = captureBases(8, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1e15 base during 25m attract");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract's 0x1e15 bases are on 25m (BOARD==1)");

    const { bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `block=${hx(entry.mem.read16(PARAM_PTR))}`,
    );
    // The oracle's chain pushes down to SP-4 (its own call return addr + sub_309f's push
    // hl); that target must sit inside STACK_SCRATCH so excluding the region masks no real
    // diff. stageAward500Popup itself pushes nothing extra beyond stageAwardPopupAtHitObject's chain.
    assert.ok(
      (entry.regs.sp - 4) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's deepest push must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    // idiomatic stageAward500Popup must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    idiomatic(b);
    assert.equal(b.regs.sp, sp0, "stageAward500Popup must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "stageAward500Popup must leave pc unchanged (no ret modelling)");
    // Prove stageAward500Popup actually stamped its OWN constant: record byte 0x6A31 == B (0x7E).
    assert.equal(b.mem.read8(REC + 1), B_CONST, "stageAward500Popup must stamp B=0x7E into record byte 0x6A31");
  }
  console.log(`  REALISM: ${caps.length} real 25m base(s) — oracle vs idiomatic stageAward500Popup game-visible RAM identical`);
});

// -- 2. BOARD (exhaustive crafted) --------------------------------------------

test("BOARD (exhaustive): stageAward500Popup == oracle over all 256 BOARD values (open + closed gate arms)", () => {
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

test("PARAM BLOCK (edges): inherited block[0]->A, block[3]->C, and the byte-0 clear match the oracle", () => {
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

/** Twin (a): stages the WRONG sprite code (0x7D, its sibling's) instead of 0x7E. */
function brokenWrongB(m) {
  const { regs } = m;
  regs.b = 0x7d; // BUG: should be 0x7E
  regs.de = DE_CONST;
  oracle15(m);
}

/** Twin (b): stages the WRONG task message (0x0003, its sibling's) instead of 0x0005. */
function brokenWrongDE(m) {
  const { regs } = m;
  regs.b = B_CONST;
  regs.de = 0x0003; // BUG: should be 0x0005
  oracle15(m);
}

test("TEETH (wrong-B): the 0x7D twin is CAUGHT on a real base and names record byte 0x6A31", () => {
  const base = craftedBase();
  const { bad } = replay(base, brokenWrongB);
  assert.notEqual(bad, null, "the replay FAILED to catch a wrong B constant — it is worthless");
  assert.equal(bad.addr, REC + 1, `expected the caught diff at record byte 0x6A31, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-B: caught at 0x6A31 (oracle=${hx(bad.a)} broken=${hx(bad.b)})`);
});

test("TEETH (wrong-DE): the 0x0003 twin is CAUGHT on a real write-arm base and names the ring argument slot", () => {
  const base = craftedBase();
  const tail = base.mem.read8(TASK_TAIL);
  const slot = 0x6000 | tail;
  assert.equal(base.mem.read8(slot) & 0x80, 0x80, "the base entry must be a WRITE arm (ring slot free) for this teeth");
  const argSlot = 0x6000 | ((tail + 1) & 0xff); // the E-argument byte of the posted message
  const { bad } = replay(base, brokenWrongDE);
  assert.notEqual(bad, null, "the replay FAILED to catch a wrong DE constant — it is worthless");
  assert.equal(bad.addr, argSlot, `expected the caught diff at the ring argument slot ${hx(argSlot)}, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-DE: caught at ${hx(argSlot)} (oracle E=${hx(bad.a)} broken E=${hx(bad.b)})`);
});
