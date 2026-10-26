// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for movePlayerVerticallyAndTickStatusRender (ROM 0x2329-0x23d6) — the bidirectional position driver
 * for the actor at IX. Aim bit2 clear routes to the descent handler (movePlayerDownAndTickStatusRender); set steps the
 * position up (dec, clamp low 0x41), refreshes the sprite Ys (loc_23d7), then advances the rising
 * ring counter — unless the tile-anim cursor sits at 0xe6 over a tile < 0x35 while all seven
 * integrity flags are clear, in which case it holds. On a ring wrap the mod-4 phase advances and
 * the shared render tail (wrapRenderPhaseAndPaintTileTriplet) redraws.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so each case uses a FRESH clone
 * per side, compared on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are not compared (the
 * oracle drives them through m.step/push/ret, the stack ABI the direct-call layer replaces).
 * movePlayerVerticallyAndTickStatusRender has NO register live-out — its only caller (dispatchPerFrameActorUpdatePasses) invokes the next helper straight
 * after and reads nothing back — so the contract is memory alone. The oracle drives its inlined
 * sub-calls (loc_23d7 / loc_23ec / loc_2405 / fetchWordFromTableIndex / loc_3325 and the inlined descent) through
 * the full translated registry that new Machine(ROM) builds; the module direct-calls the idiomatic
 * siblings and dissolves the descent into movePlayerDownAndTickStatusRender.
 *
 * IX is seated at the actor table (0x8a80) — the value the live caller passes and the value
 * loc_23d7 forces — so the initial (IX+4)/(IX+7) reads and the sprite-Y derivation coincide.
 *
 * Jobs:
 *   1. EQUAL — rise wrap (full render tail), rise advance no-wrap, rise gate-holds, rise
 *      scan-finds-a-flag, descent bit3-clear (delegation is a no-op), and descent advance
 *      (delegation does real work): oracle == movePlayerVerticallyAndTickStatusRender in RAM (−stack).
 *   2. TEETH — a wrong final-blit byte (wrap) and a wrong ring byte (no-wrap) are CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2329.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2329 as oracle } from "../../translated/loc_2329.js";
import { movePlayerVerticallyAndTickStatusRender } from "../movePlayerVerticallyAndTickStatusRender.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const IX = 0x8a80; //   ACTOR_TABLE (the live caller's IX; loc_23d7 forces the same)
const AIM = IX + 0x07; // aim/direction flags
const POSY = IX + 0x04; // actor vertical position
const CURSOR = 0x88be; // TILE_ANIM_CURSOR (16-bit)
const FRAME = 0x8f37; //  tile-anim parity counter (gates loc_23ec / loc_2405)
const RING = 0x88bd; //   STATUS_RENDER_RING
const PHASE = 0x88bc; //  STATUS_RENDER_PHASE
const FLAG_BASE = 0x89e7; // INTEGRITY_FLAG_SCAN_BASE
const FLAG_COUNT = 7;
const VRAM_BASE = 0x8425; // STATUS_RENDER_VRAM_BASE
const FIELD_STRIDE = 0x40;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x9000);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone with IX seated, the integrity flags cleared, and the case cells poked. */
function craft(poke) {
  const m = BASE.clone();
  m.regs.ix = IX;
  m.regs.sp = 0x9000; // stack top inside STACK_SCRATCH; the oracle's push/pop stay there
  for (let i = 0; i < FLAG_COUNT; i++) m.mem.write8(FLAG_BASE + i, 0x00);
  m.mem.write8(AIM, poke.aim);
  m.mem.write8(POSY, poke.posY ?? 0x50);
  if (poke.cursor !== undefined) m.mem.write16(CURSOR, poke.cursor);
  if (poke.cursorTile !== undefined) m.mem.write8(poke.cursor & 0xffff, poke.cursorTile);
  if (poke.frame !== undefined) m.mem.write8(FRAME, poke.frame);
  if (poke.ring !== undefined) m.mem.write8(RING, poke.ring);
  if (poke.phase !== undefined) m.mem.write8(PHASE, poke.phase);
  if (poke.flagSet !== undefined) m.mem.write8(poke.flagSet, 0x05);
  return m;
}

/** The four cells one 2x2 blit writes, in blit2x2TileBlock's order. */
const blitCells = (d) => [d & 0xffff, (d + 0x01) & 0xffff, (d + 0x21) & 0xffff, (d + 0x20) & 0xffff];

const CASES = [
  // rise, cursor low != 0xe6 -> skip the gate -> advance; ring 0x07 wraps -> phase++ -> render tail
  { name: "rise/wrap -> render tail", poke: { aim: 0x04, cursor: 0x8400, frame: 0x00, ring: 0x07, phase: 0x01 } },
  // rise advance, ring 0x00 -> 0x01, no wrap -> returns before the render tail
  { name: "rise/advance no-wrap", poke: { aim: 0x04, cursor: 0x8400, frame: 0x00, ring: 0x00 } },
  // rise, cursor at 0xe6 over a low tile, every flag clear -> gate holds (no counter step)
  { name: "rise/gate holds", poke: { aim: 0x04, cursor: 0x84e6, cursorTile: 0x10 } },
  // same gate, one integrity flag set -> advance
  { name: "rise/scan finds a flag", poke: { aim: 0x04, cursor: 0x84e6, cursorTile: 0x10, flagSet: 0x89e8, frame: 0x00, ring: 0x00 } },
  // bit2 clear, bit3 clear -> descent handler returns immediately (delegation must not run rise)
  { name: "descent/bit3 clear -> ret", poke: { aim: 0x00 } },
  // bit2 clear, bit3 set -> descent handler advances (delegation does real work)
  { name: "descent/advance", poke: { aim: 0x08, cursor: 0x0000, frame: 0x01, ring: 0x05 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every branch — movePlayerVerticallyAndTickStatusRender == oracle in RAM (−stack)", () => {
  for (const { name, poke } of CASES) {
    const o = craft(poke);
    const c = craft(poke);
    oracle(o);
    movePlayerVerticallyAndTickStatusRender(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a wrong final-blit byte (wrap) is CAUGHT", () => {
  const poke = { aim: 0x04, cursor: 0x8400, frame: 0x00, ring: 0x07, phase: 0x01 };
  const o = craft(poke);
  const c = craft(poke);
  oracle(o);
  movePlayerVerticallyAndTickStatusRender(c);
  const last = blitCells(VRAM_BASE + 2 * FIELD_STRIDE).at(-1);
  c.mem.write8(last, (c.mem.read8(last) + 1) & 0xff); // BUG: corrupt the final render cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong render byte — it is worthless");
  assert.equal(d.addr, last, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(last)})`);
  console.log(`  TEETH: wrong render byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong ring byte (no-wrap) is CAUGHT", () => {
  const poke = { aim: 0x04, cursor: 0x8400, frame: 0x00, ring: 0x00 };
  const o = craft(poke);
  const c = craft(poke);
  oracle(o);
  movePlayerVerticallyAndTickStatusRender(c);
  c.mem.write8(RING, (c.mem.read8(RING) + 1) & 0xff); // BUG: corrupt the advanced ring counter

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong ring byte");
  assert.equal(d.addr, RING, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(RING)})`);
  console.log(`  TEETH: wrong ring byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
