// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence + boolean-return gate for testTargetSlotGrabAndCatchObject (ROM 0x5e1f) — the proximity trigger,
 * decompiled as a DISSOLVED caller-skip. In the frozen oracle the "no grab" outcomes end with a
 * plain `ret` (back into the caller's slot sweep) and the "grab hit" outcome ends with `pop af;
 * ret`, unwinding PAST the immediate caller to abort the sweep. The idiomatic module drops that
 * stack plumbing and returns a boolean instead: true = the normal `ret` (continue the sweep),
 * false = the `pop af; ret` (abort it). The two must land byte-identical in RAM (−stack).
 *
 * Contract compared: RAM (dumpState, minus stack scratch below the entry SP) PLUS the module's boolean return, which
 * must match which path the oracle took. There is NO register live-out (the caller reloads DE
 * immediately and the abort path clobbers AF), so pc/SP/registers are not compared.
 *
 * Every case is CRAFTED: the record state (HL), the flip flag, and the source/target coordinate
 * bytes are poked identically on both sides. GAME_ACTIVE + PLAY_MODE are cleared so the hit path's
 * sound-append helper deterministically writes only its pending byte. Which path the oracle ran is
 * cross-checked against the grab latch (set only on a hit).
 *
 * Jobs:
 *   1. EQUAL — over five path cases, oracle == testTargetSlotGrabAndCatchObject in RAM (−stack) AND the module's boolean
 *      matches the oracle's path (grab latch).
 *   2. WRITE-SET — the grab-hit path writes exactly the record fields, the grab latch, the landing
 *      animation pointer, and the sound pending byte.
 *   3. TEETH — a twin that inverts the abort boolean is caught by the return check; a twin that
 *      writes a wrong record byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5e1f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5e1f as oracle } from "../../translated/loc_5e1f.js";
import { testTargetSlotGrabAndCatchObject } from "../testTargetSlotGrabAndCatchObject.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  GRAB_ACTIVE_FLAG,
  FLIP_SCREEN_FLAG,
  GAME_ACTIVE_FLAG,
  PLAY_MODE_LATCH,
  SOUND_RING_PENDING_BYTE,
  LANDING_ANIM_SEQ_40B4,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const IX = 0x8a00; // source coordinate record base (read at +0/+2)
const IY = 0x8b00; // target coordinate record base (read at +0/+2)
const HL = 0x8c50; // proximity record pointer (state at +0; becomes the hit record)

/** A fresh clone with the trigger's register inputs + selector cells seated identically. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.hl = HL;
  m.regs.ix = IX;
  m.regs.iy = IY;
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH; every push/pop/ret the oracle makes stays there
  m.mem8[GRAB_ACTIVE_FLAG] = 0x00;
  m.mem8[GAME_ACTIVE_FLAG] = 0x00; // sound-append gate closed -> deterministic footprint
  m.mem8[PLAY_MODE_LATCH] = 0x00;
  m.mem8[FLIP_SCREEN_FLAG] = spec.flip & 0xff;
  m.mem8[HL] = spec.state & 0xff;
  m.mem8[IX + 0x00] = spec.ix0 & 0xff;
  m.mem8[IX + 0x02] = spec.ix2 & 0xff;
  m.mem8[IY + 0x00] = spec.iy0 & 0xff;
  m.mem8[IY + 0x02] = spec.iy2 & 0xff;
  return m;
}

// (state, flip, ix0, ix2, iy0, iy2, hit) — one input per branch outcome.
const CASES = [
  { label: "state 0 short-circuits -> continue", state: 0x00, flip: 0x01, ix0: 0x00, ix2: 0x00, iy0: 0x00, iy2: 0x00, hit: false },
  { label: "state 5 short-circuits -> continue", state: 0x05, flip: 0x01, ix0: 0x00, ix2: 0x00, iy0: 0x00, iy2: 0x00, hit: false },
  { label: "dx >= 2 -> continue", state: 0x02, flip: 0x01, ix0: 0x00, ix2: 0x00, iy0: 0x00, iy2: 0x00, hit: false },
  { label: "dx < 2, dy >= 9 -> continue", state: 0x02, flip: 0x00, ix0: 0x09, ix2: 0x00, iy0: 0x00, iy2: 0xf8, hit: false },
  { label: "dx < 2, dy < 9 -> grab hit -> abort", state: 0x02, flip: 0x00, ix0: 0x09, ix2: 0x00, iy0: 0x00, iy2: 0x08, hit: true },
];

// The grab-hit path's write footprint (rec = HL), with the sound gate closed.
const HIT_WRITES = new Map([
  [HL + 0x00, 0x00],
  [HL + 0x01, 0x01],
  [HL + 0x02, 0x02],
  [HL + 0x0c, LANDING_ANIM_SEQ_40B4 & 0xff],
  [HL + 0x0d, (LANDING_ANIM_SEQ_40B4 >> 8) & 0xff],
  [HL + 0x0e, 0x00],
  [HL + 0x11, 0x0a],
  [SOUND_RING_PENDING_BYTE, 0x0d],
  [GRAB_ACTIVE_FLAG, 0x01],
]);

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted branch paths — testTargetSlotGrabAndCatchObject == oracle in RAM (−stack) + boolean matches path", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    const c = craft(spec);
    oracle(o);
    const ret = testTargetSlotGrabAndCatchObject(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} ("${spec.label}")`);
    // The oracle set the grab latch iff it took the abort (pop af; ret) path.
    const oracleAborted = o.mem8[GRAB_ACTIVE_FLAG] === 0x01;
    assert.equal(oracleAborted, spec.hit, `oracle path mismatch for "${spec.label}"`);
    assert.equal(ret, !spec.hit, `boolean return must be ${!spec.hit} for "${spec.label}"`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted paths identical (RAM −stack) + boolean matches`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the grab-hit path writes exactly the record + latch + anim + pending cells", () => {
  const after = craft(CASES[4]);
  // Pre-dirty every target cell so a write to its final value still shows in the before/after diff.
  for (const addr of HIT_WRITES.keys()) after.mem8[addr] = 0xaa;
  after.mem8[HL] = CASES[4].state; // restore the state input the routine reads first
  const b0 = after.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(addr)) changed.set(addr, a1[off]);
  }
  for (const [addr, val] of HIT_WRITES) {
    assert.equal(after.mem8[addr], val, `record cell ${hx(addr)} must hold ${hx(val)}`);
  }
  for (const addr of changed.keys()) {
    assert.ok(HIT_WRITES.has(addr), `unexpected write at ${hx(addr)}`);
  }
  console.log(`  WRITE-SET: ${HIT_WRITES.size} cells (record fields + grab latch + anim ptr + pending byte)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: an inverted abort boolean is CAUGHT by the return check", () => {
  const inverted = (m) => !testTargetSlotGrabAndCatchObject(m); // BUG: reports continue on a hit and abort on a miss
  const hit = craft(CASES[4]);
  assert.throws(() => {
    const ret = inverted(hit);
    assert.equal(ret, false, "the hit path must report abort (false)");
  }, "the boolean check must reject a twin that inverts the abort signal");

  const miss = craft(CASES[0]);
  assert.throws(() => {
    const ret = inverted(miss);
    assert.equal(ret, true, "the miss path must report continue (true)");
  }, "the boolean check must reject the inverted twin on a miss too");
  console.log("  TEETH/BOOL: inverted abort signal rejected on both a hit and a miss");
});

test("TEETH: a wrong record byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[4]);
  const c = craft(CASES[4]);
  oracle(o);
  testTargetSlotGrabAndCatchObject(c);
  c.mem8[HL + 0x11] = 0x00; // BUG: this record field must hold 0x0a
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record byte — it is worthless");
  assert.equal(d.addr, HL + 0x11, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(HL + 0x11)})`);
  console.log(`  TEETH/RAM: wrong record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
