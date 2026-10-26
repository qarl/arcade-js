// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceRisingActorStep (ROM 0x2ab3-0x2ae7, Pooyan) — the
 * actor state-6 per-frame step: reload the short delay (+0x11=0x02), bump the frame counter
 * (+0x0b) and every 4th frame flip the display tile (+0x0f) between 0x15 and 0x1e, drive the
 * rise position (+0x06) up; while it stays below 0xc0 return early, else nudge base Y (+0x04)
 * down 3, advance the state (+0x02), and seed the long delay (+0x11=0x40).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. advanceRisingActorStep WRITES RAM, so
 * every case uses a FRESH clone per side and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The routine is memory-only — no register or flag survives for a caller — so there is no
 * return to compare; the actor record IS the contract. The record base is IX; both sides
 * read it from regs.ix (the module's sanctioned default).
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — actor state 6 is a gameplay path, not reached in a short
 *      attract boot; if any real 0x2ab3 dispatch IS seen, oracle vs module agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Seed records exercising both tile-flip outcomes
 *      (0x15->0x1e and other->0x15), the skip-flip frames, both exit paths, and the y/Y wraps.
 *   3. WRITE-SET — every oracle write lands within {+0x02,+0x04,+0x06,+0x0b,+0x0f,+0x11}.
 *   4. TEETH — a twin that writes a WRONG rise byte MUST be caught at rec+0x06.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2ab3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ab3 as oracle } from "../../translated/loc_2ab3.js";
import { advanceRisingActorStep } from "../advanceRisingActorStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x2ab3;
const REC = ACTOR_TABLE; // 0x8a80: a sane record base inside the actor arena (work RAM)
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const WRITTEN_OFFSETS = [0x02, 0x04, 0x06, 0x0b, 0x0f, 0x11];

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/**
 * Build a machine with an actor record at REC, IX pointing at it, the whole 0x18-byte
 * record pre-dirtied to 0xAA, then the used fields seeded from `f`.
 */
function craft(f) {
  const m = new Machine(ROM);
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, 0xaa);
  m.mem.write8((REC + 0x02) & 0xffff, f.state);
  m.mem.write8((REC + 0x04) & 0xffff, f.baseY);
  m.mem.write8((REC + 0x06) & 0xffff, f.rise);
  m.mem.write8((REC + 0x0b) & 0xffff, f.frame);
  m.mem.write8((REC + 0x0f) & 0xffff, f.tile);
  m.mem.write8((REC + 0x11) & 0xffff, f.delay);
  m.regs.ix = REC;
  return m;
}

// frame/rise/tile chosen to cover: skip-flip vs flip, flip 0x15->0x1e vs other->0x15,
// early-return vs tail, and the rise (0xff->0x00) + base-Y (0x02-3) wraps.
const CASES = [
  { state: 0x22, baseY: 0x55, rise: 0x10, frame: 0x00, tile: 0x77, delay: 0x09 }, // skip flip, early ret
  { state: 0x30, baseY: 0x50, rise: 0xbf, frame: 0x03, tile: 0x15, delay: 0x09 }, // flip 0x15->0x1e, tail
  { state: 0x10, baseY: 0x40, rise: 0x50, frame: 0x07, tile: 0x1e, delay: 0x09 }, // flip 0x1e->0x15, early ret
  { state: 0x11, baseY: 0x40, rise: 0xff, frame: 0x01, tile: 0x30, delay: 0x09 }, // rise wraps 0xff->0x00, early ret
  { state: 0xfe, baseY: 0x02, rise: 0xc5, frame: 0x02, tile: 0x30, delay: 0x09 }, // tail: base-Y 0x02-3 wraps, state 0xfe->0xff
  { state: 0x00, baseY: 0x00, rise: 0xbf, frame: 0x0b, tile: 0xaa, delay: 0x09 }, // flip dirty->0x15, tail, base-Y 0x00-3 wraps
];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  return caps;
}

test("CAPTURE: real 0x2ab3 dispatches (if reached) — advanceRisingActorStep == oracle in RAM (−stack)", () => {
  const caps = captureDispatches(32, 4000);
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    advanceRisingActorStep(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${caps.length} real dispatch(es) checked (best-effort — gameplay path)`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: seeded state-6 records — RAM identical (−stack) across both branches + wraps", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    advanceRisingActorStep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `case ${JSON.stringify(cs)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CRAFTED: ${CASES.length} seeded records identical (RAM −stack)`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: every oracle write is within {+0x02,+0x04,+0x06,+0x0b,+0x0f,+0x11}", () => {
  const written = new Set(WRITTEN_OFFSETS.map((o) => (REC + o) & 0xffff));
  for (const cs of CASES) {
    const before = craft(cs);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      assert.ok(written.has(addr), `case ${JSON.stringify(cs)}: oracle wrote unexpected addr ${hx(addr)}`);
    }
  }
  console.log("  WRITE-SET: every oracle write is within the declared six offsets");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts the stored rise byte by one — must be caught at rec+0x06. */
function brokenAdvance(m, rec = m.regs.ix) {
  advanceRisingActorStep(m, rec);
  m.mem.write8((rec + 0x06) & 0xffff, (m.mem.read8((rec + 0x06) & 0xffff) + 1) & 0xff); // BUG
}

test("TEETH: a wrong stored rise byte is CAUGHT at rec+0x06", () => {
  let caught = null;
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    brokenAdvance(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong rise store — it is worthless");
  assert.equal(caught.addr, (REC + 0x06) & 0xffff, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong rise store caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
