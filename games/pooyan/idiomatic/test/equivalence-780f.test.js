// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintTileBlock2x2Above (ROM 0x780f) — "stamp a 2x2 tile block whose
 * top row sits ONE screen row above the anchor": four source bytes (DE) land at HL, HL+1 (bottom
 * row) and HL-0x1f, HL-0x20 (the row above, 0x20-wide map). Source order is bottom-left,
 * bottom-right, top-right, top-left.
 *
 * CYCLE-FREE / memory-equivalence gate: the routine WRITES RAM, so every case uses a FRESH clone
 * per side. The go-forward contract is RAM only (dumpState minus stack scratch below the entry SP): the caller
 * (drawObjectStackedTiles) reloads HL/DE from the object record, so neither pointer is a live-out.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x780f in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. Pre-dirtied destination + varied source patterns; both
 *      sides land the four tiles identically.
 *   3. TEETH — a twin that writes a WRONG tile MUST be caught at the destination.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-780f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_780f as oracle } from "../../translated/loc_780f.js";
import { paintTileBlock2x2Above } from "../paintTileBlock2x2Above.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x780f;
const DST = 0x8a00; // work RAM: the anchor; row-above cells (DST-0x20/-0x1f) stay in work RAM too
const SRC = 0x8b00; // four source tiles, disjoint from DST and STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Destination cells in write order, and the source byte each receives.
const DST_CELLS = [DST, DST + 1, (DST - 0x1f) & 0xffff, (DST - 0x20) & 0xffff];
const SRC_FOR = [0, 1, 2, 3]; // DST_CELLS[i] <- SRC + SRC_FOR[i]

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** DST-block pre-dirtied to 0xAA, four source tiles from a pattern, HL=DST, DE=SRC. */
function craft(seed) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10;
  for (const a of DST_CELLS) m.mem.write8(a, 0xaa);
  for (let i = 0; i < 4; i++) m.mem.write8((SRC + i) & 0xffff, (seed + i) & 0xff);
  m.regs.hl = DST;
  m.regs.de = SRC;
  return m;
}

const SEEDS = [0xa0, 0x00, 0xff, 0x3c];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x780f dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    paintTileBlock2x2Above(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied dest + varied source — four tiles identical", () => {
  for (const seed of SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    paintTileBlock2x2Above(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed ${hx(seed)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    // The four tiles landed in the documented order (bottom-left, bottom-right, top-right, top-left).
    for (let i = 0; i < 4; i++) {
      assert.equal(c.mem.read8(DST_CELLS[i]), (seed + SRC_FOR[i]) & 0xff, `seed ${hx(seed)}: tile ${i}`);
    }
  }
  console.log(`  CRAFTED: ${SEEDS.length} source patterns blitted identically`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: writes a WRONG top-left tile — must be caught at DST-0x20. */
function brokenBlit(m) {
  paintTileBlock2x2Above(m);
  const bad = (DST - 0x20) & 0xffff;
  m.mem.write8(bad, (m.mem.read8(bad) ^ 0x01) & 0xff); // BUG: wrong tile
}

test("TEETH: a wrong tile is CAUGHT at the destination", () => {
  let caught = null;
  for (const seed of SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    brokenBlit(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong tile — it is worthless");
  assert.equal(caught.addr, (DST - 0x20) & 0xffff, `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong tile caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
