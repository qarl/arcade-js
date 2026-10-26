// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for renderStageCountdownDigits (ROM 0x34c9, Pooyan) — paint the
 * stage countdown at STAGE_COUNTDOWN as a two-cell HUD number: units nibble at
 * HUD_STAGE_DIGIT_LO, tens nibble one tilemap row over (+0x20), leading zero suppressed.
 * A value < 10 renders as a single digit; a value >= 10 converts to packed BCD first and
 * draws nothing while PLAY_MODE_LATCH is held. Every other RAM byte is left as found.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES VRAM, so every case
 * runs the oracle on one FRESH clone and the module on another, compared on the go-forward
 * contract: RAM (dumpState, minus stack scratch below the entry SP). There is NO register live-out — every
 * caller (paintRoundNumberHud/loc_1f14/loc_3fb5) discards it — so nothing else is compared.
 *
 * Jobs:
 *   1. CRAFTED (load-bearing) — pre-dirty the two HUD tiles, seed varied countdown + latch
 *      values across all three paths, confirm both sides land identical RAM.
 *   2. CAPTURED (best-effort) — replay any real 0x34c9 dispatch from a boot window.
 *   3. WRITE-SET — a two-digit value writes only within {HUD_STAGE_DIGIT_LO, +0x20}.
 *   4. TEETH — a twin that corrupts the units tile MUST be caught at HUD_STAGE_DIGIT_LO.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-34c9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_34c9 as oracle } from "../../translated/loc_34c9.js";
import { renderStageCountdownDigits } from "../renderStageCountdownDigits.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, STAGE_COUNTDOWN, PLAY_MODE_LATCH, HUD_STAGE_DIGIT_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TARGET = 0x34c9;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

const TILE_UNITS = HUD_STAGE_DIGIT_LO & 0xffff; // units digit tile
const TILE_TENS = (HUD_STAGE_DIGIT_LO + 0x20) & 0xffff; // tens digit tile, one row over
const WRITTEN = new Set([TILE_UNITS, TILE_TENS]);
const DIRT = 0xee; // sentinel pre-loaded into both HUD tiles

/** First RAM difference on the go-forward contract: dumpState minus the dead stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** Fresh machine: countdown + latch seeded, both HUD tiles pre-dirtied, SP parked in dead scratch. */
function craft(value, latch) {
  const base = new Machine(ROM);
  base.mem.write8(STAGE_COUNTDOWN, value & 0xff);
  base.mem.write8(PLAY_MODE_LATCH, latch & 0xff);
  base.mem.write8(TILE_UNITS, DIRT);
  base.mem.write8(TILE_TENS, DIRT);
  base.regs.sp = 0x8fe0; // inside STACK_SCRATCH
  return base;
}

// [countdown, latch]: single-digit (0/7/9), BCD (10/32/99/21 with gate open), and the two
// gated paths (>= 10 with a held latch -> draw nothing).
const CASES = [
  [0x00, 0x00], [0x07, 0x00], [0x09, 0x00],
  [0x0a, 0x00], [0x20, 0x00], [0x63, 0x00], [0x15, 0x00],
  [0x15, 0x01], [0x0a, 0x80],
];

// -- 1. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: varied countdown + latch — RAM(−stack) identical, HUD tiles match oracle", () => {
  for (const [value, latch] of CASES) {
    const base = craft(value, latch);
    const o = base.clone();
    const c = base.clone();
    oracle(o);
    renderStageCountdownDigits(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `value ${hx(value)} latch ${hx(latch)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);

    // Both HUD tiles equal what the oracle left (derived from the ORACLE clone, never the module).
    assert.equal(c.mem.read8(TILE_UNITS), o.mem.read8(TILE_UNITS), `value ${hx(value)}: units tile`);
    assert.equal(c.mem.read8(TILE_TENS), o.mem.read8(TILE_TENS), `value ${hx(value)}: tens tile`);
  }
  console.log(`  CRAFTED: ${CASES.length} countdown/latch cases rendered identically`);
});

// -- 2. CAPTURED (best-effort) ------------------------------------------------

test("CAPTURED: real 0x34c9 dispatches replay identically (if reached in the boot window)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 24) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    new Machine(ROM, { overrides: snap }).runFrames(4000);
  } catch {
    /* boot may unwind on an unimplemented path; keep whatever we captured */
  }
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    renderStageCountdownDigits(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `captured RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  CAPTURED: ${caps.length} real 0x34c9 dispatch(es) replayed identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a two-digit value writes only within {units, tens} tiles", () => {
  const base = craft(0x20, 0x00); // 32 -> both digits present (BCD 0x32)
  const before = base.clone();
  const after = base.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  for (const addr of changed) assert.ok(WRITTEN.has(addr), `oracle wrote unexpected addr ${hx(addr)}`);
  assert.ok(changed.includes(TILE_UNITS), "units tile should have changed");
  assert.ok(changed.includes(TILE_TENS), "tens tile should have changed");
  console.log(`  WRITE-SET: ${changed.length} writes, all within {units, tens}`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong units tile is caught at HUD_STAGE_DIGIT_LO", () => {
  const base = craft(0x20, 0x00);
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  renderStageCountdownDigits(c);
  c.mem.write8(TILE_UNITS, (c.mem.read8(TILE_UNITS) ^ 0x01) & 0xff); // BUG: corrupt the units digit

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong units tile — it is worthless");
  assert.equal(d.addr, TILE_UNITS, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong units tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
