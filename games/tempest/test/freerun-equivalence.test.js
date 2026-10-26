// SPDX-License-Identifier: GPL-3.0-only
// Free-run idiomatic-vs-oracle DISPLAY equivalence -- the class-level teeth for the bug class the pinned
// per-routine equivalence tests and the pixel gate MISS. Both of those pin RANDOM to MAME's captured
// sequence, so they only ever visit MAME's states; a port bug that only diverges in a FREE-RUN state (the
// shipped clock-free RNG reaches states MAME never does) hides from all of them. The emitEnemySlotEntry
// stale-cursor short-record bug lived exactly there and passed every gate until it drew a stray vector.
//
// Method: run the idiomatic layer clock-free over the full attract. Each frame, rebuild the ORACLE's display
// list from the SAME entry state and the SAME RANDOM values the idiomatic frame consumed (c7bd
// dispatchFramePhaseHandler -> c891 seedFramePhaseAndTick -> b1b6 buildFrameVectors, the per-frame chain that
// writes the vector list), and assert the RENDER INPUTS (vector RAM + colour RAM + beam flips) are byte-equal
// -- pixel-confirmed on any mismatch, since bytes past the AVG list terminator are stale and never render.
// Run: node --test games/tempest/test/freerun-equivalence.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Machine, resolveAllIdiomatic } from "../machine.js";
import manifest from "../manifest.js";
import { renderFrameRGB } from "../../../boards/tempest/video.js";

const ROM_DIR = new URL("../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));

const RANDOM_REG = 0x0a; // POKEY register read for the RNG LFSR (0x60ca chip0 / 0x60da chip1)
const DISPLAY_CHAIN = [0xc7bd, 0xc891, 0xb1b6]; // dispatchFramePhaseHandler, seedFramePhaseAndTick, buildFrameVectors
const ATTRACT_FRAMES = 900; // one full attract cycle

// Mirror runIdiomaticIrqGame's clock-free setup (core/frame-stepped.js) without running its internal loop --
// the gate needs the per-frame ENTRY state (post previous IRQ), which the engine's onFrame hook fires before.
function bootClockFree(m) {
  m.nextBoundary = Infinity;
  m.maxFrames = Infinity;
  m.maxCycles = Infinity;
  m.nextNmi = Infinity;
  m.nextIrqCycle = Infinity;
  m.clockFree = true;
  m.idiomaticIrq = true;
  m.booted = true;
}

// Copy the same state fields Machine.clone() does, but INTO a pre-built no-override (oracle) machine.
function copyStateInto(d, s) {
  d.mem.workRam.set(s.mem.workRam);
  d.mem.vectorRam.set(s.mem.vectorRam);
  d.io.colorram.set(s.io.colorram);
  d.io.flipX = s.io.flipX;
  d.io.flipY = s.io.flipY;
  d.io.earom = s.io.earom.clone();
  d.io.mathbox = s.io.mathbox.clone();
  d.io.pokeys = s.io.pokeys.map((p, i) => p.clone(d.io.pokeys[i].potBits, d.io.pokeys[i].onWrite));
  d.io.knob = s.io.knob;
  d.io.inputAssert = structuredClone(s.io.inputAssert);
  d.io.dsw1 = s.io.dsw1;
  d.io.dsw2 = s.io.dsw2;
  d.io.cabinet = s.io.cabinet;
  d.io.playerSelect = s.io.playerSelect;
  if (d.io.avg) Object.assign(d.io.avg, { flipX: s.io.flipX, flipY: s.io.flipY, doneFlag: s.io.avg?.doneFlag, goPending: s.io.avg?.goPending });
  d.regs.copyFrom(s.regs);
  d.cycles = s.cycles;
  d.pc = s.pc;
  d.pcKnown = s.pcKnown;
}

const arrEq = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};
// Every input the AVG render reads: the display list, the colour LUT, and the beam flips.
const renderInputsEqual = (a, b) =>
  arrEq(a.mem.vectorRam, b.mem.vectorRam) && arrEq(a.io.colorram, b.io.colorram) &&
  a.io.flipX === b.io.flipX && a.io.flipY === b.io.flipY;
const pixelDiff = (a, b) => {
  const pa = renderFrameRGB(a), pb = renderFrameRGB(b);
  let n = 0;
  for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) n++;
  return n;
};

// Seat the oracle to replay the exact RANDOM values the idiomatic frame consumed, in read order per chip.
function pinReplay(mo, reads) {
  const q = [reads.filter((e) => e.c === 0).map((e) => e.v), reads.filter((e) => e.c !== 0).map((e) => e.v)];
  const qi = [0, 0];
  const base = (c, reg, cy) => mo.io.pokeys[c].read(reg, cy);
  mo.io.pokeyRead = (c, reg, cy) => {
    if ((reg & 0x0f) === RANDOM_REG && qi[c] < q[c].length) return q[c][qi[c]++];
    return base(c, reg, cy);
  };
}

const OVERRIDES = ROM_PRESENT ? await resolveAllIdiomatic() : null;
const OPTS = ROM_PRESENT ? { vectorrom: rd("vectorrom.bin"), avgprom: rd("avgprom.bin") } : {};
const IRQ = manifest.convergence.idiomatic.irq;

test("free-run idiomatic display list == oracle across the full attract (render inputs byte-equal)", () => {
  const mi = new Machine(rd("maincpu.bin"), { overrides: OVERRIDES, ...OPTS });
  bootClockFree(mi);
  let reads = [];
  const iRead = mi.io.pokeyRead.bind(mi.io);
  mi.io.pokeyRead = (c, reg, cy) => { const v = iRead(c, reg, cy); if ((reg & 0x0f) === RANDOM_REG) reads.push({ c, v }); return v; };
  const mo = new Machine(rd("maincpu.bin"), OPTS); // no overrides -> the frozen oracle

  const gen = mi.call(IRQ.bootAddr);
  let checked = 0;
  for (let frame = 1; frame <= ATTRACT_FRAMES; frame++) {
    copyStateInto(mo, mi); // entry state, before this frame's build
    reads = [];
    if (gen.next().done) break;
    pinReplay(mo, reads);
    for (const addr of DISPLAY_CHAIN) mo.call(addr);
    checked++;
    if (!renderInputsEqual(mi, mo)) {
      // A render-input byte differs -- fail only if it actually reaches pixels (stale post-terminator bytes do not).
      assert.equal(pixelDiff(mi, mo), 0, `frame ${frame}: idiomatic display diverges from the oracle in free-run`);
    }
    for (const vb of IRQ.irqVblank) { mi.io.vblank = vb; mi.pcKnown = true; mi.fireIrq(); }
    mi.io.vblank = 0;
  }
  assert.ok(checked > ATTRACT_FRAMES / 2, `only ${checked} frames ran -- attract free-run stopped early`);
  console.log(`  free-run equivalence: ${checked} attract frames, idiomatic == oracle`);
});

test("TEETH: a display-list byte the idiomatic layer builds wrong is caught (render-input + pixel)", () => {
  const mi = new Machine(rd("maincpu.bin"), { overrides: OVERRIDES, ...OPTS });
  bootClockFree(mi);
  let reads = [];
  const iRead = mi.io.pokeyRead.bind(mi.io);
  mi.io.pokeyRead = (c, reg, cy) => { const v = iRead(c, reg, cy); if ((reg & 0x0f) === RANDOM_REG) reads.push({ c, v }); return v; };
  const mo = new Machine(rd("maincpu.bin"), OPTS);

  const gen = mi.call(IRQ.bootAddr);
  // Advance to a frame with a populated display list, then build the matching oracle.
  for (let frame = 1; frame <= 130; frame++) {
    copyStateInto(mo, mi);
    reads = [];
    if (gen.next().done) break;
    if (frame === 130) {
      pinReplay(mo, reads);
      for (const addr of DISPLAY_CHAIN) mo.call(addr);
    } else {
      for (const vb of IRQ.irqVblank) { mi.io.vblank = vb; mi.pcKnown = true; mi.fireIrq(); }
      mi.io.vblank = 0;
    }
  }
  assert.ok(renderInputsEqual(mi, mo), "control: the clean frame's render inputs match before the mutation");
  // Corrupt the idiomatic display list in its active (rendered) span -- the bug class emits shifted/wrong bytes.
  for (let k = 0; k < 64; k++) mi.mem.vectorRam[k] ^= 0xff;
  assert.ok(!renderInputsEqual(mi, mo), "the render-input diff missed a mutated display-list byte");
  assert.notEqual(pixelDiff(mi, mo), 0, "the pixel confirm missed a mutated display-list byte");
});
