// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for markFatalFallByHeight (ROM 0x1c76) — the fall-height fatality
 * check that condemns a deep fall before the movement machine's shared sprite tail.
 *
 * The routine's memory-observable branch depends on exactly TWO bytes — the current
 * height MARIO_Y (0x6205) and the take-off height MARIO_AIR_START_Y (0x620E): the fall
 * is lethal iff u8(MARIO_Y - 15) >= MARIO_AIR_START_Y, in which case it writes
 * MARIO_FATAL_FALL (0x6220) = 1 and the fall sound latch (SND_TRIGGER+4 = 0x6084) = 3.
 * Either way it tail-jumps to entry_1da6 (0x1da6), which refreshes Mario's 4-byte sprite
 * record and `ret`s. So the whole decision space is 256 x 256 and can be swept EXHAUSTIVELY.
 *
 * The oracle nets exactly ONE `ret`: entry_1c76 pushes nothing and its `jp 0x1da6` tail
 * runs entry_1da6, whose `ret` pops the caller's return address (that pop reads bytes in
 * STACK_SCRATCH, excluded by the memory-equivalence contract). The idiomatic routine
 * models no stack — it calls writeMarioSpriteRecord directly and returns — so the harness
 * performs ONE m.ret() on the candidate to line pc + SP up with the oracle. Contract:
 * RAM (minus the stack scratch below the entry SP) + pc + SP, never a register file (live-out is memory-only).
 *
 *   1. EQUAL (exhaustive) — all 65536 (MARIO_Y, MARIO_AIR_START_Y) pairs; both arms and
 *      the byte-width wrap (MARIO_Y < 15) are covered by construction, and the sweep is
 *      asserted to have exercised both the fatal and the survivable arm (non-vacuity).
 *
 *   2. EQUAL (real dispatches) — hook 0x1c76 in a real attract run (the 25m demo jumps,
 *      so both arms fire) and confirm the candidate matches the oracle on every capture.
 *
 *   3. TEETH — three broken twins, each of which the SAME exhaustive sweep must catch:
 *      (a) inverted decision (marks fatal on the survivable arm and vice-versa),
 *      (b) dropped byte-width wrap (plain MARIO_Y - 15) — diverges where MARIO_Y < 15,
 *      (c) dropped sprite refresh (omits the shared tail) — diverges on the record bytes.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1c76.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1c76 as oracle } from "../../translated/loc_1c76.js";
import { markFatalFallByHeight } from "../markFatalFallByHeight.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_Y,
  MARIO_AIR_START_Y,
  MARIO_FATAL_FALL,
  SND_TRIGGER,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1c76;
const FALL_SOUND = SND_TRIGGER + 4; // 0x6084
const MARIO_SPRITE_RECORD_END = 0x694f; // slot +3 (Y) of Mario's sprite record

// The oracle's tail `ret` pops a return address; point SP inside STACK_SCRATCH so that
// pop reads valid, excluded bytes and never aliases live work RAM.
const SAFE_SP = 0x6bf8;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region — exactly the memory-equivalence contract (RAM − the stack scratch below the entry SP).
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

// A fresh entry: a clone of `base` with the two decision bytes set, a safe stack, and the
// frame machinery neutralised so the oracle's `m.step` cannot fire an NMI in isolation.
function makeEntry(base, y, startY) {
  const e = base.clone();
  e.mem.write8(MARIO_Y, y);
  e.mem.write8(MARIO_AIR_START_Y, startY);
  e.regs.sp = SAFE_SP;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// Run the oracle on one fresh entry and the candidate on another, byte-identical entry,
// then diff the contract: RAM − the stack scratch below the entry SP, pc, SP. The candidate models the tail's
// single net `ret` with one m.ret() so pc + SP line up with the oracle. Fresh entries per
// side because the routine WRITES memory.
function contractDiffAt(base, y, startY, candidate) {
  const o = makeEntry(base, y, startY);
  const oFloor = o.regs.sp;
  const c = makeEntry(base, y, startY);
  oracle(o);
  candidate(c);
  c.ret();
  const ram = firstRamDiff(o, c, oFloor);
  if (ram) return { addr: ram.addr, a: ram.a, b: ram.b, kind: "RAM" };
  if (o.pc !== c.pc) return { kind: "pc", a: o.pc, b: c.pc };
  if (o.regs.sp !== c.regs.sp) return { kind: "SP", a: o.regs.sp, b: c.regs.sp };
  return null;
}

// Sweep the whole (MARIO_Y, MARIO_AIR_START_Y) decision space against `candidate`.
// Returns the first mismatch (or null), the combo count, and how many of each arm the
// oracle actually took (so EQUAL can prove it was not vacuous).
function fullSweep(base, candidate) {
  let count = 0, fatalArm = 0, survivableArm = 0;
  for (let y = 0; y < 256; y++) {
    for (let s = 0; s < 256; s++) {
      // Classify the arm the oracle takes here, for the non-vacuity report.
      if (((y - 15) & 0xff) >= s) fatalArm++; else survivableArm++;
      const mm = contractDiffAt(base, y, s, candidate);
      count++;
      if (mm) return { mismatch: { y, s, ...mm }, count, fatalArm, survivableArm };
    }
  }
  return { mismatch: null, count, fatalArm, survivableArm };
}

const describe = (mm) =>
  mm &&
  (mm.kind === "RAM"
    ? `at MARIO_Y=${hx(mm.y)} startY=${hx(mm.s)}: RAM diverges at 0x${(mm.addr ?? 0).toString(16)} (${mm.a}->${mm.b})`
    : `at MARIO_Y=${hx(mm.y)} startY=${hx(mm.s)}: ${mm.kind} diverges (${mm.a}->${mm.b})`);

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): markFatalFallByHeight == oracle across all 65536 height pairs", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count, fatalArm, survivableArm } = fullSweep(base, markFatalFallByHeight);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256 * 256, "must have compared the full decision space");
  assert.ok(fatalArm > 0 && survivableArm > 0, "sweep must exercise BOTH arms, else it proves nothing");
  console.log(`  EQUAL/exhaustive: ${count} height pairs — RAM+pc+SP identical (${fatalArm} fatal, ${survivableArm} survivable)`);
});

// -- 2. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): markFatalFallByHeight == oracle on every captured 0x1c76 entry", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 256) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1c76 dispatch during attract");

  let sawFatal = 0, sawSurvivable = 0;
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    o.nextNmi = Infinity; o.nextBoundary = Infinity;
    c.nextNmi = Infinity; c.nextBoundary = Infinity;
    oracle(o);
    markFatalFallByHeight(c);
    c.ret();
    const ram = firstRamDiff(o, c, cap.regs.sp);
    assert.equal(ram, null, ram && `real dispatch RAM diverges at 0x${(ram.addr ?? 0).toString(16)} (${ram.a}->${ram.b})`);
    assert.equal(o.pc, c.pc, "real dispatch pc mismatch");
    assert.equal(o.regs.sp, c.regs.sp, "real dispatch SP mismatch");
    if (((cap.mem.read8(MARIO_Y) - 15) & 0xff) >= cap.mem.read8(MARIO_AIR_START_Y)) sawFatal++; else sawSurvivable++;
  }
  assert.ok(sawFatal > 0 && sawSurvivable > 0, "captured attract dispatches should span both arms");
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical (${sawFatal} fatal, ${sawSurvivable} survivable)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): inverts the fatal/survivable decision — marks fatal on the survivable arm
 *  and skips on the fatal arm. Caught wherever the two arms disagree. */
function brokenInvertedDecision(m) {
  const { mem } = m;
  const currentLessSlack = (mem.read8(MARIO_Y) - 15) & 0xff;
  if (currentLessSlack < mem.read8(MARIO_AIR_START_Y)) { // BUG: should be `>=`
    mem.write8(MARIO_FATAL_FALL, 1);
    mem.write8(FALL_SOUND, 3);
  }
  writeMarioSpriteRecord(m);
}

/** BUG (b): drops the byte-width wrap on (MARIO_Y - 15). When MARIO_Y < 15 the true
 *  routine wraps to a large value (usually fatal); this twin sees a negative and treats
 *  it as survivable. Caught on the low-MARIO_Y rows of the sweep. */
function brokenNoWrap(m) {
  const { mem } = m;
  const currentLessSlack = mem.read8(MARIO_Y) - 15; // BUG: no u8()
  if (currentLessSlack >= mem.read8(MARIO_AIR_START_Y)) {
    mem.write8(MARIO_FATAL_FALL, 1);
    mem.write8(FALL_SOUND, 3);
  }
  writeMarioSpriteRecord(m);
}

/** BUG (c): forgets the shared sprite-refresh tail. Diverges on Mario's sprite record
 *  whenever the live fields differ from what the record already held (MARIO_Y sweeps, so
 *  slot +3 differs on almost every row). */
function brokenDropTail(m) {
  const { mem } = m;
  const currentLessSlack = (mem.read8(MARIO_Y) - 15) & 0xff;
  if (currentLessSlack >= mem.read8(MARIO_AIR_START_Y)) {
    mem.write8(MARIO_FATAL_FALL, 1);
    mem.write8(FALL_SOUND, 3);
  }
  // BUG: no writeMarioSpriteRecord(m);
}

test("TEETH: the inverted-decision twin is CAUGHT (a conditional write diverges)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenInvertedDecision);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an inverted decision — worthless");
  assert.ok(
    mismatch.kind === "RAM" && (mismatch.addr === FALL_SOUND || mismatch.addr === MARIO_FATAL_FALL),
    `the inverted-decision twin must diverge on the fall sound latch or MARIO_FATAL_FALL, got ${describe(mismatch)}`,
  );
  console.log(`  TEETH/inverted: caught — ${describe(mismatch)}`);
});

test("TEETH: the dropped-wrap twin is CAUGHT (diverges where MARIO_Y < 15)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenNoWrap);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped byte-width wrap — worthless");
  assert.ok(mismatch.y < 15, `the dropped-wrap twin can only diverge where (MARIO_Y - 15) wraps, i.e. MARIO_Y < 15; got MARIO_Y=${hx(mismatch.y)}`);
  console.log(`  TEETH/no-wrap: caught — ${describe(mismatch)}`);
});

test("TEETH: the dropped-sprite-refresh twin is CAUGHT (sprite record diverges)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenDropTail);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped sprite refresh — worthless");
  assert.ok(
    mismatch.kind === "RAM" && mismatch.addr >= 0x694c && mismatch.addr <= MARIO_SPRITE_RECORD_END,
    `the dropped-tail twin must first diverge inside Mario's sprite record (0x694c..0x694f), got ${describe(mismatch)}`,
  );
  console.log(`  TEETH/drop-tail: caught — ${describe(mismatch)}`);
});
