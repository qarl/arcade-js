// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stageAward300Popup (ROM 0x1E00) — load this effect-sprite arm's constant
 * (B=0x7D code, DE=0x0003 task message) and delegate to the shared stageAwardPopupAtHitObject tail.
 *
 * stageAward300Popup's own body is a straight-line "set two constants, delegate" — no branches of
 * its own. But it WRITES memory (through stageAwardPopupAtHitObject → enqueueTask + stampScorePopupSprite: the task ring,
 * the block[0] clear at *(0x6343), the sprite record 0x6A30..0x6A33, and the gated sound
 * 0x6085), so it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per
 * case — never a reused clone. The two things this setter alone can get wrong are the two
 * CONSTANTS it loads; the composition arms below inherit the stageAwardPopupAtHitObject /
 * stampScorePopupSprite / enqueueTask branches. Attract dispatches this arm only on 25m (BOARD 1) with a free ring slot, so
 * the closed arms are reached with crafted entries:
 *
 *   1. REALISM (real captured dispatch) — pickRandomAwardTier lands on stageAward300Popup (RANDOM bits 0/1
 *      clear) while the 25m demo plays. Run the ORACLE on one clone and idiomatic stageAward300Popup
 *      on another and confirm every game-visible byte matches; the residual is confined to
 *      STACK_SCRATCH (the oracle models `jp 0x1e15 … call 0x309f`, pushing to SP-4; stageAward300Popup
 *      uses the JS call stack and models neither SP nor pc). Also asserts the two constants
 *      actually landed: record[1] (0x6A31) == 0x7D and the posted task argument == 0x03.
 *
 *   2. BOARD (exhaustive crafted) — stampScorePopupSprite's sound gate is the chain's only
 *      board-dependent logic and attract exercises only BOARD 1, so on a real entry poke
 *      BOARD to EVERY byte 0..255 identically on both sides and compare game-visible RAM.
 *      Pins the 50m/100m CLOSED arms (no 0x6085 write) attract never reaches.
 *
 *   3. DROP arm (crafted) — occupy the ring slot at the tail so enqueueTask silently drops
 *      (bit7 clear), exercising the composition on the full-ring path attract's free-slot
 *      writes never reach; the tail must stay put on both sides.
 *
 *   4. TEETH — two twins the REALISM replay MUST catch, each a wrong constant that only
 *      this setter can introduce: (a) loads B=0x7E not 0x7D — caught at record[1] 0x6A31;
 *      (b) loads DE=0x0005 not 0x0003 — caught at the posted task argument in the ring.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e00.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e00 as oracle } from "../../translated/loc_1e00.js";
import { stageAward300Popup as idiomatic } from "../stageAward300Popup.js";
import { stageAwardPopupAtHitObject } from "../stageAwardPopupAtHitObject.js"; // idiomatic callee, for the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e00;
const BOARD = 0x6227;
const REC = 0x6a30;       // sprite-record slot (record[1] = the B constant, via stampScorePopupSprite)
const SND = 0x6085;       // sound latch (gate-open, written by stampScorePopupSprite)
const TASK_TAIL = 0x60b0; // low byte of the task ring's next write slot
const PAGE = 0x6000;      // fixed high byte of every task-ring slot address
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch region
 * (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns the first game-visible
 * difference { addr, a, b } or null, plus the count tolerated inside the stack.
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
 * (stageAward300Popup writes RAM), and return the game-visible diff + both machines.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Run attract and clone the machine at each real 0x1e00 dispatch (pickRandomAwardTier reaches this
 * arm when RANDOM's bits 0/1 are clear while the 25m demo plays). The wrapper delegates to
 * the oracle so the host run proceeds undisturbed to a clean stop.
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

/** A real captured 0x1e00 entry (BOARD 1, free ring slot) to craft arms onto. */
function craftedBase() {
  const caps = captureDispatches(1, 6000);
  assert.ok(caps.length >= 1, "expected a real 0x1e00 entry to craft from");
  return caps[0];
}

// -- 1. REALISM (real captured dispatch) --------------------------------------

test("REALISM: real captured 25m 0x1e00 dispatch — game-visible RAM identical, constants landed", () => {
  const caps = captureDispatches(8, 6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1e00 dispatch during 25m attract");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract dispatches 0x1e00 on 25m (BOARD==1)");

    // Where the posted task argument will land (this arm always hits a free slot in
    // attract, so the write arm is taken and the tail's slot+1 receives E=0x03).
    const tail = entry.mem.read8(TASK_TAIL);
    const argSlot = PAGE | ((tail + 1) & 0xff);

    const { bad, a } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on entry B=${hx(entry.regs.b)} DE=${hx(entry.regs.de)}`,
    );

    // The two constants this setter loads actually reached memory (via the stageAwardPopupAtHitObject tail).
    assert.equal(a.mem.read8(REC + 1), 0x7d, "record[1] (0x6A31) must be the loaded sprite code 0x7D");
    assert.equal(a.mem.read8(argSlot), 0x03, `posted task argument at ${hx(argSlot)} must be E=0x03`);

    // The oracle's chain pushes down to SP-4 (its call-0x309f return, then sub_309f's push
    // hl); that target must sit inside STACK_SCRATCH, so excluding the region can't mask a
    // real diff. stageAward300Popup itself must NOT model the stack: SP and pc unchanged from entry.
    assert.ok(
      (entry.regs.sp - 4) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's deepest push must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    idiomatic(b);
    assert.equal(b.regs.sp, sp0, "stageAward300Popup must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "stageAward300Popup must leave pc unchanged (no tail-jump/ret modelling)");
  }
  console.log(`  REALISM: ${caps.length} real 25m dispatch(es) — game-visible RAM identical; B=0x7D, E=0x03 landed`);
});

// -- 2. BOARD (exhaustive crafted) --------------------------------------------

test("BOARD (exhaustive): stageAward300Popup == oracle over all 256 BOARD values (open + closed sound gate)", () => {
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

// -- 3. DROP arm (crafted) ----------------------------------------------------

test("DROP arm: an occupied ring slot makes enqueueTask drop — composition matches, tail held", () => {
  const base = craftedBase();
  const tail = base.mem.read8(TASK_TAIL);
  const slot = PAGE | tail;
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

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): loads the WRONG sprite-code constant (B=0x7E). Only record[1] (0x6A31) diverges. */
function brokenWrongCode(m) {
  const { regs } = m;
  regs.b = 0x7e; // BUG: should be 0x7D
  regs.de = 0x0003;
  stageAwardPopupAtHitObject(m);
}

/** Twin (b): loads the WRONG task-message constant (DE=0x0005). The posted argument diverges. */
function brokenWrongMessage(m) {
  const { regs } = m;
  regs.b = 0x7d;
  regs.de = 0x0005; // BUG: E should be 0x03
  stageAwardPopupAtHitObject(m);
}

test("TEETH (wrong-code): the B=0x7E twin is CAUGHT on a real dispatch and names 0x6A31", () => {
  const base = craftedBase();
  const { bad } = replay(base, brokenWrongCode);
  assert.notEqual(bad, null, "the replay FAILED to catch a wrong sprite-code constant — it is worthless");
  assert.equal(bad.addr, REC + 1, `expected the caught diff at record[1] 0x6A31, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-code: caught at 0x6A31 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (wrong-message): the DE=0x0005 twin is CAUGHT on a real dispatch and names the ring", () => {
  const base = craftedBase();
  const tail = base.mem.read8(TASK_TAIL);
  const argSlot = PAGE | ((tail + 1) & 0xff);
  assert.equal(base.mem.read8(PAGE | tail) & 0x80, 0x80, "the base entry must be a WRITE arm (ring slot free) for this teeth");
  const { bad } = replay(base, brokenWrongMessage);
  assert.notEqual(bad, null, "the replay FAILED to catch a wrong task-message constant — it is worthless");
  assert.equal(bad.addr, argSlot, `expected the caught diff at the posted-argument slot ${hx(argSlot)}, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-message: caught at ${hx(argSlot)} (oracle=${bad.a} broken=${bad.b})`);
});
