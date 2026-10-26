// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueFixedSoundCommandRun (ROM 0x0fc1, Pooyan) — enqueue the four-tile text sequence
 * 0x29,0x15,0x16,0x17 into the text ring. Each tile is handed to the frozen text-ring append
 * loc_0ea2 via A (a register bridge); the final append is a tail call.
 *
 * Both sides call the SAME frozen loc_0ea2, so the gate proves the module seats A with the right
 * tiles in the right order. loc_0ea2 appends only when 0x8806 != 0 (or 0x8f50 != 0); the gate is
 * opened here (0x8806 = 1) with the cursor at the ring start so all four tiles actually land.
 * Compared on RAM (dumpState, minus stack scratch below the entry SP). No register live-out — memory only.
 *
 * Jobs:
 *   1. EQUAL — module == oracle in RAM (−stack).
 *   2. WRITE-SET — the four tiles land in order and the cursor advances by four.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that drops the tail tile diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0fc1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fc1 as oracle } from "../../translated/loc_0fc1.js";
import { queueFixedSoundCommandRun } from "../queueFixedSoundCommandRun.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const GAME_ACTIVE = 0x8806; //  gate: nonzero -> loc_0ea2 appends
const CURSOR = 0x8a40; //       text-ring write cursor (0x43..0x5e)
const RING = 0x8a00; //         text-ring page base (0x8a00 | cursor)
const PENDING = 0x8d20; //      latched tile byte written by every loc_0ea2 call
const CUR0 = 0x43; //           cursor seeded at the ring start
const SP0 = 0x8ff0; //          inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: append gate open, cursor at ring start, the four target slots pre-dirtied. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(GAME_ACTIVE, 1);
  m.mem.write8(CURSOR, CUR0);
  for (let i = 0; i < 4; i++) m.mem.write8(RING + CUR0 + i, 0xaa);
  m.mem.write8(PENDING, 0xaa);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: queueFixedSoundCommandRun == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  queueFixedSoundCommandRun(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: four-tile append identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the four tiles land in order and the cursor advances by four", () => {
  const c = craft();
  queueFixedSoundCommandRun(c);
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => c.mem.read8(RING + CUR0 + i)),
    [0x29, 0x15, 0x16, 0x17],
    "tiles 0x29,0x15,0x16,0x17 in order",
  );
  assert.equal(c.mem.read8(CURSOR), CUR0 + 4, "cursor advanced by four");
  assert.equal(c.mem.read8(PENDING), 0x17, "last tile latched at the pending byte");
  console.log("  WRITE-SET: 0x29,0x15,0x16,0x17 appended, cursor +4");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  queueFixedSoundCommandRun(c);
  c.mem.write8(RING + CUR0 + 2, (o.mem.read8(RING + CUR0 + 2) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, RING + CUR0 + 2, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that drops the tail tile diverges from the oracle", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  // broken twin: append only the first three tiles (drop the tail 0x17)
  for (const tile of [0x29, 0x15, 0x16]) {
    c.regs.a = tile;
    c.push16(0x0fff);
    c.call(0x0ea2);
  }
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a dropped tail tile must be caught by the RAM diff");
  console.log(`  TEETH(drop-tail): caught at ${hx(d.addr ?? 0)}`);
});
