// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stampTwoPlaneColumnStrip (ROM 0x0cf8, Pooyan) — a two-plane column-strip blit. It
 * walks a ROM source table of 12-byte columns, writing each column bottom-up (row stride 0x20) into
 * the tile-code plane at 0x86a7; a 0xff steering byte switches to the attribute table + attribute
 * plane at 0x82a7, a 0xee byte ends the stamp, any other byte starts the next column one cell right.
 *
 * SEATING: BALANCED — the oracle's only exit is a plain `ret z` on the 0xee marker, so the module is
 * WIRED as a void routine. LIVE-OUT: none — the caller (fetchWordFromTableIndex) overwrites DE and reads no
 * register back, so equivalence is RAM (dumpState) minus stack scratch below the entry SP; the register file is not
 * compared. A plain boot clone reaches it: the source tables live in ROM and terminate themselves.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack) after the full stamp.
 *   2. WRITE-SET — the module changed RAM, and the first cell of each plane holds its source byte
 *      (proves both the tile-plane and the attribute-plane copies ran; guards a vacuous EQUAL).
 *   3. TEETH — a single wrong dest byte is caught by the RAM diff, and a wrong-stride twin (dest
 *      stepping +0x20 instead of up a row) diverges from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0cf8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0cf8 as oracle } from "../../translated/loc_0cf8.js";
import { stampTwoPlaneColumnStrip } from "../stampTwoPlaneColumnStrip.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_SRC = 0x0d2f; // COLUMN_BLIT_TILE_SRC — tile-code source table (ROM)
const ATTR_SRC = 0x0d48; // COLUMN_BLIT_ATTR_SRC — attribute source table (ROM)
const TILE_DEST = 0x86a7; // COLUMN_BLIT_TILE_DEST — tile-code plane
const ATTR_DEST = 0x82a7; // COLUMN_BLIT_ATTR_DEST — attribute plane
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  return m;
}

/** The module's algorithm with the row stride flipped the wrong way (dest steps +0x20). */
function wrongStrideBlit(m) {
  const { mem8 } = m;
  let src = TILE_SRC;
  let colTop = TILE_DEST;
  for (;;) {
    let dest = colTop;
    for (let n = 0x0c; n > 0; n--) {
      mem8[dest] = mem8[src];
      src = (src + 1) & 0xffff;
      dest = (dest + 0x20) & 0xffff; // BUG: down a row, not up
    }
    const marker = mem8[src];
    if (marker === 0xff) { src = ATTR_SRC; colTop = ATTR_DEST; continue; }
    if (marker === 0xee) return;
    colTop = (colTop + 1) & 0xffff;
  }
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: module == oracle in RAM (−stack) after the full stamp", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  stampTwoPlaneColumnStrip(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: RAM identical");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the blit ran — RAM changed and each plane's first cell holds its source byte", () => {
  const c = craft();
  stampTwoPlaneColumnStrip(c);
  const changed = ramDiffMinusStack(BASE.clone(), c);
  assert.notEqual(changed, null, "module wrote nothing — EQUAL would be vacuous");
  assert.equal(c.mem8[TILE_DEST], c.mem8[TILE_SRC], "tile-plane first cell = tile source byte");
  assert.equal(c.mem8[ATTR_DEST], c.mem8[ATTR_SRC], "attribute-plane first cell = attribute source byte");
  console.log("  WRITE-SET: both planes stamped");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a single wrong dest byte is caught by the RAM diff", () => {
  const o = craft();
  oracle(o);
  const twin = craft();
  stampTwoPlaneColumnStrip(twin);
  twin.mem8[TILE_DEST] = (twin.mem8[TILE_DEST] + 1) & 0xff; // one byte off
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a one-byte error — worthless");
  assert.equal(d.addr, TILE_DEST, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(TILE_DEST)})`);
  console.log(`  TEETH one-byte: caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong-stride twin (dest steps +0x20) diverges from the oracle", () => {
  const o = craft();
  oracle(o);
  const twin = craft();
  wrongStrideBlit(twin);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a wrong-stride blit — worthless");
  console.log(`  TEETH wrong-stride: caught at ${hx(d.addr)}`);
});
