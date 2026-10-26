// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for completeBoardWhenMarioReachesRescueRow (ROM 0x1E7A) — the rescue-row test
 * inside Mario's per-frame position check (sub_1e57). ROM 0x1E5F's `rra` rotates BOARD's bit 0
 * into the carry, so `jp c,0x1E7A` selects the ODD boards — BOARD 1 (25m) AND BOARD 3 (75m) —
 * not "the girder board" alone. It reads Mario's screen Y (a register live-in the caller
 * leaves in the accumulator, an un-promoted register ABI), compares it against the
 * rescue-row line 0x31, and:
 *   • Y value >= 0x31 (still down the board) -> a NORMAL return (true, writes nothing);
 *   • Y value <  0x31 (up on Pauline's row) -> the board is won: fall into loc_1e6d, which
 *     stamps Mario's sprite facing (0x694D) and tail-calls enterBoardAdvanceAndUnwind
 *     (0x1E85) to set GAME_SUBSTATE (0x600A) := 0x16 and UNWIND out of the movement cascade.
 *     In direct-call form that non-local exit is a boolean — completeBoardWhenMarioReachesRescueRow returns the callee's
 *     false (the caller-skip "abort" signal).
 *
 * The Y position is the ONLY input to completeBoardWhenMarioReachesRescueRow's whole subtree: the incoming flags are dead
 * (the compare overwrites the carry it then feeds to loc_1e6d), and the callees read no other
 * register or RAM. So the gate is EXHAUSTIVE over all 256 Y values.
 *
 * It is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — plus the boolean
 * return. The oracle brackets its two exits with stack ops the idiomatic routine drops (it
 * uses the JS call stack): the normal arm's single `ret`, and the board-won arm's two-level
 * unwind (loc_1e85 discards its own return then rets to the grandparent). Both are modeled on
 * the candidate — keyed on its boolean return — so pc + SP line up; the popped return bytes
 * sit in STACK_SCRATCH (excluded by contract).
 *
 * An attract run dispatches 0x1E7A thousands of times but ALWAYS on the normal-return arm
 * (the demo never climbs Mario to the rescue row), so:
 *
 *   1. EQUAL (crafted, exhaustive) — sweep Y over 0..255 from a real booted attract base with
 *      a controlled return stack and sprite/sub-state sentinels; RAM + pc + SP identical to
 *      the oracle on every value, the return matches (true above the line, false below), and
 *      the oracle's outputs are asserted on both arms (board-won: 0x694D:=0x00, 0x600A:=0x16,
 *      SP+4, pc->grandparent; normal: nothing written, SP+2, pc->own-return) so EQUAL is not
 *      vacuous and the stack exclusion is load-bearing. The crafted incoming carry is forced
 *      CLEAR, which the correct routine must recompute via the compare.
 *
 *   2. TEETH (exhaustive) — three deliberately-broken twins the same sweep MUST catch:
 *      (a) inverted-threshold — swaps the arms; caught wherever the wrong arm runs.
 *      (b) wrong-boundary (0x30) — disagrees at Y == 0x30; caught there.
 *      (c) dropped-carry-marshal — skips the compare, so the stale (clear) carry reaches
 *          loc_1e6d and writes the wrong facing (0x80 not 0x00); caught at 0x694D. Proves the
 *          carry-marshalling in the routine is load-bearing.
 *
 *   3. REALISM (captured) — hook 0x1E7A over an attract run and replay every real dispatch;
 *      each matches the oracle and is confirmed to be the normal-return arm (Y >= 0x31).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e7a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e7a as oracle } from "../../translated/loc_1e7a.js";
import { completeBoardWhenMarioReachesRescueRow } from "../completeBoardWhenMarioReachesRescueRow.js";
import { loc_1e6d } from "../loc_1e6d.js"; // the shared callee — the twins call it directly to isolate completeBoardWhenMarioReachesRescueRow's own logic
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_SPRITE_RECORD, SPRITE_CODE, GAME_SUBSTATE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e7a;
const THRESHOLD = 0x31;                                   // the rescue-row Y line
const SPRITE_FLAG = MARIO_SPRITE_RECORD + SPRITE_CODE;    // 0x694D — Mario's sprite-code / facing byte
const BOARD_ADVANCE_SUBSTATE = 0x16;                      // GAME_SUBSTATE value the board-won arm sets
const GRAND_RET = 0x1234;   // grandparent return the board-won unwind lands on (compared both sides)
const OWN_RET = 0x5678;     // sub_1e57's own return; the normal arm rets here, the unwind discards it
const SP_TOP = 0x6bfc;      // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa
const SENTINEL_SPRITE = 0x37; // != 0x00 (board-won write) and != 0x80, so the write is observable
const SENTINEL_SUBSTATE = 0x08; // != 0x16, so the board-advance write is observable

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead stack
 *  region excluded by contract — the staged/popped return bytes live there). */
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

/** All non-stack RAM addresses that changed between two machines (for the no-write
 *  non-vacuity check on the normal-return arm). */
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run the ORACLE on a fresh clone. The frozen translated loc_1e7a either rets normally
 *  (Y-high) or tail-calls loc_1e6d/0x1E85 (Y-low), whose two-level unwind advances SP by 4. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model the oracle's stack bracket from the routine's
 *  boolean return: true = normal single `ret`; false = the board-won two-level unwind (discard
 *  own return, then ret to the grandparent). The idiomatic routine never touches pc/SP itself. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  if (ret) {
    c.ret();          // normal return: pop sub_1e57's own return
  } else {
    c.pop16();        // board-won unwind: discard the own return (models 0x1E85's `pop hl`)
    c.ret();          // then net-return to the grandparent (models 0x1E85's `ret`)
  }
  return { c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const { c } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hx(ram.a & 0xff)} cand=${hx(ram.b & 0xff)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated).
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    _base = host.clone();
  }
  return _base;
}

/** A fresh crafted entry: real attract RAM, Mario's Y in the register, a controlled return
 *  stack (own return then grandparent return staged in STACK_SCRATCH), the incoming carry
 *  forced CLEAR (the routine must recompute it), and sprite / sub-state sentinels poked so
 *  both board-won writes are observable. */
function craftEntry(y) {
  const e = base().clone();
  e.regs.sp = SP_TOP;
  e.push16(GRAND_RET); // -> 0x6bfa
  e.push16(OWN_RET);   // -> 0x6bf8 (the return the normal arm rets to / the unwind discards)
  e.regs.a = y;
  e.regs.f = 0x00;     // all flags clear -> carry clear; the compare must set the carry itself
  e.mem.write8(SPRITE_FLAG, SENTINEL_SPRITE);
  e.mem.write8(GAME_SUBSTATE, SENTINEL_SUBSTATE);
  return e;
}

/** Sweep Y over all 256 values; return the first contract mismatch (or null) and the count.
 *  Also flags any Y where the candidate's boolean return disagrees with the expected arm. */
function fullSweep(candidate) {
  let count = 0;
  for (let y = 0; y < 256; y++) {
    const entry = craftEntry(y);
    const diffs = contractDiffs(entry, candidate);
    if (diffs.length) return { mismatch: { y, why: diffs.join("; ") }, count };
    const { ret } = runCandidate(entry, candidate);
    const expected = y >= THRESHOLD; // true = normal return, false = board-won unwind
    if (ret !== expected) return { mismatch: { y, why: `return ${ret} != expected ${expected}` }, count };
    count++;
  }
  return { mismatch: null, count };
}

const describe = (mm) => mm && `at Y=${hx(mm.y)}: ${mm.why}`;

// -- 1. EQUAL (crafted, exhaustive) -------------------------------------------

test("EQUAL (exhaustive): completeBoardWhenMarioReachesRescueRow == oracle on RAM+pc+SP over all 256 Y values, and returns the right arm", () => {
  const { mismatch, count } = fullSweep(completeBoardWhenMarioReachesRescueRow);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 256, "must have swept the full Y input space");

  // Non-vacuity — the board-won arm actually wrote, unwound, and returned false.
  const won = craftEntry(0x00);
  const o1 = runOracle(won);
  assert.equal(o1.mem.read8(SPRITE_FLAG), 0x00, "board-won: oracle must set 0x694D := 0x00 (carry recomputed set)");
  assert.equal(o1.mem.read8(GAME_SUBSTATE), BOARD_ADVANCE_SUBSTATE, "board-won: oracle must set GAME_SUBSTATE := 0x16");
  assert.equal(o1.regs.sp, SP_TOP, "board-won: oracle unwinds SP by 4 (0x1E85's pop hl + ret)");
  assert.equal(o1.pc, GRAND_RET, "board-won: oracle returns to the grandparent (two levels up)");
  assert.equal(runCandidate(won, completeBoardWhenMarioReachesRescueRow).ret, false, "board-won: idiomatic must return false (the unwind signal)");

  // Boundary just below the line still wins.
  const edge = craftEntry(THRESHOLD - 1);
  assert.equal(runOracle(edge).mem.read8(SPRITE_FLAG), 0x00, "Y=0x30: still the board-won arm (proves the < 0x31 boundary)");

  // Non-vacuity — the normal arm at the boundary wrote nothing, popped one level, returned true.
  const normal = craftEntry(THRESHOLD);
  const o2 = runOracle(normal);
  assert.deepEqual(changedAddrs(normal, o2, normal.regs.sp), [], "normal arm: oracle must write no non-stack RAM");
  assert.equal(o2.mem.read8(SPRITE_FLAG), SENTINEL_SPRITE, "normal arm: sprite byte untouched");
  assert.equal(o2.regs.sp, SP_TOP - 2, "normal arm: oracle pops one level (SP+2)");
  assert.equal(o2.pc, OWN_RET, "normal arm: oracle rets to sub_1e57's own return");
  assert.equal(runCandidate(normal, completeBoardWhenMarioReachesRescueRow).ret, true, "normal arm: idiomatic must return true (keep going)");

  // The stack exclusion is load-bearing: the staged returns really sit in STACK_SCRATCH.
  assert.ok(inStack(SP_TOP - 2) && inStack(SP_TOP - 4), "the staged returns must sit in STACK_SCRATCH");

  console.log(`  EQUAL/exhaustive: ${count} Y values identical on RAM+pc+SP; board-won 0x694D:=0x00, 0x600A:=0x16, SP+4, pc->grandparent; normal arm no-write, SP+2, pc->own-return`);
});

// -- 2. TEETH (exhaustive) ----------------------------------------------------

/** (a) inverted-threshold — returns on carry-clear vs carry-set swapped, so the arms flip. */
function brokenInvertedThreshold(m) {
  const { regs } = m;
  regs.cp(THRESHOLD);
  if (regs.fC) return true; // BUG: should be `if (!regs.fC)`
  return loc_1e6d(m);
}

/** (b) wrong-boundary — compares against 0x30 instead of 0x31, disagreeing at Y == 0x30. */
function brokenWrongBoundary(m) {
  const { regs } = m;
  regs.cp(THRESHOLD - 1); // BUG: 0x30 not 0x31
  if (!regs.fC) return true;
  return loc_1e6d(m);
}

/** (c) dropped-carry-marshal — skips the compare, so the stale (clear) incoming carry reaches
 *  loc_1e6d and it writes the wrong facing (0x80 not 0x00). */
function brokenNoCarryMarshal(m) {
  const { regs } = m;
  if (regs.a >= THRESHOLD) return true; // BUG: no compare -> carry never set for loc_1e6d
  return loc_1e6d(m);
}

test("TEETH (exhaustive): the inverted-threshold twin is CAUGHT", () => {
  const { mismatch } = fullSweep(brokenInvertedThreshold);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an inverted threshold — the gate is worthless");
  console.log(`  TEETH/inverted: caught — ${describe(mismatch)}`);
});

test("TEETH (exhaustive): the wrong-boundary twin is CAUGHT at Y=0x30", () => {
  const { mismatch } = fullSweep(brokenWrongBoundary);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a shifted boundary — worthless");
  assert.equal(mismatch.y, THRESHOLD - 1, `the boundary twin must first diverge at Y=0x30, got ${describe(mismatch)}`);
  console.log(`  TEETH/boundary: caught — ${describe(mismatch)}`);
});

test("TEETH (exhaustive): the dropped-carry-marshal twin is CAUGHT at 0x694D", () => {
  // Prove the divergence is the wrong facing byte, not a stack ghost.
  const won = craftEntry(0x00);
  const diffs = contractDiffs(won, brokenNoCarryMarshal);
  assert.ok(diffs.length > 0 && diffs[0].startsWith(`RAM@${hx(SPRITE_FLAG)}`),
    `the dropped-carry twin must diverge at ${hx(SPRITE_FLAG)} (wrong facing), got ${diffs.join("; ") || "nothing"}`);
  const { mismatch } = fullSweep(brokenNoCarryMarshal);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped carry marshal — worthless");
  console.log(`  TEETH/carry: caught — sprite facing ${diffs[0]}; first sweep mismatch ${describe(mismatch)}`);
});

// -- 3. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x1E7A dispatches — completeBoardWhenMarioReachesRescueRow matches oracle (all the normal-return arm)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 200) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1E7A dispatch during attract");

  let normalArm = 0, wonArm = 0;
  for (const cap of caps) {
    const y = cap.regs.a;
    const diffs = contractDiffs(cap, completeBoardWhenMarioReachesRescueRow);
    assert.equal(diffs.length, 0, `real dispatch Y=${hx(y)}: ${diffs.join("; ")}`);
    if (y >= THRESHOLD) normalArm++; else wonArm++;
  }
  assert.equal(wonArm, 0, "attract should never reach the board-won arm (Mario never climbs to the rescue row)");
  console.log(`  REALISM: ${caps.length} real 0x1E7A dispatches identical to the oracle (${normalArm} normal-return, ${wonArm} board-won)`);
});
