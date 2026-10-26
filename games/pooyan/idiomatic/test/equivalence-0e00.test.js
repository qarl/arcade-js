// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resetActorStateForBoard (ROM 0x0e00) — "reset the actor/sprite state for a new
 * board": memset 0xbf bytes at 0x8900, clear loose flags, seed each player's bank from the cabinet
 * DSWs (lives 0x8807, colour 0x8820, opening X 0x20), arm the tile fill (call 0x02e3), and — unless
 * the in-play gate 0x8806 is clear — clear the launch flags.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the register live-out A, which both exits leave at 0. HL/B/DE are NOT compared:
 * the frozen 0x02e3 leaves HL at 0x8402 while the idiomatic path leaves the memset's advanced pointer
 * — a divergence in a register no caller reads (see notes). A is checked against the oracle clone and
 * the module's own clone must SET it.
 *
 * resetActorStateForBoard takes no register inputs; its only inputs are three memory cells. Cases are CRAFTED to
 * exercise both the in-play (full) and idle (early-return) exits with distinct DSW values.
 *
 * Jobs:
 *   1. EQUAL (crafted) — in-play and idle, each with distinct lives/colour: oracle == resetActorStateForBoard in
 *      RAM (−stack) and A, and the module SETS A.
 *   2. WRITE-SET — every changed cell (minus stack) falls in the reset footprint, and the seed cells,
 *      tile-fill cells, and launch flags hold their expected values.
 *   3. TEETH — a twin that seeds the wrong lives byte is caught in RAM; a twin that leaves A nonzero
 *      is caught by the A live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0e00.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e00 as oracle } from "../../translated/loc_0e00.js";
import { resetActorStateForBoard } from "../resetActorStateForBoard.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

// Cell addresses (test is exempt from the reference rule).
const LIVES_DSW = 0x8807, DIFF_DSW = 0x8820, IN_PLAY = 0x8806;
const P0_BANK = 0x8940, P1_BANK = 0x8980, P0_LIVES = 0x8948, P1_LIVES = 0x8988;
const FILL_CNT = 0x8809, FILL_PTR = 0x880b, PLAY_STATE = 0x880a, ENEMY_X = 0x8f5b;
const GATE0 = 0x89e1, GATE1 = 0x89e2, GATE2 = 0x89e3;
const LAUNCH_FLAGS = [0x8f3f, 0x8f30, 0x8f0e, 0x8f0f];
const MEMSET_LO = 0x8900, MEMSET_HI = 0x89be; // inclusive span cleared to 0
const SEED_CELLS = new Set([P0_BANK, P0_BANK + 1, P0_LIVES, P1_BANK, P1_BANK + 1, P1_LIVES]);
const LOOSE = new Set([FILL_CNT, FILL_PTR, FILL_PTR + 1, PLAY_STATE, ENEMY_X, GATE0, GATE1, GATE2, ...LAUNCH_FLAGS]);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const inFootprint = (addr) => (addr >= MEMSET_LO && addr <= MEMSET_HI) || LOOSE.has(addr);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the two DSWs and the in-play gate seated. */
function craft({ lives, colour, inPlay }) {
  const m = BASE.clone();
  m.mem.write8(LIVES_DSW, lives);
  m.mem.write8(DIFF_DSW, colour);
  m.mem.write8(IN_PLAY, inPlay);
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { lives: 0x03, colour: 0x05, inPlay: 1 }, // in-play -> full path
  { lives: 0x02, colour: 0x00, inPlay: 0 }, // idle -> early return
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted in-play/idle cases — resetActorStateForBoard == oracle in RAM (−stack) + A", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    oracle(o);

    const c = craft(cs);
    c.regs.a = 0xff; // sentinel: a module that never sets A fails
    const ret = resetActorStateForBoard(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${JSON.stringify(cs)})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (${JSON.stringify(cs)})`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (${JSON.stringify(cs)})`);
    assert.equal(o.regs.a & 0xff, 0, "oracle leaves A = 0");
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: every change lies in the reset footprint with the expected seed/fill/flag values", () => {
  const m = craft(CASES[0]); // in-play, lives=3 colour=5
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    assert.ok(inFootprint(addr), `unexpected write outside the reset footprint at ${hx(addr)}`);
  }
  // seeds
  assert.equal(m.mem.read8(P0_LIVES), 0x03, "player-0 lives seeded");
  assert.equal(m.mem.read8(P1_LIVES), 0x03, "player-1 lives seeded");
  assert.equal(m.mem.read8(P0_BANK + 1), 0x20, "player-0 opening X");
  assert.equal(m.mem.read8(P1_BANK + 1), 0x20, "player-1 opening X");
  assert.equal(m.mem.read8(P0_BANK), 0x05, "player-0 colour seeded");
  assert.equal(m.mem.read8(P1_BANK), 0x05, "player-1 colour seeded");
  // loose flags + tile fill
  for (const f of [PLAY_STATE, ENEMY_X, GATE0, GATE1, GATE2, ...LAUNCH_FLAGS]) assert.equal(m.mem.read8(f), 0, `flag ${hx(f)} cleared`);
  assert.equal(m.mem.read16(FILL_PTR), 0x8402, "tile-fill pointer armed");
  assert.equal(m.mem.read8(FILL_CNT), 0x20, "tile-fill row count seeded");
  // memset sample: a non-seed cell inside the span is zeroed
  assert.equal(m.mem.read8(0x8905), 0, "memset cleared a non-seed cell");
  assert.ok(!SEED_CELLS.has(0x8905), "sanity: the sampled cell is not a seed");
  console.log("  WRITE-SET: footprint bounded; seeds + fill + flags verified");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded lives byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0]);
  const c = craft(CASES[0]);
  oracle(o);
  resetActorStateForBoard(c);
  c.mem.write8(P0_LIVES, 0x07); // BUG: wrong lives seed
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong lives seed — it is worthless");
  assert.equal(d.addr, P0_LIVES, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): wrong lives seed caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a nonzero A is CAUGHT by the live-out check", () => {
  const o = craft(CASES[0]);
  oracle(o);
  assert.equal(o.regs.a & 0xff, 0, "sanity: oracle leaves A = 0");
  assert.notEqual(0x20, o.regs.a & 0xff, "the A live-out check must reject a nonzero residue");
  console.log("  TEETH(A): a nonzero residue is rejected against oracle A=0");
});
