// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for findTableSlotAndPaintStageHeader (ROM 0x1f40, Pooyan) — scan a table then draw the stage
 * header.
 *
 * SEATING: BALANCED. Both exits are a plain `ret`; the module returns nothing and equivalence is
 * RAM (dumpState) minus stack scratch below the entry SP. Entry registers A/HL/B/C are the param-default bridge
 * (target, table pointer, count, slot). It is a render routine: no register survives to a caller.
 *
 * Cases are CRAFTED: the scan table is seeded into work RAM so the three outcomes are reachable
 * deterministically — a match at slot 0 (renders the round number + label), a match at a nonzero
 * slot (label only), and no match (inert).
 *
 * Jobs:
 *   1. EQUAL — match-slot-0, match-slot-1, and no-match: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a no-match scan leaves RAM untouched; a slot-0 match writes the round tile and
 *      the mirrored HUD digit.
 *   3. TEETH — a corrupted rendered byte is caught by the RAM diff; a twin that skips the round
 *      render on a slot-0 match diverges at the round tile.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1f40.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1f40 as oracle } from "../../translated/loc_1f40.js";
import { findTableSlotAndPaintStageHeader } from "../findTableSlotAndPaintStageHeader.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TABLE = 0x8e00; // crafted scan table in work RAM
const TARGET = 0x42;
const ROUND = 0x8907; // ROUND_COUNTER
const STAGEC = 0x8901; // STAGE_COUNTDOWN
const HUD_DIGIT = 0x8743; // HUD_STAGE_DIGIT_LO
const ROUND_TILE = 0x8722; // HUD_ROUND_TILE
const LABEL_TILE = 0x8322; // HUD_STAGE_LABEL_TILE
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the scan interface + a five-slot table; `matchAt` places the target (null => no match). */
function seat(m, { matchAt = 0 } = {}) {
  m.regs.a = TARGET;
  m.regs.hl = TABLE;
  m.regs.b = 0x05;
  m.regs.c = 0x00;
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.mem.write8(ROUND, 0x00); //  round 0 -> BCD 1, units glyph block
  m.mem.write8(STAGEC, 0x07); // countdown mirrored into the HUD digit
  for (let i = 0; i < 5; i++) m.mem.write8(TABLE + i, 0x11); // non-matching filler
  if (matchAt != null) m.mem.write8(TABLE + matchAt, TARGET);
  return m;
}

const craftSlot0 = () => seat(BASE.clone(), { matchAt: 0 });
const craftSlot1 = () => seat(BASE.clone(), { matchAt: 1 });
const craftNoMatch = () => seat(BASE.clone(), { matchAt: null });

const CASES = [
  { name: "match slot 0 -> round + label", craft: craftSlot0 },
  { name: "match slot 1 -> label only", craft: craftSlot1 },
  { name: "no match -> inert", craft: craftNoMatch },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: findTableSlotAndPaintStageHeader == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    findTableSlotAndPaintStageHeader(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: no match is inert; a slot-0 match renders the round tile + HUD digit", () => {
  const none = craftNoMatch();
  const b0 = none.dumpState();
  oracle(none);
  assert.deepEqual([...none.dumpState()], [...b0], "a no-match scan must leave RAM untouched");

  const hit = craftSlot0();
  const beforeHit = hit.dumpState();
  oracle(hit);
  assert.equal(hit.mem.read8(HUD_DIGIT), 0x07, "a slot-0 match mirrors the stage countdown into the HUD digit");
  assert.notDeepEqual([...hit.dumpState()], [...beforeHit], "a slot-0 match must render (RAM changes)");
  console.log("  WRITE-SET: no-match inert; slot-0 renders");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted rendered byte is CAUGHT by the RAM diff", () => {
  const o = craftSlot0();
  const c = craftSlot0();
  oracle(o);
  findTableSlotAndPaintStageHeader(c);
  c.mem.write8(LABEL_TILE, (o.mem.read8(LABEL_TILE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted rendered byte");
  assert.equal(d.addr, LABEL_TILE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the round render diverges at the round tile", () => {
  const o = craftSlot0();
  const twin = craftSlot0();
  oracle(o);
  // a broken rewrite that mistook the slot-0 match for a nonzero slot: label only, no round tile
  twin.regs.c = 0x01; // force the nonzero-slot path
  twin.mem.write8(TABLE + 0x00, 0x11);
  twin.mem.write8(TABLE + 0x01, TARGET);
  findTableSlotAndPaintStageHeader(twin);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a missing round render");
  console.log(`  TEETH(skip round): caught at ${hx(d.addr ?? 0)}`);
});
