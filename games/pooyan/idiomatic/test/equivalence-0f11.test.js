// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand0C (ROM 0x0f11, Pooyan) — "enqueue the fixed command byte
 * 0x0c into the page-0x8a00 command ring". The routine loads A := 0x0c then tail-jumps into the
 * ring-append helper appendSoundCommandGated, whose ret returns to queueSoundCommand0C's caller. So queueSoundCommand0C is appendSoundCommandGated
 * with the incoming byte pinned to 0x0c: it stashes 0x0c at 0x8d20, and — only while
 * GAME_ACTIVE_FLAG (0x8806) or PLAY_MODE_LATCH (0x8f50) is set — writes it at 0x8a00 + cursor
 * (cursor = 0x8a40) and steps the cursor 0x43..0x5e, wrapping 0x5e -> 0x43.
 *
 * This is the cycle-free / memory-equivalence gate (docs/decompiler-pipeline). The routine writes
 * work RAM, so each case runs the oracle on one FRESH clone and queueSoundCommand0C on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP)  +  the A register live-out.
 *
 * A IS a live-out: the append helper leaves A = the advanced cursor (append path) or A = 0
 * (gates closed), A survives because the flag pair is not restored across the tail, and the
 * command trigger tail-returns it — so the EQUAL job asserts A in addition to RAM(−stack), and
 * that the module SET A on its own clone (a return-only rewrite would fail a translated caller).
 * pc/SP/cycles are NOT compared. queueSoundCommand0C takes no register inputs (the byte is a constant).
 *
 * Jobs:
 *   1. EQUAL (crafted) — gate-closed, gate-open via each flag, a mid cursor, and the 0x5e->0x43
 *      wrap: oracle == queueSoundCommand0C in RAM(−stack) and in A, and the module SET A.
 *   2. WRITE-SET — gate-open writes exactly {0x8d20, ring cell, 0x8a40}; gate-closed writes only
 *      0x8d20.
 *   3. TEETH — a twin returning the wrong A is rejected by the live-out check; a twin that writes
 *      the wrong ring byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f11.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f11 as oracle } from "../../translated/loc_0f11.js";
import { queueSoundCommand0C } from "../queueSoundCommand0C.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const COMMAND = 0x0c;
const LATCH = 0x8d20;
const CURSOR = 0x8a40;
const ACTIVE = 0x8806;
const MODE = 0x8f50;
const RING_PAGE = 0x8a00;
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the gate/cursor/ring cells poked identically. queueSoundCommand0C takes no register
 *  inputs, so only memory + the dead stack are seated. */
function craft(active, mode, cursor) {
  const m = BASE.clone();
  m.mem.write8(ACTIVE, active);
  m.mem.write8(MODE, mode);
  m.mem.write8(CURSOR, cursor);
  m.mem.write8(LATCH, 0x00); // known start so the WRITE-SET before/after sees the latch write
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ffe; // dead stack: the oracle's tail/push framing reads/writes excluded RAM
  return m;
}

const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);

const CASES = [
  { name: "gate closed", active: 0, mode: 0, cursor: 0x50 },
  { name: "open via GAME_ACTIVE, first slot", active: 1, mode: 0, cursor: RING_FIRST },
  { name: "open via PLAY_MODE, wrap slot", active: 0, mode: 1, cursor: RING_LAST },
  { name: "open, mid cursor", active: 1, mode: 0, cursor: 0x50 },
  { name: "both gates, second-to-last slot", active: 1, mode: 1, cursor: 0x5d },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundCommand0C == oracle in RAM (−stack) + A", () => {
  for (const { name, active, mode, cursor } of CASES) {
    const o = craft(active, mode, cursor);
    const c = craft(active, mode, cursor);
    oracle(o);
    const ret = queueSoundCommand0C(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `${name}: A return matches oracle`);
    // SIDE-EFFECT arm: the module must SET A for the translated caller, not merely return it.
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: module must SET A`);

    if (active === 0 && mode === 0) {
      assert.equal(ret & 0xff, 0x00, `${name}: gate closed -> A = 0`);
    } else {
      assert.equal(ret & 0xff, nextCursor(cursor), `${name}: A = advanced cursor`);
      assert.equal(c.mem.read8(RING_PAGE + cursor), COMMAND, `${name}: 0x0c appended at the cursor`);
    }
    assert.equal(c.mem.read8(LATCH), COMMAND, `${name}: 0x0c stashed at the latch`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate-open writes {0x8d20, ring cell, 0x8a40}; gate-closed writes only 0x8d20", () => {
  const open = craft(1, 0, RING_FIRST);
  const b0 = open.dumpState();
  oracle(open);
  const a1 = open.dumpState();
  const openChanged = [];
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) openChanged.push(open.stateOffsetToAddr(off));
  const openSet = new Set(openChanged);
  assert.equal(openChanged.length, 3, `gate-open expected 3 writes, got ${openChanged.length}`);
  for (const cell of [LATCH, RING_PAGE + RING_FIRST, CURSOR]) {
    assert.ok(openSet.has(cell), `gate-open missing a write at ${hx(cell)}`);
  }

  const shut = craft(0, 0, 0x50);
  const s0 = shut.dumpState();
  oracle(shut);
  const s1 = shut.dumpState();
  const shutChanged = [];
  for (let off = 0; off < s0.length; off++) if (s0[off] !== s1[off]) shutChanged.push(shut.stateOffsetToAddr(off));
  assert.deepEqual(shutChanged, [LATCH], `gate-closed must write only 0x8d20, got ${shutChanged.map(hx)}`);
  console.log("  WRITE-SET: open -> 3 cells, closed -> only 0x8d20");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong returned A is REJECTED by the live-out check", () => {
  const o = craft(1, 0, RING_FIRST);
  const c = craft(1, 0, RING_FIRST);
  oracle(o);
  const ret = queueSoundCommand0C(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: the module's A matches the oracle");
  // A stale, un-advanced cursor (the input cursor) is a plausible bug the === check must reject.
  assert.notEqual(RING_FIRST, o.regs.a & 0xff, "the live-out check must reject an un-advanced cursor");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; a stale ${hx(RING_FIRST)} is rejected`);
});

test("TEETH: a wrong appended ring byte is CAUGHT by the RAM diff", () => {
  const o = craft(1, 0, RING_FIRST);
  const c = craft(1, 0, RING_FIRST);
  oracle(o);
  queueSoundCommand0C(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(RING_PAGE + RING_FIRST, COMMAND ^ 0xff); // BUG: wrong byte appended
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + RING_FIRST, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong ring byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
