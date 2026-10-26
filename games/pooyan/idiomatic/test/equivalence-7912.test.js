// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickActivePlayerPlayTimer (ROM 0x7912, Pooyan) — the active player's BCD play-timer tick.
 * Bails when the game is inactive or the selected gate byte is set; otherwise it advances a frame
 * sub-counter (base byte) up to 0x3b/0x3c (the extra frame chosen by bit0 of the seconds byte) and,
 * on the roll, BCD-carries the seconds then minutes digit (low nibble rolls at 0x0a, high nibble at
 * 0x60). It is a LEAF that calls nothing.
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). There is no register live-out — every exit
 * is a plain ret and no caller reads a register/flag back — so the register file is not compared. Every
 * arm is CRAFTED: the routine's inputs (GAME_ACTIVE_FLAG, ACTIVE_PLAYER, the gate byte, and the three
 * timer bytes) are poked identically on both sides, which is also the only way to reach the carry arms.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack) across inactive, gated, plain-tick, frame-roll,
 *      seconds-carry, seconds->minutes-carry, minutes-carry, and the P2 bank.
 *   2. WRITE-SET — the seconds->minutes carry writes exactly base:=0, seconds:=0, minutes+=1.
 *   3. TEETH — a wrong written byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7912.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7912 as oracle } from "../../translated/loc_7912.js";
import { tickActivePlayerPlayTimer } from "../tickActivePlayerPlayTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  ACTIVE_PLAYER,
  PLAY_TIMER_GATE_P1,
  PLAY_TIMER_GATE_P2,
  PLAY_TIMER_BCD_P1,
  PLAY_TIMER_BCD_P2,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Seat all of tickActivePlayerPlayTimer's inputs for the active-player bank on a fresh clone. */
function craft({ active = 1, player = 0, gate = 0, base = 0, sec = 0, min = 0 }) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active & 0xff);
  m.mem.write8(ACTIVE_PLAYER, player & 0xff);
  const gAddr = player === 0 ? PLAY_TIMER_GATE_P1 : PLAY_TIMER_GATE_P2;
  const tAddr = player === 0 ? PLAY_TIMER_BCD_P1 : PLAY_TIMER_BCD_P2;
  m.mem.write8(gAddr, gate & 0xff);
  m.mem.write8(tAddr, base & 0xff);
  m.mem.write8((tAddr + 1) & 0xffff, sec & 0xff);
  m.mem.write8((tAddr + 2) & 0xffff, min & 0xff);
  m.regs.sp = 0x8fe0; // the oracle's ret only reads the dead stack region
  return m;
}

// bit0 of the seconds byte selects the frame limit: even -> 0x3b, odd -> 0x3c.
const CASES = [
  { name: "inactive", active: 0, player: 0, gate: 0, base: 0x10, sec: 0x00, min: 0x00 },
  { name: "gated-P1", active: 1, player: 0, gate: 0x01, base: 0x10, sec: 0x00, min: 0x00 },
  { name: "tick-below-limit-3b", active: 1, player: 0, gate: 0, base: 0x10, sec: 0x00, min: 0x00 },
  { name: "tick-below-limit-3c", active: 1, player: 0, gate: 0, base: 0x3b, sec: 0x01, min: 0x00 },
  { name: "frame-roll", active: 1, player: 0, gate: 0, base: 0x3b, sec: 0x00, min: 0x00 },
  { name: "seconds-units-carry", active: 1, player: 0, gate: 0, base: 0x3c, sec: 0x09, min: 0x00 },
  { name: "seconds->minutes-carry", active: 1, player: 0, gate: 0, base: 0x3c, sec: 0x59, min: 0x02 },
  { name: "minutes-units-carry", active: 1, player: 0, gate: 0, base: 0x3c, sec: 0x59, min: 0x09 },
  { name: "P2-tick-below-limit", active: 1, player: 1, gate: 0, base: 0x10, sec: 0x00, min: 0x00 },
  { name: "P2-frame-roll", active: 1, player: 1, gate: 0, base: 0x3b, sec: 0x00, min: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: tickActivePlayerPlayTimer == oracle in RAM (−stack) across all timer arms", () => {
  for (const cfg of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    tickActivePlayerPlayTimer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (${cfg.name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted timer arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the seconds->minutes carry writes base:=0, seconds:=0, minutes+=1", () => {
  const cfg = CASES.find((c) => c.name === "seconds->minutes-carry");
  const before = craft(cfg);
  const after = craft(cfg);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  const byAddr = new Map(changed.map((ch) => [ch.addr, ch]));
  assert.equal(changed.length, 3, `expected exactly 3 writes, got ${changed.length}`);
  assert.equal(byAddr.get(PLAY_TIMER_BCD_P1)?.to, 0x00, "base frame counter must roll to 0");
  assert.equal(byAddr.get((PLAY_TIMER_BCD_P1 + 1) & 0xffff)?.to, 0x00, "seconds must roll to 0 at 60");
  assert.equal(byAddr.get((PLAY_TIMER_BCD_P1 + 2) & 0xffff)?.to, 0x03, "minutes must carry 0x02 -> 0x03");
  console.log("  WRITE-SET: base:=0, seconds:=0, minutes 0x02->0x03 (3 cells)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written byte is CAUGHT by the RAM diff", () => {
  const cfg = CASES.find((c) => c.name === "frame-roll");
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  tickActivePlayerPlayTimer(c);
  c.mem.write8((PLAY_TIMER_BCD_P1 + 1) & 0xffff, 0x00); // BUG: seconds should have incremented to 0x01

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong seconds byte — it is worthless");
  assert.equal(d.addr, (PLAY_TIMER_BCD_P1 + 1) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seconds byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
