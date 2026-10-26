// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seatPlayReadyOnIntroDelayExpiry (ROM 0x705f) — "level-intro phase 6 (final)":
 * dec (0x8f48); ret nz; else call 0x0ecf (sound silence), (0x8f52)=0, (0x880a)=6, ret.
 *
 * Cycle-free memory-equivalence gate (docs/decompiler-pipeline): a FRESH clone per side, compared
 * on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared. seatPlayReadyOnIntroDelayExpiry is a
 * tail-dispatched intro-phase handler (dispatchLevelIntroPhase's rst-0x28 table, selector 0x8f51) and leaves no
 * register a caller consumes, so the contract is RAM only — no register live-out.
 *
 * The routine has two paths off the intro-delay decrement:
 *   - non-zero after the decrement -> early return (only the delay cell moved);
 *   - zero after the decrement -> the full hand-off (silence the sound channel, clear the hit
 *     tally, seat the play sub-state to 6).
 * The oracle's `push16 + call 0x0ecf` on the full path writes a return address into STACK_SCRATCH
 * that the idiomatic direct call does not — excluded by contract.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over delay seeds hitting both paths (incl. the 0->0xff underflow),
 *      seatPlayReadyOnIntroDelayExpiry == oracle in RAM (-stack).
 *   2. WRITE-SET — the early path moves only the delay cell; the full path clears the delay, the
 *      tally, and seats the play sub-state to 6 (plus the sound-ring append).
 *   3. TEETH — a twin with a wrong play sub-state is CAUGHT at 0x880a; a twin that under-decrements
 *      the delay is CAUGHT at 0x8f48.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-705f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_705f as oracle } from "../../translated/loc_705f.js";
import { seatPlayReadyOnIntroDelayExpiry } from "../seatPlayReadyOnIntroDelayExpiry.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, INTRO_DELAY_CKSUM_WORD, HIT_TALLY, PLAY_STATE_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PLAY_READY = 0x06; // the play sub-state seated once the delay expires
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the intro-delay cell seated; sp lands pushes in STACK_SCRATCH. */
function craft(delay) {
  const m = BASE.clone();
  m.mem.write8(INTRO_DELAY_CKSUM_WORD, delay & 0xff);
  m.regs.sp = 0x8ffe;
  return m;
}

// delay 1 -> full hand-off; the rest -> early return (incl. 0 -> 0xff underflow).
const CASES = [0x01, 0x02, 0x05, 0x00, 0x80];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted delays — seatPlayReadyOnIntroDelayExpiry == oracle in RAM (−stack)", () => {
  for (const delay of CASES) {
    const o = craft(delay);
    const c = craft(delay);
    oracle(o);
    seatPlayReadyOnIntroDelayExpiry(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (delay=${hx(delay)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted delays identical (RAM −stack), incl. 0->0xff underflow + full hand-off`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: early path moves only the delay; the full path clears delay+tally and seats play=6", () => {
  // Early path (delay 5 -> 4): the delay cell is the only game-state write.
  const early = craft(0x05);
  const e0 = early.dumpState();
  oracle(early);
  const e1 = early.dumpState();
  const earlyChanged = [];
  for (let off = 0; off < e0.length; off++) {
    if (e0[off] === e1[off]) continue;
    const addr = early.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) earlyChanged.push(addr);
  }
  assert.deepEqual(earlyChanged, [INTRO_DELAY_CKSUM_WORD], "early path writes only the intro-delay cell");
  assert.equal(early.mem.read8(INTRO_DELAY_CKSUM_WORD), 0x04, "delay decremented 5 -> 4");

  // Full path (delay 1 -> 0): pre-dirty the tally so its clear is visible in the diff.
  const full = craft(0x01);
  full.mem.write8(HIT_TALLY, 0x33);
  const f0 = full.dumpState();
  oracle(full);
  const f1 = full.dumpState();
  const fullChanged = new Set();
  for (let off = 0; off < f0.length; off++) {
    if (f0[off] === f1[off]) continue;
    const addr = full.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) fullChanged.add(addr);
  }
  assert.ok(fullChanged.has(INTRO_DELAY_CKSUM_WORD), "full path clears the delay");
  assert.ok(fullChanged.has(HIT_TALLY), "full path clears the hit tally");
  assert.ok(fullChanged.has(PLAY_STATE_INDEX), "full path seats the play sub-state");
  assert.equal(full.mem.read8(INTRO_DELAY_CKSUM_WORD), 0x00, "delay := 0");
  assert.equal(full.mem.read8(HIT_TALLY), 0x00, "tally := 0");
  assert.equal(full.mem.read8(PLAY_STATE_INDEX), PLAY_READY, "play sub-state := 6");
  console.log("  WRITE-SET: early=1 cell (delay); full clears delay+tally, play:=6 (+sound-ring append)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong play sub-state is CAUGHT at 0x880a", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  seatPlayReadyOnIntroDelayExpiry(c);
  c.mem.write8(PLAY_STATE_INDEX, 0x05); // BUG: must be seated to 6
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong play sub-state — it is worthless");
  assert.equal(d.addr, PLAY_STATE_INDEX, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(play): wrong sub-state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an under-decremented delay is CAUGHT at 0x8f48", () => {
  const o = craft(0x05);
  const c = craft(0x05);
  oracle(o);
  seatPlayReadyOnIntroDelayExpiry(c);
  c.mem.write8(INTRO_DELAY_CKSUM_WORD, 0x05); // BUG: forgot the decrement
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missed decrement");
  assert.equal(d.addr, INTRO_DELAY_CKSUM_WORD, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(delay): missed decrement caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
