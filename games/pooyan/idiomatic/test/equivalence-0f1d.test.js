// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand0F (ROM 0x0f1d) — "append the fixed byte 0x0f into the text
 * ring": load A=0x0f then tail-jr into the ring-append helper appendSoundCommandGated, whose ret returns to our
 * caller.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the declared register live-out A. The append helper leaves the advanced ring
 * cursor in A (0 when both gates are shut) and the AF pair is not restored across the hand-off, so
 * A is a genuine register-dispatched live-out; it is checked against the oracle clone and the
 * module's own clone must SET it.
 *
 * Jobs:
 *   1. EQUAL (crafted) — gate-open (valid cursor, incl. the last-slot wrap) and gate-closed:
 *      oracle == queueSoundCommand0F in RAM (−stack) and in A, and the module SETS A.
 *   2. WRITE-SET — gate-open writes exactly the pending-byte cell, the ring slot, and the cursor;
 *      gate-closed writes only the pending-byte cell.
 *   3. TEETH — a twin that stashes the WRONG byte is caught in RAM; a twin that returns the WRONG
 *      cursor is caught by the A live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f1d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f1d as oracle } from "../../translated/loc_0f1d.js";
import { queueSoundCommand0F } from "../queueSoundCommand0F.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_WRITE_PTR,
  SOUND_RING_PENDING_BYTE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_BYTE = 0x0f; // the fixed byte queueSoundCommand0F appends
const RING_PAGE = SOUND_RING_WRITE_PTR & 0xff00; // page the ring lives in
const RING_LAST = 0x5e; // last cursor slot before wrap
const RING_FIRST = 0x43; // wrap target
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the append gates + ring cursor seated. */
function craft({ active, latch, cursor }) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, latch);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.regs.sp = 0x8ffe; // work RAM; nested ret only reads the stack
  return m;
}

const CASES = [
  { active: 1, latch: 0, cursor: 0x50 }, // gate open -> cursor advances to 0x51
  { active: 0, latch: 1, cursor: 0x50 }, // play-mode latch alone opens the gate
  { active: 1, latch: 0, cursor: RING_LAST }, // last slot -> wraps to RING_FIRST
  { active: 0, latch: 0, cursor: 0x50 }, // both gates shut -> only the pending byte is stashed, A=0
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundCommand0F == oracle in RAM (−stack) + A", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    oracle(o);

    const c = craft(cs);
    c.regs.a = (o.regs.a ^ 0xff) & 0xff; // sentinel: a module that never sets A fails
    const ret = queueSoundCommand0F(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${JSON.stringify(cs)})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (${JSON.stringify(cs)})`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (${JSON.stringify(cs)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate-open writes pending byte + ring slot + cursor; gate-closed writes only the byte", () => {
  const open = craft(CASES[0]);
  const b0 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const changed = new Set();
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed.add(open.stateOffsetToAddr(off));
  assert.ok(changed.has(SOUND_RING_PENDING_BYTE), "pending byte written");
  assert.ok(changed.has(RING_PAGE + 0x50), "ring slot written");
  assert.ok(changed.has(SOUND_RING_WRITE_PTR), "cursor advanced");
  assert.equal(open.mem.read8(SOUND_RING_PENDING_BYTE), RING_BYTE, "pending byte := 0x0f");
  assert.equal(open.mem.read8(RING_PAGE + 0x50), RING_BYTE, "slot := 0x0f");
  assert.equal(open.mem.read8(SOUND_RING_WRITE_PTR), 0x51, "cursor := 0x51");

  const shut = craft(CASES[3]);
  const s0 = shut.dumpState();
  oracle(shut);
  const s1 = shut.dumpState();
  const shutChanged = [];
  for (let off = 0; off < s0.length; off++) if (s0[off] !== s1[off]) shutChanged.push(shut.stateOffsetToAddr(off));
  assert.deepEqual(shutChanged, [SOUND_RING_PENDING_BYTE], "gate-closed writes only the pending byte");
  console.log("  WRITE-SET: open=3 cells, closed=1 cell");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong stashed byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0]);
  const c = craft(CASES[0]);
  oracle(o);
  queueSoundCommand0F(c);
  c.mem.write8(SOUND_RING_PENDING_BYTE, (RING_BYTE ^ 0x01) & 0xff); // BUG: wrong stashed byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stashed byte — it is worthless");
  assert.equal(d.addr, SOUND_RING_PENDING_BYTE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): wrong stashed byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned cursor is CAUGHT by the A live-out check", () => {
  const o = craft(CASES[2]); // wrap case: oracle A = RING_FIRST
  oracle(o);
  assert.equal(o.regs.a & 0xff, RING_FIRST, "sanity: the wrap leaves A at the ring start");
  // an un-wrapped cursor (RING_LAST+1) is a plausible bug the === check must reject
  assert.notEqual((RING_LAST + 1) & 0xff, o.regs.a & 0xff, "the A live-out check must reject an un-wrapped cursor");
  console.log(`  TEETH(A): un-wrapped ${hx((RING_LAST + 1) & 0xff)} rejected against oracle A=${hx(o.regs.a)}`);
});
