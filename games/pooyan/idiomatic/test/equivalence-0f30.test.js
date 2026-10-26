// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommands95And03And11 (ROM 0x0f30, Pooyan) — "append three fixed bytes
 * (0x95, 0x03, 0x11) into the page-0x8a command ring", each via the ring-append helper (the
 * third a tail call). The helper stashes each byte at 0x8d20, and while GAME_ACTIVE_FLAG
 * (0x8806) or PLAY_MODE_LATCH (0x8f50) is set also writes it at 0x8a00 + cursor (cursor =
 * 0x8a40), stepping the cursor 0x43..0x5e and wrapping 0x5e -> 0x43.
 *
 * Cycle-free memory-equivalence gate: writes work RAM, so a FRESH clone per side, compared on
 * RAM (dumpState minus stack scratch below the entry SP) + the A register live-out. A IS a live-out: the third
 * (tail) append leaves A = the advanced cursor (or 0 when the gates are closed) and callers read
 * it. The helper's transient push/pop framing lands in STACK_SCRATCH and is excluded.
 *
 * Jobs:
 *   1. EQUAL (crafted) — gate-closed, gate-open via each flag, and a run that wraps 0x5e -> 0x43.
 *   2. WRITE-SET — gate-open writes {0x8d20, three ring cells, 0x8a40} (5); gate-closed only 0x8d20.
 *   3. TEETH — a wrong ring byte (RAM diff) and a wrong advanced cursor (A live-out) are caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0f30.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f30 as oracle } from "../../translated/loc_0f30.js";
import { queueSoundCommands95And03And11 } from "../queueSoundCommands95And03And11.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_WRITE_PTR,
  SOUND_RING_PENDING_BYTE,
  HIGH_SCORE_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = HIGH_SCORE_TABLE; // 0x8a00: the append page
const RING_FIRST = 0x43;
const RING_LAST = 0x5e;
const CMDS = [0x95, 0x03, 0x11]; // the three fixed bytes, in append order

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const nextCursor = (c) => (c === RING_LAST ? RING_FIRST : c + 1);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the gates + cursor poked and the ring window / pending byte cleared. */
function craft(active, mode, cursor) {
  const m = BASE.clone();
  m.mem.write8(GAME_ACTIVE_FLAG, active);
  m.mem.write8(PLAY_MODE_LATCH, mode);
  m.mem.write8(SOUND_RING_WRITE_PTR, cursor);
  m.mem.write8(SOUND_RING_PENDING_BYTE, 0x00);
  for (let c = RING_FIRST; c <= RING_LAST; c++) m.mem.write8(RING_PAGE + c, 0x00);
  m.regs.sp = 0x8ffe;
  return m;
}

/** Game-state cells changed by `run`, excluding the transient stack framing. */
function changedCells(mm, run) {
  const b0 = mm.dumpState();
  run(mm);
  const a1 = mm.dumpState();
  const out = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = mm.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) out.push(addr);
  }
  return out;
}

const CASES = [
  { name: "gate closed", active: 0, mode: 0, cursor: 0x50 },
  { name: "open via GAME_ACTIVE, mid cursor", active: 1, mode: 0, cursor: 0x50 },
  { name: "open via PLAY_MODE, wraps on 3rd", active: 0, mode: 1, cursor: 0x5c },
  { name: "open, first slot", active: 1, mode: 0, cursor: RING_FIRST },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted gate/cursor cases — queueSoundCommands95And03And11 == oracle in RAM (−stack) + A", () => {
  for (const { name, active, mode, cursor } of CASES) {
    const o = craft(active, mode, cursor);
    const c = craft(active, mode, cursor);
    oracle(o);
    queueSoundCommands95And03And11(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `${name}: A live-out mismatch`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: gate-open writes 5 cells {0x8d20, 3 ring cells, 0x8a40}; gate-closed only 0x8d20", () => {
  const cursor = 0x50;
  const openChanged = changedCells(craft(1, 0, cursor), oracle);
  const openSet = new Set(openChanged);
  const expected = [SOUND_RING_PENDING_BYTE, RING_PAGE + cursor, RING_PAGE + cursor + 1, RING_PAGE + cursor + 2, SOUND_RING_WRITE_PTR];
  assert.equal(openChanged.length, expected.length, `gate-open expected ${expected.length} writes, got ${openChanged.length} (${openChanged.map(hx)})`);
  for (const cell of expected) assert.ok(openSet.has(cell), `gate-open missing a write at ${hx(cell)}`);

  const shutChanged = changedCells(craft(0, 0, cursor), oracle);
  assert.deepEqual(shutChanged, [SOUND_RING_PENDING_BYTE], `gate-closed must write only 0x8d20, got ${shutChanged.map(hx)}`);
  console.log("  WRITE-SET: open -> 5 cells, closed -> only the stash byte");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: appends the middle byte inverted. */
function brokenMiddleByte(m) {
  let cursor = m.mem.read8(SOUND_RING_WRITE_PTR);
  const open = !(m.mem.read8(GAME_ACTIVE_FLAG) === 0 && m.mem.read8(PLAY_MODE_LATCH) === 0);
  for (let i = 0; i < CMDS.length; i++) {
    m.mem.write8(SOUND_RING_PENDING_BYTE, CMDS[i]);
    if (!open) continue;
    m.mem.write8(RING_PAGE + cursor, i === 1 ? CMDS[i] ^ 0xff : CMDS[i]); // BUG on the middle byte
    cursor = nextCursor(cursor);
    m.mem.write8(SOUND_RING_WRITE_PTR, cursor); // advance the cursor like the helper, so ONLY the byte diverges
    m.regs.a = cursor;
  }
}

test("TEETH: a wrong middle ring byte is CAUGHT by the RAM diff", () => {
  const cursor = 0x50;
  const o = craft(1, 0, cursor);
  const c = craft(1, 0, cursor);
  oracle(o);
  brokenMiddleByte(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte — it is worthless");
  assert.equal(d.addr, RING_PAGE + cursor + 1, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(byte): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong advanced cursor is CAUGHT by the A live-out check", () => {
  const o = craft(1, 0, RING_FIRST);
  const c = craft(1, 0, RING_FIRST);
  oracle(o);
  const ret = queueSoundCommands95And03And11(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A return matches the oracle");
  // advancing by one instead of three is a plausible bug the A check must reject
  assert.notEqual((RING_FIRST + 1) & 0xff, o.regs.a & 0xff, "the A live-out check must reject a single-step cursor");
  console.log(`  TEETH(A): module A ${hx(ret & 0xff)} == oracle; single-step ${hx(RING_FIRST + 1)} rejected`);
});
