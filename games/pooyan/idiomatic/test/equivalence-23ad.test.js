// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for wrapRenderPhaseAndPaintTileTriplet (ROM 0x23ad-0x23d6) — the shared render tail. Masks the
 * phase counter at (HL) to 0..3, looks up a tile-block descriptor for that phase via fetchWordFromTableIndex
 * (table 0x26f6), and stamps three 2x2 blocks at 0x8425 / 0x8465 / 0x84a5; the third block's
 * source is 0x270a when (0x88bc) bit0 is set, else 0x270e.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so each case uses a FRESH clone
 * per side, compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are not compared (the
 * oracle drives them through m.step/push/ret, the stack ABI the direct-call layer replaces).
 * wrapRenderPhaseAndPaintTileTriplet has NO register live-out — its callers (tickStatusRenderRingAndRedrawOnWrap / clampActorYAndAdvanceRenderPhase / movePlayerVerticallyAndTickStatusRender) tail into it and
 * read nothing back — so the contract is memory alone. The oracle's fetchWordFromTableIndex / loc_3325 sub-calls
 * resolve through the full translated registry that new Machine(ROM) builds.
 *
 * The mask reads (HL) but the third-block bit0 test reads 0x88bc ABSOLUTELY: one case seats HL at
 * 0x88bd (a different cell) so a rewrite that masked 0x88bc instead of (HL) — or read (HL) instead
 * of 0x88bc for bit0 — would diverge.
 *
 * Jobs:
 *   1. EQUAL — over the four phases at the real seat (HL = 0x88bc) and the split seat (HL = 0x88bd),
 *      oracle == wrapRenderPhaseAndPaintTileTriplet in RAM (−stack).
 *   2. TEETH — a wrong byte in the final blit cell, and a wrong (unmasked) phase cell, are CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-23ad.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_23ad as oracle } from "../../translated/loc_23ad.js";
import { wrapRenderPhaseAndPaintTileTriplet } from "../wrapRenderPhaseAndPaintTileTriplet.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const RENDER_PHASE = 0x88bc; // STATUS_RENDER_PHASE (masked to 0..3; bit0 selects the third source)
const RENDER_RING = 0x88bd; //  STATUS_RENDER_RING (used only as the "split seat" HL)
const VRAM_BASE = 0x8425; //    STATUS_RENDER_VRAM_BASE (first 2x2 anchor)
const FIELD_STRIDE = 0x40; //   two rows between the three status cells

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x9000);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone with HL seated and the two phase cells poked identically. */
function craft({ hl, atHl, atPhase }) {
  const m = BASE.clone();
  m.regs.hl = hl;
  m.mem.write8(hl, atHl); // the cell the mask reads/writes
  m.mem.write8(RENDER_PHASE, atPhase); // the cell bit0 reads (== atHl when hl == RENDER_PHASE)
  m.regs.sp = 0x9000; // stack top inside STACK_SCRATCH; the oracle's push/pop stay there
  return m;
}

/** The four cells one 2x2 blit writes, in blit2x2TileBlock's order. */
const blitCells = (d) => [d & 0xffff, (d + 0x01) & 0xffff, (d + 0x21) & 0xffff, (d + 0x20) & 0xffff];

// Real seat: HL == RENDER_PHASE, so the masked cell and the bit0 cell coincide (all four phases).
// Split seat: HL == RENDER_RING, so the mask hits 0x88bd while bit0 still reads 0x88bc.
const CASES = [
  { name: "real phase 0 (bit0 clear)", poke: { hl: RENDER_PHASE, atHl: 0x00, atPhase: 0x00 } },
  { name: "real phase 1 (bit0 set)", poke: { hl: RENDER_PHASE, atHl: 0x01, atPhase: 0x01 } },
  { name: "real phase 2 (bit0 clear)", poke: { hl: RENDER_PHASE, atHl: 0x02, atPhase: 0x02 } },
  { name: "real phase 3 (bit0 set)", poke: { hl: RENDER_PHASE, atHl: 0x03, atPhase: 0x03 } },
  { name: "real high phase 6 -> &3 = 2", poke: { hl: RENDER_PHASE, atHl: 0x06, atPhase: 0x06 } },
  { name: "split seat: mask 0x88bd, bit0 from 0x88bc", poke: { hl: RENDER_RING, atHl: 0x05, atPhase: 0x01 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every case — wrapRenderPhaseAndPaintTileTriplet == oracle in RAM (−stack)", () => {
  for (const { name, poke } of CASES) {
    const o = craft(poke);
    const c = craft(poke);
    oracle(o);
    wrapRenderPhaseAndPaintTileTriplet(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack)`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a wrong final-blit byte is CAUGHT by the RAM diff", () => {
  const poke = { hl: RENDER_PHASE, atHl: 0x01, atPhase: 0x01 };
  const o = craft(poke);
  const c = craft(poke);
  oracle(o);
  wrapRenderPhaseAndPaintTileTriplet(c);
  const last = blitCells(VRAM_BASE + 2 * FIELD_STRIDE).at(-1); // bottom-left of the third block
  c.mem.write8(last, (c.mem.read8(last) + 1) & 0xff); // BUG: corrupt the final blit cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong blit byte — it is worthless");
  assert.equal(d.addr, last, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(last)})`);
  console.log(`  TEETH: wrong blit byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an unmasked phase cell is CAUGHT (mask write is compared)", () => {
  const poke = { hl: RENDER_PHASE, atHl: 0x06, atPhase: 0x06 }; // oracle writes 0x02 back
  const o = craft(poke);
  const c = craft(poke);
  oracle(o);
  wrapRenderPhaseAndPaintTileTriplet(c);
  c.mem.write8(RENDER_PHASE, 0x06); // BUG: leave the phase cell unmasked

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an unmasked phase cell");
  assert.equal(d.addr, RENDER_PHASE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(RENDER_PHASE)})`);
  console.log(`  TEETH: unmasked phase cell caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
