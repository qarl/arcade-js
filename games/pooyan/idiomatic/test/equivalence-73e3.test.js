// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickEagleInterWaveHoldAndRearmLaunch (ROM 0x73e3) — "eagle inter-wave idle": while the hold timer
 * (0x8f36) is non-zero, decrement it and return the pre-decrement value in A. On expiry, if a wave
 * index (0x8f3d) is still set, enqueue command 0x06(0xb0+index) into the page-0x88 display-command
 * ring; then reseed the hold timer to 0x18 and clear the launch flag (0x8f3a), leaving A=0.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). Each case uses a FRESH
 * clone per side: oracle on one, tickEagleInterWaveHoldAndRearmLaunch on the other, compared on RAM (dumpState) minus
 * stack scratch below the entry SP PLUS the declared register live-out A. pc/SP/cycles are NOT compared. A is a
 * deterministic exit value on both paths (pre-decrement hold, or 0), matchable and consumed by
 * callers, so it is declared. The oracle's `push16 + call 0x0038` return address lands in
 * STACK_SCRATCH, excluded by contract.
 *
 * Every case is CRAFTED: the hold, wave-index and launch-flag cells (and, for the enqueue path, the
 * ring) are poked identically on both sides. The ring is seeded free so the enqueue lands.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — over {ticking, expiry+no wave, expiry+enqueue, ticking to zero}
 *      tickEagleInterWaveHoldAndRearmLaunch == oracle in RAM (-stack) AND in A; the SIDE-EFFECT arm asserts the module SET A.
 *   2. WRITE-SET — expiry with a wave index writes exactly five cells: the command word (two ring
 *      bytes), the advanced ring pointer, the reseeded hold timer, and the cleared launch flag.
 *   3. TEETH — a wrong reseed value is CAUGHT by the RAM diff; a wrong A is CAUGHT by the live-out
 *      check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-73e3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_73e3 as oracle } from "../../translated/loc_73e3.js";
import { tickEagleInterWaveHoldAndRearmLaunch } from "../tickEagleInterWaveHoldAndRearmLaunch.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, WAVE_HOLD_TIMER, WAVE_INDEX, WAVE_LAUNCH_FLAG, DISPLAY_CMD_RING_WRITE_PTR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PAGE = 0x8800;
const RING_START = 0xc0;
const HOLD_RESEED = 0x18;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the wave cells seated and the display ring seeded free. */
function craft(hold, waveIndex) {
  const m = BASE.clone();
  m.mem.write8(WAVE_HOLD_TIMER, hold & 0xff);
  m.mem.write8(WAVE_INDEX, waveIndex & 0xff);
  m.mem.write8(WAVE_LAUNCH_FLAG, 0x01); // nonzero so the clear is observable
  m.mem.write8(DISPLAY_CMD_RING_WRITE_PTR, RING_START);
  for (let s = RING_START; s <= 0xff; s++) m.mem.write8(RING_PAGE | s, 0x80); // free slots
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { hold: 0x05, waveIndex: 0x02 }, // ticking (wave index ignored while holding)
  { hold: 0x00, waveIndex: 0x00 }, // expiry, no wave -> reseed + clear only
  { hold: 0x00, waveIndex: 0x03 }, // expiry with a wave -> enqueue + reseed + clear
  { hold: 0x01, waveIndex: 0x04 }, // ticking down to zero
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted hold x wave — tickEagleInterWaveHoldAndRearmLaunch == oracle in RAM (-stack) + A", () => {
  for (const { hold, waveIndex } of CASES) {
    const o = craft(hold, waveIndex);
    const c = craft(hold, waveIndex);
    oracle(o);
    const ret = tickEagleInterWaveHoldAndRearmLaunch(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} (hold=${hx(hold)} wave=${hx(waveIndex)})`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `A return mismatch (hold=${hx(hold)} wave=${hx(waveIndex)})`);
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `module must SET A (hold=${hx(hold)} wave=${hx(waveIndex)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM -stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: expiry with a wave writes the command word, ring pointer, hold reseed, launch clear", () => {
  const mm = craft(0x00, 0x03);
  const b0 = mm.dumpState();
  oracle(mm);
  const a1 = mm.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = mm.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    changed.push({ addr, to: a1[off] });
  }
  const EXPECTED = new Map([
    [(RING_PAGE | 0xc0) & 0xffff, 0x06], //        command opcode
    [(RING_PAGE | 0xc1) & 0xffff, 0xb0 + 0x03], // command param (0xb0 + wave index)
    [DISPLAY_CMD_RING_WRITE_PTR, 0xc2], //         advanced ring pointer
    [WAVE_HOLD_TIMER, HOLD_RESEED],
    [WAVE_LAUNCH_FLAG, 0x00],
  ]);
  assert.equal(changed.length, EXPECTED.size, `expected ${EXPECTED.size} cells, got ${changed.length}`);
  for (const { addr, to } of changed) {
    assert.ok(EXPECTED.has(addr), `unexpected write at ${hx(addr)}`);
    assert.equal(to, EXPECTED.get(addr), `cell ${hx(addr)} must be ${hx(EXPECTED.get(addr))}, got ${hx(to)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} cells (command word + ring pointer + hold + launch flag)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong hold reseed value is CAUGHT by the RAM diff", () => {
  const o = craft(0x00, 0x00);
  const c = craft(0x00, 0x00);
  oracle(o);
  tickEagleInterWaveHoldAndRearmLaunch(c);
  c.mem.write8(WAVE_HOLD_TIMER, 0x17); // BUG: reseed must be 0x18
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong reseed value");
  assert.equal(d.addr, WAVE_HOLD_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/reseed: wrong hold reseed caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A on the ticking path is CAUGHT by the live-out check", () => {
  const o = craft(0x05, 0x02);
  const c = craft(0x05, 0x02);
  oracle(o);
  const ret = tickEagleInterWaveHoldAndRearmLaunch(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches the oracle (pre-decrement hold)");
  assert.notEqual(0x04, o.regs.a & 0xff, "the live-out check must reject the post-decrement value (0x04)");
  console.log(`  TEETH/A: module A ${hx(ret & 0xff)} == oracle; the post-decrement 0x04 is rejected`);
});
