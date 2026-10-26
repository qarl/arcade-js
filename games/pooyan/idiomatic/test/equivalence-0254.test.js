// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for repaintScrollColumnsElseVerifySignature (ROM 0x0254) — the per-frame scroll-column worker.
 *
 * Branch selectors are four work-RAM cells: the control byte (low nibble gates the ROM-signature
 * check, bit 4 gates the final blank), the game-active flag (nonzero to run, bit 0 gates the final
 * blank), the two-player flag (0 = paint four blank columns then the shared column; nonzero =
 * paint a capped body column then the shared column), and the active-player select (picks which
 * column the final blank targets).
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and
 * there is NO register live-out — the main state driver reloads every register right after this
 * returns, so nothing it leaves is consumed.
 *
 * All cases are CRAFTED: the four selector cells are poked identically on both sides, sp seated
 * inside STACK_SCRATCH so every push/call/ret the oracle makes stays there. The signature-check
 * path writes nothing against the intact ROM.
 *
 * Jobs:
 *   1. EQUAL — over the six branch paths, oracle == repaintScrollColumnsElseVerifySignature in RAM (−stack).
 *   2. WRITE-SET — the two-player + final-blank path writes exactly the two three-cell columns.
 *   3. TEETH — a wrong written column byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0254.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0254 as oracle } from "../../translated/loc_0254.js";
import { repaintScrollColumnsElseVerifySignature } from "../repaintScrollColumnsElseVerifySignature.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  WORKER_CONTROL_BYTE,
  GAME_ACTIVE_FLAG,
  TWO_PLAYER_FLAG,
  ACTIVE_PLAYER,
  COLUMN_CAP_VRAM,
  WORKER_COLUMN_VRAM,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_BLANK = 0x10;
const TILE_CAP = 0x01;
const TILE_MID = 0x25;
const TILE_BASE = 0x20;
const ROW = 0x20; // one tilemap row
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the four branch selectors seated. */
function craft(control, gameActive, twoPlayer, activePlayer) {
  const m = BASE.clone();
  m.mem.write8(WORKER_CONTROL_BYTE, control & 0xff);
  m.mem.write8(GAME_ACTIVE_FLAG, gameActive & 0xff);
  m.mem.write8(TWO_PLAYER_FLAG, twoPlayer & 0xff);
  m.mem.write8(ACTIVE_PLAYER, activePlayer & 0xff);
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH; the oracle's push/call/ret stay there
  return m;
}

// (label, control, gameActive, twoPlayer, activePlayer)
const CASES = [
  { label: "signature-check path (low nibble set)", control: 0x03, gameActive: 0x00, twoPlayer: 0x00, activePlayer: 0x00 },
  { label: "game inactive -> return", control: 0x00, gameActive: 0x00, twoPlayer: 0x00, activePlayer: 0x00 },
  { label: "1P, bit4 clear -> no final blank", control: 0x00, gameActive: 0x01, twoPlayer: 0x00, activePlayer: 0x00 },
  { label: "1P, bit4 + active-bit0 -> final blank at worker column", control: 0x10, gameActive: 0x01, twoPlayer: 0x00, activePlayer: 0x00 },
  { label: "2P, active-player 1 -> final blank at cap column", control: 0x10, gameActive: 0x01, twoPlayer: 0x01, activePlayer: 0x01 },
  { label: "1P, bit4 set but active-bit0 clear -> no final blank", control: 0x10, gameActive: 0x02, twoPlayer: 0x00, activePlayer: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted branch paths — repaintScrollColumnsElseVerifySignature == oracle in RAM (−stack)", () => {
  for (const { label, control, gameActive, twoPlayer, activePlayer } of CASES) {
    const o = craft(control, gameActive, twoPlayer, activePlayer);
    const c = craft(control, gameActive, twoPlayer, activePlayer);
    oracle(o);
    repaintScrollColumnsElseVerifySignature(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} ("${label}")`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted branch paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the 2P + final-blank path writes exactly the two three-cell columns", () => {
  // Pre-dirty the six target cells to 0xAA so every write shows in the diff.
  const targets = [
    COLUMN_CAP_VRAM, COLUMN_CAP_VRAM - ROW, COLUMN_CAP_VRAM - 2 * ROW,
    WORKER_COLUMN_VRAM, WORKER_COLUMN_VRAM - ROW, WORKER_COLUMN_VRAM - 2 * ROW,
  ];
  const expected = new Map([
    [COLUMN_CAP_VRAM, TILE_BLANK], [COLUMN_CAP_VRAM - ROW, TILE_BLANK], [COLUMN_CAP_VRAM - 2 * ROW, TILE_BLANK],
    [WORKER_COLUMN_VRAM, TILE_CAP], [WORKER_COLUMN_VRAM - ROW, TILE_MID], [WORKER_COLUMN_VRAM - 2 * ROW, TILE_BASE],
  ]);

  const before = craft(0x10, 0x01, 0x01, 0x01);
  const after = craft(0x10, 0x01, 0x01, 0x01);
  for (const t of targets) { before.mem.write8(t, 0xaa); after.mem.write8(t, 0xaa); }
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.set(addr, a1[off]);
  }
  for (const [addr, val] of expected) {
    assert.equal(after.mem.read8(addr), val, `column cell ${hx(addr)} must hold ${hx(val)}`);
  }
  for (const addr of changed.keys()) {
    assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  }
  console.log(`  WRITE-SET: blank column at ${hx(COLUMN_CAP_VRAM)} + body column at ${hx(WORKER_COLUMN_VRAM)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written column byte is CAUGHT by the RAM diff", () => {
  const { control, gameActive, twoPlayer, activePlayer } = CASES[4]; // 2P + final blank
  const o = craft(control, gameActive, twoPlayer, activePlayer);
  const c = craft(control, gameActive, twoPlayer, activePlayer);
  oracle(o);
  repaintScrollColumnsElseVerifySignature(c);
  c.mem.write8(WORKER_COLUMN_VRAM, 0x00); // BUG: this cell must hold the cap tile
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong column byte — it is worthless");
  assert.equal(d.addr, WORKER_COLUMN_VRAM, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong column byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
