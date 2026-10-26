// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand13 (ROM 0x0f44) — "queue command 0x13": tail hand-off into the
 * enqueue helper (0x0ea2) with A=0x13. The helper stashes the byte at 0x8d20, appends it at the ring
 * cursor (0x8a40, slots 0x43..0x5e wrapping) only while a game is active or the play-mode latch is
 * set, and leaves the advanced cursor in A.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES the
 * ring, so each case uses a FRESH clone per side: oracle on one, queueSoundCommand13 on the other, compared on
 * RAM (dumpState) minus stack scratch below the entry SP PLUS the declared register live-out A. pc/SP/cycles are NOT
 * compared. A is a GENUINE live-out: the tail hand-off leaves the append's advanced cursor in A,
 * which the AF pair does not restore, and callers read it.
 *
 * Every case is CRAFTED (a live-gameplay leaf): the gate cells and the ring cursor are poked
 * identically on both sides.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over {active, gates-closed, cursor at wrap} queueSoundCommand13 == oracle in RAM
 *      (-stack) AND in A; the SIDE-EFFECT arm asserts the module SET A on its own clone.
 *   2. WRITE-SET — active from cursor 0x43 writes exactly two cells (the ring slot and the advanced
 *      cursor); the 0x8d20 stash also changes and is checked.
 *   3. TEETH — a wrong ring byte is CAUGHT by the RAM diff; a wrong A is CAUGHT by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f44.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f44 as oracle } from "../../translated/loc_0f44.js";
import { queueSoundCommand13 } from "../queueSoundCommand13.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_ACTIVE_FLAG, PLAY_MODE_LATCH, SOUND_RING_WRITE_PTR, SOUND_RING_PENDING_BYTE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = 0x8a00;
const CMD = 0x13;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the append gates and the ring cursor seated. */
function craft(active, cursor) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active ? 1 : 0);
  m.mem.write8(PLAY_MODE_LATCH, 0);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor & 0xff);
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { active: true, cursor: 0x43 }, //  append from the start
  { active: false, cursor: 0x43 }, // gates closed: stash only, A=0
  { active: true, cursor: 0x5e }, //  append lands on the last slot then wraps to 0x43
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted gate x cursor — queueSoundCommand13 == oracle in RAM (-stack) + A", () => {
  for (const { active, cursor } of CASES) {
    const o = craft(active, cursor);
    const c = craft(active, cursor);
    oracle(o);
    const ret = queueSoundCommand13(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (active=${active} cursor=${hx(cursor)})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (active=${active} cursor=${hx(cursor)})`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (active=${active} cursor=${hx(cursor)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM -stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: active from cursor 0x43 writes the ring slot, the cursor, and the stash", () => {
  const mm = craft(true, 0x43);
  const b0 = mm.dumpState();
  oracle(mm);
  const a1 = mm.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = mm.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    changed.push({ addr, to: a1[off] });
  }
  const EXPECTED = new Map([
    [(RING_PAGE | 0x43) & 0xffff, CMD],
    [SOUND_RING_WRITE_PTR, 0x44],
    [SOUND_RING_PENDING_BYTE, CMD],
  ]);
  assert.equal(changed.length, EXPECTED.size, `expected ${EXPECTED.size} cells, got ${changed.length}`);
  for (const { addr, to } of changed) {
    assert.ok(EXPECTED.has(addr), `unexpected write at ${hx(addr)}`);
    assert.equal(to, EXPECTED.get(addr), `cell ${hx(addr)} must be ${hx(EXPECTED.get(addr))}, got ${hx(to)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} cells (ring slot + cursor + stash)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ring byte is CAUGHT by the RAM diff", () => {
  const o = craft(true, 0x43);
  const c = craft(true, 0x43);
  oracle(o);
  queueSoundCommand13(c);
  c.mem.write8(RING_PAGE | 0x43, 0x00); // BUG: ring slot must be 0x13
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte");
  assert.equal(d.addr, (RING_PAGE | 0x43) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/byte: wrong ring byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A is CAUGHT by the live-out check", () => {
  const o = craft(true, 0x43);
  const c = craft(true, 0x43);
  oracle(o);
  const ret = queueSoundCommand13(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle");
  assert.notEqual(0x43, o.regs.a & 0xff, "the live-out check must reject a non-advanced A (0x43)");
  console.log(`  TEETH/A: module A ${hx(ret & 0xff)} == oracle; a non-advanced 0x43 is rejected`);
});
