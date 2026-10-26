// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSound82ThenRun1C (ROM 0x0f88) — "tile-command trampoline": append tile
 * 0x82 via appendSoundCommandGated, then tail into appendSoundCommandRun which appends the run 0x1c/0x15/0x16/0x17. Five
 * bytes land in the page-0x8a command ring (when the game-active / play-mode gate is open),
 * each advancing the ring cursor (0x8a40), wrapping 0x5e -> 0x43.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) PLUS the register live-out A — the advanced ring cursor left by the final
 * append (0 when the gate is closed). AF is not restored across the calls and the emitter
 * family's callers read the cursor from A; it is checked against the oracle clone and the
 * module's own clone must SET it (a sentinel is seated first). pc is NOT compared.
 *
 * Jobs:
 *   1. EQUAL (crafted) — a mid-ring append, a wrap across 0x5e, and a gate-closed idle case:
 *      oracle == queueSound82ThenRun1C in RAM (−stack) and in A.
 *   2. WRITE-SET — the gate-open path writes the five ring cells, the pending byte, and the
 *      advanced cursor; the gate-closed path writes only the pending byte.
 *   3. TEETH — a wrong ring byte is caught in RAM; an under-advanced A is rejected by the
 *      live-out check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f88.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f88 as oracle } from "../../translated/loc_0f88.js";
import { queueSound82ThenRun1C } from "../queueSound82ThenRun1C.js";
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

const RING_PAGE = SOUND_RING_WRITE_PTR & 0xff00; // page-0x8a ring base
const RUN = [0x82, 0x1c, 0x15, 0x16, 0x17]; // the five bytes appended, in order
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the ring cursor + append gates seated. */
function craft({ cursor, active }) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active ? 0x01 : 0x00);
  m.mem.write8(PLAY_MODE_LATCH, 0x00); // keep the second gate closed either way
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.regs.sp = 0x8ffe;
  return m;
}

/** The ring cursor after n appends from `start`, wrapping 0x5e -> 0x43. */
function advance(start, n) {
  let c = start;
  for (let i = 0; i < n; i++) c = c === 0x5e ? 0x43 : (c + 1) & 0xff;
  return c;
}

const CASES = [
  { cursor: 0x50, active: true }, // mid-ring append
  { cursor: 0x5c, active: true }, // wraps across 0x5e -> 0x43
  { cursor: 0x50, active: false }, // gate closed: ring untouched, A := 0
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted cases — queueSound82ThenRun1C == oracle in RAM (−stack) + A", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    oracle(o);

    const c = craft(cs);
    c.regs.a = 0xab; // sentinel: a module that never sets A fails
    const ret = queueSound82ThenRun1C(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${JSON.stringify(cs)})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (${JSON.stringify(cs)})`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (${JSON.stringify(cs)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate-open writes five ring cells + pending + cursor; gate-closed writes only pending", () => {
  const open = craft(CASES[0]);
  oracle(open);
  let cur = CASES[0].cursor;
  for (const byte of RUN) {
    assert.equal(open.mem.read8(RING_PAGE + cur), byte, `ring[${hx(cur)}] := ${hx(byte)}`);
    cur = advance(cur, 1);
  }
  assert.equal(open.mem.read8(SOUND_RING_WRITE_PTR), advance(CASES[0].cursor, 5), "cursor advanced five slots");
  assert.equal(open.mem.read8(SOUND_RING_PENDING_BYTE), RUN[RUN.length - 1], "pending byte := last appended");

  const closed = craft(CASES[2]);
  const s0 = closed.dumpState();
  oracle(closed);
  const s1 = closed.dumpState();
  const changed = [];
  for (let off = 0; off < s0.length; off++) {
    if (s0[off] !== s1[off] && !inDeadStack(closed.stateOffsetToAddr(off))) changed.push(closed.stateOffsetToAddr(off));
  }
  assert.deepEqual(changed, [SOUND_RING_PENDING_BYTE], "gate-closed writes only the pending byte");
  assert.equal(closed.mem.read8(SOUND_RING_WRITE_PTR), CASES[2].cursor, "gate-closed leaves the cursor untouched");
  console.log("  WRITE-SET: gate-open=7 cells, gate-closed=1 cell");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ring byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0]);
  const c = craft(CASES[0]);
  oracle(o);
  queueSound82ThenRun1C(c);
  const firstCell = RING_PAGE + CASES[0].cursor;
  c.mem.write8(firstCell, 0x00); // BUG: first ring cell must be 0x82, not 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte — it is worthless");
  assert.equal(d.addr, firstCell, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): wrong ring byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an under-advanced A is CAUGHT by the live-out check", () => {
  const o = craft(CASES[0]);
  oracle(o);
  const under = advance(CASES[0].cursor, 4) & 0xff; // BUG: four appends, not five
  assert.notEqual(under, o.regs.a & 0xff, "the A live-out check must reject an under-advanced cursor");
  console.log(`  TEETH(A): under-advanced ${hx(under)} rejected against oracle A=${hx(o.regs.a)}`);
});
