// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drainSoundCommandRing (ROM 0x0e64, Pooyan) — "drain one sound-ring entry":
 * read the head slot; if empty (0xff) return; otherwise hand the byte to the audio CPU when
 * demo sounds are enabled (DEMO_SOUNDS_DSW bit 0) OR a game is active (GAME_ACTIVE_FLAG),
 * staying silent only when both are clear; then free the slot to 0xff and advance the head
 * index (0x5e wraps to 0x43).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM (the ring),
 * so every case runs the oracle on one fresh clone and drainSoundCommandRing on another, compared on the
 * go-forward contract: RAM (dumpState, minus stack scratch below the entry SP). There is NO register live-out —
 * both callers drop the registers (runVblankNmiService reloads, runLevelIntroPhase1Frame returns) — so no register is
 * compared. The dispatch DECISION, however, is invisible in dumpState (a sound command goes
 * to the 0xa100 latch, outside dumpState's RAM window), so it is checked separately through
 * io.soundData: each craft seeds a sentinel there, and the oracle and module clones must end
 * with the SAME io.soundData (sentinel = suppressed, entry byte = dispatched).
 *
 * Jobs:
 *   1. EQUAL — over empty/dispatch/suppress/wrap cases, oracle == drainSoundCommandRing in RAM(−stack)
 *      AND in io.soundData (the dispatch decision), derived from the oracle clone.
 *   2. WRITE-SET — a non-empty entry writes only the freed slot + the head-index cell.
 *   3. TEETH — a wrong freed-slot byte is caught by the RAM diff, and a wrong dispatch
 *      decision (io.soundData) is caught by the sound-latch check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0e64.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0e64 as oracle } from "../../translated/loc_0e64.js";
import { drainSoundCommandRing } from "../drainSoundCommandRing.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SOUND_RING_READ_PTR,
  HIGH_SCORE_TABLE,
  DEMO_SOUNDS_DSW,
  GAME_ACTIVE_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT_EMPTY = 0xff;
const SND_SENTINEL = 0xab; // pre-seeded io.soundData; survives iff the entry is NOT dispatched
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone: head index seated, that slot's entry byte set, both gate flags seeded, a
 *  sentinel parked in io.soundData, SP in the dead stack window. */
function craft({ head, entry, demo, active }) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_READ_PTR, head & 0xff);
  m.mem.write8((HIGH_SCORE_TABLE + head) & 0xffff, entry & 0xff);
  m.mem.write8(DEMO_SOUNDS_DSW, demo & 0xff);
  m.mem.write8(GAME_ACTIVE_FLAG, active & 0xff);
  m.io.soundData = SND_SENTINEL;
  m.regs.sp = 0x8ffe;
  return m;
}

// head/entry/gate combinations: empty slot, the two dispatch triggers, the both-clear
// suppress, both-set, and the wrap boundary (head 0x5e -> 0x43).
const CASES = [
  { head: 0x50, entry: SLOT_EMPTY, demo: 0x01, active: 0x00 }, // empty -> early return
  { head: 0x50, entry: 0x09, demo: 0x01, active: 0x00 }, //        dispatch via demo sounds
  { head: 0x51, entry: 0x15, demo: 0x00, active: 0x01 }, //        dispatch via game active
  { head: 0x52, entry: 0x22, demo: 0x00, active: 0x00 }, //        both clear -> suppress
  { head: 0x53, entry: 0x30, demo: 0x01, active: 0x01 }, //        both set -> dispatch
  { head: 0x5e, entry: 0x09, demo: 0x01, active: 0x00 }, //        wrap: 0x5e -> 0x43
  { head: 0x43, entry: 0x41, demo: 0x00, active: 0x01 }, //        first slot, +1 advance
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: oracle == drainSoundCommandRing in RAM(−stack) + io.soundData (dispatch decision)", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    drainSoundCommandRing(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (head=${hx(cs.head)} entry=${hx(cs.entry)})`);
    assert.equal(c.io.soundData, o.io.soundData, `sound-dispatch mismatch (head=${hx(cs.head)} entry=${hx(cs.entry)} demo=${cs.demo} active=${cs.active})`);
  }
  console.log(`  EQUAL: ${CASES.length} ring cases identical (RAM −stack + sound dispatch)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a non-empty entry writes only the freed slot + the head-index cell", () => {
  const cs = { head: 0x50, entry: 0x09, demo: 0x01, active: 0x00 };
  const slot = (HIGH_SCORE_TABLE + cs.head) & 0xffff;

  const before = craft(cs);
  const after = craft(cs);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's call push/pop dirties STACK_SCRATCH; not game state
    changed.push(addr);
  }
  const addrs = new Set(changed);
  assert.equal(changed.length, 2, `expected exactly 2 written cells, got ${changed.length}`);
  assert.ok(addrs.has(slot), `expected the freed slot ${hx(slot)} to change`);
  assert.ok(addrs.has(SOUND_RING_READ_PTR), `expected the head-index cell ${hx(SOUND_RING_READ_PTR)} to change`);
  assert.equal(after.mem.read8(slot), SLOT_EMPTY, "freed slot must be 0xff");
  console.log(`  WRITE-SET: freed ${hx(slot)}:=0xff, head ${hx(SOUND_RING_READ_PTR)} advanced (2 cells)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong freed-slot byte is caught by the RAM diff", () => {
  const cs = { head: 0x50, entry: 0x09, demo: 0x01, active: 0x00 };
  const slot = (HIGH_SCORE_TABLE + cs.head) & 0xffff;
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  drainSoundCommandRing(c);
  c.mem.write8(slot, 0x00); // BUG: freed slot must be 0xff, not 0x00

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong freed-slot byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(slot)})`);
  console.log(`  TEETH/RAM: wrong freed slot caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong dispatch decision is caught by the io.soundData check", () => {
  const cs = { head: 0x52, entry: 0x22, demo: 0x00, active: 0x00 }; // real path: SUPPRESS
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  drainSoundCommandRing(c);
  assert.equal(c.io.soundData, o.io.soundData, "sanity: module suppressed exactly as the oracle did");
  assert.equal(o.io.soundData, SND_SENTINEL, "sanity: the oracle left the sentinel (nothing dispatched)");
  c.io.soundData = cs.entry; // BUG: pretend the byte was dispatched
  assert.notEqual(c.io.soundData, o.io.soundData, "the sound-latch check must reject a spurious dispatch");
  console.log(`  TEETH/SND: spurious dispatch ${hx(cs.entry)} rejected vs oracle sentinel ${hx(o.io.soundData)}`);
});
