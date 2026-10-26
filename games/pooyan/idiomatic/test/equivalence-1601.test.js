// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for initRoundArenaAndRestorePlayerBank (ROM 0x1601, Pooyan) — the round-init state handler. It blanks
 * one tilemap row and returns early until the fill drains; once drained it re-arms the fill, clears
 * the actor arena and several round-init cells, on the first entry of a two-player round raises the
 * once-per-round latch / enqueues a player-select display command / floods the attribute map, then in
 * the shared tail seeds the phase timer, advances the play sub-state, restores the active player's
 * saved bank into the live page, adjusts the rope-segment count, and (unless gated) copies the round
 * message table into the message buffer.
 *
 * Cycle-free memory-equivalence gate: a FRESH clone per side (the routine writes RAM), compared on
 * RAM (dumpState, minus stack scratch below the entry SP — the oracle drives its callees through m.call/m.step, whose
 * return-address pushes land in the dead stack). pc/SP/cycles are NOT compared, and there is NO
 * register/flag live-out: initRoundArenaAndRestorePlayerBank is a table-dispatched state handler whose caller does not read a
 * result register back. The oracle runs entirely in the translated layer (its m.call resolves the
 * frozen callees); initRoundArenaAndRestorePlayerBank runs its idiomatic callees. Each callee's own gate proves the two agree,
 * so RAM equivalence over composed inputs is the fidelity contract here.
 *
 * NOTE on coupling: the bank->live-page copy writes 0x8900..0x893e, which contains the cells the tail
 * then reads (arrival count 0x8903, gate 0x8906) and overwrites (0x8905/0x890a/0x8931). So the seeded
 * bank bytes at offsets 3 and 6 drive the rope-adjust and message-copy branches; both sides do the
 * identical copy-then-read, so they agree regardless.
 *
 * Jobs:
 *   1. EQUAL (crafted) — early-return (fill not drained), single-player, two-player first-entry
 *      (both player/cabinet variants), latch-already-set, message-copy, and rope-skip cases:
 *      oracle == initRoundArenaAndRestorePlayerBank in RAM (−stack).
 *   2. CONTRACT — a first-entry case: document the owned cells the oracle produces (phase timer,
 *      sub-state bump, cleared cells, raised latch, flip flag, the copied live page).
 *   3. TEETH — a wrong phase-timer byte and a wrong copied live-page byte are each caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1601.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1601 as oracle } from "../../translated/loc_1601.js";
import { initRoundArenaAndRestorePlayerBank } from "../initRoundArenaAndRestorePlayerBank.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  FILL_ROW_COUNTER,
  TILE_FILL_PTR,
  TWO_PLAYER_FLAG,
  loc_89e3,
  CABINET_MODE_FLAG,
  ACTIVE_PLAYER,
  FLIP_SCREEN_FLAG,
  PHASE_TIMER,
  PLAY_STATE_INDEX,
  PLAYER0_STATE_BANK,
  PLAYER1_STATE_BANK,
  SPEED_INDEX,
  WAVE_EVENT_LATCH,
  ROPE_EXTEND_TIMER,
  ROPE_SEGMENT_COUNT,
  loc_8905,
  DISPLAY_MSG_BUF,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LIVE_PAGE = SPEED_INDEX; // 0x8900, ldir destination
const BANK_SIZE = 0x3f;
const VRAM_FILL = 0x8400; // where the seeded fill cursor points

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function seedBank(m, base, b3, b6) {
  for (let i = 0; i < BANK_SIZE; i++) m.mem.write8((base + i) & 0xffff, (0x40 + i) & 0xff);
  m.mem.write8((base + 3) & 0xffff, b3 & 0xff); // drives the rope-adjust branch (via 0x8903 after ldir)
  m.mem.write8((base + 6) & 0xffff, b6 & 0xff); // drives the message-copy branch (via 0x8906 after ldir)
}

/** A fresh clone with the round-init control cells + both player banks seated identically. */
function craft(c) {
  const m = BASE.clone();
  m.mem.write8(FILL_ROW_COUNTER, c.rowCounter & 0xff);
  m.mem.write8(TILE_FILL_PTR, VRAM_FILL & 0xff);
  m.mem.write8((TILE_FILL_PTR + 1) & 0xffff, (VRAM_FILL >> 8) & 0xff);
  m.mem.write8(TWO_PLAYER_FLAG, c.twoPlayer & 0xff);
  m.mem.write8(loc_89e3, c.latch & 0xff);
  m.mem.write8(CABINET_MODE_FLAG, c.cabinet & 0xff);
  m.mem.write8(ACTIVE_PLAYER, c.activePlayer & 0xff);
  m.mem.write8(PLAY_STATE_INDEX, 0x00);
  m.mem.write8(FLIP_SCREEN_FLAG, 0x00);
  seedBank(m, PLAYER0_STATE_BANK, c.bankB3, c.bankB6);
  seedBank(m, PLAYER1_STATE_BANK, c.bankB3, c.bankB6);
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH; the oracle's trampolines push here
  return m;
}

// defaults: full-path (drained), two-player off, latch clear, cabinet off, player 0, bank pattern
const D = { rowCounter: 1, twoPlayer: 0, latch: 0, cabinet: 0, activePlayer: 0, bankB3: 0x43, bankB6: 0x46 };
const CASES = [
  ["early return: fill not drained", { ...D, rowCounter: 2 }],
  ["single-player full path (phase timer 0x02)", { ...D, twoPlayer: 0 }],
  ["two-player first-entry, player 0, cabinet off", { ...D, twoPlayer: 1, latch: 0, cabinet: 0, activePlayer: 0 }],
  ["two-player first-entry, player 1, cabinet on", { ...D, twoPlayer: 1, latch: 0, cabinet: 1, activePlayer: 1 }],
  ["two-player, latch already set (phase timer = latch)", { ...D, twoPlayer: 1, latch: 0x05 }],
  ["message-copy path (0x8906 reads 0)", { ...D, bankB6: 0x00 }],
  ["rope-skip + message-copy (0x8903 & 0x8906 read 0)", { ...D, bankB3: 0x00, bankB6: 0x00 }],
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted round-init cases — initRoundArenaAndRestorePlayerBank == oracle in RAM (−stack)", () => {
  for (const [label, c] of CASES) {
    const o = craft(c);
    const cc = craft(c);
    oracle(o);
    initRoundArenaAndRestorePlayerBank(cc);
    const d = ramDiffMinusStack(o, cc);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. CONTRACT --------------------------------------------------------------

test("CONTRACT: first-entry (player 0) produces the documented owned cells", () => {
  const o = craft({ ...D, twoPlayer: 1, latch: 0, cabinet: 0, activePlayer: 0 });
  oracle(o);
  assert.equal(o.mem.read8(PHASE_TIMER), 0x80, "first-entry seeds the phase timer to 0x80");
  assert.equal(o.mem.read8(PLAY_STATE_INDEX), 0x01, "play sub-state bumped from 0 to 1");
  assert.equal(o.mem.read8(WAVE_EVENT_LATCH), 0x00, "wave-event latch cleared");
  assert.equal(o.mem.read8(ROPE_EXTEND_TIMER), 0x00, "rope-extend timer cleared");
  assert.equal(o.mem.read8(loc_89e3), 0x01, "once-per-round latch raised");
  assert.equal(o.mem.read8(FLIP_SCREEN_FLAG), 0xff, "flip flag = (activePlayer - 1) on the cabinet-off branch");
  assert.equal(o.mem.read8(LIVE_PAGE), 0x40, "live page[0] holds the copied player-0 bank byte");
  assert.equal(o.mem.read8((LIVE_PAGE + 2) & 0xffff), 0x42, "live page[2] copied from the bank");
  assert.equal(o.mem.read8(loc_8905), 0x45, "0x8905 holds copied bank[5] (this scenario takes the ret-nz path, which skips the 0x8905 clear)");
  assert.equal(o.mem.read8(ROPE_SEGMENT_COUNT), 0x41, "rope-segment count = bank[3] (0x43) - 2");
  assert.equal(o.mem.read8(DISPLAY_MSG_BUF), 0x00, "message buffer untouched on the ret-nz (bank[6]!=0) path");
  console.log("  CONTRACT: first-entry owned cells match the documented behaviour");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong phase-timer byte is CAUGHT by the RAM diff", () => {
  const c = { ...D, twoPlayer: 1, latch: 0, cabinet: 0, activePlayer: 0 };
  const o = craft(c);
  const cc = craft(c);
  oracle(o);
  initRoundArenaAndRestorePlayerBank(cc);
  cc.mem.write8(PHASE_TIMER, (cc.mem.read8(PHASE_TIMER) ^ 0x01) & 0xff); // BUG: corrupt the phase timer
  const d = ramDiffMinusStack(o, cc);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase-timer byte — it is worthless");
  assert.equal(d.addr, PHASE_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/phase: wrong phase-timer byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong copied live-page byte is CAUGHT by the RAM diff", () => {
  const c = { ...D, twoPlayer: 0, activePlayer: 0 };
  const o = craft(c);
  const cc = craft(c);
  oracle(o);
  initRoundArenaAndRestorePlayerBank(cc);
  cc.mem.write8(LIVE_PAGE, (cc.mem.read8(LIVE_PAGE) ^ 0x01) & 0xff); // BUG: corrupt the ldir'd byte
  const d = ramDiffMinusStack(o, cc);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte — it is worthless");
  assert.equal(d.addr, LIVE_PAGE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/livepage: wrong copied byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
