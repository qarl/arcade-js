// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceBarrelSpriteOrientation (ROM 0x23DE) — refresh a moving object's two
 * sprite-orientation bits from a packed direction lookup, on a per-object countdown.
 *
 * advanceBarrelSpriteOrientation reads the object record IX points at and the direction code in C (both
 * still supplied in registers by the frozen translated callers). Its whole
 * memory-observable behaviour is a function of four bytes — the record's countdown
 * (+0x0F), its sprite code (+0x07), its sprite attribute (+0x08), and C — and it
 * writes only those three record cells. Both callers overwrite the returned value
 * before reading it, so the contract is memory-only.
 *
 * The effect factors into disjoint paths, and within the refresh path into disjoint
 * bit fields, which makes an EXHAUSTIVE gate available:
 *
 *   PATH split (+0x0F != 1) — most calls just step the countdown: write (counter-1)
 *     to +0x0F, nothing else. Swept over all 256 counter values (CTR sweep); counter
 *     0 exercises the 0 -> 0xFF wrap and counter 1 crosses into the refresh path.
 *   REFRESH path (+0x0F == 1) — reloads +0x0F to 4 and rewrites the top bit of +0x07
 *     and +0x08, preserving their low seven bits. The two new top bits are bit 1 and
 *     bit 0 of nextAnimationStep(0x03|C, selector), where selector packs the two OLD top bits
 *     (code's bit 7 high, attribute's bit 7 low). Because C's low bit is forced set,
 *     nextAnimationStep's family constant is always a full {0,1,2,3} permutation, so the lookup
 *     always terminates for the 2-bit selector — no hang. This path factors as:
 *       • the two output top bits = a function of (C, selector) ONLY. Swept over the
 *         COMPLETE 256×4 (C, selector) grid (SEL sweep) with the low bits fixed.
 *       • each byte's low seven bits pass straight through. Swept over all 256 values
 *         of +0x07 (LO7A sweep) and all 256 of +0x08 (LO7B sweep) with C fixed.
 *     The top bit and the low seven bits are disjoint positions in the same byte, so
 *     proving each independently proves the whole byte.
 *
 * Together these sweeps cover the full (counter, code, attr, C) input space by that
 * factorisation, so this is a proof, not a sample.
 *
 *   1. EQUAL (exhaustive) — advanceBarrelSpriteOrientation == oracle on RAM − the stack scratch below the entry SP across all four
 *      sweeps. The oracle's refresh beat brackets its nextAnimationStep call with a push16, so
 *      the compared RAM excludes the dead stack scratch that dissolved push writes;
 *      advanceBarrelSpriteOrientation calls nextAnimationStep directly and touches no stack.
 *
 *   2. TEETH (exhaustive) — four deliberately-broken twins, each of which the same
 *      sweeps MUST catch:
 *        (a) swapped output top bits — bit 0 of the lookup to +0x07, bit 1 to +0x08;
 *            caught by the SEL sweep wherever the two bits differ.
 *        (b) swapped selector sources — attribute's bit 7 high, code's bit 7 low;
 *            caught wherever that changes the lookup.
 *        (c) wrong countdown reload — reloads +0x0F to 5 instead of 4; caught on any
 *            refresh beat at the countdown cell.
 *        (d) dropped low-bit passthrough — writes only the top bit of +0x07; caught by
 *            the LO7A / SEL sweeps (the fixed low bits are non-zero).
 *
 *   3. REALISM (captured dispatches) — 0x23DE runs continuously in the attract demo,
 *      so hook it, clone at each true dispatch, and confirm advanceBarrelSpriteOrientation reproduces the
 *      oracle's RAM on every real state the game actually produces (spanning both the
 *      decrement path and the refresh beat).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-23de.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_23de as oracle } from "../../translated/loc_23de.js";
import { advanceBarrelSpriteOrientation } from "../advanceBarrelSpriteOrientation.js";
import { nextAnimationStep } from "../nextAnimationStep.js";
import { STACK_SCRATCH, OBJ_SPRITE_CODE, OBJ_SPRITE_ATTR } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x23de;
const OBJ_COUNTDOWN = 0x0f;

// The object record the callers point at (IX). Base 0x6400 is a real object array
// (OBJ_ARRAY_64, stride 0x20, so +0x07/+0x08/+0x0F fit inside record 0) and all three
// touched cells land in work RAM (0x6000-0x6BFF).
const IX_BASE = 0x6400;
const CODE_CELL = (IX_BASE + OBJ_SPRITE_CODE) & 0xffff; // 0x6407
const ATTR_CELL = (IX_BASE + OBJ_SPRITE_ATTR) & 0xffff; // 0x6408
const CTR_CELL = (IX_BASE + OBJ_COUNTDOWN) & 0xffff;    // 0x640f

// On the refresh beat the oracle brackets its nextAnimationStep call with a push16; point SP
// into STACK_SCRATCH so that dissolved push (and the terminal ret's pop) stay in the
// dead region the memory-equivalence contract excludes.
const SAFE_SP = 0x6bf8;

// Distinctive non-zero low-seven-bit patterns so a twin that drops the passthrough (or
// clobbers the low bits) still diverges from the oracle's write.
const LOW7_CODE = 0x3c; // 0b0111100
const LOW7_ATTR = 0x2b; // 0b0101011

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * A synthetic entry: a clone of `base` with the object record's three input cells set,
 * the record pointer in IX, the direction code in C, and a safe stack in STACK_SCRATCH.
 * The frame machinery is neutralised (clone() already sets nextNmi/nextBoundary =
 * Infinity; re-asserted here) so the oracle's step machinery cannot fire an NMI.
 */
function makeEntry(base, { counter, code, attr, c }) {
  const e = base.clone();
  e.regs.ix = IX_BASE;
  e.regs.c = c;
  e.regs.sp = SAFE_SP;
  e.mem.write8(CTR_CELL, counter);
  e.mem.write8(CODE_CELL, code);
  e.mem.write8(ATTR_CELL, attr);
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

// Run the oracle and the candidate on two FRESH, byte-identical entries (the routine WRITES memory) and diff the
// memory-equivalence contract (RAM − the stack scratch below the entry SP).
function runPair(base, inputs, candidate) {
  const a = makeEntry(base, inputs); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(base, inputs); // candidate
  oracle(a);
  candidate(b);
  return { ram: firstRamDiff(a, b, aFloor) };
}

// Build a record whose two top bits encode a given 2-bit selector, over the fixed low
// bits (selector high bit -> code's bit 7, low bit -> attribute's bit 7).
const codeForSel = (sel) => (((sel >> 1) & 1) << 7) | LOW7_CODE;
const attrForSel = (sel) => ((sel & 1) << 7) | LOW7_ATTR;

// The four disjoint factored sweeps, run in sequence: the first mismatch (or null) and the total combos compared.
function fullSweep(base, candidate) {
  let count = 0;
  const step = (inputs) => {
    const { ram } = runPair(base, inputs, candidate);
    count++;
    return ram ? { mismatch: { inputs, ram }, count } : null;
  };

  // CTR sweep — the countdown path split and decrement over all 256 counter values
  // (fixed code/attr/C). counter 0 hits the 0 -> 0xFF wrap; counter 1 runs one refresh.
  for (let counter = 0; counter < 256; counter++) {
    const hit = step({ counter, code: 0x81, attr: 0xaa, c: 0x50 });
    if (hit) return hit;
  }

  // SEL sweep — the refresh top-bit lookup over the COMPLETE 256×4 (C, selector) grid,
  // low bits fixed. Exhaustive over everything nextAnimationStep's output can depend on here.
  for (let c = 0; c < 256; c++) {
    for (let sel = 0; sel < 4; sel++) {
      const hit = step({ counter: 1, code: codeForSel(sel), attr: attrForSel(sel), c });
      if (hit) return hit;
    }
  }

  // LO7A sweep — the +0x07 low-seven-bit passthrough over all 256 code values (fixed
  // attr/C). code's bit 7 also toggles the selector high bit as it sweeps.
  for (let code = 0; code < 256; code++) {
    const hit = step({ counter: 1, code, attr: 0xaa, c: 0x50 });
    if (hit) return hit;
  }

  // LO7B sweep — the +0x08 low-seven-bit passthrough over all 256 attr values.
  for (let attr = 0; attr < 256; attr++) {
    const hit = step({ counter: 1, code: 0x81, attr, c: 0x50 });
    if (hit) return hit;
  }

  return { mismatch: null, count };
}

const describeMismatch = (mm) =>
  mm &&
  `at counter=${hx(mm.inputs.counter)} code=${hx(mm.inputs.code)} attr=${hx(mm.inputs.attr)} ` +
    `c=${hx(mm.inputs.c)}: RAM diverges at 0x${(mm.ram.addr ?? 0).toString(16)} (${mm.ram.a}->${mm.ram.b})`;

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): advanceBarrelSpriteOrientation == oracle across all four factored sweeps", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = fullSweep(base, advanceBarrelSpriteOrientation);
  assert.equal(mismatch, null, describeMismatch(mismatch));
  // 256 counter + 256*4 (C, selector) + 256 code + 256 attr
  assert.equal(count, 256 + 256 * 4 + 256 + 256, "must have compared the full factored input space");
  console.log(`  EQUAL/exhaustive: ${count} (counter, code, attr, C) combos — RAM == oracle (minus the stack scratch below the entry SP)`);
});

// -- 2. TEETH (exhaustive) ----------------------------------------------------

// The twins reimplement advanceBarrelSpriteOrientation with one surgical bug each (they must call the real
// nextAnimationStep to reproduce the lookup so only the injected bug diverges).

/** BUG (a): routes bit 0 of the lookup to +0x07 and bit 1 to +0x08 (top bits swapped). */
function brokenSwappedOutputs(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const ctr = (objBase + 0x0f) & 0xffff;
  const counter = mem.read8(ctr);
  if (counter !== 1) { mem.write8(ctr, counter - 1); return; }
  const cA = (objBase + 0x07) & 0xffff, aA = (objBase + 0x08) & 0xffff;
  const code = mem.read8(cA), attr = mem.read8(aA);
  const sel = (((code >> 7) & 1) << 1) | ((attr >> 7) & 1);
  const next = nextAnimationStep(0x03 | regs.c, sel).a;
  mem.write8(aA, (((next >> 1) & 1) << 7) | (attr & 0x7f)); // BUG: bit 1 to +0x08
  mem.write8(cA, ((next & 1) << 7) | (code & 0x7f));        // BUG: bit 0 to +0x07
  mem.write8(ctr, 0x04);
}

/** BUG (b): packs the selector as attribute-bit7-high, code-bit7-low (sources swapped). */
function brokenSwappedSelector(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const ctr = (objBase + 0x0f) & 0xffff;
  const counter = mem.read8(ctr);
  if (counter !== 1) { mem.write8(ctr, counter - 1); return; }
  const cA = (objBase + 0x07) & 0xffff, aA = (objBase + 0x08) & 0xffff;
  const code = mem.read8(cA), attr = mem.read8(aA);
  const sel = (((attr >> 7) & 1) << 1) | ((code >> 7) & 1); // BUG: sources swapped
  const next = nextAnimationStep(0x03 | regs.c, sel).a;
  mem.write8(aA, ((next & 1) << 7) | (attr & 0x7f));
  mem.write8(cA, (((next >> 1) & 1) << 7) | (code & 0x7f));
  mem.write8(ctr, 0x04);
}

/** BUG (c): reloads the countdown to 5 instead of 4. */
function brokenReload(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const ctr = (objBase + 0x0f) & 0xffff;
  const counter = mem.read8(ctr);
  if (counter !== 1) { mem.write8(ctr, counter - 1); return; }
  const cA = (objBase + 0x07) & 0xffff, aA = (objBase + 0x08) & 0xffff;
  const code = mem.read8(cA), attr = mem.read8(aA);
  const sel = (((code >> 7) & 1) << 1) | ((attr >> 7) & 1);
  const next = nextAnimationStep(0x03 | regs.c, sel).a;
  mem.write8(aA, ((next & 1) << 7) | (attr & 0x7f));
  mem.write8(cA, (((next >> 1) & 1) << 7) | (code & 0x7f));
  mem.write8(ctr, 0x05); // BUG: should reload to 4
}

/** BUG (d): drops the +0x07 low-seven-bit passthrough (writes only the new top bit). */
function brokenDroppedPassthrough(m) {
  const { regs, mem } = m;
  const objBase = regs.ix;
  const ctr = (objBase + 0x0f) & 0xffff;
  const counter = mem.read8(ctr);
  if (counter !== 1) { mem.write8(ctr, counter - 1); return; }
  const cA = (objBase + 0x07) & 0xffff, aA = (objBase + 0x08) & 0xffff;
  const code = mem.read8(cA), attr = mem.read8(aA);
  const sel = (((code >> 7) & 1) << 1) | ((attr >> 7) & 1);
  const next = nextAnimationStep(0x03 | regs.c, sel).a;
  mem.write8(aA, ((next & 1) << 7) | (attr & 0x7f));
  mem.write8(cA, ((next >> 1) & 1) << 7); // BUG: no | (code & 0x7f)
  mem.write8(ctr, 0x04);
}

test("TEETH (exhaustive): the swapped-output-top-bits twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenSwappedOutputs);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch swapped output top bits — worthless");
  console.log(`  TEETH/swapped-outputs: caught — ${describeMismatch(mismatch)}`);
});

test("TEETH (exhaustive): the swapped-selector twin is CAUGHT", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenSwappedSelector);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a swapped selector — worthless");
  console.log(`  TEETH/swapped-selector: caught — ${describeMismatch(mismatch)}`);
});

test("TEETH (exhaustive): the wrong-countdown-reload twin is CAUGHT (countdown cell diverges)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenReload);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong countdown reload — worthless");
  assert.equal(mismatch.ram.addr, CTR_CELL, "the wrong-reload twin must diverge on the countdown cell");
  console.log(`  TEETH/reload: caught — ${describeMismatch(mismatch)}`);
});

test("TEETH (exhaustive): the dropped-low-bit-passthrough twin is CAUGHT (code cell diverges)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = fullSweep(base, brokenDroppedPassthrough);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped low-bit passthrough — worthless");
  assert.equal(mismatch.ram.addr, CODE_CELL, "the dropped-passthrough twin must diverge on the code cell");
  console.log(`  TEETH/passthrough: caught — ${describeMismatch(mismatch)}`);
});

// -- 3. REALISM (captured dispatches) -----------------------------------------

/**
 * Hook 0x23DE in a real attract run and clone the machine at up to K real dispatches.
 * The attract demo animates objects, so 0x23DE fires continuously. The wrapper clones
 * the entry state, then runs the oracle so the host game proceeds undisturbed.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

test("REALISM: real captured 0x23DE dispatches — advanceBarrelSpriteOrientation matches oracle RAM", () => {
  const caps = captureDispatches(300, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x23DE dispatch during attract");

  let sawRefresh = 0, sawDecrement = 0;
  for (const cap of caps) {
    const a = cap.clone(); a.nextNmi = Infinity; a.nextBoundary = Infinity;
    const b = cap.clone(); b.nextNmi = Infinity; b.nextBoundary = Infinity;
    const counterBefore = a.mem.read8((a.regs.ix + OBJ_COUNTDOWN) & 0xffff);
    oracle(a);
    advanceBarrelSpriteOrientation(b);
    const ram = firstRamDiff(a, b, cap.regs.sp);
    assert.equal(
      ram,
      null,
      ram &&
        `RAM diverges on real dispatch (ix=0x${a.regs.ix.toString(16)} counter=${hx(counterBefore)} ` +
          `c=${hx(b.regs.c)}) at 0x${(ram.addr ?? 0).toString(16)} (${ram.a}->${ram.b})`,
    );
    if (counterBefore === 1) sawRefresh++; else sawDecrement++;
  }
  console.log(`  REALISM: ${caps.length} real 0x23DE dispatches — RAM == oracle (${sawRefresh} refresh beats, ${sawDecrement} decrements)`);
});
