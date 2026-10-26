// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loc_0929 (Pooyan) — guarded screen/attribute setup.
 *
 * Carry-clear: fill one tile row and bail via `ret nz` if the fill-row counter is not about to
 * drain (FILL_ROW_COUNTER != 1); otherwise re-arm the fill, bump ATTRACT_SUBSTATE, zero the board
 * arena, pass the protection stall (the stall cell already reads its ready value on a genuine ROM),
 * pass the seven-entry signature check, flood the attribute map, and enqueue three display commands.
 * Carry-set: an overlapping-decode arm that only bumps the byte at the incoming pointer, then joins
 * the common tail.
 *
 * Inputs bridged from registers: the entry carry flag (branch selector) and HL (the arm pointer).
 * The tile-fill cursor and row counter are RAM pokes. Compared on RAM (dumpState) minus
 * stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the oracle's call/ret pushes fall out of the diff.
 *
 * Jobs: 1. EQUAL across the full / early-return / carry-arm branches; 2. WRITE-SET (attract bump +
 * attribute flood on the full path; pointer bump on the arm path; neither on the early return);
 * 3. TEETH (a corrupted written cell is caught; the branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0929.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0929 as oracle } from "../../translated/loc_0929.js";
import { loc_0929 } from "../loc_0929.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ATTRACT_SUBSTATE,
  FILL_ROW_COUNTER,
  TILE_FILL_PTR,
  ATTRIB_MAP_BASE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; //  inside STACK_SCRATCH
const VRAM = 0x8402; // a writable tile-code cell to seat the fill cursor at
const ARM_PTR = 0x8e60; // a work-RAM cell outside the zeroed arena, so the arm bump is observable

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the branch selectors; pre-dirty the observed cells so a bump/store is visible. */
function seat({ carry = false, ptr = ARM_PTR, rowCounter = 0x01, cursor = VRAM } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.fC = carry;
  m.regs.hl = ptr;
  m.mem.write8(FILL_ROW_COUNTER, rowCounter);
  m.mem.write16(TILE_FILL_PTR, cursor);
  m.mem.write8(ATTRACT_SUBSTATE, 0x40); // pre-dirty so the full-path bump is visible
  m.mem.write8(ARM_PTR, 0x40); // pre-dirty so the carry-arm bump is visible
  return m;
}

const CASES = [
  { name: "full path (carry=0, counter drains)", cfg: { carry: false, rowCounter: 0x01 } },
  { name: "early return (carry=0, counter not draining)", cfg: { carry: false, rowCounter: 0x05 } },
  { name: "carry-arm (carry=1)", cfg: { carry: true } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: loc_0929 == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = seat(cfg);
    const c = seat(cfg);
    oracle(o);
    loc_0929(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} branches identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: full path bumps attract + floods attributes; early leaves attract; arm bumps pointer", () => {
  // full path: ATTRACT_SUBSTATE bumped, attribute map written
  const full = seat({ carry: false, rowCounter: 0x01 });
  loc_0929(full);
  assert.equal(full.mem.read8(ATTRACT_SUBSTATE), 0x41, "full path bumps the attract sub-state");
  assert.notEqual(full.mem.read8(ATTRIB_MAP_BASE), BASE.mem.read8(ATTRIB_MAP_BASE), "attribute map flooded");

  // early return: ATTRACT_SUBSTATE untouched (bailed before the bump)
  const early = seat({ carry: false, rowCounter: 0x05 });
  loc_0929(early);
  assert.equal(early.mem.read8(ATTRACT_SUBSTATE), 0x40, "early return leaves the attract sub-state");

  // carry-arm: the incoming pointer cell bumped, attract sub-state untouched
  const arm = seat({ carry: true });
  loc_0929(arm);
  assert.equal(arm.mem.read8(ARM_PTR), 0x41, "carry-arm bumps the incoming pointer cell");
  assert.equal(arm.mem.read8(ATTRACT_SUBSTATE), 0x40, "carry-arm does not bump the attract sub-state");
  console.log("  WRITE-SET: full=attract++ & attribs; early=none; arm=ptr++");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted written cell is CAUGHT; branches are load-bearing", () => {
  const o = seat({ carry: false, rowCounter: 0x01 });
  const c = seat({ carry: false, rowCounter: 0x01 });
  oracle(o);
  loc_0929(c);
  c.mem.write8(ATTRACT_SUBSTATE, (o.mem.read8(ATTRACT_SUBSTATE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted attract cell");
  assert.equal(d.addr, ATTRACT_SUBSTATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);

  // full vs early, and full vs arm, must differ or the branch guards are dead
  const full = seat({ carry: false, rowCounter: 0x01 });
  const early = seat({ carry: false, rowCounter: 0x05 });
  const arm = seat({ carry: true });
  oracle(full);
  oracle(early);
  oracle(arm);
  assert.notEqual(ramDiffMinusStack(full, early), null, "full and early-return branches must differ");
  assert.notEqual(ramDiffMinusStack(full, arm), null, "full and carry-arm branches must differ");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}; branch guards load-bearing`);
});
