// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorDropStateOnDelay (ROM 0x24db, Pooyan) — one step of an
 * actor's drop/settle phase (dispatch 0x2436[4]). It decrements the per-frame delay at (ix+0x11);
 * while that stays non-zero it returns having only decremented. When the delay reaches zero it
 * nudges (ix+0x04) += 4 and (ix+0x06) -= 8, stamps the display tile (ix+0x0f) = 0x1a, reseeds the
 * delay (ix+0x11) = 0x30, and advances the dispatch state (ix+0x02) += 1.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES RAM, so each
 * case runs the oracle on one FRESH clone and advanceActorDropStateOnDelay on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * Memory-only: the early-return path leaves the decrement's Z flag in the CPU, but the state
 * dispatcher that invokes this handler reads no register or flag, so there is no return to compare.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — replay any real 0x24db dispatch a boot happens to reach.
 *   2. CRAFTED (load-bearing) — the two branches plus edges: delay>1 (early), delay==1 (full
 *      path, incl. add/sub truncation and state wrap), delay==0 (early via 0->0xff underflow).
 *   3. WRITE-SET — the oracle's writes land only in the declared offsets (all five on the full
 *      path; only +0x11 on the early path).
 *   4. TEETH — a twin that stamps a WRONG display tile MUST be caught, at ix+0x0f.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-24db.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_24db as oracle } from "../../translated/loc_24db.js";
import { advanceActorDropStateOnDelay } from "../advanceActorDropStateOnDelay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x24db;
const REC = ACTOR_TABLE; // 0x8a80: a sane actor-record base in the actor arena (work RAM)
const DIRT = 0xaa;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

// The offsets the full (delay-expired) path touches.
const FULL_OFFSETS = [0x02, 0x04, 0x06, 0x0f, 0x11];

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Pre-dirty the whole 0x18-byte record, then set the fields this handler reads; IX -> record. */
function craft({ delay, y04, y06, state02 }) {
  const m = new Machine(ROM);
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, DIRT);
  m.mem.write8((REC + 0x11) & 0xffff, delay);
  m.mem.write8((REC + 0x04) & 0xffff, y04);
  m.mem.write8((REC + 0x06) & 0xffff, y06);
  m.mem.write8((REC + 0x02) & 0xffff, state02);
  m.regs.ix = REC;
  m.regs.sp = 0x8fe0; // dead scratch; the routine pushes nothing, ret pops excluded RAM
  return m;
}

const CASES = [
  { name: "delay>1 (early)", delay: 0x05, y04: 0x40, y06: 0x80, state02: 0x03, expired: false },
  { name: "delay==1 (full)", delay: 0x01, y04: 0x40, y06: 0x80, state02: 0x03, expired: true },
  { name: "delay==0 underflow (early)", delay: 0x00, y04: 0x40, y06: 0x80, state02: 0x03, expired: false },
  { name: "delay==1 wraps (full)", delay: 0x01, y04: 0xfe, y06: 0x03, state02: 0xff, expired: true },
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

test("CAPTURE: real 0x24db dispatches replay identically in RAM (−stack), if reached", () => {
  const caps = captureDispatches(24, 4000);
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    advanceActorDropStateOnDelay(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  CAPTURE: ${caps.length} real 0x24db dispatch(es) replayed identically`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: both branches + edges — RAM(−stack) identical, fields exactly right", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    advanceActorDropStateOnDelay(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cs.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);

    const r = (off) => c.mem.read8((REC + off) & 0xffff);
    if (cs.expired) {
      assert.equal(r(0x04), (cs.y04 + 0x04) & 0xff, `${cs.name}: +0x04`);
      assert.equal(r(0x06), (cs.y06 - 0x08) & 0xff, `${cs.name}: +0x06`);
      assert.equal(r(0x0f), 0x1a, `${cs.name}: +0x0f tile`);
      assert.equal(r(0x11), 0x30, `${cs.name}: +0x11 reseed`);
      assert.equal(r(0x02), (cs.state02 + 1) & 0xff, `${cs.name}: +0x02 state`);
    } else {
      assert.equal(r(0x11), (cs.delay - 1) & 0xff, `${cs.name}: +0x11 decremented`);
      // Nothing else moved: the fields the full path would touch keep their crafted values.
      assert.equal(r(0x04), cs.y04, `${cs.name}: +0x04 untouched`);
      assert.equal(r(0x06), cs.y06, `${cs.name}: +0x06 untouched`);
      assert.equal(r(0x02), cs.state02, `${cs.name}: +0x02 untouched`);
      assert.equal(r(0x0f), DIRT, `${cs.name}: +0x0f untouched`);
    }
  }
  console.log(`  CRAFTED: ${CASES.length} cases identical (RAM −stack)`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: full path writes only {+0x02,+0x04,+0x06,+0x0f,+0x11}; early path only +0x11", () => {
  const allowedFull = new Set(FULL_OFFSETS.map((o) => (REC + o) & 0xffff));
  for (const cs of CASES) {
    const before = craft(cs);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    const changed = new Set();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) changed.add(after.stateOffsetToAddr(off));
    }
    if (cs.expired) {
      for (const addr of changed) assert.ok(allowedFull.has(addr), `${cs.name}: unexpected write ${hx(addr)}`);
      // Every declared write actually changed a byte (crafted values differ from the stamped ones).
      for (const off of FULL_OFFSETS) assert.ok(changed.has((REC + off) & 0xffff), `${cs.name}: +${hx(off)} should change`);
    } else {
      assert.deepEqual([...changed], [(REC + 0x11) & 0xffff], `${cs.name}: early path must touch only +0x11`);
    }
  }
  console.log("  WRITE-SET: writes confined to the declared offsets on both branches");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong display tile is caught, at ix+0x0f", () => {
  const cs = CASES[1]; // delay==1 -> full path stamps +0x0f
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  advanceActorDropStateOnDelay(c);
  c.mem.write8((REC + 0x0f) & 0xffff, 0xaa); // BUG: wrong display tile

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong display tile — it is worthless");
  assert.equal(d.addr, (REC + 0x0f) & 0xffff, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
