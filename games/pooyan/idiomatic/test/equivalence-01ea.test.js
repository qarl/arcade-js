// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearSpriteBanksAndBlankVideoRam (ROM 0x01ea, Pooyan) — "boot clear": fill 0x30 bytes at
 * the top of each sprite bank (0x9410, 0x9010) with the incoming byte A, then blank the video
 * tile region 0x8440..0x87ff to the erase tile 0x1e. The original then spins a cycle-burning
 * settle delay that only kicks the hardware watchdog at 0xa000 (outside the dumped RAM), so the
 * cycle-free rewrite drops it; the two sides are compared on dumped RAM, which the delay never
 * touches.
 *
 * Cycle-free gate: a fresh clone per side, compared on RAM (dumpState) minus stack scratch below the entry SP. A is
 * the sole input (the sprite-bank fill value); there is no register live-out (a boot init whose
 * caller reloads every register), so only RAM is compared. Every case is CRAFTED: A is poked
 * identically on both sides.
 *
 * Jobs:
 *   1. EQUAL — over a sweep of fill bytes, oracle == module in RAM (−stack).
 *   2. WRITE-SET — the only writes are the two 0x30-byte sprite regions (:= A) and the 0x3c0-byte
 *      video region (:= 0x1e); enumerated exactly on a pre-dirtied clone.
 *   3. CRAFTED (overwrite) — pre-dirty the footprint on both sides; both overwrite identically.
 *   4. TEETH — a wrong video byte and a wrong sprite byte are each CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-01ea.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01ea as oracle } from "../../translated/loc_01ea.js";
import { clearSpriteBanksAndBlankVideoRam } from "../clearSpriteBanksAndBlankVideoRam.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SPRITE1_CLEAR_BASE = 0x9410;
const SPRITE0_CLEAR_BASE = 0x9010;
const BANK_CLEAR_LEN = 0x30;
const VIDEO_RAM_BLANK_START = 0x8440;
const BLANK_LEN = 0x3c0;
const BLANK_TILE = 0x1e;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the fill byte seated in A and a work-RAM stack. */
function craft(fill) {
  const m = BASE.clone();
  m.regs.a = fill & 0xff;
  m.regs.sp = 0x8ffe; // the oracle's call/ret trampolines land inside STACK_SCRATCH
  return m;
}

/** The routine's write footprint: two sprite regions + the video region. */
function footprintCells() {
  const cells = new Set();
  for (let i = 0; i < BANK_CLEAR_LEN; i++) { cells.add(SPRITE1_CLEAR_BASE + i); cells.add(SPRITE0_CLEAR_BASE + i); }
  for (let i = 0; i < BLANK_LEN; i++) cells.add(VIDEO_RAM_BLANK_START + i);
  return cells;
}

/** Pre-dirty every footprint cell to a sentinel so all writes are observable. */
function dirtyFootprint(m, sentinel) {
  for (let i = 0; i < BANK_CLEAR_LEN; i++) { m.mem.write8(SPRITE1_CLEAR_BASE + i, sentinel); m.mem.write8(SPRITE0_CLEAR_BASE + i, sentinel); }
  for (let i = 0; i < BLANK_LEN; i++) m.mem.write8(VIDEO_RAM_BLANK_START + i, sentinel);
}

const FILLS = [0x00, 0x1e, 0x55, 0xa5, 0xff];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted fill bytes — clearSpriteBanksAndBlankVideoRam == oracle in RAM (−stack)", () => {
  for (const fill of FILLS) {
    const o = craft(fill);
    const c = craft(fill);
    oracle(o);
    clearSpriteBanksAndBlankVideoRam(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `fill=${hx(fill)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${FILLS.length} crafted fills identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: writes are the two sprite regions (:= A) and the video region (:= 0x1e)", () => {
  const fill = 0x55;
  const footprint = footprintCells();
  const m = craft(fill);
  dirtyFootprint(m, 0xaa); // sentinel differs from both 0x55 and 0x1e, so every write shows
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // exclude the oracle's own push/pop scratch (matches EQUAL's ramDiffMinusStack)
    changed.push(addr);
  }
  assert.equal(changed.length, footprint.size, `expected ${footprint.size} writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(footprint.has(addr), `unexpected write at ${hx(addr)}`);
  for (let i = 0; i < BANK_CLEAR_LEN; i++) {
    assert.equal(m.mem.read8(SPRITE1_CLEAR_BASE + i), fill, `sprite1 cell ${hx(SPRITE1_CLEAR_BASE + i)}`);
    assert.equal(m.mem.read8(SPRITE0_CLEAR_BASE + i), fill, `sprite0 cell ${hx(SPRITE0_CLEAR_BASE + i)}`);
  }
  for (let i = 0; i < BLANK_LEN; i++) {
    assert.equal(m.mem.read8(VIDEO_RAM_BLANK_START + i), BLANK_TILE, `video cell ${hx(VIDEO_RAM_BLANK_START + i)}`);
  }
  console.log(`  WRITE-SET: ${footprint.size} cells (0x60 sprite := A, 0x3c0 video := 0x1e)`);
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: a pre-dirtied footprint is overwritten identically on both sides", () => {
  const fill = 0xa5;
  const o = craft(fill);
  const c = craft(fill);
  dirtyFootprint(o, 0x3c);
  dirtyFootprint(c, 0x3c);
  oracle(o);
  clearSpriteBanksAndBlankVideoRam(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log(`  CRAFTED: footprint pre-dirtied to 0x3c -> both overwrite identically`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong video byte is CAUGHT by the RAM diff", () => {
  const fill = 0x55;
  const badCell = VIDEO_RAM_BLANK_START + 0x100;
  const o = craft(fill);
  const c = craft(fill);
  oracle(o);
  clearSpriteBanksAndBlankVideoRam(c);
  c.mem.write8(badCell, 0x00); // BUG: this cell must be 0x1e
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong video byte — it is worthless");
  assert.equal(d.addr, badCell, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(video): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong sprite-bank byte is CAUGHT by the RAM diff", () => {
  const fill = 0x55;
  const badCell = SPRITE1_CLEAR_BASE + 0x08;
  const o = craft(fill);
  const c = craft(fill);
  oracle(o);
  clearSpriteBanksAndBlankVideoRam(c);
  c.mem.write8(badCell, (fill ^ 0xff) & 0xff); // BUG: this cell must hold the fill byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sprite byte — it is worthless");
  assert.equal(d.addr, badCell, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(sprite): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
