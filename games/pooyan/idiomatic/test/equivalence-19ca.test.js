// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickIdleSirenAndTogglePhase (ROM 0x19ca) — "periodic warning-siren tick".
 *
 * The cycle-free / memory-equivalence gate: oracle and module run on fresh clones and are
 * compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are not compared.
 *
 * LIVE-OUT: memory only — the countdown, the phase byte, and any enqueued display command.
 * A per-frame tick whose scratch registers no caller reads.
 *
 * The leaf is not reached in a plain boot/attract, so every case is CRAFTED: the two gate
 * cells, the countdown, the phase byte, and the display ring are poked identically on both
 * clones. The enqueue path needs a free ring slot (bit 7 set), poked in craft().
 *
 * Jobs:
 *   1. EQUAL — over crafted gate/countdown/phase states oracle == tickIdleSirenAndTogglePhase in RAM (−stack),
 *      including the two toggle phases and both early gates.
 *   2. WRITE-SET — on expiry the writes are the reloaded countdown, the flipped phase byte,
 *      and (when the slot is free) the two ring bytes + the ring write pointer.
 *   3. TEETH — a wrong phase byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-19ca.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19ca as oracle } from "../../translated/loc_19ca.js";
import { tickIdleSirenAndTogglePhase } from "../tickIdleSirenAndTogglePhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  SIREN_ENABLE_GATE,
  SIREN_FRAME_COUNTDOWN,
  SIREN_PHASE_BYTE,
  DISPLAY_CMD_RING_WRITE_PTR,
} from "../names.js";

const RING_PAGE = DISPLAY_CMD_RING_WRITE_PTR & 0xff00; // display ring shares the pointer's page
const FREE_SLOT_LOW = 0xc0; //                            a free ring slot for the enqueue path
const RELOAD = 0x18;

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(pokes) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  // A free ring slot so the enqueue path actually stores (harmless for the other cases).
  m.mem8[DISPLAY_CMD_RING_WRITE_PTR] = FREE_SLOT_LOW;
  m.mem8[RING_PAGE + FREE_SLOT_LOW] = 0x80;
  for (const [addr, val] of pokes) m.mem8[addr] = val;
  return m;
}

const CASES = [
  { name: "game active -> no siren", pokes: [[GAME_ACTIVE_FLAG, 0x01], [SIREN_ENABLE_GATE, 0x01]] },
  { name: "siren disabled", pokes: [[GAME_ACTIVE_FLAG, 0x00], [SIREN_ENABLE_GATE, 0x00]] },
  {
    name: "countdown not expired",
    pokes: [[GAME_ACTIVE_FLAG, 0x00], [SIREN_ENABLE_GATE, 0x01], [SIREN_FRAME_COUNTDOWN, 0x05]],
  },
  {
    name: "expire, phase bit0 clear -> cmd A",
    pokes: [[GAME_ACTIVE_FLAG, 0x00], [SIREN_ENABLE_GATE, 0x01], [SIREN_FRAME_COUNTDOWN, 0x01], [SIREN_PHASE_BYTE, 0x00]],
  },
  {
    name: "expire, phase bit0 set -> cmd B",
    pokes: [[GAME_ACTIVE_FLAG, 0x00], [SIREN_ENABLE_GATE, 0x01], [SIREN_FRAME_COUNTDOWN, 0x01], [SIREN_PHASE_BYTE, 0x01]],
  },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/countdown/phase — tickIdleSirenAndTogglePhase == oracle in RAM (−stack)", () => {
  for (const { name, pokes } of CASES) {
    const o = craft(pokes);
    const c = craft(pokes);
    oracle(o);
    tickIdleSirenAndTogglePhase(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (${name})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: on expiry — countdown reload, phase flip, and enqueued command", () => {
  const pokes = [[GAME_ACTIVE_FLAG, 0x00], [SIREN_ENABLE_GATE, 0x01], [SIREN_FRAME_COUNTDOWN, 0x01], [SIREN_PHASE_BYTE, 0x00]];
  const before = craft(pokes);
  const after = craft(pokes);
  const b = before.dumpState();
  oracle(after);
  const a = after.dumpState();

  const changed = new Set();
  for (let off = 0; off < b.length; off++) {
    if (b[off] === a[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // exclude the oracle's own push/pop scratch (matches EQUAL's ramDiffMinusStack)
    changed.add(addr);
  }
  const expected = new Set([
    SIREN_FRAME_COUNTDOWN, SIREN_PHASE_BYTE,
    RING_PAGE + FREE_SLOT_LOW, RING_PAGE + FREE_SLOT_LOW + 1, DISPLAY_CMD_RING_WRITE_PTR,
  ]);
  for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  assert.equal(after.mem8[SIREN_FRAME_COUNTDOWN], RELOAD, "countdown reloaded to 0x18");
  assert.equal(after.mem8[SIREN_PHASE_BYTE], 0x01, "phase byte set to 1 (bit0 was clear)");
  console.log(`  WRITE-SET: ${[...changed].map(hx).join("/")}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong phase byte is CAUGHT by the RAM diff", () => {
  const pokes = [[GAME_ACTIVE_FLAG, 0x00], [SIREN_ENABLE_GATE, 0x01], [SIREN_FRAME_COUNTDOWN, 0x01], [SIREN_PHASE_BYTE, 0x01]];
  const o = craft(pokes);
  const c = craft(pokes);
  oracle(o);
  tickIdleSirenAndTogglePhase(c);
  c.mem8[SIREN_PHASE_BYTE] = 0x01; // BUG: bit0 was set -> phase must become 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase byte");
  assert.equal(d.addr, SIREN_PHASE_BYTE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong phase byte caught at ${hx(d.addr)}`);
});
