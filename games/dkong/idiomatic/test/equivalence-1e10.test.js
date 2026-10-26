// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stageAward800Popup (ROM 0x1E10) — the sub_1dbd effect-sprite setter that
 * loads the fixed pair (B=0x7F, DE=0x0008) and tail-jumps into the feeder stageAwardPopupAtHitObject.
 *
 * stageAward800Popup WRITES memory only through its stageAwardPopupAtHitObject chain (the task ring via enqueueTask,
 * the block[0] clear at *(0x6343), and — via the stampScorePopupSprite tail — the sprite record
 * 0x6A30..0x6A33 + the gated sound 0x6085), so it is gated by capture / clone / replay
 * (docs/decompiler-pipeline) with a FRESH clone per case. Because the idiomatic stageAwardPopupAtHitObject does NOT model
 * the Z80 stack while the oracle's `jp 0x1e15` chain does, the contract is RAM −
 * STACK_SCRATCH (never the full register file, never cycles), with the additional
 * requirement that idiomatic stageAward800Popup leaves SP/pc UNCHANGED (it models no stack).
 *
 * stageAward800Popup's own body is branchless — it just sets two constants — and reads NEITHER B
 * NOR DE, so it depends on no entry register. The wrinkle is reachability: attract plays
 * level-1 25m only, and 0x1e10 is reached only when armScorePopupAndSelectAward falls through at level >= 3
 * or pickRandomAwardTier sees RNG 0x6018 bit1 set — neither happens in attract (measured: 0x1e10
 * dispatches 0x times over 8000 frames while its feeder 0x1e15 dispatches 6-8x). So the
 * gate is crafted-entry, built three ways:
 *
 *   1. REALISM / GENUINE ENTRY — force 0x1e10 down the real pickRandomAwardTier path: at each real
 *      0x1df5 dispatch poke 0x6018 to 0x02 (bit0=0, bit1=1) identically, so pickRandomAwardTier's
 *      `jp c,0x1e10` fires and hands 0x1e10 a genuine, in-play machine state. Run the
 *      ORACLE on one clone and idiomatic stageAward800Popup on another; every game-visible byte
 *      matches (residual confined to STACK_SCRATCH), and idiomatic leaves SP/pc put.
 *
 *   2. REALISM / BOUNDARY — real captured 0x1e15 dispatches (which attract DOES reach)
 *      are faithful stageAward800Popup continuation states: stageAward800Popup reads neither B nor DE, so
 *      the setter's identity that produced the capture is irrelevant — running stageAward800Popup
 *      on such a state is exactly "the level>=3 setter fired here." Same oracle-vs-
 *      idiomatic contract over many real states, breadth the single forced entry lacks.
 *
 *   3. BOARD (exhaustive crafted) — stampScorePopupSprite's sound gate is the chain's only board-
 *      dependent logic and attract only reaches 25m, so on a real base poke BOARD 0..255
 *      identically on both sides and compare. This pins the 50m/100m CLOSED arms
 *      (no 0x6085 write) attract never reaches; both gate arms are exercised.
 *
 *   4. TEETH — two twins the sweeps MUST catch: (a) wrong-B (0x7E) — stampScorePopupSprite stores B
 *      unconditionally at record byte 0x6A31, so it diverges there on ANY base; (b)
 *      wrong-E (DE=0x0009) — enqueueTask writes E as the task's argument byte, so it
 *      diverges at the ring slot on a write-arm base.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e10.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e10 as oracle } from "../../translated/loc_1e10.js";
import { stageAward800Popup as idiomatic } from "../stageAward800Popup.js";
import { stageAwardPopupAtHitObject } from "../stageAwardPopupAtHitObject.js"; // idiomatic feeder, for the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e10;
const FEEDER = 0x1e15;
const ROUTER = 0x1df5;    // pickRandomAwardTier: reads 0x6018, `jp c,0x1e10` on bit1
const RNG = 0x6018;       // seed byte pickRandomAwardTier dispatches on (poke bit1 to force 0x1e10)
const BOARD = 0x6227;
const REC = 0x6a30;       // sprite-record slot; REC+1 = B, written by the stampScorePopupSprite tail
const SND = 0x6085;       // gated sound latch (gate-open, written by stampScorePopupSprite)
const TASK_TAIL = 0x60b0; // low byte of the task ring's next write slot (page 0x60 fixed)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible RAM difference between two machines, EXCLUDING the dead
 * STACK_SCRATCH region (the memory-equivalence contract is RAM − the stack scratch below the entry SP; SP/pc
 * are handled separately because the oracle models the stack and idiomatic does not).
 * Returns the first difference { addr, a, b } or null, plus the tolerated stack count.
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry through the oracle and a candidate on independent FRESH clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Force a GENUINE 0x1e10 entry down the pickRandomAwardTier RNG path. At each real 0x1df5 dispatch
 * poke 0x6018 = 0x02 (bit0=0, bit1=1) so `jp c,0x1e10` fires; the 0x1e10 hook then clones
 * the (real, in-play) entry state and delegates to the wired routine so the host proceeds.
 */
function captureForced(K, maxFrames) {
  const caps = [];
  const base = new Machine(ROM);
  const realRouter = base.routines.get(ROUTER);
  const realTarget = base.routines.get(TARGET);
  const snap = new Map([
    [ROUTER, (mm) => { mm.mem.write8(RNG, 0x02); return realRouter(mm); }],
    [TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return realTarget(mm); }],
  ]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}

/**
 * Run attract and clone the machine at each real 0x1e15 dispatch — a faithful stageAward800Popup
 * continuation state (stageAward800Popup reads neither B nor DE). The wrapper delegates to the
 * wired feeder so the host run proceeds to a clean stop.
 */
function captureBoundary(K, maxFrames) {
  const caps = [];
  const base = new Machine(ROM);
  const realFeeder = base.routines.get(FEEDER);
  const snap = new Map([[FEEDER, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return realFeeder(mm);
  }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}

/** A real 0x1e15-boundary entry (BOARD 1, free ring slot) to craft arms onto. */
function craftedBase() {
  const caps = captureBoundary(1, 4000);
  assert.ok(caps.length >= 1, "expected a real 0x1e15-boundary entry to craft from");
  return caps[0];
}

/** Assert idiomatic stageAward800Popup models no stack: SP and pc unchanged from entry. */
function assertNoStackModel(entry) {
  const b = entry.clone();
  const sp0 = b.regs.sp, pc0 = b.pc;
  idiomatic(b);
  assert.equal(b.regs.sp, sp0, "stageAward800Popup must leave SP unchanged (no stack modelling)");
  assert.equal(b.pc, pc0, "stageAward800Popup must leave pc unchanged (no tail-jump/ret modelling)");
}

// -- 1. REALISM / GENUINE ENTRY (forced pickRandomAwardTier path) ------------------------

test("REALISM (genuine): a real 0x1e10 entry forced via pickRandomAwardTier — RAM identical, SP/pc unmodelled", () => {
  const caps = captureForced(4, 8000);
  assert.ok(caps.length >= 1, "expected at least one genuine 0x1e10 entry via the forced pickRandomAwardTier path");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "the forced 25m attract dispatches 0x1e10 on BOARD==1");
    const { bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on a genuine 0x1e10 entry (SP=${hx(entry.regs.sp)})`,
    );
    // The oracle's chain pushes at most to SP-4 (stageAwardPopupAtHitObject's call-0x309f return + sub_309f's
    // push hl); that target must sit inside STACK_SCRATCH so the exclusion masks nothing.
    assert.ok(
      (entry.regs.sp - 4) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's deepest push must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    assertNoStackModel(entry);
  }
  console.log(`  REALISM/genuine: ${caps.length} forced 0x1e10 entr(ies) — game-visible RAM identical to the oracle`);
});

// -- 2. REALISM / BOUNDARY (real captured 0x1e15 states) ----------------------

test("REALISM (boundary): real 0x1e15-boundary states — RAM identical, sets B=0x7F/E=0x08", () => {
  const caps = captureBoundary(8, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1e15-boundary state during 25m attract");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract reaches the 0x1e15 boundary on 25m (BOARD==1)");
    const { a, bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    // Positive check that stageAward800Popup actually installed its constant B: the stampScorePopupSprite tail
    // stamps B unconditionally into record byte 0x6A31, so the oracle's own output pins it.
    assert.equal(a.mem.read8(REC + 1), 0x7f, "stageAward800Popup must set B=0x7F (record byte 0x6A31)");
    assertNoStackModel(entry);
  }
  console.log(`  REALISM/boundary: ${caps.length} real 0x1e15-boundary state(s) — RAM identical, B=0x7F confirmed`);
});

// -- 3. BOARD (exhaustive crafted) --------------------------------------------

test("BOARD (exhaustive): stageAward800Popup == oracle over all 256 BOARD values (open + closed gate arms)", () => {
  const base = craftedBase();
  let count = 0, opened = 0, closed = 0, mismatch = null;
  for (let v = 0; v < 256 && !mismatch; v++) {
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    for (const m of [a, b]) { m.mem.write8(BOARD, v); m.mem.write8(SND, 0x00); } // clean SND probe
    oracle(a);
    idiomatic(b);
    count++;
    if (a.mem.read8(SND) === 3) opened++; else closed++; // stampScorePopupSprite's gate fired or not
    const { bad } = ramDiffMinusStack(a, b, aFloor);
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

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): wrong B constant (0x7E). stampScorePopupSprite stamps it at record byte 0x6A31. */
function brokenWrongB(m) {
  m.regs.b = 0x7e; // BUG: should be 0x7F
  m.regs.de = 0x0008;
  stageAwardPopupAtHitObject(m);
}

/** Twin (b): wrong E constant (DE=0x0009). enqueueTask writes E as the task argument. */
function brokenWrongE(m) {
  m.regs.b = 0x7f;
  m.regs.de = 0x0009; // BUG: should be 0x0008
  stageAwardPopupAtHitObject(m);
}

test("TEETH (wrong-B): the B=0x7E twin is CAUGHT and names the record byte 0x6A31", () => {
  const base = craftedBase();
  const { bad } = replay(base, brokenWrongB);
  assert.notEqual(bad, null, "the replay FAILED to catch a wrong B constant — it is worthless");
  assert.equal(bad.addr, REC + 1, `expected the caught diff at 0x6A31, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-B: caught at 0x6A31 (oracle=${hx(bad.a)} broken=${hx(bad.b)})`);
});

test("TEETH (wrong-E): the DE=0x0009 twin is CAUGHT at the task ring's argument byte", () => {
  const base = craftedBase();
  // Ensure the write arm: free the ring slot so enqueueTask writes D/E (and E is observable).
  const tail = base.mem.read8(TASK_TAIL);
  const argAddr = 0x6000 | ((tail + 1) & 0xff); // E lands here (page 0x60 fixed)
  const a = base.clone(), b = base.clone();
  const aFloor = a.regs.sp;
  for (const m of [a, b]) m.mem.write8(0x6000 | tail, 0xff); // bit7 set -> slot free -> write arm
  oracle(a);
  brokenWrongE(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the write-arm replay FAILED to catch a wrong E constant — it is worthless");
  assert.equal(bad.addr, argAddr, `expected the caught diff at the task argument byte ${hx(argAddr)}, got ${hx(bad.addr)}`);
  assert.equal(bad.a, 0x08, "oracle must enqueue E=0x08");
  assert.equal(bad.b, 0x09, "broken twin must enqueue E=0x09");
  console.log(`  TEETH/wrong-E: caught at ${hx(argAddr)} (oracle E=${hx(bad.a)} broken E=${hx(bad.b)})`);
});
