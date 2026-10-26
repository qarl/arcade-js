// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for spendCredit (ROM 0x0977) — spend one credit + post the
 * credit-display task.
 *
 * spendCredit WRITES memory (CREDITS at 0x6001 and, via enqueueTask, the task ring
 * 0x60C0–0x60FF + tail 0x60B0) and is NOT a leaf (it calls enqueueTask), so it is
 * gated by capture / clone / replay (docs/decompiler-pipeline), with a FRESH clone per case:
 *
 *   1. REALISM (real captured dispatch) — 0x0977 is NOT reached in plain attract
 *      (attract inserts no coin, so no start is ever accepted). A coin+start input
 *      tape drives the credited state and produces one real 1P-start dispatch
 *      (CREDITS==1). Run the ORACLE on one clone and spendCredit on another and
 *      confirm every game-visible byte matches — the diff is confined to
 *      STACK_SCRATCH. That confinement is the whole point: the oracle models
 *      `push … call … ret` (writing to the stack and consuming a return address, so
 *      its SP/pc move); spendCredit uses the JS call stack and models neither, so
 *      the ONLY residual difference is stack-scratch bytes. SP/pc must be unchanged.
 *
 *   2. CREDITS decrement (exhaustive crafted) — the decrement is the routine's core
 *      arithmetic and attract exercises only CREDITS==1, so on a real captured entry
 *      poke CREDITS to EVERY byte 0..255 identically on both sides and compare
 *      game-visible RAM. This exhaustively pins the `add 0x99 / daa` BCD decrement,
 *      including the 0x00->0x99 wrap and non-canonical inputs.
 *
 *   3. CRAFTED (task-ring arms) — attract's one dispatch takes the plain-write enqueue
 *      arm, so the OCCUPIED-slot DROP and wrap-around arms of the delegated enqueueTask
 *      are forced by poking the ring/tail on a real entry, identically both sides.
 *
 *   4. TEETH — a twin that spends the credit with a BINARY decrement `(v-1)&0xff`
 *      instead of a BCD one MUST be caught by the CREDITS sweep (they agree whenever
 *      the low nibble is nonzero, and diverge at 0x10->0x09 vs 0x0f / 0x00->0x99 vs
 *      0xff — the subtle, load-bearing kind of bug the gate must not miss), naming
 *      CREDITS (0x6001).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0977.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0977 as oracle } from "../../translated/loc_0977.js";
import { spendCredit } from "../spendCredit.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0977;
const CREDITS = 0x6001;
const TASK_TAIL = 0x60b0;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// A coin then a 1-player start. Coin (IN2 bit7) at frame 10 credits the machine so
// GAME_STATE reaches 2; start1 (IN2 bit2) at frame 45 makes loc_08f8 accept the start
// (CREDITS==1 -> B=0x04 in loc_08d5, so A = IN2 & 0x04 = 0x04 -> the 1P arm calls 0x0977
// exactly once). dur 6 = MAME's coin/button hold.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin1
  { port: 0x7d00, bits: 0x04, frame: 45, dur: 6 }, // start1
];

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns the first
 * game-visible difference { addr, a, b } or null, plus how many bytes differed inside
 * the tolerated stack scratch.
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/**
 * Replay one entry state through the oracle and a candidate on independent clones
 * (FRESH per side — the routine writes RAM), and return the diff + both machines.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Drive coin+start and clone the machine at each real 0x0977 dispatch. The wrapper
 * delegates to the oracle so the host run proceeds to a clean stop.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// -- 1. REALISM (real captured dispatch) --------------------------------------

test("REALISM: real captured 0x0977 dispatch — game-visible RAM identical, SP/pc unmodelled", () => {
  const caps = captureDispatches(8, 150);
  assert.ok(caps.length >= 1, "expected at least one real 0x0977 dispatch after coin+start");

  for (const entry of caps) {
    const { bad } = replay(entry, spendCredit);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on CREDITS=${hx(entry.mem.read8(CREDITS))}`,
    );
    // The oracle's push16(0x0985) writes to [SP-2,SP-1] and sub_309f pushes HL below
    // that ([SP-4,SP-3]); both targets must sit inside STACK_SCRATCH, so excluding it
    // cannot mask a real diff.
    assert.ok(
      (entry.regs.sp - 4) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's push targets must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    // spendCredit must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    spendCredit(b);
    assert.equal(b.regs.sp, sp0, "spendCredit must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "spendCredit must leave pc unchanged (no ret modelling)");
  }
  console.log(`  REALISM: ${caps.length} real dispatch(es) — game-visible RAM identical to the oracle`);
});

// -- 2. CREDITS decrement (exhaustive crafted) --------------------------------

// A real credited-state 0x0977 entry to poke CREDITS onto (a real state + a surgical
// nudge — docs/decompiler-pipeline crafted entry). Free the tail slot so every iteration also exercises
// the enqueue WRITE path, not only the decrement.
function craftedBase() {
  const caps = captureDispatches(1, 150);
  assert.ok(caps.length >= 1, "expected a real credited-state 0x0977 entry to craft from");
  const base = caps[0];
  base.mem.write8(0x6000 | base.mem.read8(TASK_TAIL), 0xff); // ensure the tail slot is free
  return base;
}

test("CREDITS decrement (exhaustive): spendCredit == oracle over all 256 CREDITS values", () => {
  const base = craftedBase();
  let count = 0;
  let mismatch = null;
  for (let v = 0; v < 256 && !mismatch; v++) {
    const a = base.clone(); const b = base.clone();
    a.mem.write8(CREDITS, v);
    b.mem.write8(CREDITS, v);
    oracle(a);
    spendCredit(b);
    const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
    count++;
    if (bad) mismatch = { v, bad };
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at CREDITS=${hx(mismatch.v)}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 CREDITS values");
  console.log(`  CREDITS/exhaustive: ${count} CREDITS values — game-visible RAM identical (incl. 0x00->0x99 wrap)`);
});

// -- 3. CRAFTED (task-ring arms the one dispatch never reaches) ---------------

test("CRAFTED: enqueueTask DROP / WRAP arms (via spendCredit) match the oracle", () => {
  const base = craftedBase();
  const arms = [
    // Occupied slot at the tail (bit 7 clear) -> ring full -> DROP, tail untouched.
    ["DROP", (m) => { m.mem.write8(0x6000 | m.mem.read8(TASK_TAIL), 0x00); }],
    // Tail at the last slot, free -> write, advance past 0xFF -> WRAP to 0xC0.
    ["WRAP", (m) => { m.mem.write8(TASK_TAIL, 0xfe); m.mem.write8(0x60fe, 0xff); m.mem.write8(0x60ff, 0xff); }],
  ];
  for (const [label, craft] of arms) {
    const a = base.clone(); const b = base.clone();
    craft(a); craft(b);
    oracle(a);
    spendCredit(b);
    const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(`  CRAFTED ${label}: tail 0x60b0 -> ${hx(a.mem.read8(TASK_TAIL))}, game-visible RAM identical`);
  }
});

// -- 4. TEETH -----------------------------------------------------------------

/**
 * Broken twin: spends the credit with a BINARY decrement `(v-1)&0xff` instead of the
 * BCD `add 0x99 / daa`. It agrees with the oracle whenever CREDITS' low nibble is
 * nonzero and diverges only at a nibble borrow (0x10 -> 0x09 vs 0x0f, 0x00 -> 0x99 vs
 * 0xff), so only the CREDITS sweep catches it.
 */
function brokenSpendCredit(m) {
  const { regs, mem } = m;
  mem.write8(CREDITS, (mem.read8(CREDITS) - 1) & 0xff); // BUG: binary, not BCD
  regs.de = 0x0400;
  // Enqueue exactly as spendCredit does, so the ONLY divergence is CREDITS.
  const tail = mem.read8(TASK_TAIL);
  const slot = 0x6000 | tail;
  if ((mem.read8(slot) & 0x80) !== 0) {
    mem.write8(slot, regs.d);
    mem.write8(0x6000 | ((tail + 1) & 0xff), regs.e);
    let next = (tail + 2) & 0xff;
    if (next < 0xc0) next = 0xc0;
    mem.write8(TASK_TAIL, next);
  }
}

test("TEETH: the binary-decrement twin is CAUGHT by the CREDITS sweep and names 0x6001", () => {
  const base = craftedBase();
  let caught = null;
  for (let v = 0; v < 256 && !caught; v++) {
    const a = base.clone(); const b = base.clone();
    a.mem.write8(CREDITS, v);
    b.mem.write8(CREDITS, v);
    oracle(a);
    brokenSpendCredit(b);
    const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
    if (bad) caught = { v, bad };
  }
  assert.notEqual(caught, null, "the CREDITS sweep FAILED to catch a binary (non-BCD) decrement — it is worthless");
  assert.equal(caught.bad.addr, CREDITS, `expected the caught diff at 0x6001, got ${hx(caught.bad.addr)}`);
  console.log(
    `  TEETH: caught at CREDITS=${hx(caught.v)} (0x6001 oracle=${hx(caught.bad.a)} broken=${hx(caught.bad.b)})`,
  );
});
