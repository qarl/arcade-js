// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundRun28 (ROM 0x0fbc, Pooyan) — "append four text tiles": append
 * 0x28, 0x15, 0x16, 0x17 one at a time into the text ring via the append helper. Each append
 * stashes the byte at the pending cell 0x8d20, and — only while a game is active (0x8806) OR the
 * play-mode latch (0x8f50) is set — writes it at RING_BASE + cursor (cursor = 0x8a40) and steps
 * the cursor, wrapping 0x5e -> 0x43. The final append is a tail call; its result is queueSoundRun28's.
 *
 * Cycle-free gate: a fresh clone per side, compared on RAM (dumpState) minus stack scratch below the entry SP PLUS
 * the register live-out A. A is a GENUINE live-out here: the tail append leaves the advanced
 * cursor in A (or 0 when both gates are shut), and the frozen dispatch reads it out of the
 * register — so the module must SET A, not merely return it. Two entry conditions matter:
 *   - gates SHUT (default boot: 0x8806==0 && 0x8f50==0): no ring writes, only the pending cell,
 *     and A == 0.
 *   - gates OPEN (0x8806 poked to 1): all four tiles append and the cursor advances four slots.
 * All cases are CRAFTED (the leaf never runs in a plain boot): the gate flag and ring cursor are
 * poked identically on both sides.
 *
 * Jobs:
 *   1. EQUAL (gates open) — over cursors incl. ones that wrap mid-sequence, oracle == module in
 *      RAM (−stack) and in A, and the module SET A on its own clone.
 *   2. EQUAL (gates shut) — no ring writes; only the pending cell changes and A == 0 on both.
 *   3. WRITE-SET (gates open) — four ring slots + the pending cell + the advanced cursor.
 *   4. TEETH — a wrong appended byte, a wrong final cursor, and a wrong returned A are each caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0fbc.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0fbc as oracle } from "../../translated/loc_0fbc.js";
import { queueSoundRun28 } from "../queueSoundRun28.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_CURSOR = 0x8a40; // shared ring cursor cell (append and enqueue share it)
const RING_BASE = 0x8a00;
const PENDING_BYTE = 0x8d20; // byte stashed on every append, appended-or-not
const GAME_ACTIVE_FLAG = 0x8806;
const CURSOR_FIRST = 0x43;
const CURSOR_LAST = 0x5e;
const TILES = [0x28, 0x15, 0x16, 0x17];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const step = (c) => (c === CURSOR_LAST ? CURSOR_FIRST : (c + 1) & 0xff);
const cursorAfter = (c) => { let x = c; for (let i = 0; i < TILES.length; i++) x = step(x); return x; };

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: optionally open a gate, seat the cursor, pre-dirty the four slots. */
function craft(cursor, gateOpen) {
  const m = BASE.clone();
  if (gateOpen) m.mem.write8(GAME_ACTIVE_FLAG, 1);
  m.mem.write8(RING_CURSOR, cursor);
  let c = cursor;
  for (let i = 0; i < TILES.length; i++) { m.mem.write8(RING_BASE + c, 0xaa); c = step(c); }
  m.regs.sp = 0x8ffe; // the helper's push/pop of BC/DE/HL and its rets land inside STACK_SCRATCH
  return m;
}

// 0x5b appends 0x5b..0x5e (last wraps -> cursor 0x43); 0x5c wraps mid-sequence.
const CURSORS = [CURSOR_FIRST, 0x5b, 0x5c];

// -- 1. EQUAL (gates open) ----------------------------------------------------

test("EQUAL(open): crafted cursors — queueSoundRun28 == oracle in RAM (−stack) + A live-out", () => {
  for (const cursor of CURSORS) {
    const o = craft(cursor, true);
    const c = craft(cursor, true);
    oracle(o);
    const ret = queueSoundRun28(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `cursor=${hx(cursor)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch for cursor=${hx(cursor)}`);
    // SIDE-EFFECT arm: the module must SET A on its own clone (the dispatch reads it register-side).
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A for the dispatch (cursor=${hx(cursor)})`);
    assert.equal(o.regs.a & 0xff, cursorAfter(cursor), `sanity: A == advanced cursor (cursor=${hx(cursor)})`);
  }
  console.log(`  EQUAL(open): ${CURSORS.length} crafted cursors identical (RAM −stack + A)`);
});

// -- 2. EQUAL (gates shut) ----------------------------------------------------

test("EQUAL(shut): gates closed — no ring writes, only the pending cell, A == 0", () => {
  const o = craft(CURSOR_FIRST, false);
  const c = craft(CURSOR_FIRST, false);
  oracle(o);
  const ret = queueSoundRun28(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(ret & 0xff, 0, "gates shut -> A == 0");
  assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, "module A matches oracle A on the shut path");
  assert.equal(c.mem.read8(RING_CURSOR), CURSOR_FIRST, "cursor unchanged on the shut path");
  assert.equal(c.mem.read8(PENDING_BYTE), TILES[TILES.length - 1], "pending cell holds the last byte");
  console.log(`  EQUAL(shut): no append, pending := 0x17, A == 0`);
});

// -- 3. WRITE-SET (gates open) ------------------------------------------------

test("WRITE-SET(open): four ring slots + the pending cell + the advanced cursor", () => {
  const cursor = CURSOR_FIRST;
  const footprint = new Set([PENDING_BYTE, RING_CURSOR]);
  let c = cursor;
  for (let i = 0; i < TILES.length; i++) { footprint.add(RING_BASE + c); c = step(c); }

  const m = craft(cursor, true);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(m.stateOffsetToAddr(off));
  }
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  let cc = cursor;
  for (const tile of TILES) { assert.equal(m.mem.read8(RING_BASE + cc), tile, `slot ${hx(RING_BASE + cc)} := ${hx(tile)}`); cc = step(cc); }
  assert.equal(m.mem.read8(RING_CURSOR), cursorAfter(cursor), "cursor advanced four slots");
  assert.equal(m.mem.read8(PENDING_BYTE), TILES[TILES.length - 1], "pending cell holds the last byte");
  console.log(`  WRITE-SET(open): 4 slots + pending + cursor -> ${hx(cursorAfter(cursor))}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong appended byte is CAUGHT by the RAM diff", () => {
  const cursor = CURSOR_FIRST;
  const slot0 = RING_BASE + cursor;
  const o = craft(cursor, true);
  const c = craft(cursor, true);
  oracle(o);
  queueSoundRun28(c);
  c.mem.write8(slot0, 0x00); // BUG: first appended tile must be 0x28
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong appended byte — it is worthless");
  assert.equal(d.addr, slot0, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(slot): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong final cursor is CAUGHT by the RAM diff", () => {
  const cursor = 0x5b; // last append wraps -> cursor 0x43
  const o = craft(cursor, true);
  const c = craft(cursor, true);
  oracle(o);
  queueSoundRun28(c);
  c.mem.write8(RING_CURSOR, (cursor + TILES.length) & 0xff); // BUG: must wrap, not run past 0x5e
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong final cursor — it is worthless");
  assert.equal(d.addr, RING_CURSOR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(cursor): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong returned A is CAUGHT by the live-out check", () => {
  const cursor = CURSOR_FIRST;
  const o = craft(cursor, true);
  const c = craft(cursor, true);
  oracle(o);
  const ret = queueSoundRun28(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches oracle A");
  // one tile short (three appends' worth of advance) is a plausible bug the === must reject
  assert.notEqual((cursor + TILES.length - 1) & 0xff, o.regs.a & 0xff, "the live-out check must reject an under-advanced A");
  console.log(`  TEETH(A): module A ${hx(ret & 0xff)} == oracle; an under-advanced ${hx((cursor + TILES.length - 1) & 0xff)} is rejected`);
});
