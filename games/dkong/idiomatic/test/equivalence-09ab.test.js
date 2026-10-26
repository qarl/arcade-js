// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for restorePlayer1Context (ROM 0x09ab) — restore P1's saved
 * context, re-derive the board, and arm the next sub-state.
 *
 * The routine WRITES MEMORY (the 8-byte live context block 0x6228-0x622F, BOARD
 * 0x6227, SUBSTATE_TIMER 0x6009, GAME_SUBSTATE 0x600A) and leaves NO live registers
 * (it is reached via the vblank rst-0x28 sub-state dispatch, which reads none of its
 * residual regs/flags — live-out is memory-only). So it is gated on
 * memory-equivalence over RAM (minus the stack scratch below the entry SP) + pc + SP, and every case runs
 * on a FRESH clone (a reused clone is only safe for a read-only leaf):
 *
 *   1. EQUAL (real driven dispatch) — 0x09ab does NOT run in attract (0 dispatches
 *      over 9000 attract frames): it needs a credited game (GAME_STATE==3). A
 *      coin+start inputTape credits and starts a game, and the game-start context
 *      restore dispatches 0x09ab exactly once at frame 33 on the 0x600F==0
 *      (one-player) arm. The oracle and restorePlayer1Context are run on fresh clones
 *      of that captured entry and compared on RAM (minus the stack scratch below the entry SP) + pc + SP.
 *
 *   2. EQUAL (crafted arms + edges) — clones of the real entry with a surgical poke,
 *      for coverage the single driven dispatch cannot reach:
 *      (a) TWO_PLAYER arm: poke 0x600F = 1 and 0x600F = 0xFF (any non-zero) — arms
 *          the alternation screen (SUBSTATE_TIMER 0x78, GAME_SUBSTATE 2);
 *      (b) distinct-byte context: 8 distinct bytes at 0x6040-0x6047, pinning every
 *          ldir'd field of the live block independently (catches a wrong copy count
 *          or offset);
 *      (c) ldir-before-deref ordering: the OLD live pointer (0x622A) and the restored
 *          pointer (P1_CONTEXT[2..3]) point at different bytes, so BOARD depends on
 *          reading the pointer AFTER the ldir — pins the load-bearing ordering.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) arm-swap: writes the one-player arm's (timer 1, sub-state 5) where the
 *          two-player arm belongs and vice versa — caught on EVERY case (the arms
 *          always differ), including the real one-player dispatch;
 *      (b) stale-pointer: derefs the board pointer BEFORE the ldir (the ordering bug)
 *          — caught on the ordering craft, where old and restored pointers differ.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so
 * runCandidate performs one m.ret() AFTER the call to line pc + SP up with the oracle
 * (which rets internally). The oracle only READS the stack (the ret pop), never writes
 * it, and the popped bytes live in STACK_SCRATCH, so the stack region is byte-equal on
 * both sides and is excluded by the contract exactly as intended.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-09ab.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09ab as oracle } from "../../translated/loc_09ab.js";
import { restorePlayer1Context } from "../restorePlayer1Context.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  P1_CONTEXT,
  LIVES,
  BOARD_SEQ_PTR,
  BOARD,
  TWO_PLAYER_GAME,
  SUBSTATE_TIMER,
  GAME_SUBSTATE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x09ab;
const MAX_FRAMES = 40; // 0x09ab first dispatches at frame 33 under the coin+start tape
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// A coin+start tape: coin on IN2 (0x7d00) bit7 at frame 10, start1 on bit2 at frame 30.
// Credits and starts a game so GAME_STATE reaches 3 and the game-start sub-state
// dispatches 0x09ab at frame 33. Same pinned contract values as the loc_06fe tape.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
  { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
];

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region the standard gate excludes.
 */
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

function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP.
 * Live-out is memory-only (no live registers), so the register file is deliberately
 * NOT compared. Returns a list of human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Drive the coin+start tape and clone the machine at the single real 0x09ab
 * dispatch (frame 33). The wrapper snapshots the entry state, then runs the oracle
 * so the host game proceeds undisturbed.
 */
function captureEntry(maxFrames) {
  let entry = null;
  const snapshot = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  return entry;
}

function makeOrderingCraft(entry) {
  const c = entry.clone();
  // Old live board-seq pointer -> 0x6100 (value 0xAA); restored pointer (P1_CONTEXT
  // bytes 2/3) -> 0x6102 (value 0xBB). After the ldir, 0x622A holds 0x6102, so the
  // deref must read the RESTORED pointer (0xBB), not the stale one (0xAA).
  c.mem.write8(BOARD_SEQ_PTR, 0x00);
  c.mem.write8(BOARD_SEQ_PTR + 1, 0x61); // old 0x622A = 0x6100
  c.mem.write8(P1_CONTEXT + 2, 0x02);
  c.mem.write8(P1_CONTEXT + 3, 0x61);    // restored 0x622A = 0x6102
  c.mem.write8(0x6100, 0xaa);            // stale target
  c.mem.write8(0x6102, 0xbb);            // restored target
  return c;
}

// -- broken twins -------------------------------------------------------------

function brokenArmSwap(m) {
  const { mem } = m;
  for (let i = 0; i < 8; i++) mem.write8(LIVES + i, mem.read8(P1_CONTEXT + i));
  mem.write8(BOARD, mem.read8(mem.read16(BOARD_SEQ_PTR)));
  if (mem.read8(TWO_PLAYER_GAME) === 0) {
    mem.write8(SUBSTATE_TIMER, 0x78); // BUG: one-player arm should be (1, 5)
    mem.write8(GAME_SUBSTATE, 0x02);
  } else {
    mem.write8(SUBSTATE_TIMER, 0x01); // BUG: two-player arm should be (0x78, 2)
    mem.write8(GAME_SUBSTATE, 0x05);
  }
}

function brokenStalePointer(m) {
  const { mem } = m;
  mem.write8(BOARD, mem.read8(mem.read16(BOARD_SEQ_PTR))); // BUG: before the ldir
  for (let i = 0; i < 8; i++) mem.write8(LIVES + i, mem.read8(P1_CONTEXT + i));
  if (mem.read8(TWO_PLAYER_GAME) === 0) {
    mem.write8(SUBSTATE_TIMER, 0x01);
    mem.write8(GAME_SUBSTATE, 0x05);
  } else {
    mem.write8(SUBSTATE_TIMER, 0x78);
    mem.write8(GAME_SUBSTATE, 0x02);
  }
}

// -- 1. EQUAL (real driven dispatch) ------------------------------------------

test("EQUAL (real dispatch): restorePlayer1Context == oracle on the frame-33 game-start entry", () => {
  const entry = captureEntry(MAX_FRAMES);
  assert.ok(entry, "expected one real 0x09ab dispatch under the coin+start tape (frame 33)");
  assert.equal(entry.mem.read8(TWO_PLAYER_GAME), 0, "the driven entry is expected on the 0x600F==0 arm");

  const diffs = contractDiffs(entry, restorePlayer1Context); // FRESH clones inside — entry untouched
  assert.equal(diffs.length, 0, diffs.join("; "));
  console.log(
    `  EQUAL/real: game-start dispatch identical (0x600F==0, one-player: ` +
      `SUBSTATE_TIMER=1 GAME_SUBSTATE=5), SP=0x${entry.regs.sp.toString(16)}`,
  );
});

// -- 2. EQUAL (crafted arms + edges) ------------------------------------------

test("EQUAL (crafted): two-player arm + distinct-byte context + ldir-before-deref ordering match the oracle", () => {
  const entry = captureEntry(MAX_FRAMES);
  assert.ok(entry, "need the real capture to seed crafted entries with real RAM");

  const twoP = entry.clone();
  twoP.mem.write8(TWO_PLAYER_GAME, 0x01);
  const twoPff = entry.clone();
  twoPff.mem.write8(TWO_PLAYER_GAME, 0xff);

  // (b) distinct-byte context pins every ldir'd field of the live block independently.
  // Bytes 2/3 (0x6042/0x6043) become the restored board-seq pointer, so they are set
  // to a MAPPED work-RAM address (0x6150, seeded 0x99) while staying distinct.
  const distinct = entry.clone();
  const PATTERN = [0x11, 0x22, 0x50, 0x61, 0x55, 0x66, 0x77, 0x88]; // b2,b3 -> ptr 0x6150
  for (let i = 0; i < 8; i++) distinct.mem.write8(P1_CONTEXT + i, PATTERN[i]);
  distinct.mem.write8(0x6150, 0x99); // deref target for the pinned pointer

  const ordering = makeOrderingCraft(entry);

  const cases = [
    { name: "two-player arm (0x600F=1)", e: twoP },
    { name: "two-player arm (0x600F=0xFF)", e: twoPff },
    { name: "distinct-byte context (0x6040-0x6047)", e: distinct },
    { name: "ldir-before-deref ordering", e: ordering },
  ];
  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, restorePlayer1Context);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }

  const orderOut = runOracle(makeOrderingCraft(entry));
  assert.equal(orderOut.mem.read8(BOARD), 0xbb, "ordering craft must derive BOARD from the restored pointer (0xBB)");

  console.log(`  EQUAL/crafted: ${cases.length} arms identical to the oracle (incl. two-player arm + ordering pin)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the arm-swap twin and the stale-pointer twin are CAUGHT", () => {
  const entry = captureEntry(MAX_FRAMES);
  assert.ok(entry, "need the real capture to run the teeth");

  // (a) arm-swap: caught on the real one-player dispatch (arms 0x78/2 vs 1/5).
  const swapDiffs = contractDiffs(entry, brokenArmSwap);
  assert.ok(swapDiffs.length > 0, "the arm-swap twin escaped on the real dispatch — the gate is worthless");

  const twoP = entry.clone();
  twoP.mem.write8(TWO_PLAYER_GAME, 0x01);
  assert.ok(contractDiffs(twoP, brokenArmSwap).length > 0, "arm-swap twin escaped on the two-player arm");

  // (b) stale-pointer: caught on the ordering craft (BOARD 0xAA vs 0xBB).
  const ordering = makeOrderingCraft(entry);
  const staleDiffs = contractDiffs(ordering, brokenStalePointer);
  assert.ok(staleDiffs.length > 0, "the stale-pointer twin escaped on the ordering craft — the gate is worthless");

  console.log(
    `  TEETH: arm-swap caught on real one-player dispatch (${swapDiffs[0]}); ` +
      `stale-pointer caught on ordering craft (${staleDiffs[0]})`,
  );
});
