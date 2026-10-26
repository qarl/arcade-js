// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for allSlotsClear (ROM 0x1783) — the ten-slot strided all-zero scan.
 *
 * sub_1783 is a READ-ONLY LEAF: it reads up to ten cells at base + i*stride (the
 * caller's HL/DE), writes no memory, calls nothing, and returns a boolean decision —
 * true = every slot zero (the oracle's plain `ret`, caller continues), false = a slot
 * is non-zero (the oracle's `jp 0x0026` CALLER-SKIP that aborts the caller). So its
 * whole observable output is (a) no memory written and (b) that boolean. It is
 * validated against the frozen oracle on both:
 *
 *   1. REACHABILITY — hook 0x1783 over a long attract run. It is NOT dispatched in attract
 *      (its caller sub_1757 is a post-board object-clear phase), so the gate is entirely
 *      CRAFTED ENTRIES over every arm; any real dispatch that appears is validated, none required.
 *
 *   2. EQUAL (crafted arms) — for a curated set of strided-scan states covering every
 *      control arm (all-clear; first / middle / last slot occupied; several strides;
 *      high-bit non-zero), on FRESH clones both sides: the oracle writes NO RAM
 *      (justifying the read-only signature) and allSlotsClear returns the oracle's
 *      boolean, with RAM (minus the stack scratch below the entry SP) identical.
 *
 *   3. EQUAL (randomized differential) — thousands of random (base, stride, pattern)
 *      states, each compared boolean + RAM against the oracle. Broadens coverage past
 *      the hand-picked arms.
 *
 *   4. TEETH — a deliberately-broken twin that scans nine slots instead of ten MUST be
 *      caught: it agrees everywhere except when only the tenth slot is occupied, which
 *      the last-slot arm exercises.
 *
 * COVERAGE HOLE, stated plainly. This file gates the PREDICATE only. The seam entry
 * `allSlotsClearFromRegisters` — which unpacks HL/DE, REPLAYS the oracle's exit register file
 * on the all-clear arm, and deliberately DROPS the residuals on the occupied (caller-skip)
 * arm — is not exercised here at all; its live coverage is the two-level test in
 * seam-entry-abi.test.js. And because 0x1783 is not dispatched in a plain attract run (job 1
 * above), no whole-machine gate exercises the occupied arm either, so the decision to drop
 * those residuals rests on source reading rather than on a measurement.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1783.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1783 as oracle } from "../../translated/loc_1783.js";
import { allSlotsClear } from "../allSlotsClear.js";
import { Machine } from "../../machine.js";
import { SPRITE_OBJ_BLOCK, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1783;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- state-diff plumbing (RAM minus the stack scratch below the entry SP) ----------------------------

/**
 * First differing RAM byte between two dumps, skipping the STACK_SCRATCH region.
 * The oracle's caller-skip path pops/rets off the Z80 stack; those are reads, not
 * writes, but the exclusion mirrors the doc-06 contract (compare RAM minus stack).
 */
function firstRamDiffExStack(a, b, m, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const addr = m.stateOffsetToAddr(i);
      if (dead(addr)) continue;
      return { offset: i, addr, a: a[i], b: b[i] };
    }
  }
  return null;
}

/**
 * Build a fresh entry clone with the ten scan cells (base + i*stride) set to `pattern`
 * and HL/DE/SP wired the way the caller hands them over. FRESH per case: the oracle
 * mutates registers/SP, and each case lays its own memory pattern.
 */
function craft(entry, base, stride, pattern) {
  const c = entry.clone();
  for (let i = 0; i < pattern.length; i++) {
    c.mem.write8((base + i * stride) & 0xffff, pattern[i] & 0xff);
  }
  c.regs.hl = base & 0xffff;
  c.regs.de = stride & 0xffff;
  c.regs.b = 0; // the oracle re-loads B=10 itself; proves it is not a live-in here
  // Caller-skip path does pop16 + ret (4 stack bytes); keep them all inside work RAM
  // (STACK_SCRATCH ends at 0x6bff) so the oracle's stack unwind reads mapped bytes.
  c.regs.sp = 0x6bf8;
  return c;
}

/** Run the oracle on a fresh clone; return {bool, wroteRam:boolean|null}. */
function runOracle(crafted) {
  const m = crafted.clone();
  const before = m.dumpState();
  const bool = oracle(m);
  const after = m.dumpState();
  const wrote = firstRamDiffExStack(before, after, m, crafted.regs.sp);
  return { bool, wrote, ram: after, m };
}

/** Run the candidate on a fresh clone; return {bool, ram, m}. */
function runCandidate(crafted) {
  const m = crafted.clone();
  const before = m.dumpState();
  const bool = allSlotsClear(m.mem8, m.regs.hl, m.regs.de);
  const after = m.dumpState();
  // candidate is read-only; confirm it too mutated nothing
  const wrote = firstRamDiffExStack(before, after, m, crafted.regs.sp);
  return { bool, wrote, ram: after, m };
}

/**
 * Full memory-equivalence check on one crafted state: oracle writes no RAM, candidate
 * reproduces the oracle's boolean, and RAM (minus the stack scratch below the entry SP) is identical.
 */
function assertEquiv(crafted, label) {
  const o = runOracle(crafted);
  const c = runCandidate(crafted);
  assert.equal(o.wrote, null, `${label}: oracle wrote RAM at ${o.wrote && hx(o.wrote.addr)} — not read-only`);
  assert.equal(c.wrote, null, `${label}: candidate wrote RAM at ${c.wrote && hx(c.wrote.addr)} — not read-only`);
  assert.equal(c.bool, o.bool, `${label}: boolean mismatch — oracle=${o.bool} candidate=${c.bool}`);
  const rd = firstRamDiffExStack(o.ram, c.ram, o.m, crafted.regs.sp);
  assert.equal(rd, null, rd && `${label}: RAM diverged at ${hx(rd.addr)} oracle=${hx(rd.a)} cand=${hx(rd.b)}`);
  return o.bool;
}

// A safe writable base window: work RAM 0x6000-0x6BFF and the sprite buffer 0x6900-0x6A7F.
// Every case below keeps base + 9*stride inside writable RAM.
const ARMS = [
  { label: "sprite block, all clear", base: SPRITE_OBJ_BLOCK, stride: 4, pat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], want: true },
  { label: "sprite block, first slot occupied", base: SPRITE_OBJ_BLOCK, stride: 4, pat: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], want: false },
  { label: "sprite block, middle slot occupied", base: SPRITE_OBJ_BLOCK, stride: 4, pat: [0, 0, 0, 0, 0x22, 0, 0, 0, 0, 0], want: false },
  { label: "sprite block, LAST slot occupied", base: SPRITE_OBJ_BLOCK, stride: 4, pat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0x07], want: false },
  { label: "sprite block, all occupied (0xff)", base: SPRITE_OBJ_BLOCK, stride: 4, pat: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], want: false },
  { label: "high-bit non-zero (0x80) counts as occupied", base: SPRITE_OBJ_BLOCK, stride: 4, pat: [0, 0, 0x80, 0, 0, 0, 0, 0, 0, 0], want: false },
  { label: "stride 1 contiguous, all clear", base: 0x6a00, stride: 1, pat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], want: true },
  { label: "stride 1 contiguous, 2nd occupied", base: 0x6a00, stride: 1, pat: [0, 0xff, 0, 0, 0, 0, 0, 0, 0, 0], want: false },
  { label: "stride 0x20, all clear", base: 0x6800, stride: 0x20, pat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], want: true },
  { label: "stride 0x20, 9th slot occupied", base: 0x6800, stride: 0x20, pat: [0, 0, 0, 0, 0, 0, 0, 0, 0x05, 0], want: false },
];

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x1783 in attract — captured dispatches validated; none required", () => {
  let caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    if (caps.length < 32) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(6000);

  // Not reached in plain attract; the crafted-entry gate carries the proof. Validate
  // any that DO show (e.g. under future driven input) rather than assume zero.
  for (const cap of caps) {
    assertEquiv(cap, `real dispatch base=${hx(cap.regs.hl)} stride=${hx(cap.regs.de)}`);
  }
  console.log(`  REACHABILITY: ${caps.length} real 0x1783 dispatch(es) over 6000 attract frames (crafted-entry gate is the proof)`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted arms): allSlotsClear == oracle over every control arm", () => {
  const entry = new Machine(ROM).clone();
  for (const a of ARMS) {
    const got = assertEquiv(craft(entry, a.base, a.stride, a.pat), a.label);
    assert.equal(got, a.want, `${a.label}: expected oracle=${a.want} but got ${got}`);
  }
  console.log(`  EQUAL/arms: ${ARMS.length} crafted control arms identical to the oracle (bool + RAM)`);
});

// -- 3. EQUAL (randomized differential) ---------------------------------------

test("EQUAL (randomized): allSlotsClear == oracle over 4000 random strided states", () => {
  const entry = new Machine(ROM).clone();
  // deterministic LCG so a failure reproduces
  let s = 0x1783abcd >>> 0;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x100000000;
  const N = 4000;
  let sawTrue = 0, sawFalse = 0;
  for (let i = 0; i < N; i++) {
    const stride = 1 + ((rnd() * 0x20) | 0); // 1..0x20, keeps base+9*stride in RAM below
    const base = 0x6100 + ((rnd() * 0x400) | 0); // 0x6100..0x64ff -> +9*0x20 stays < 0x6bff
    const pat = [];
    for (let k = 0; k < 10; k++) pat.push(rnd() < 0.25 ? 1 + ((rnd() * 255) | 0) : 0);
    const got = assertEquiv(craft(entry, base, stride, pat), `rnd#${i} base=${hx(base)} stride=${hx(stride)}`);
    if (got) sawTrue++; else sawFalse++;
  }
  // both outcomes must actually occur, or the sweep never exercised a real fork
  assert.ok(sawTrue > 0 && sawFalse > 0, `sweep degenerate: true=${sawTrue} false=${sawFalse}`);
  console.log(`  EQUAL/random: ${N} random states identical to the oracle (true=${sawTrue}, false=${sawFalse})`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: scans NINE slots instead of ten — a plausible off-by-one that agrees
 *  with the oracle everywhere except when ONLY the tenth slot is occupied. */
function brokenAllSlotsClear(mem, base, stride) {
  let addr = base & 0xffff;
  for (let slot = 0; slot < 9; slot++) { // BUG: 9 should be 10
    if (mem.read8(addr) !== 0) return false;
    addr = (addr + stride) & 0xffff;
  }
  return true;
}

test("TEETH: the nine-instead-of-ten twin is CAUGHT by the arms", () => {
  const entry = new Machine(ROM).clone();
  let caught = null;
  for (const a of ARMS) {
    const crafted = craft(entry, a.base, a.stride, a.pat);
    const oracleBool = oracle(crafted.clone());
    const brokenBool = brokenAllSlotsClear(crafted.mem, crafted.regs.hl, crafted.regs.de);
    if (brokenBool !== oracleBool) { caught = a.label; break; }
  }
  assert.notEqual(caught, null, "the arm set FAILED to catch a nine-slot twin — the gate is worthless");
  console.log(`  TEETH: nine-slot twin caught by arm "${caught}"`);
});
