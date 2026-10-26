// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueSoundCommand02 (ROM 0x0ed6) — enqueue the fixed sound command 0x02 into
 * the sound-command ring.
 *
 * The wrapper hands command id 0x02 to the ring-enqueue helper, which stores it into the slot
 * named by the write pointer (ring base + pointer) and advances the pointer, wrapping the last
 * slot (0x5e) back to the first (0x43). The one crafted input is that write pointer.
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared, and
 * there is NO register live-out — the helper round-trips BC/DE/HL and enqueue sites reload A.
 *
 * All cases are CRAFTED: the write pointer is poked identically on both sides, sp seated inside
 * STACK_SCRATCH so the oracle's push/pop/ret stay there.
 *
 * Jobs:
 *   1. EQUAL — over first/mid/last-slot write pointers, oracle == queueSoundCommand02 in RAM (−stack).
 *   2. WRITE-SET — first-slot case stores 0x02 into the slot and advances the pointer by one.
 *   3. TEETH — a wrong enqueued byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0ed6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ed6 as oracle } from "../../translated/loc_0ed6.js";
import { queueSoundCommand02 } from "../queueSoundCommand02.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SOUND_RING_WRITE_PTR, HIGH_SCORE_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SOUND_COMMAND = 0x02;
const RING_LAST = 0x5e;
const RING_FIRST = 0x43;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the ring write pointer seated. */
function craft(tail) {
  const m = BASE.clone();
  m.mem.write8(SOUND_RING_WRITE_PTR, tail & 0xff);
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH; the oracle's push/pop/ret stay there
  return m;
}

const CASES = [
  { label: "first slot", tail: RING_FIRST },
  { label: "mid slot", tail: 0x50 },
  { label: "last slot -> wraps", tail: RING_LAST },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted write pointers — queueSoundCommand02 == oracle in RAM (−stack)", () => {
  for (const { label, tail } of CASES) {
    const o = craft(tail);
    const c = craft(tail);
    oracle(o);
    queueSoundCommand02(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} ("${label}")`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted write pointers identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: first-slot enqueue stores 0x02 and advances the pointer by one", () => {
  const o = craft(RING_FIRST);
  oracle(o);
  assert.equal(o.mem.read8(HIGH_SCORE_TABLE + RING_FIRST), SOUND_COMMAND, "ring slot must hold command 0x02");
  assert.equal(o.mem.read8(SOUND_RING_WRITE_PTR), RING_FIRST + 1, "write pointer must advance by one");
  console.log(`  WRITE-SET: slot ${hx(HIGH_SCORE_TABLE + RING_FIRST)}=0x02, ptr ${hx(SOUND_RING_WRITE_PTR)}=${hx(RING_FIRST + 1)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong enqueued byte is CAUGHT by the RAM diff", () => {
  const slot = HIGH_SCORE_TABLE + RING_FIRST;
  const o = craft(RING_FIRST);
  const c = craft(RING_FIRST);
  oracle(o);
  queueSoundCommand02(c);
  c.mem.write8(slot, 0x00); // BUG: this slot must hold command 0x02
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong enqueued byte — it is worthless");
  assert.equal(d.addr, slot, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong enqueued byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
