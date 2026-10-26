// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand07 (ROM 0x0ef9) — "append the fixed byte 0x07 into the
 * command ring". The routine loads the constant append value and tail-jumps into the ring
 * appender, so its whole effect is the appender's: it stashes the byte at the pending cell,
 * and — only while the game is active OR the play-mode latch is set — writes the byte into the
 * ring page at the current cursor and advances that cursor (wrapping the last slot to the first).
 *
 * This is the cycle-free / memory-equivalence gate. The routine writes work RAM, so every case
 * uses a FRESH clone per side; the oracle runs on one clone, queueSoundCommand07 on another, and they are
 * compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the declared register live-out (A).
 *
 * pc, SP and cycles are deliberately NOT compared. A IS a genuine live-out: the appender leaves
 * the advanced cursor in A (the AF pair is not saved across the call), and this tail hands that
 * straight back, so the live-out check reads it from the oracle clone and the SIDE-EFFECT arm
 * confirms the module SET the register (not merely returned it).
 *
 * The leaf is not reached in a plain boot/attract, so every case is CRAFTED: the appender's
 * inputs (the two gate cells and the ring cursor) are poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — over gate/cursor combinations, oracle == queueSoundCommand07 in RAM (−stack) and in A,
 *      and the module SET A on its own clone.
 *   2. WRITE-SET — the gates-open append touches exactly the pending byte, the ring slot, and
 *      the cursor cell.
 *   3. CRAFTED (wrap) — a cursor at the last slot wraps the advance back to the first.
 *   4. TEETH — a wrong appended byte is caught by the RAM diff, and an under-advanced A is
 *      rejected by the live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0ef9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ef9 as oracle } from "../../translated/loc_0ef9.js";
import { queueSoundCommand07 } from "../queueSoundCommand07.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_WRITE_PTR,
  SOUND_RING_PENDING_BYTE,
  STACK_SCRATCH,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const APPEND_TILE = 0x07;
const RING_PAGE = 0x8a00; // the cursor's page base; a slot is RING_PAGE + cursor
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference minus the stack scratch below the entry SP (neither side writes it here). */
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the appender's inputs (the two gates + the ring cursor) seated. */
function craft({ active, playMode, cursor }) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, playMode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.regs.sp = 0x8ffe; // in work RAM; the oracle's ret/push only touch the dead stack window
  return m;
}

// gates-open (either gate), gates-closed, and a wrap boundary. gated = append suppressed.
const CASES = [
  { active: 1, playMode: 0, cursor: 0x43 }, // game active, first slot
  { active: 1, playMode: 0, cursor: 0x4a }, // game active, mid slot
  { active: 1, playMode: 0, cursor: 0x5d }, // game active, one before the last
  { active: 0, playMode: 1, cursor: 0x50 }, // play-mode latch open, game inactive
  { active: 0, playMode: 0, cursor: 0x4a }, // both gates closed — no append
  { active: 3, playMode: 2, cursor: 0x5e }, // both gates open, cursor at the last slot (wrap)
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor — queueSoundCommand07 == oracle in RAM (−stack) + A", () => {
  for (const c0 of CASES) {
    const o = craft(c0);
    const c = craft(c0);
    oracle(o);
    const ret = queueSoundCommand07(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (${JSON.stringify(c0)})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A live-out mismatch (${JSON.stringify(c0)})`);
    // SIDE-EFFECT arm: the tail must SET A on the module clone (a caller reads the cursor from
    // the register), not merely return it.
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A for the caller (${JSON.stringify(c0)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a gates-open append touches the pending byte, the ring slot, and the cursor", () => {
  const cursor = 0x43;
  const slot = RING_PAGE + cursor;
  const o = craft({ active: 1, playMode: 0, cursor });
  // Pre-dirty the two byte-writes so both definitely change (the cursor itself always advances).
  o.mem.write8(SOUND_RING_PENDING_BYTE, 0xaa);
  o.mem.write8(slot, 0xaa);
  const before = o.dumpState();
  oracle(o);
  const after = o.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) changed.push({ addr: o.stateOffsetToAddr(off), to: after[off] });
  }
  const byAddr = new Map(changed.map((ch) => [ch.addr, ch.to]));
  assert.equal(changed.length, 3, `expected exactly 3 written cells, got ${changed.length}`);
  assert.equal(byAddr.get(SOUND_RING_PENDING_BYTE), APPEND_TILE, "pending byte must be 0x07");
  assert.equal(byAddr.get(slot), APPEND_TILE, "ring slot must be 0x07");
  assert.equal(byAddr.get(SOUND_RING_WRITE_PTR), (cursor + 1) & 0xff, "cursor must advance by one");
  console.log(`  WRITE-SET: ${hx(SOUND_RING_PENDING_BYTE)}/${hx(slot)} := 0x07, cursor -> ${hx(cursor + 1)}`);
});

// -- 3. CRAFTED (wrap) --------------------------------------------------------

test("CRAFTED: a cursor at the last slot wraps the advance back to the first", () => {
  const c0 = { active: 1, playMode: 0, cursor: 0x5e };
  const o = craft(c0);
  const c = craft(c0);
  oracle(o);
  const ret = queueSoundCommand07(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  assert.equal(o.mem.read8(SOUND_RING_WRITE_PTR), 0x43, "oracle wraps the cursor to the first slot");
  assert.equal(ret & 0xff, 0x43, "module returns the wrapped cursor");
  assert.equal(c.mem.read8(RING_PAGE + 0x5e), APPEND_TILE, "the last slot received the byte");
  console.log("  CRAFTED: cursor 0x5e -> byte at last slot, cursor wraps to 0x43");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong appended byte is CAUGHT by the RAM diff", () => {
  const c0 = { active: 1, playMode: 0, cursor: 0x43 };
  const slot = RING_PAGE + 0x43;
  const o = craft(c0);
  const c = craft(c0);
  oracle(o);
  queueSoundCommand07(c);
  c.mem.write8(slot, 0x00); // BUG: the appended byte must be 0x07, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(slot)})`);
  console.log(`  TEETH/RAM: wrong appended byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned A is CAUGHT by the live-out check", () => {
  const c0 = { active: 1, playMode: 0, cursor: 0x43 };
  const o = craft(c0);
  const c = craft(c0);
  oracle(o);
  const ret = queueSoundCommand07(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A matches the oracle");
  // an un-advanced return (the cursor as it was, 0x43) is a plausible bug the check must reject
  assert.notEqual(0x43, o.regs.a & 0xff, "the live-out check must reject an un-advanced A");
  console.log(`  TEETH/A: module A ${hx(ret & 0xff)} == oracle; an un-advanced 0x43 is rejected`);
});
