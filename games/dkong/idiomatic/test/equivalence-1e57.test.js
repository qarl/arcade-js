// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1e57 (ROM 0x1E57) — Mario's per-frame board-won position check.
 * It reads BOARD (0x6227) and dispatches by board type:
 *   • bit 2 set (rivet / 100m board)  -> completeRivetBoardWhenCleared (0x1E80): won iff no
 *     rivets remain. Mario's position is not read on this arm.
 *   • bit 2 clear, bit 0 set (the ODD boards — 25m AND 75m; ROM 0x1E5F's `rra` puts BOARD's bit 0
 *     in the carry, so this arm is NOT "the girder board" alone) -> completeBoardWhenMarioReachesRescueRow
 *     (0x1E7A): won iff Mario's screen Y is above the rescue-row line 0x31. Mario's Y is handed
 *     over in the accumulator. (The crafted cases below label this arm "girder" because they
 *     drive it with BOARD == 1; the routing itself takes BOARD 3 too.)
 *   • bit 2 clear, bit 0 clear (remaining boards) -> won iff Mario's Y is above the climb line
 *     0x51 (screen Y decreases as he climbs). At/below the line -> a NORMAL return (keep going).
 *     Above it -> loc_1e6d (0x1E6D), with Mario's X high bit rotated into the carry (his facing
 *     selector); it stamps the facing, commits the board-advance, and unwinds.
 *
 * The return is the caller-skip signal threaded through the whole check:
 *   true  — normal: the board is not won, the movement cascade continues this frame.
 *   false — the board was won and the cascade unwound (0x1E85's two-level unwind), so the
 *           caller must NOT continue.
 *
 * MEMORY-equivalence contract: RAM (minus the stack scratch below the entry SP) + pc + SP, plus the boolean return.
 * The oracle brackets its exits with stack ops the idiomatic routine drops (it uses the JS
 * call stack): the normal arms' single `ret`, and the board-won arms' two-level unwind
 * (0x1E85 discards its own return then rets to the grandparent). Both are modeled on the
 * candidate — keyed on its boolean return, true = single ret / false = discard + net return —
 * so pc + SP line up; the popped return bytes sit in STACK_SCRATCH (excluded by contract).
 *
 * Attract only ever plays the girder board and never wins it, so real captured dispatches
 * cover ONLY the girder normal-return arm. Coverage:
 *
 *   1. EQUAL (crafted) — from a real booted attract base with a controlled return stack and
 *      sprite / sub-state sentinels, drive EVERY arm: rivet (won / not-won, with bit0 noise to
 *      prove bit2 wins), girder (Y swept 0..255 across the rescue-row boundary, clean + noisy
 *      board), and the climb arm (Y swept 0..255 × both X-high-bit facings, clean + noisy
 *      board). RAM + pc + SP identical to the oracle on every case, the return matches the
 *      expected arm, and the oracle's outputs are asserted on both won and normal arms so
 *      EQUAL is not vacuous and the stack exclusion is load-bearing.
 *
 *   2. TEETH — five deliberately-broken twins the same sweep MUST catch:
 *      (a) wrong bit2 mask (0x08)     — mis-dispatches the rivet arm.
 *      (b) wrong bit0 mask (0x02)     — mis-dispatches the girder arm.
 *      (c) shifted climb line (0x50)  — disagrees at Y == 0x50 on the climb arm.
 *      (d) dropped Y marshal          — completeBoardWhenMarioReachesRescueRow reads the stale accumulator; proves the
 *                                       Mario-Y hand-off to the girder arm is load-bearing.
 *      (e) dropped carry marshal      — loc_1e6d reads the stale carry and writes the wrong
 *                                       facing (0x80 not 0x00); proves the X-high-bit -> carry
 *                                       hand-off to the climb arm is load-bearing.
 *
 *   3. REALISM (captured) — hook 0x1E57 over an attract run and replay every real dispatch;
 *      each matches the oracle (all on the girder normal-return arm).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e57.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e57 as oracle } from "../../translated/loc_1e57.js";
import { checkBoardWonByType as loc_1e57 } from "../checkBoardWonByType.js";
// The real idiomatic arms — the twins call them directly to isolate loc_1e57's own logic.
import { completeRivetBoardWhenCleared } from "../completeRivetBoardWhenCleared.js"; // ROM 0x1E80
import { completeBoardWhenMarioReachesRescueRow } from "../completeBoardWhenMarioReachesRescueRow.js"; // ROM 0x1E7A
import { loc_1e6d } from "../loc_1e6d.js"; // ROM 0x1E6D
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  MARIO_Y,
  MARIO_X,
  RIVETS_LEFT,
  MARIO_SPRITE_RECORD,
  SPRITE_CODE,
  GAME_SUBSTATE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e57;
const RESCUE_ROW = 0x31;                                // completeBoardWhenMarioReachesRescueRow's girder rescue-row line
const CLIMB_LINE = 0x51;                                // loc_1e57's own climb threshold
const SPRITE_FLAG = MARIO_SPRITE_RECORD + SPRITE_CODE;  // 0x694D — Mario's sprite-code / facing byte
const BOARD_ADVANCE_SUBSTATE = 0x16;                    // GAME_SUBSTATE value the board-won arms set
const GRAND_RET = 0x1234;   // grandparent return the board-won unwind lands on (compared both sides)
const OWN_RET = 0x5678;     // the return the normal arm rets to / the unwind discards
const SP_TOP = 0x6bfc;      // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa
const INCOMING_A = 0xff;    // stale accumulator poked in — exposes a dropped Mario-Y marshal
const SENTINEL_SPRITE = 0x37; // != 0x00 and != 0x80, so the won-arm facing write is observable
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
 *  non-vacuity check on the normal-return arms). */
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

/** Run the ORACLE on a fresh clone. The frozen translated sub_1e57 either rets normally
 *  (SP += 2) or unwinds two levels through 0x1E85 (SP += 4). */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model the oracle's stack bracket from the routine's
 *  boolean return: true = normal single `ret`; false = the board-won two-level unwind (discard
 *  the own return, then ret to the grandparent). The idiomatic routine never touches pc/SP. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  if (ret) {
    c.ret();     // normal: pop sub_1e57's own return
  } else {
    c.pop16();   // board-won unwind: discard the own return (models 0x1E85's `pop hl`)
    c.ret();     // then net-return to the grandparent (models 0x1E85's `ret`)
  }
  return { c, ret };
}

/** Compare a candidate vs the oracle over the contract in ONE pass. Returns {diffs, ret}. */
function evalCase(entry, fn) {
  const o = runOracle(entry);
  const { c, ret } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hx(ram.a & 0xff)} cand=${hx(ram.b & 0xff)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ret };
}

/** Convenience for the non-vacuity / teeth-location asserts: just the diff list. */
const contractDiffs = (entry, fn) => evalCase(entry, fn).diffs;

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated).
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    assert.equal(host.stoppedBy, null, "attract base run must reach the vblank spin cleanly");
    _base = host.clone();
  }
  return _base;
}

/** A fresh crafted entry: real attract RAM; BOARD / Mario Y,X / rivets poked; a controlled
 *  return stack (own return then grandparent return staged in STACK_SCRATCH); a stale
 *  accumulator and cleared carry (both register hand-offs must be recomputed); sprite and
 *  sub-state sentinels so the won-arm writes are observable. */
function craftEntry({ board, y, x, rivets }) {
  const e = base().clone();
  e.regs.sp = SP_TOP;
  e.push16(GRAND_RET); // -> 0x6bfa
  e.push16(OWN_RET);   // -> 0x6bf8 (the return the normal arm rets to / the unwind discards)
  e.regs.a = INCOMING_A;
  e.regs.f = 0x00;     // carry clear -> the climb arm must rotate X's high bit in itself
  e.mem.write8(BOARD, board);
  e.mem.write8(MARIO_Y, y);
  e.mem.write8(MARIO_X, x);
  e.mem.write8(RIVETS_LEFT, rivets);
  e.mem.write8(SPRITE_FLAG, SENTINEL_SPRITE);
  e.mem.write8(GAME_SUBSTATE, SENTINEL_SUBSTATE);
  return e;
}

// The full crafted case set, each tagged with the arm and the return the correct routine owes.
function* allCases() {
  // Rivet arm — bit 2 set. bit0 noise (0x05/0xff) proves bit2 is checked first. Won iff rivets==0.
  for (const board of [0x04, 0x05, 0xfc, 0xff]) {
    for (const rivets of [0x00, 0x01, 0x42, 0xff]) {
      yield { arm: "rivet", board, y: 0x00, x: 0x80, rivets, expectRet: rivets !== 0 };
    }
  }
  // Girder arm — bit2 clear, bit0 set (clean + high-bit noise). Won iff Y < 0x31.
  for (const board of [0x01, 0xfb]) {
    for (let y = 0; y < 256; y++) {
      yield { arm: "girder", board, y, x: 0x80, rivets: 0x11, expectRet: y >= RESCUE_ROW };
    }
  }
  // Climb arm — bit2 clear, bit0 clear (clean + noise) × both X facings. Won iff Y < 0x51.
  for (const board of [0x00, 0xfa]) {
    for (const x of [0x00, 0x80]) {
      for (let y = 0; y < 256; y++) {
        yield { arm: "climb", board, y, x, rivets: 0x22, expectRet: y >= CLIMB_LINE };
      }
    }
  }
}

/** Sweep every crafted case against a candidate; return the first mismatch (contract or
 *  return) and the counts by arm. */
function sweep(candidate) {
  let count = 0;
  const arms = { rivet: 0, girder: 0, climb: 0 };
  for (const cs of allCases()) {
    const entry = craftEntry(cs);
    const { diffs, ret } = evalCase(entry, candidate);
    if (diffs.length) return { mismatch: { ...cs, why: diffs.join("; ") }, count, arms };
    if (ret !== cs.expectRet) return { mismatch: { ...cs, why: `return ${ret} != expected ${cs.expectRet}` }, count, arms };
    arms[cs.arm]++;
    count++;
  }
  return { mismatch: null, count, arms };
}

const describe = (mm) => mm && `${mm.arm} board=${hx(mm.board)} Y=${hx(mm.y)} X=${hx(mm.x)} rivets=${hx(mm.rivets)}: ${mm.why}`;

// -- 1. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): loc_1e57 == oracle on RAM+pc+SP across every arm, and returns the right arm", () => {
  const { mismatch, count, arms } = sweep(loc_1e57);
  assert.equal(mismatch, null, describe(mismatch));
  assert.equal(count, 16 + 2 * 256 + 2 * 2 * 256, "must have swept the full crafted case set");

  // -- Non-vacuity + load-bearing-stack asserts, one per (arm, outcome) --------

  // Rivet WON (rivets == 0): the oracle unwinds two levels and commits the advance.
  const rivetWon = runOracle(craftEntry({ board: 0x04, y: 0x00, x: 0x80, rivets: 0x00 }));
  assert.equal(rivetWon.mem.read8(GAME_SUBSTATE), BOARD_ADVANCE_SUBSTATE, "rivet won: GAME_SUBSTATE := 0x16");
  assert.equal(rivetWon.regs.sp, SP_TOP, "rivet won: oracle unwinds SP by 4");
  assert.equal(rivetWon.pc, GRAND_RET, "rivet won: oracle returns to the grandparent");
  assert.equal(runCandidate(craftEntry({ board: 0x04, y: 0x00, x: 0x80, rivets: 0x00 }), loc_1e57).ret, false,
    "rivet won: idiomatic returns false (unwind)");

  // Rivet NOT-won (rivets != 0): normal single return, nothing written.
  const rivetGo = craftEntry({ board: 0x04, y: 0x00, x: 0x80, rivets: 0x03 });
  const rivetGoO = runOracle(rivetGo);
  assert.deepEqual(changedAddrs(rivetGo, rivetGoO, rivetGo.regs.sp), [], "rivet not-won: oracle writes no non-stack RAM");
  assert.equal(rivetGoO.regs.sp, SP_TOP - 2, "rivet not-won: oracle pops one level");
  assert.equal(rivetGoO.pc, OWN_RET, "rivet not-won: oracle rets to the own return");
  assert.equal(runCandidate(rivetGo, loc_1e57).ret, true, "rivet not-won: idiomatic returns true (keep going)");

  // Girder WON (Y below the rescue row): facing 0x00 (carry recomputed set) + advance.
  const girderWon = runOracle(craftEntry({ board: 0x01, y: 0x00, x: 0x80, rivets: 0x11 }));
  assert.equal(girderWon.mem.read8(SPRITE_FLAG), 0x00, "girder won: facing := 0x00");
  assert.equal(girderWon.mem.read8(GAME_SUBSTATE), BOARD_ADVANCE_SUBSTATE, "girder won: GAME_SUBSTATE := 0x16");
  assert.equal(girderWon.regs.sp, SP_TOP, "girder won: SP unwound by 4");
  // Girder boundary: Y = 0x30 still wins, Y = 0x31 does not.
  assert.equal(runOracle(craftEntry({ board: 0x01, y: RESCUE_ROW - 1, x: 0x80, rivets: 0x11 })).mem.read8(SPRITE_FLAG), 0x00,
    "girder Y=0x30: still the won arm (proves the < 0x31 boundary)");
  const girderGo = craftEntry({ board: 0x01, y: RESCUE_ROW, x: 0x80, rivets: 0x11 });
  const girderGoO = runOracle(girderGo);
  assert.deepEqual(changedAddrs(girderGo, girderGoO, girderGo.regs.sp), [], "girder Y=0x31: normal arm writes no non-stack RAM");
  assert.equal(girderGoO.pc, OWN_RET, "girder normal: oracle rets to the own return");

  // Climb WON with X high bit SET -> facing 0x00; with X high bit CLEAR -> facing 0x80.
  assert.equal(runOracle(craftEntry({ board: 0x00, y: 0x00, x: 0x80, rivets: 0x22 })).mem.read8(SPRITE_FLAG), 0x00,
    "climb won, X bit7 set: facing := 0x00");
  assert.equal(runOracle(craftEntry({ board: 0x00, y: 0x00, x: 0x00, rivets: 0x22 })).mem.read8(SPRITE_FLAG), 0x80,
    "climb won, X bit7 clear: facing := 0x80");
  // Climb boundary: Y = 0x50 wins, Y = 0x51 keeps going.
  assert.equal(runOracle(craftEntry({ board: 0x00, y: CLIMB_LINE - 1, x: 0x80, rivets: 0x22 })).mem.read8(SPRITE_FLAG), 0x00,
    "climb Y=0x50: still the won arm (proves the < 0x51 boundary)");
  const climbGo = craftEntry({ board: 0x00, y: CLIMB_LINE, x: 0x80, rivets: 0x22 });
  const climbGoO = runOracle(climbGo);
  assert.deepEqual(changedAddrs(climbGo, climbGoO, climbGo.regs.sp), [], "climb Y=0x51: normal arm writes no non-stack RAM");
  assert.equal(climbGoO.regs.sp, SP_TOP - 2, "climb normal: oracle pops one level");

  // The stack exclusion is load-bearing: the staged returns really sit in STACK_SCRATCH.
  assert.ok(inStack(SP_TOP - 2) && inStack(SP_TOP - 4), "the staged returns must sit in STACK_SCRATCH");

  console.log(`  EQUAL/crafted: ${count} cases identical on RAM+pc+SP (rivet ${arms.rivet}, girder ${arms.girder}, climb ${arms.climb}); both boundaries + both facings + both HUD-free outcomes asserted`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** (a) wrong bit2 mask — tests 0x08 instead of 0x04, mis-selecting the rivet arm. */
function brokenBit2Mask(m) {
  const { regs, mem } = m;
  const board = mem.read8(BOARD);
  if ((board & 0x08) !== 0) return completeRivetBoardWhenCleared(m); // BUG: 0x08 not 0x04
  const marioY = mem.read8(MARIO_Y);
  regs.a = marioY;
  if ((board & 0x01) !== 0) return completeBoardWhenMarioReachesRescueRow(m);
  if (marioY >= CLIMB_LINE) return true;
  regs.a = mem.read8(MARIO_X);
  regs.rla();
  return loc_1e6d(m);
}

/** (b) wrong bit0 mask — tests 0x02 instead of 0x01, mis-selecting the girder arm. */
function brokenBit0Mask(m) {
  const { regs, mem } = m;
  const board = mem.read8(BOARD);
  if ((board & 0x04) !== 0) return completeRivetBoardWhenCleared(m);
  const marioY = mem.read8(MARIO_Y);
  regs.a = marioY;
  if ((board & 0x02) !== 0) return completeBoardWhenMarioReachesRescueRow(m); // BUG: 0x02 not 0x01
  if (marioY >= CLIMB_LINE) return true;
  regs.a = mem.read8(MARIO_X);
  regs.rla();
  return loc_1e6d(m);
}

/** (c) shifted climb line — compares against 0x50 instead of 0x51, disagreeing at Y == 0x50. */
function brokenClimbLine(m) {
  const { regs, mem } = m;
  const board = mem.read8(BOARD);
  if ((board & 0x04) !== 0) return completeRivetBoardWhenCleared(m);
  const marioY = mem.read8(MARIO_Y);
  regs.a = marioY;
  if ((board & 0x01) !== 0) return completeBoardWhenMarioReachesRescueRow(m);
  if (marioY >= CLIMB_LINE - 1) return true; // BUG: 0x50 not 0x51
  regs.a = mem.read8(MARIO_X);
  regs.rla();
  return loc_1e6d(m);
}

/** (d) dropped Y marshal — never loads Mario's Y into the accumulator, so completeBoardWhenMarioReachesRescueRow reads the
 *  stale INCOMING_A and mis-decides the girder arm. */
function brokenDropYMarshal(m) {
  const { regs, mem } = m;
  const board = mem.read8(BOARD);
  if ((board & 0x04) !== 0) return completeRivetBoardWhenCleared(m);
  const marioY = mem.read8(MARIO_Y);
  // BUG: regs.a = marioY  is missing
  if ((board & 0x01) !== 0) return completeBoardWhenMarioReachesRescueRow(m);
  if (marioY >= CLIMB_LINE) return true;
  regs.a = mem.read8(MARIO_X);
  regs.rla();
  return loc_1e6d(m);
}

/** (e) dropped carry marshal — never rotates X's high bit into the carry, so loc_1e6d reads
 *  the stale (clear) carry and writes the wrong facing. */
function brokenDropCarryMarshal(m) {
  const { regs, mem } = m;
  const board = mem.read8(BOARD);
  if ((board & 0x04) !== 0) return completeRivetBoardWhenCleared(m);
  const marioY = mem.read8(MARIO_Y);
  regs.a = marioY;
  if ((board & 0x01) !== 0) return completeBoardWhenMarioReachesRescueRow(m);
  if (marioY >= CLIMB_LINE) return true;
  // BUG: regs.a = MARIO_X; regs.rla()  is missing -> carry stays clear
  return loc_1e6d(m);
}

test("TEETH: the wrong-bit2-mask twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenBit2Mask);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong bit2 mask — the gate is worthless");
  console.log(`  TEETH/bit2: caught — ${describe(mismatch)}`);
});

test("TEETH: the wrong-bit0-mask twin is CAUGHT", () => {
  const { mismatch } = sweep(brokenBit0Mask);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong bit0 mask — worthless");
  console.log(`  TEETH/bit0: caught — ${describe(mismatch)}`);
});

test("TEETH: the shifted-climb-line twin is CAUGHT at Y=0x50", () => {
  const { mismatch } = sweep(brokenClimbLine);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a shifted climb line — worthless");
  assert.equal(mismatch.arm, "climb", "the climb-line twin must first diverge on the climb arm");
  assert.equal(mismatch.y, CLIMB_LINE - 1, `must first diverge at Y=0x50, got ${describe(mismatch)}`);
  console.log(`  TEETH/climb-line: caught — ${describe(mismatch)}`);
});

test("TEETH: the dropped-Y-marshal twin is CAUGHT on the girder arm", () => {
  const { mismatch } = sweep(brokenDropYMarshal);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped Mario-Y marshal — worthless");
  assert.equal(mismatch.arm, "girder", "the dropped-Y twin must diverge on the girder arm (completeBoardWhenMarioReachesRescueRow's input)");
  console.log(`  TEETH/drop-Y: caught — ${describe(mismatch)}`);
});

test("TEETH: the dropped-carry-marshal twin is CAUGHT at 0x694D on the climb arm", () => {
  // Prove the divergence is the wrong facing byte, not a stack ghost: climb won, X bit7 set,
  // so the correct facing is 0x00 but the stale (clear) carry writes 0x80.
  const won = craftEntry({ board: 0x00, y: 0x00, x: 0x80, rivets: 0x22 });
  const diffs = contractDiffs(won, brokenDropCarryMarshal);
  assert.ok(diffs.length > 0 && diffs[0].startsWith(`RAM@${hx(SPRITE_FLAG)}`),
    `the dropped-carry twin must diverge at ${hx(SPRITE_FLAG)} (wrong facing), got ${diffs.join("; ") || "nothing"}`);
  const { mismatch } = sweep(brokenDropCarryMarshal);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped carry marshal — worthless");
  console.log(`  TEETH/drop-carry: caught — sprite facing ${diffs[0]}; first sweep mismatch ${describe(mismatch)}`);
});

// -- 3. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x1E57 dispatches — loc_1e57 matches oracle (all the girder normal arm)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 200) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1E57 dispatch during attract");

  const arms = { rivet: 0, girder: 0, climb: 0 };
  let won = 0;
  for (const cap of caps) {
    const board = cap.mem.read8(BOARD);
    const y = cap.mem.read8(MARIO_Y);
    const { diffs, ret } = evalCase(cap, loc_1e57);
    assert.equal(diffs.length, 0, `real dispatch board=${hx(board)} Y=${hx(y)}: ${diffs.join("; ")}`);
    if ((board & 0x04) !== 0) arms.rivet++;
    else if ((board & 0x01) !== 0) arms.girder++;
    else arms.climb++;
    if (!ret) won++;
  }
  assert.equal(won, 0, "attract should never win a board (Mario never reaches a board's win position)");
  console.log(`  REALISM: ${caps.length} real 0x1E57 dispatches identical to the oracle (rivet ${arms.rivet}, girder ${arms.girder}, climb ${arms.climb}; ${won} won)`);
});
