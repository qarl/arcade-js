// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceAttractOnStartPress (ROM 0x0c2a, Pooyan) — the attract IN0 start-button poll.
 *
 * While IN0 bit3 is set the routine is inert; on a press it seats attract sub-state 9 and wipes the
 * tile video RAM to the blank tile. The fill is one cell short of the full page (bc = 0x03ff), so the
 * final 0x87ff cell is deliberately left untouched — a quirk the teeth pin down. advanceAttractOnStartPress is a void
 * poll, so equivalence is RAM (dumpState) minus stack scratch below the entry SP.
 *
 * Jobs:
 *   1. EQUAL — pressed and not-pressed crafts: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a press seats sub-state 9 and blanks the first/last-filled cells.
 *   3. TEETH — a corrupted filled cell is caught; a twin that also fills 0x87ff diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0c2a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0c2a as oracle } from "../../translated/loc_0b32.js";
import { advanceAttractOnStartPress } from "../advanceAttractOnStartPress.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, IN0_PORT, ATTRACT_SUBSTATE, VIDEO_RAM_BASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;
const BLANK_TILE = 0x10;
const LAST_FILLED = VIDEO_RAM_BASE + 0x03fe; // 0x87fe
const NEVER_FILLED = VIDEO_RAM_BASE + 0x03ff; // 0x87ff — the off-by-one cell

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the poll input and pre-dirty the video RAM so the fill is observable. */
function craft(in0) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.io.in0 = in0 & 0xff; // IN0 is a read-only port: set the io input, not a mem write
  m.mem8[ATTRACT_SUBSTATE] = 0x00;
  for (let i = 0; i <= 0x03ff; i++) m.mem8[VIDEO_RAM_BASE + i] = 0x55; // pre-dirty incl. 0x87ff
  return m;
}

const CASES = {
  "start held -> inert": () => craft(0x08),
  "start pressed -> wipe": () => craft(0x00),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceAttractOnStartPress == oracle in RAM (−stack)", () => {
  for (const [name, mk] of Object.entries(CASES)) {
    const o = mk();
    const c = mk();
    oracle(o);
    advanceAttractOnStartPress(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a press seats sub-state 9 and blanks the strip up to 0x87fe", () => {
  const o = CASES["start pressed -> wipe"]();
  oracle(o);
  assert.equal(o.mem8[ATTRACT_SUBSTATE], 0x09, "sub-state advanced to 9");
  assert.equal(o.mem8[VIDEO_RAM_BASE], BLANK_TILE, "first cell blanked");
  assert.equal(o.mem8[LAST_FILLED], BLANK_TILE, "last filled cell (0x87fe) blanked");
  assert.equal(o.mem8[NEVER_FILLED], 0x55, "0x87ff left untouched (bc=0x03ff quirk)");
  console.log("  WRITE-SET: sub-state 9, strip blanked, 0x87ff untouched");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted filled cell is CAUGHT by the RAM diff", () => {
  const o = CASES["start pressed -> wipe"]();
  const c = CASES["start pressed -> wipe"]();
  oracle(o);
  advanceAttractOnStartPress(c);
  c.mem8[VIDEO_RAM_BASE] = (o.mem8[VIDEO_RAM_BASE] ^ 0xff) & 0xff;
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted cell");
  assert.equal(d.addr, VIDEO_RAM_BASE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that also fills 0x87ff diverges from the oracle", () => {
  const o = CASES["start pressed -> wipe"]();
  const c = CASES["start pressed -> wipe"]();
  oracle(o);
  advanceAttractOnStartPress(c);
  c.mem8[NEVER_FILLED] = BLANK_TILE; // over-fill: the oracle left this cell alone
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "an over-fill of 0x87ff must be caught");
  assert.equal(d.addr, NEVER_FILLED, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(quirk): over-fill caught at ${hx(d.addr)}`);
});
