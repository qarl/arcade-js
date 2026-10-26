// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blitTile3x3Block (ROM 0x3307) — "stamp a 3-wide, 3-tall tile
 * block into video RAM": for each of three rows copy three source bytes (DE) into consecutive
 * destination cells (HL), then step HL down one screen row (3 written + 0x1d = 0x20 cells).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses
 * a FRESH clone per side. The oracle runs on one clone, the module on another, and they are
 * compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP), AND the advanced HL and DE live-outs.
 *
 * Register inputs are HL (destination) and DE (source); both sides read them from regs.hl /
 * regs.de. TWO pointers are live-out: the caller renderMarkerColumnExtendOrRetract stamps `ld (hl),0x10` right after the
 * call (advanced HL = dst + 0x60), and paintRoundNumberHud stamps the NEXT block (0x1f8c) straight from the
 * advanced DE = src + 9 — so a rewrite that drops the source advance renders a wrong glyph.
 *
 * NOTE — the oracle drives its row loop through a private RAM counter (0x8f0b), incrementing
 * it 1/2/3 and resetting it to 0 on exit; that cell is touched by NOTHING else and is always 0
 * on entry, so the born-clean form folds it into a local `row` counter. Because entry is 0 and
 * the oracle exits it at 0, the final RAM state (0) is identical either way. Every crafted case
 * leaves 0x8f0b at its 0 default, matching the sole reachable contract.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x3307 in a real run; any dispatch must agree in RAM + HL.
 *   2. CRAFTED — the load-bearing arm. Pre-dirtied destination + varied source patterns; both
 *      sides land the nine tiles identically and advance HL to dst + 0x60.
 *   3. TEETH — a twin that writes a WRONG tile MUST be caught at the destination.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3307.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3307 as oracle } from "../../translated/loc_3307.js";
import { blitTile3x3Block } from "../blitTile3x3Block.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x3307;
const DST = 0x8a00; // work RAM: writes land at +0x00/01/02, +0x20/21/22, +0x40/41/42
const SRC = 0x8b00; // nine source tiles, disjoint from DST and STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Destination cells the oracle stamps, and the final advanced HL.
const DST_CELLS = [0x00, 0x01, 0x02, 0x20, 0x21, 0x22, 0x40, 0x41, 0x42].map((o) => (DST + o) & 0xffff);
const HL_OUT = (DST + 0x60) & 0xffff;
const DE_OUT = (SRC + 9) & 0xffff; // advanced source: a chained blitter (paintRoundNumberHud) reads it next

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/**
 * DST pre-dirtied to 0xAA, nine source tiles from a pattern, HL=DST, DE=SRC. SP is parked
 * inside STACK_SCRATCH: the oracle push/pops BC (its row stride) as scratch, and those writes
 * land in the excluded dead-stack window so they never show up in the RAM diff.
 */
function craft(seed) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10;
  for (const a of DST_CELLS) m.mem.write8(a, 0xaa);
  for (let i = 0; i < 9; i++) m.mem.write8((SRC + i) & 0xffff, (seed + i) & 0xff);
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

test("CAPTURE: real 0x3307 dispatches — module == oracle in RAM (−stack) and HL", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const [retHl, retDe] = blitTile3x3Block(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(retHl, o.regs.hl, `HL live-out: module ${hx(retHl)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(retDe, o.regs.de, `DE live-out: module ${hx(retDe)} != oracle ${hx(o.regs.de)}`);
    // SIDE EFFECT: the bridge must SET both regs — renderMarkerColumnExtendOrRetract does `ld (hl),0x10` and paintRoundNumberHud blits
    // the next block from DE right after the call, so a return-only rewrite would break the dispatch.
    assert.equal(c.regs.hl, o.regs.hl, `module must SET HL: ${hx(c.regs.hl)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.de, o.regs.de, `module must SET DE: ${hx(c.regs.de)} != oracle ${hx(o.regs.de)}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: pre-dirtied dest + varied source — nine tiles identical, HL advanced", () => {
  for (const seed of SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    const [retHl, retDe] = blitTile3x3Block(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed ${hx(seed)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(retHl, o.regs.hl, `seed ${hx(seed)}: HL module ${hx(retHl)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(retHl, HL_OUT, `seed ${hx(seed)}: HL should be ${hx(HL_OUT)}`);
    assert.equal(retDe, o.regs.de, `seed ${hx(seed)}: DE module ${hx(retDe)} != oracle ${hx(o.regs.de)}`);
    assert.equal(retDe, DE_OUT, `seed ${hx(seed)}: DE should be ${hx(DE_OUT)}`);
    // SIDE EFFECT: the bridge must SET both HL and DE (renderMarkerColumnExtendOrRetract stamps via HL, paintRoundNumberHud blits via DE).
    assert.equal(c.regs.hl, o.regs.hl, `seed ${hx(seed)}: module must SET HL: ${hx(c.regs.hl)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.de, o.regs.de, `seed ${hx(seed)}: module must SET DE: ${hx(c.regs.de)} != oracle ${hx(o.regs.de)}`);

    // The nine tiles landed in row-major order from the source.
    for (let i = 0; i < 9; i++) {
      assert.equal(c.mem.read8(DST_CELLS[i]), (seed + i) & 0xff, `seed ${hx(seed)}: tile ${i}`);
    }
  }
  console.log(`  CRAFTED: ${SEEDS.length} source patterns blitted identically`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: writes a WRONG first tile — must be caught at DST. */
function brokenBlit(m, dst = m.regs.hl, src = m.regs.de) {
  const ret = blitTile3x3Block(m, dst, src);
  m.mem.write8(DST & 0xffff, (m.mem.read8(DST & 0xffff) ^ 0x01) & 0xff); // BUG: wrong tile
  return ret;
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
  assert.equal(caught.addr, DST & 0xffff, `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong tile caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
