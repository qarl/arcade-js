// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for rebuildSpriteDisplayList (Pooyan) — "rebuild the sprite display list": copy four
 * object-record groups into the list, drop the arrow group's two sprite-Y bytes one pixel, then via
 * the shared tail tick the second byte and (when the screen is flipped) mirror the whole list.
 *
 * Cycle-free memory-equivalence gate. The routine WRITES video RAM and calls the copy/coordinate
 * builders plus the shared flip tail, so each case runs on a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP/registers are deliberately NOT compared: there is no register live-out (every caller rets
 * straight after). The routine seeds all its own inputs, so a case is a seeded record region plus the
 * orientation flag, poked identically on both sides; the nested calls push/pop in the dead stack.
 *
 * Jobs:
 *   1. EQUAL — normal orientation (no mirror) and flipped orientation (mirror): module == oracle.
 *   2. WRITE-SET — every net write lands inside the sprite display list window; nothing else changes.
 *   3. CRAFTED — the flipped path runs the mirror, provably differing from the un-mirrored build.
 *   4. TEETH — a corrupted copied byte, and an undone sprite-Y tick, are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-02ef.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_02ef as oracle } from "../../translated/loc_02ef.js";
import { rebuildSpriteDisplayList } from "../rebuildSpriteDisplayList.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_DISPLAY_LIST, FLIP_SCREEN_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LIST_BYTES = 0x60; // 96 bytes: the four record groups copied into the list
const LIST_END = SPRITE_DISPLAY_LIST + LIST_BYTES;
const SRC_LO = 0x8a80; // first source record bank
const SRC_HI = 0x8cc0; // one past the last source record
const Y_A = SPRITE_DISPLAY_LIST + 0x58; // the first ticked sprite-Y byte
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the source record banks seeded distinctively and the flip flag seated. */
function craft(flip) {
  const m = BASE.clone();
  for (let a = SRC_LO; a < SRC_HI; a++) m.mem.write8(a, (a * 7 + 0x11) & 0xff);
  m.mem.write8(FLIP_SCREEN_FLAG, flip & 0xff);
  m.regs.sp = 0x8fe0; // dead stack: the nested builder/mirror calls push/pop here
  return m;
}

const CASES = [
  { name: "normal orientation (no mirror)", flip: 0x01 },
  { name: "flipped orientation (mirror)", flip: 0x00 },
  { name: "any non-zero flag is normal", flip: 0x7f },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: rebuild + tick + (gated) mirror — rebuildSpriteDisplayList == oracle in RAM (−stack)", () => {
  for (const { name, flip } of CASES) {
    const o = craft(flip);
    const c = craft(flip);
    oracle(o);
    rebuildSpriteDisplayList(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: every net write lands inside the sprite display list", () => {
  for (const flip of [0x01, 0x00]) {
    const before = craft(flip);
    const after = craft(flip);
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    let changed = 0;
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] !== a1[off]) {
        const addr = after.stateOffsetToAddr(off);
        if (inDeadStack(addr)) continue; // nested builder/mirror call push/pop scratch, not game state
        assert.ok(addr >= SPRITE_DISPLAY_LIST && addr < LIST_END, `write outside the list at ${hx(addr)} (flip=${hx(flip)})`);
        changed++;
      }
    }
    assert.ok(changed > 0, `expected writes inside the list (flip=${hx(flip)})`);
  }
  console.log(`  WRITE-SET: all writes within [${hx(SPRITE_DISPLAY_LIST)}, ${hx(LIST_END)})`);
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: the flipped path runs the mirror, differing from the un-mirrored build", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  rebuildSpriteDisplayList(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  // sanity: the mirror actually ran — the flipped list differs from the un-mirrored (normal) build.
  const normal = craft(0x01);
  oracle(normal);
  let differs = false;
  for (let a = SPRITE_DISPLAY_LIST; a < LIST_END; a++) {
    if (c.mem.read8(a) !== normal.mem.read8(a)) { differs = true; break; }
  }
  assert.ok(differs, "sanity: the flipped build should differ from the un-mirrored build");
  console.log("  CRAFTED: flipped path mirror identical to the reference, and provably mirrored");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted copied list byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  rebuildSpriteDisplayList(c);
  const cell = SPRITE_DISPLAY_LIST + 0x10; // an interior list cell a copy wrote
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt one built byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted list byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(byte): corrupted list byte caught at ${hx(d.addr)}`);
});

test("TEETH: an undone sprite-Y tick is CAUGHT at the ticked cell", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  rebuildSpriteDisplayList(c);
  c.mem.write8(Y_A, (c.mem.read8(Y_A) + 1) & 0xff); // BUG: undo the one-pixel drop
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an undone sprite-Y tick — it is worthless");
  assert.equal(d.addr, Y_A, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(Y_A)})`);
  console.log(`  TEETH(tick): undone Y tick caught at ${hx(d.addr)}`);
});
