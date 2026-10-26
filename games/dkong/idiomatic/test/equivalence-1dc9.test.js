// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for armScorePopupAndSelectAward (ROM 0x1DC9) — sub_1dbd's state-1 handler: it arms the
 * state-2 countdown (0x6341 := 0x40), advances the state (0x6340 := 2) unconditionally,
 * then spawns one effect sprite by tail-jumping to a setter chosen from 0x6342's low three
 * bits — bit0 -> pickAwardTierByObjectCount, else bit1 -> stageAward300Popup, else bit2 -> pickRandomAwardTier — or, if none is
 * set, it cues SND_TRIGGER[5] := 3 and picks by LEVEL (1 -> stageAward300Popup, 2 -> stageAward500Popup,
 * otherwise -> stageAward800Popup).
 *
 * armScorePopupAndSelectAward writes 0x6341, 0x6340 and (on the fall-through arm) 0x6085 itself; every other
 * game-visible byte is written by the CHOSEN setter's chain (task ring via enqueueTask, the
 * sprite record 0x6A30.., the gated sound). Its arms are all TAIL jumps, so in the idiomatic
 * layer they are direct calls: the bit0 arm bottoms out in the still-oracle loc_1e28 (which
 * models the stack), while the other arms run the fully-idiomatic stageAwardPopupAtHitObject chain (which does
 * not). So SP/pc and the STACK_SCRATCH region diverge from the oracle on the non-bit0 arms
 * (dead — the rst-0x28 caller reads no register, and the Z80 stack has become the JS call
 * stack). The gate is therefore memory-equivalence on RAM − the stack scratch below the entry SP (never the full
 * register file, never cycles, never SP/pc), with a FRESH clone per case because the routine
 * and its callees write memory and advance the task ring:
 *
 *   1. REALISM — hook 0x1dc9 in a real attract run (sub_1dbd calls it whenever 0x6340 == 1
 *      while the 25m demo plays). For each real entry run the ORACLE on one fresh clone and
 *      idiomatic armScorePopupAndSelectAward on another; every game-visible byte matches (residual confined to
 *      the dead STACK_SCRATCH). The oracle's deepest push is asserted to sit inside
 *      STACK_SCRATCH so excluding the region cannot mask a real diff.
 *
 *   2. EXHAUSTIVE (0x6342 dispatch) — on a real captured base, poke 0x6342 to EVERY byte
 *      0..255 identically on both sides (freeing the task-ring slot so the setter's stamp is
 *      observable) and compare RAM − the stack scratch below the entry SP. This crafts every top-level arm attract
 *      does not naturally reach and is the whole of armScorePopupAndSelectAward's bit dispatch, proven against
 *      the oracle; all four arm classes (bit0 / bit1 / bit2 / fall-through) are exercised.
 *
 *   3. EXHAUSTIVE (LEVEL sub-dispatch) — force the fall-through arm (0x6342 := 0) and sweep
 *      LEVEL (0x6229) over 0..255, comparing RAM − the stack scratch below the entry SP. Crafts the 1 / 2 / >=3
 *      LEVEL sub-dispatch (stageAward300Popup / stageAward500Popup / stageAward800Popup) attract's single 25m level never
 *      reaches; all three arms are exercised.
 *
 *   4. TEETH — three deliberately-broken twins each caught by the sweep that targets it:
 *      (a) a wrong state-advance constant (0x6340 := 3) — caught at 0x6340 for every value;
 *      (b) a top-level bit-order swap (bit1 tested before bit0) — caught by the 0x6342 sweep;
 *      (c) a LEVEL-dispatch swap (level 1 -> stageAward500Popup) — caught by the LEVEL sweep, diverging
 *      both at the posted task argument E and at the stamped sprite code B (0x6A31: 0x7E for 0x7D).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1dc9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1dc9 as oracle } from "../../translated/loc_1dc9.js";
import { armScorePopupAndSelectAward as idiomatic } from "../armScorePopupAndSelectAward.js";
import { pickAwardTierByObjectCount } from "../pickAwardTierByObjectCount.js"; // idiomatic arms, for the teeth twins
import { stageAward300Popup } from "../stageAward300Popup.js";
import { pickRandomAwardTier } from "../pickRandomAwardTier.js";
import { stageAward500Popup } from "../stageAward500Popup.js";
import { stageAward800Popup } from "../stageAward800Popup.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, LEVEL, SND_TRIGGER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1dc9;
const SELECT = 0x6342;      // effect-select bitmask armScorePopupAndSelectAward dispatches on (low 3 bits)
const STATE = 0x6340;       // sub_1dbd state byte (armScorePopupAndSelectAward advances 1 -> 2)
const STATE_TIMER = 0x6341; // countdown value armScorePopupAndSelectAward arms to 0x40
const SND = SND_TRIGGER + 5; // 0x6085 — the effect sound latch (fall-through arm only)
const REC = 0x6a30;         // sprite-record slot; REC+1 = the setter's B (arm-distinguishing)
const TASK_TAIL = 0x60b0;   // low byte of the task ring's next write slot (page 0x60 fixed)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible RAM difference between two machines, EXCLUDING the stack scratch below the entry SP
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP; SP/pc are the dropped
 * stack model — the oracle's tail-`ret` chain moves them, the idiomatic setters mostly do
 * not, and neither is consumed by the rst-0x28 caller).
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
 * Run attract and clone the machine at each real 0x1dc9 dispatch (sub_1dbd calls it via
 * m.call(0x1dc9) whenever 0x6340 == 1 while the 25m demo plays). The wrapper delegates to
 * the oracle so the host run proceeds undisturbed to a clean stop.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}

/**
 * A real captured 0x1dc9 entry to craft the sweeps onto — one whose word at 0x6343 is a
 * valid param-block pointer. That pointer is set up per effect and IS the live-in the
 * stageAwardPopupAtHitObject arm (bit1 / bit2 / fall-through) dereferences (`ld hl,(0x6343)`); a bit0-only
 * entry leaves it 0x0000 (its loc_1e28 tail never reads it), so crafting the stageAwardPopupAtHitObject arm
 * onto that base would fault the ORACLE at 0x0000. Picking a base with a live pointer makes
 * the crafted entry a faithful live-in for EVERY forced arm (loc_1e28 ignores 0x6343 anyway).
 */
function craftedBase() {
  const caps = captureDispatches(24, 8000);
  const base = caps.find((c) => {
    const ptr = c.mem.read8(0x6343) | (c.mem.read8(0x6344) << 8);
    return ptr >= 0x6000 && ptr < 0x6c00;
  });
  assert.ok(base, "expected a real 0x1dc9 entry with a valid 0x6343 param-block pointer");
  return base;
}

/** Free the task-ring slot on a clone so a setter's enqueue/stamp is observable. */
function freeRingSlot(m) {
  m.mem.write8(0x6000 | m.mem.read8(TASK_TAIL), 0xff);
}

/** Which top-level arm 0x6342 selects (for coverage tallying). */
function selectArm(sel) {
  if (sel & 0x01) return "bit0";
  if (sel & 0x02) return "bit1";
  if (sel & 0x04) return "bit2";
  return "fall";
}

// -- 1. REALISM (real captured dispatch) --------------------------------------

test("REALISM: real captured 0x1dc9 dispatches — game-visible RAM identical to the oracle", () => {
  const caps = captureDispatches(16, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1dc9 dispatch during attract");

  const armsSeen = new Set();
  for (const entry of caps) {
    const { bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on a real 0x1dc9 entry (0x6342=${hx(entry.mem.read8(SELECT))} SP=${hx(entry.regs.sp)})`,
    );
    // The oracle's tail chain can push a couple of words; that target must sit inside
    // STACK_SCRATCH so excluding the region cannot mask a real game-visible diff.
    assert.ok(
      (entry.regs.sp - 4) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's deepest push must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    armsSeen.add(selectArm(entry.mem.read8(SELECT)));
  }
  console.log(`  REALISM: ${caps.length} real 0x1dc9 dispatch(es) — RAM identical; arms seen: ` +
    [...armsSeen].join(", "));
});

// -- 2. EXHAUSTIVE (0x6342 top-level dispatch over all 256 values) ------------

function sweepSelect(base, candidate) {
  const arms = { bit0: 0, bit1: 0, bit2: 0, fall: 0 };
  let count = 0, mismatch = null;
  for (let sel = 0; sel < 256 && !mismatch; sel++) {
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    for (const m of [a, b]) { m.mem.write8(SELECT, sel); freeRingSlot(m); }
    oracle(a);
    candidate(b);
    count++;
    arms[selectArm(sel)]++;
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) mismatch = { sel, bad };
  }
  return { mismatch, arms, count };
}

test("EXHAUSTIVE (0x6342): armScorePopupAndSelectAward == oracle over all 256 select values (all four arms)", () => {
  const base = craftedBase();
  const { mismatch, arms, count } = sweepSelect(base, idiomatic);
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at 0x6342=${hx(mismatch.sel)}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 select values");
  assert.ok(
    arms.bit0 > 0 && arms.bit1 > 0 && arms.bit2 > 0 && arms.fall > 0,
    `sweep must exercise all four arms (${JSON.stringify(arms)})`,
  );
  // 0x6340 / 0x6341 are written unconditionally on every path.
  const chk = base.clone();
  chk.mem.write8(SELECT, 0x00);
  oracle(chk);
  assert.equal(chk.mem.read8(STATE), 0x02, "0x6340 must be advanced to 2");
  assert.equal(chk.mem.read8(STATE_TIMER), 0x40, "0x6341 must be armed to 0x40");
  console.log(`  EXHAUSTIVE/0x6342: 256 values — RAM identical to the oracle; arm hits ${JSON.stringify(arms)}`);
});

// -- 3. EXHAUSTIVE (LEVEL sub-dispatch on the fall-through arm) ----------------

function sweepLevel(base, candidate) {
  const arms = { 0x7d: 0, 0x7e: 0, 0x7f: 0 }; // 1e00 / 1e08 / 1e10 sprite codes at 0x6A31
  let count = 0, mismatch = null;
  for (let lvl = 0; lvl < 256 && !mismatch; lvl++) {
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    for (const m of [a, b]) { m.mem.write8(SELECT, 0x00); m.mem.write8(LEVEL, lvl); freeRingSlot(m); }
    oracle(a);
    candidate(b);
    count++;
    const code = a.mem.read8(REC + 1);
    if (code in arms) arms[code]++;
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) mismatch = { lvl, bad };
  }
  return { mismatch, arms, count };
}

test("EXHAUSTIVE (LEVEL): fall-through armScorePopupAndSelectAward == oracle over all 256 LEVEL values (three arms)", () => {
  const base = craftedBase();
  const { mismatch, arms, count } = sweepLevel(base, idiomatic);
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at LEVEL=${hx(mismatch.lvl)}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 LEVEL values");
  assert.ok(
    arms[0x7d] > 0 && arms[0x7e] > 0 && arms[0x7f] > 0,
    `LEVEL sweep must exercise all three arms (1e00/0x7d=${arms[0x7d]} 1e08/0x7e=${arms[0x7e]} 1e10/0x7f=${arms[0x7f]})`,
  );
  // The fall-through arm cues the effect sound before dispatching.
  const chk = base.clone();
  chk.mem.write8(SELECT, 0x00); chk.mem.write8(LEVEL, 0x01);
  oracle(chk);
  assert.equal(chk.mem.read8(SND), 0x03, "fall-through must cue SND_TRIGGER[5] := 3");
  console.log(`  EXHAUSTIVE/LEVEL: 256 values — RAM identical; arm hits ` +
    `1e00(0x7d)=${arms[0x7d]} 1e08(0x7e)=${arms[0x7e]} 1e10(0x7f)=${arms[0x7f]}`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): wrong state-advance constant — writes 0x6340 := 3 instead of 2. */
function brokenState(m) {
  const { regs, mem } = m;
  mem.write8(STATE_TIMER, 0x40);
  mem.write8(STATE, 0x03); // BUG: should be 0x02
  const sel = mem.read8(SELECT);
  if (sel & 0x01) { regs.a = sel >> 1; return pickAwardTierByObjectCount(m); }
  if (sel & 0x02) return stageAward300Popup(m);
  if (sel & 0x04) return pickRandomAwardTier(m);
  mem.write8(SND, 0x03);
  const lvl = mem.read8(LEVEL);
  if (lvl === 1) return stageAward300Popup(m);
  if (lvl === 2) return stageAward500Popup(m);
  return stageAward800Popup(m);
}

/** Twin (b): top-level bit-order swap — tests bit 1 before bit 0 (a wrong priority encoder). */
function brokenBitSwap(m) {
  const { regs, mem } = m;
  mem.write8(STATE_TIMER, 0x40);
  mem.write8(STATE, 0x02);
  const sel = mem.read8(SELECT);
  if (sel & 0x02) return stageAward300Popup(m);                 // BUG: bit 1 tested first
  if (sel & 0x01) { regs.a = sel >> 1; return pickAwardTierByObjectCount(m); }
  if (sel & 0x04) return pickRandomAwardTier(m);
  mem.write8(SND, 0x03);
  const lvl = mem.read8(LEVEL);
  if (lvl === 1) return stageAward300Popup(m);
  if (lvl === 2) return stageAward500Popup(m);
  return stageAward800Popup(m);
}

/** Twin (c): LEVEL-dispatch swap — level 1 routes to stageAward500Popup instead of stageAward300Popup. */
function brokenLevelSwap(m) {
  const { regs, mem } = m;
  mem.write8(STATE_TIMER, 0x40);
  mem.write8(STATE, 0x02);
  const sel = mem.read8(SELECT);
  if (sel & 0x01) { regs.a = sel >> 1; return pickAwardTierByObjectCount(m); }
  if (sel & 0x02) return stageAward300Popup(m);
  if (sel & 0x04) return pickRandomAwardTier(m);
  mem.write8(SND, 0x03);
  const lvl = mem.read8(LEVEL);
  if (lvl === 1) return stageAward500Popup(m); // BUG: should be stageAward300Popup
  if (lvl === 2) return stageAward500Popup(m);
  return stageAward800Popup(m);
}

test("TEETH (state-constant): the 0x6340 := 3 twin is CAUGHT and names 0x6340", () => {
  const base = craftedBase();
  const { mismatch } = sweepSelect(base, brokenState);
  assert.notEqual(mismatch, null, "the 0x6342 sweep FAILED to catch a wrong state-advance constant — it is worthless");
  assert.equal(mismatch.bad.addr, STATE, `expected the caught diff at 0x6340, got ${hx(mismatch.bad.addr)}`);
  console.log(`  TEETH/state-constant: caught at 0x6342=${hx(mismatch.sel)} (0x6340 oracle=${mismatch.bad.a} broken=${mismatch.bad.b})`);
});

test("TEETH (bit-swap): the wrong top-level priority encoder is CAUGHT by the 0x6342 sweep", () => {
  const base = craftedBase();
  const { mismatch } = sweepSelect(base, brokenBitSwap);
  assert.notEqual(mismatch, null, "the 0x6342 sweep FAILED to catch a top-level bit-order swap — it is worthless");
  console.log(`  TEETH/bit-swap: caught at 0x6342=${hx(mismatch.sel)} (game-visible diff at ${hx(mismatch.bad.addr)} ` +
    `oracle=${mismatch.bad.a} broken=${mismatch.bad.b})`);
});

test("TEETH (level-swap): the level-1 -> stageAward500Popup twin is CAUGHT (wrong E and wrong B at 0x6A31)", () => {
  const base = craftedBase();
  const { mismatch } = sweepLevel(base, brokenLevelSwap);
  assert.notEqual(mismatch, null, "the LEVEL sweep FAILED to catch a wrong LEVEL dispatch — it is worthless");
  // The swap routes level 1 to stageAward500Popup (B=0x7E, DE=0x0005) instead of stageAward300Popup (B=0x7D,
  // DE=0x0003), so it diverges both at the posted task argument E (in the ring, the lower
  // address the linear scan reports first) AND at the stamped sprite code B (0x6A31). Pin
  // the record-byte divergence directly, re-running the caught LEVEL on fresh clones.
  const a = base.clone(), b = base.clone();
  for (const m of [a, b]) { m.mem.write8(SELECT, 0x00); m.mem.write8(LEVEL, mismatch.lvl); freeRingSlot(m); }
  oracle(a);
  brokenLevelSwap(b);
  const oB = a.mem.read8(REC + 1), bB = b.mem.read8(REC + 1);
  assert.notEqual(bB, oB, `the swap must diverge the stamped sprite code at 0x6A31 (oracle=${hx(oB)} broken=${hx(bB)})`);
  console.log(`  TEETH/level-swap: caught at LEVEL=${hx(mismatch.lvl)} — first game-visible diff at ${hx(mismatch.bad.addr)} ` +
    `(oracle=${mismatch.bad.a} broken=${mismatch.bad.b}); record 0x6A31 B ${hx(oB)}->${hx(bB)}`);
});
