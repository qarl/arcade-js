// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand12 (ROM 0x0f3f) — "queue text-ring command 0x12": load 0x12 and
 * tail-call the page-0x8a ring appender, which stashes the byte at SOUND_RING_PENDING_BYTE, and — only
 * when the game-active or play-mode gate is set — writes it into the ring at page-0x8a + cursor
 * (cursor = SOUND_RING_WRITE_PTR), advances the cursor (wrapping 0x5e -> 0x43), leaving it in A.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM, so every case uses
 * a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the declared register live-out (A).
 *
 * pc/SP/cycles are NOT compared. A IS a live-out: the appender leaves the advanced cursor (or 0 on
 * the gates-closed path) in A across the tail, matching the appender's own contract; it is checked
 * as both a return value and a SET side-effect. Inputs are the two gate cells and the cursor, poked
 * per side; every case is crafted (the appender is gated on live gameplay).
 *
 * Jobs: 1. EQUAL over gates-closed / gates-open (both gates) / wrap-edge, RAM−stack + A + SET arm;
 * 2. WRITE-SET (closed: just the pending byte; open: pending byte + slot + cursor); 3. CRAFTED
 * (the wrap case); 4. TEETH (a wrong ring byte + a wrong A).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f3f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f3f as oracle } from "../../translated/loc_0f3f.js";
import { queueSoundCommand12 } from "../queueSoundCommand12.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_ACTIVE_FLAG, PLAY_MODE_LATCH, SOUND_RING_WRITE_PTR, SOUND_RING_PENDING_BYTE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CMD = 0x12;
const RING_LAST = 0x5e;
const RING_FIRST = 0x43;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const slot = (cursor) => (SOUND_RING_WRITE_PTR & 0xff00) + cursor; // page-0x8a ring slot for a cursor
const nextCursor = (cursor) => (cursor === RING_LAST ? RING_FIRST : (cursor + 1) & 0xff);

/** Fresh clone with the two gate cells and the ring cursor seated. */
function craft({ ga, pm, cursor }) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe;
  m.mem.write8(GAME_ACTIVE_FLAG, ga);
  m.mem.write8(PLAY_MODE_LATCH, pm);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.mem.write8(SOUND_RING_PENDING_BYTE, 0x00); // sentinel != 0x12 so the stash is observable
  m.mem.write8(slot(cursor), 0xaa); // sentinel so an append is observable
  return m;
}

const CASES = [
  { ga: 0, pm: 0, cursor: 0x50 }, // both gates closed -> no append, A=0
  { ga: 1, pm: 0, cursor: 0x50 }, // game-active gate open
  { ga: 0, pm: 1, cursor: 0x48 }, // play-mode gate open
  { ga: 1, pm: 1, cursor: RING_LAST }, // open + wrap edge
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: gate/cursor cases — queueSoundCommand12 == oracle in RAM (−stack) + A live-out", () => {
  for (const cse of CASES) {
    const o = craft(cse);
    const c = craft(cse);
    oracle(o);
    const ret = queueSoundCommand12(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} (${JSON.stringify(cse)}): oracle=${d.a} idiom=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (${JSON.stringify(cse)})`);
    // SET side-effect: the tail must leave the appender's A in the register the caller reads.
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (${JSON.stringify(cse)})`);
  }
  console.log(`  EQUAL: ${CASES.length} gate/cursor cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: closed writes only the pending byte; open adds the slot + cursor", () => {
  for (const cse of [{ ga: 0, pm: 0, cursor: 0x50 }, { ga: 1, pm: 0, cursor: 0x50 }]) {
    const before = craft(cse);
    const after = craft(cse);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    const changed = new Map();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.set(after.stateOffsetToAddr(off), a1[off]);
    }
    const open = cse.ga !== 0 || cse.pm !== 0;
    assert.equal(changed.get(SOUND_RING_PENDING_BYTE), CMD, "pending byte := 0x12");
    if (!open) {
      assert.equal(changed.size, 1, `closed path writes only the pending byte, got ${changed.size}`);
    } else {
      assert.equal(changed.size, 3, `open path writes pending + slot + cursor, got ${changed.size}`);
      assert.equal(changed.get(slot(cse.cursor)), CMD, `ring slot ${hx(slot(cse.cursor))} := 0x12`);
      assert.equal(changed.get(SOUND_RING_WRITE_PTR), nextCursor(cse.cursor), "cursor advanced");
    }
  }
  console.log("  WRITE-SET: closed -> pending byte only; open -> pending + slot + advanced cursor");
});

// -- 3. CRAFTED (wrap edge) ---------------------------------------------------

test("CRAFTED: at the last slot the cursor wraps 0x5e -> 0x43 identically", () => {
  const cse = { ga: 1, pm: 0, cursor: RING_LAST };
  const o = craft(cse);
  const c = craft(cse);
  oracle(o);
  queueSoundCommand12(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(c.mem.read8(slot(RING_LAST)), CMD, "0x12 lands in the last slot");
  assert.equal(c.mem.read8(SOUND_RING_WRITE_PTR), RING_FIRST, "cursor wrapped to the first slot");
  assert.equal(c.regs.a & 0xff, RING_FIRST, "A live-out is the wrapped cursor");
  console.log(`  CRAFTED: wrap -> slot ${hx(slot(RING_LAST))}=0x12, cursor=${hx(RING_FIRST)}, A=${hx(RING_FIRST)}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ring byte is CAUGHT by the RAM diff", () => {
  const cse = { ga: 1, pm: 0, cursor: 0x50 };
  const o = craft(cse);
  const c = craft(cse);
  oracle(o);
  queueSoundCommand12(c);
  const bug = slot(cse.cursor);
  c.mem.write8(bug, 0x00); // BUG: the appended slot must hold 0x12

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte — it is worthless");
  assert.equal(d.addr, bug, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(bug)})`);
  console.log(`  TEETH/RAM: wrong ring byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A live-out is CAUGHT by the register check", () => {
  const cse = { ga: 1, pm: 0, cursor: 0x50 };
  const o = craft(cse);
  oracle(o);
  // the un-advanced cursor is a plausible bug the === check must reject
  assert.notEqual(cse.cursor & 0xff, o.regs.a & 0xff, "the A check must reject the un-advanced cursor");
  assert.equal(o.regs.a & 0xff, nextCursor(cse.cursor), "sanity: oracle A is the advanced cursor");
  console.log(`  TEETH/A: oracle A ${hx(o.regs.a)}; un-advanced ${hx(cse.cursor)} is rejected`);
});
