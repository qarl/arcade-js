// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for reseedSpawnCountersAndArmPlayMode (ROM 0x1a01, Pooyan) — gameplay-state handler.
 *
 * SEATING: BALANCED (plain tail-branches, no seated return) -> WIRE. Void handler: no caller reads
 * a register back, so LIVE-OUT is memory only and the comparison is RAM (dumpState) minus
 * stack scratch below the entry SP; the caller-page H the tail into saveLiveStateToPlayerBank needs is a compile-time
 * literal here (0x89 / 0x81), so no register bridge is in play.
 *
 * Paths crafted: odd-frame save; credit-gate teardown; latch-set block clear; latch-arm; plus an
 * H-page-dirtied latch-set that pre-loads DISTINCT nonzero bytes into the 0x81 and 0x89 status
 * cells so the saveLiveStateToPlayerBank(m, 0x81) page choice is a real tooth (a 0x81->0x89 flip
 * would land the clear on 0x8904 instead of 0x8104 and DIVERGE).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1a01.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a01 as oracle } from "../../translated/loc_1a01.js";
import { reseedSpawnCountersAndArmPlayMode } from "../reseedSpawnCountersAndArmPlayMode.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROUND_COUNTER,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  ACTIVE_PLAYER,
  STAGE_COUNTDOWN,
  LAUNCH_SCRIPT_PTR,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat SP/interrupt/E state and the branch-selecting cells. */
function seat(m, { round = 0x00, active = 0x01, latch = 0x00, player = 0x00 } = {}) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.e = 0x00;
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, latch);
  m.mem.write8(ACTIVE_PLAYER, player);
  return m;
}

// The H-page status bytes cleared by saveLiveStateToPlayerBank(m, H): H=0x81 -> 0x8104, H=0x89 -> 0x8904.
const STATUS_BYTE_81 = (0x81 << 8) | 0x04; // 0x8104 — cleared only on the latch-set (H=0x81) tail
const STATUS_BYTE_89 = (0x89 << 8) | 0x04; // 0x8904 — cleared on every other tail (H=0x89)
const DIRT_81 = 0xa5; //  distinct nonzero pre-load for 0x8104
const DIRT_89 = 0x5a; //  distinct nonzero pre-load for 0x8904 (also live-page byte 4 -> copied to 0x8944)

const CASES = {
  "odd frame -> save (H=0x89)": (m) => seat(m, { round: 0x00 }), // +1 -> 1 odd
  "credit gate closed -> teardown": (m) => seat(m, { round: 0x01, active: 0x00 }), // +1 -> 2 even
  "latch set -> clear block, save (H=0x81)": (m) => seat(m, { round: 0x01, active: 0x01, latch: 0x02 }),
  "latch arm -> save (H=0x89)": (m) => seat(m, { round: 0x01, active: 0x01, latch: 0x00 }),
  // Same latch-set path, but with BOTH H-page status bytes pre-dirtied to DISTINCT nonzero values so
  // the 0x81-vs-0x89 page choice inside the tail is observable: on H=0x81 only 0x8104 is zeroed while
  // 0x8904 (=live byte 4) survives and copies to 0x8944; a 0x81->0x89 flip zeroes 0x8904/0x8944 and
  // leaves 0x8104 dirty instead -> RAM diff DIVERGES.
  "latch set + H-page dirtied -> clear block, save (H=0x81)": (m) => {
    seat(m, { round: 0x01, active: 0x01, latch: 0x02 });
    m.mem.write8(STATUS_BYTE_81, DIRT_81);
    m.mem.write8(STATUS_BYTE_89, DIRT_89);
    return m;
  },
};

test("EQUAL: reseedSpawnCountersAndArmPlayMode == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    reseedSpawnCountersAndArmPlayMode(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

test("WRITE-SET: the latch-arm path arms the latch, countdown and launch cells", () => {
  const m = CASES["latch arm -> save (H=0x89)"](BASE.clone());
  oracle(m);
  assert.equal(m.mem.read8(PLAY_MODE_LATCH), 0x01, "latch armed to 1");
  assert.equal(m.mem.read8(STAGE_COUNTDOWN), 0x01, "stage countdown seeded to 1");
  assert.equal(m.mem.read8(LAUNCH_SCRIPT_PTR), 0x40, "launch script ptr seeded to 0x40");
  console.log("  WRITE-SET: latch/countdown/launch armed");
});

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["latch arm -> save (H=0x89)"](BASE.clone());
  const c = CASES["latch arm -> save (H=0x89)"](BASE.clone());
  oracle(o);
  reseedSpawnCountersAndArmPlayMode(c);
  c.mem.write8(PLAY_MODE_LATCH, (o.mem.read8(PLAY_MODE_LATCH) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH: a twin that skips the latch arm diverges from the oracle", () => {
  const o = CASES["latch arm -> save (H=0x89)"](BASE.clone());
  const c = CASES["latch arm -> save (H=0x89)"](BASE.clone());
  oracle(o); // arms the latch and runs the tail save
  // twin: do nothing -> the seated cells survive
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped latch arm must be caught by the RAM diff");
  console.log(`  TEETH(arm): caught at ${hx(d.addr ?? 0)}`);
});

test("TEETH(H-page): the latch-set tail clears 0x8104, NOT 0x8904 (0x81 vs 0x89)", () => {
  // Live-out pinned from the ORACLE: on the H=0x81 tail, saveLiveStateToPlayerBank zeroes 0x8104
  // and leaves 0x8904 (live-page byte 4) intact, which the block copy then lands at 0x8944. A
  // module that ran the tail with H=0x89 would show the mirror image; the EQUAL case above catches it.
  const o = CASES["latch set + H-page dirtied -> clear block, save (H=0x81)"](BASE.clone());
  oracle(o);
  assert.equal(o.mem.read8(STATUS_BYTE_81), 0x00, "H=0x81 page status byte 0x8104 cleared");
  assert.equal(o.mem.read8(STATUS_BYTE_89), DIRT_89, "H=0x89 page status byte 0x8904 untouched");
  assert.equal(o.mem.read8(0x8944), DIRT_89, "surviving 0x8904 copied into player-0 bank at 0x8944");
  console.log("  TEETH(H-page): oracle cleared 0x8104, spared 0x8904");
});
