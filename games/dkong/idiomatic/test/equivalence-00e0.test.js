// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for soundDriverTick (ROM 0x00E0) — the per-vblank sound driver.
 *
 * sub_00e0 is a LEAF (calls nothing) but it is NOT pure: it writes work RAM (the
 * decremented shadows) and drives three write-only board latches (the eight
 * ls259.6h trigger bits at 0x7D00-0x7D07, the 0x7C00 tune latch, the 0x7D80 IRQ
 * line). Those latches are NOT in the 5120-byte state dump — they live in IO
 * device state — so the equivalence contract here is memory-equivalence EXTENDED
 * to the device latches: after running oracle vs idiomatic on independent clones
 * of one entry state, compare
 *
 *     dumpState() (work+sprite+video, minus the stack scratch below the entry SP)
 *   + io.latch6h[0..7]   (the eight sound-trigger bits)
 *   + io.soundLatch3d    (0x7C00 tune index)
 *   + io.audioIrq        (0x7D80 IRQ line)
 *
 * SP/pc/registers are NOT compared: they are dead ABI here — the caller (perFrame,
 * ROM 0x00B5, inside the NMI) overwrites HL/A and restores B/DE/etc. from the stack
 * before reading any of them, and the idiomatic routine drops the Z80 `ret` for a
 * plain JS return, so its SP/pc necessarily differ from the stack-modelling oracle.
 *
 * The gate is four parts, each on a FRESH clone per case (the routine mutates
 * memory and device state — no clone reuse):
 *
 *   1. REALISM (captured dispatches) — hook 0x00E0 in a real attract run and clone
 *      the machine at each real invocation. Attract holds ATTRACT (0x6007) non-zero,
 *      so all but one dispatch take the guard early-return; the single power-on
 *      dispatch takes the full (all-zero) path. oracle == idiomatic on every one.
 *
 *   2. CRAFTED full-path arms — attract never feeds the loop/tune/IRQ arms real
 *      data, so take a real captured state and poke ATTRACT=0 plus a matrix of sound
 *      bytes (each shadow zero vs non-zero, priority vs background tune, IRQ queued
 *      vs not) + 256 seeded-random combos. oracle == idiomatic on every one, and the
 *      sweep is proven non-vacuous (it genuinely asserted latch bits and drove
 *      non-zero tune/IRQ outputs).
 *
 *   3. GUARD with live data — ATTRACT != 0 but the sound bytes loaded: both sides
 *      must do NOTHING (no latch, no shadow change), confirming the guard is honored.
 *
 *   4. TEETH — two deliberately-broken twins the CRAFTED sweep MUST catch:
 *        (a) tune-swap: writes SND_BGM to 0x7C00 even on the priority arm — a bug
 *            in a DEVICE latch that is NOT in dumpState, so only the latch compare
 *            catches it (proves the device-latch check is load-bearing).
 *        (b) no-dec: drives the latch bit right but never writes the shadow back —
 *            a work-RAM bug the dumpState compare catches.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-00e0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_00e0 as oracle } from "../../translated/loc_00e0.js";
import { soundDriverTick } from "../soundDriverTick.js";
import { Machine } from "../../machine.js";
import {
  ATTRACT,
  SND_TRIGGER,
  SND_IRQ_TRIGGER,
  SND_BGM,
  SND_PRIORITY,
  SND_PRIORITY_FRAMES,
  STACK_SCRATCH,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x00e0;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the observable-state comparison ----------------------------------------

/**
 * First observable difference between two machines AFTER a run — work/sprite/video
 * RAM (minus the stack scratch below the entry SP) plus the three sound-device latches — or null when
 * identical. The device latches are the routine's real output and are NOT in
 * dumpState(), so they are compared explicitly.
 */
function soundStateDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue; // dead stack scratch
    return `RAM 0x${addr.toString(16)}: oracle=${hx(da[i])} idio=${hx(db[i])}`;
  }
  for (let i = 0; i < 8; i++) {
    if (a.io.latch6h[i] !== b.io.latch6h[i]) {
      return `ls259.6h latch bit ${i} (0x${(0x7d00 + i).toString(16)}): ` +
        `oracle=${a.io.latch6h[i]} idio=${b.io.latch6h[i]}`;
    }
  }
  if (a.io.soundLatch3d !== b.io.soundLatch3d) {
    return `0x7c00 tune latch: oracle=${hx(a.io.soundLatch3d)} idio=${hx(b.io.soundLatch3d)}`;
  }
  if (a.io.audioIrq !== b.io.audioIrq) {
    return `0x7d80 IRQ line: oracle=${a.io.audioIrq} idio=${b.io.audioIrq}`;
  }
  return null;
}

/** Run oracle and `candidate` on two fresh clones of `base`; return the first diff (or null). */
function comparePair(base, candidate) {
  const a = base.clone(); // oracle
  const b = base.clone(); // candidate under test
  oracle(a);
  candidate(b);
  return soundStateDiff(a, b, base.regs.sp);
}

// -- 1. REALISM (captured dispatches) ---------------------------------------

/**
 * Hook 0x00E0 in a real attract run, cloning the machine at up to K real
 * dispatches. The wrapper runs the oracle so the host game proceeds to a clean stop.
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

test("REALISM: real captured 0x00E0 dispatches — idiomatic == oracle (guard + natural full pass)", () => {
  const caps = captureDispatches(400, 1500);
  assert.ok(caps.length >= 50, `expected many real 0x00E0 dispatches, got ${caps.length}`);

  let guardCases = 0;
  let fullCases = 0;
  for (const cap of caps) {
    if (cap.mem.read8(ATTRACT) === 0) fullCases++;
    else guardCases++;
    const diff = comparePair(cap, soundDriverTick);
    assert.equal(diff, null, diff && `real dispatch (ATTRACT=${hx(cap.mem.read8(ATTRACT))}): ${diff}`);
  }
  assert.ok(guardCases > 0, "expected guard-path (ATTRACT!=0) dispatches in attract");
  assert.ok(fullCases > 0, "expected at least one natural full-path (ATTRACT==0) dispatch");
  console.log(`  REALISM: ${caps.length} real dispatches identical (${guardCases} guard, ${fullCases} full)`);
});

// -- 2. CRAFTED full-path arms ----------------------------------------------

// Build a full-path entry: real captured state + ATTRACT=0 + explicit sound bytes.
function craft(cap, s) {
  const base = cap.clone();
  base.mem.write8(ATTRACT, 0); // reach the full path
  for (let i = 0; i < 8; i++) base.mem.write8(SND_TRIGGER + i, s.trig[i]);
  base.mem.write8(SND_IRQ_TRIGGER, s.irq);
  base.mem.write8(SND_BGM, s.bgm);
  base.mem.write8(SND_PRIORITY, s.prio);
  base.mem.write8(SND_PRIORITY_FRAMES, s.prioFrames);
  return base;
}

// Deterministic edge cases across every arm, then seeded-random combos.
function craftedCases() {
  const cases = [
    // all released, background tune, no IRQ
    { trig: [0, 0, 0, 0, 0, 0, 0, 0], irq: 0x00, bgm: 0x08, prio: 0x0f, prioFrames: 0 },
    // all asserted (varied countdowns), priority tune, IRQ queued
    { trig: [1, 2, 3, 4, 5, 0xff, 0x80, 0x01], irq: 0x03, bgm: 0x08, prio: 0x0f, prioFrames: 0x03 },
    // alternating asserts, background tune, single-frame IRQ
    { trig: [0, 5, 0, 5, 0, 5, 0, 5], irq: 0x01, bgm: 0x02, prio: 0x01, prioFrames: 0 },
    // every countdown at its last frame (1 -> 0)
    { trig: [1, 1, 1, 1, 1, 1, 1, 1], irq: 0x01, bgm: 0x08, prio: 0x0f, prioFrames: 0x01 },
    // no asserts but a priority tune running
    { trig: [0, 0, 0, 0, 0, 0, 0, 0], irq: 0x00, bgm: 0x08, prio: 0x0f, prioFrames: 0x05 },
  ];
  // 256 seeded-random combos (LCG — reproducible).
  let seed = 0x00e0abcd >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) >>> 24) & 0xff;
  for (let k = 0; k < 256; k++) {
    cases.push({
      trig: [rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd(), rnd()],
      irq: rnd(),
      bgm: rnd(),
      prio: rnd(),
      prioFrames: rnd(),
    });
  }
  return cases;
}

test("CRAFTED: ATTRACT=0 full-path arms (loop/tune/IRQ) — idiomatic == oracle", () => {
  const cap = captureDispatches(1, 1500)[0];
  assert.ok(cap, "need one captured state to craft from");
  const cases = craftedCases();

  // Non-vacuity: confirm the oracle actually exercised the interesting outputs.
  let assertedBits = 0, nonzeroTune = 0, firedIrq = 0;
  for (const s of cases) {
    const base = craft(cap, s);
    const diff = comparePair(base, soundDriverTick);
    assert.equal(diff, null, diff && `crafted ${JSON.stringify(s)}: ${diff}`);

    const oc = base.clone();
    oracle(oc);
    if (oc.io.latch6h.some((b) => b === 1)) assertedBits++;
    if (oc.io.soundLatch3d !== 0) nonzeroTune++;
    if (oc.io.audioIrq === 1) firedIrq++;
  }
  assert.ok(assertedBits > 0, "sweep never asserted a latch bit — full path not exercised");
  assert.ok(nonzeroTune > 0, "sweep never drove a non-zero tune — tune arm not exercised");
  assert.ok(firedIrq > 0, "sweep never fired the IRQ line — IRQ arm not exercised");
  console.log(
    `  CRAFTED: ${cases.length} full-path entries identical ` +
      `(asserted bits in ${assertedBits}, tune!=0 in ${nonzeroTune}, IRQ fired in ${firedIrq})`,
  );
});

// -- 3. GUARD with live data ------------------------------------------------

test("GUARD: ATTRACT!=0 with sound bytes loaded — both sides do nothing", () => {
  const cap = captureDispatches(1, 1500)[0];
  const base = cap.clone();
  base.mem.write8(ATTRACT, 0x05); // non-zero: guard must early-return
  for (let i = 0; i < 8; i++) base.mem.write8(SND_TRIGGER + i, 3);
  base.mem.write8(SND_IRQ_TRIGGER, 3);
  base.mem.write8(SND_PRIORITY_FRAMES, 3);
  base.mem.write8(SND_BGM, 0x08);
  base.mem.write8(SND_PRIORITY, 0x0f);

  // idiomatic must match the oracle (both no-op) ...
  const diff = comparePair(base, soundDriverTick);
  assert.equal(diff, null, diff && `guard path: ${diff}`);

  // ... and both must genuinely leave the loaded state untouched.
  const after = base.clone();
  soundDriverTick(after);
  for (let i = 0; i < 8; i++) {
    assert.equal(after.mem.read8(SND_TRIGGER + i), 3, "guard must not tick a shadow");
    assert.equal(after.io.latch6h[i], base.io.latch6h[i], "guard must not touch a latch bit");
  }
  assert.equal(after.io.soundLatch3d, base.io.soundLatch3d, "guard must not touch the tune latch");
  assert.equal(after.io.audioIrq, base.io.audioIrq, "guard must not touch the IRQ line");
  console.log("  GUARD: ATTRACT!=0 leaves shadows + all three latches untouched");
});

// -- 4. TEETH ---------------------------------------------------------------

// (a) Device-latch teeth: writes SND_BGM to 0x7C00 even on the priority arm. The
//     bug is entirely in a device latch (0x7C00), which is NOT in dumpState — so it
//     is caught ONLY by the latch comparison. Proves that check is load-bearing.
function brokenTuneSwap(m) {
  const { mem } = m;
  if (mem.read8(ATTRACT) !== 0) return;
  for (let i = 0; i < 8; i++) {
    const shadow = mem.read8(SND_TRIGGER + i);
    let bit;
    if (shadow === 0) bit = 0;
    else { mem.write8(SND_TRIGGER + i, (shadow - 1) & 0xff); bit = 1; }
    mem.write8(0x7d00 + i, bit);
  }
  const priorityFrames = mem.read8(SND_PRIORITY_FRAMES);
  if (priorityFrames !== 0) mem.write8(SND_PRIORITY_FRAMES, (priorityFrames - 1) & 0xff);
  mem.write8(0x7c00, mem.read8(SND_BGM)); // BUG: always background, ignores the priority tune
  const irqTrigger = mem.read8(SND_IRQ_TRIGGER);
  let irq;
  if (irqTrigger === 0) irq = 0;
  else { mem.write8(SND_IRQ_TRIGGER, (irqTrigger - 1) & 0xff); irq = 1; }
  mem.write8(0x7d80, irq);
}

// (b) Work-RAM teeth: drives the latch bit right but never writes the shadow back.
function brokenNoDec(m) {
  const { mem } = m;
  if (mem.read8(ATTRACT) !== 0) return;
  for (let i = 0; i < 8; i++) {
    const shadow = mem.read8(SND_TRIGGER + i);
    mem.write8(0x7d00 + i, shadow === 0 ? 0 : 1); // BUG: never decrements the shadow
  }
  const priorityFrames = mem.read8(SND_PRIORITY_FRAMES);
  let tune;
  if (priorityFrames !== 0) { mem.write8(SND_PRIORITY_FRAMES, (priorityFrames - 1) & 0xff); tune = mem.read8(SND_PRIORITY); }
  else tune = mem.read8(SND_BGM);
  mem.write8(0x7c00, tune);
  const irqTrigger = mem.read8(SND_IRQ_TRIGGER);
  let irq;
  if (irqTrigger === 0) irq = 0;
  else { mem.write8(SND_IRQ_TRIGGER, (irqTrigger - 1) & 0xff); irq = 1; }
  mem.write8(0x7d80, irq);
}

test("TEETH: both broken twins are CAUGHT by the crafted sweep", () => {
  const cap = captureDispatches(1, 1500)[0];
  const cases = craftedCases();

  const firstCatch = (candidate) => {
    for (const s of cases) {
      const diff = comparePair(craft(cap, s), candidate);
      if (diff) return diff;
    }
    return null;
  };

  const swapDiff = firstCatch(brokenTuneSwap);
  assert.notEqual(swapDiff, null, "the tune-swap twin (device-latch bug) escaped the sweep — the latch check is worthless");
  assert.match(swapDiff, /7c00/, `tune-swap should be caught at the 0x7c00 latch, got: ${swapDiff}`);

  const noDecDiff = firstCatch(brokenNoDec);
  assert.notEqual(noDecDiff, null, "the no-dec twin (work-RAM bug) escaped the sweep — the RAM check is worthless");
  assert.match(noDecDiff, /RAM 0x60/, `no-dec should be caught in the shadow RAM, got: ${noDecDiff}`);

  console.log(`  TEETH: tune-swap caught -> ${swapDiff}`);
  console.log(`  TEETH: no-dec caught   -> ${noDecDiff}`);
});
