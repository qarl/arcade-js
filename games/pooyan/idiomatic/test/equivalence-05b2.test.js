// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for drawStackedCharField (ROM 0x05b2, Pooyan) — "draw a table-selected field of
 * stacked characters bottom-up into video RAM". The selector A's low seven bits (doubled, masked
 * to 7 bits) index a ROM pointer table (0x7a0d) whose entry heads a list of records; each record is
 * a 2-byte destination address followed by an inline string, drawn one tilemap row up per character
 * (dest -= 0x20). Bit 7 of A picks the mode: clear writes each character as a digit tile (char-'0'),
 * set writes the blank tile 0x10 for every character. '.' ends a record; '?' ends the whole run.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so each case runs on a FRESH clone
 * per side. The single input is A (the selector), bridged as a param. No register survives — callers
 * save/restore or reload their registers around this — so the contract is RAM (dumpState, minus
 * stack scratch below the entry SP) alone. pc/SP/registers are NOT compared.
 *
 * The routine reads only ROM (the pointer table and strings), so the selectors below are the ones the
 * game actually issues (paintAttractHudAndHighScores uses 0x1a..0x24, drawCreditCountAndTamperCheck uses 0x05); they terminate on a real '?'.
 * 0x85 reuses the same list as 0x05 but in blank mode, proving the mode bit changes the WRITTEN VALUES
 * without changing the WRITTEN CELLS.
 *
 * Jobs:
 *   1. EQUAL — over the game's real selectors (both modes), oracle == module in RAM.
 *   2. WRITE-SET — digit selector 0x05 and blank selector 0x85 touch the SAME cell set; blank writes
 *      are all 0x10; every write lands in the video-RAM tilemap page.
 *   3. CRAFTED — the blank-mode selector (bit 7 set) is a craft-only arm (the game paths captured use
 *      digit mode); it is exercised in EQUAL/WRITE-SET above.
 *   4. TEETH — a twin that corrupts a drawn tile MUST be caught; a twin that ignores the mode bit
 *      (renders 0x05 in blank mode) MUST be caught by the differing tile values.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-05b2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_05b2 as oracle } from "../../translated/loc_05b2.js";
import { drawStackedCharField } from "../drawStackedCharField.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const FIELD_TABLE = 0x7a0d; // the ROM pointer table (literal here; named in the module)
const BLANK_TILE = 0x10;
const TILEMAP_LO = 0x8400;
const TILEMAP_HI = 0x8800;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A machine with the tilemap pre-dirtied to 0xAA (so any drawn tile is observable) and A seated. */
function craft(selector) {
  const m = new Machine(ROM);
  for (let a = 0x8000; a < 0x8fc0; a++) m.mem.write8(a, 0xaa); // routine reads only ROM, so RAM seed is inert
  m.regs.a = selector & 0xff;
  m.regs.sp = 0x8fe0; // dead stack: the oracle's push/pop af live here
  return m;
}

/** The oracle's {addr -> value} write footprint for one selector. */
function footprint(selector) {
  const before = craft(selector);
  const after = craft(selector);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    if (b0[off] !== a1[off]) changed.set(addr, a1[off]);
  }
  return changed;
}

const DIGIT_SELECTORS = [0x05, 0x1a, 0x1f, 0x24];
const BLANK_SELECTOR = 0x85; // same list as 0x05, mode bit set

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: real game selectors (digit + blank modes) — module == oracle in RAM (−stack)", () => {
  for (const sel of [...DIGIT_SELECTORS, BLANK_SELECTOR]) {
    const o = craft(sel);
    const c = craft(sel);
    oracle(o);
    drawStackedCharField(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `sel=${hx(sel)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${DIGIT_SELECTORS.length + 1} selectors identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: digit (0x05) and blank (0x85) touch the same tilemap cells; blank writes 0x10", () => {
  const digit = footprint(0x05);
  const blank = footprint(BLANK_SELECTOR);

  assert.ok(digit.size > 0, "digit render must write something");
  assert.equal(digit.size, blank.size, `same list -> same cell count (digit ${digit.size} vs blank ${blank.size})`);
  for (const addr of digit.keys()) {
    assert.ok(blank.has(addr), `blank mode must write the same cell ${hx(addr)}`);
    assert.ok(addr >= TILEMAP_LO && addr < TILEMAP_HI, `write must land in the tilemap page: ${hx(addr)}`);
  }
  for (const [addr, val] of blank) {
    assert.equal(val, BLANK_TILE, `blank-mode cell ${hx(addr)} must be 0x10, got ${hx(val)}`);
  }
  console.log(`  WRITE-SET: ${digit.size} cells; blank mode writes 0x10 to each`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted drawn tile is CAUGHT in the tilemap", () => {
  const o = craft(0x05);
  const c = craft(0x05);
  const b0 = c.dumpState();
  oracle(o);
  drawStackedCharField(c);
  // Corrupt the first cell the module actually drew.
  const a1 = c.dumpState();
  let target = null;
  for (let off = 0; off < b0.length; off++) {
    const addr = c.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    if (b0[off] !== a1[off]) { target = addr; break; }
  }
  assert.notEqual(target, null, "sanity: the module drew at least one tile");
  c.mem.write8(target, (c.mem.read8(target) ^ 0x01) & 0xff); // BUG: flip a drawn tile bit
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted tile — it is worthless");
  assert.equal(d.addr, target, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(target)})`);
  console.log(`  TEETH(tile): corrupted tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: renders digit selector 0x05 but forces blank mode (ignores the mode bit). */
function brokenWrongMode(m, selector = m.regs.a) {
  const u8 = (x) => x & 0xff;
  const u16 = (x) => x & 0xffff;
  const { mem8 } = m;
  const index = (selector << 1) & 0x7f;
  const head = u16(FIELD_TABLE + index);
  let list = mem8[head] | (mem8[u16(head + 1)] << 8);
  for (;;) {
    let src = u16(list + 2);
    let cell = mem8[list] | (mem8[u16(list + 1)] << 8);
    for (;;) {
      const ch = mem8[src];
      if (ch === 0x2e) break;
      if (ch === 0x3f) return;
      mem8[cell] = 0x10; // BUG: always blank, even though selector 0x05 has bit 7 clear (digit mode)
      src = u16(src + 1);
      cell = u16(cell + 0xffe0);
    }
    list = u16(src + 1);
  }
}

test("TEETH: ignoring the mode bit (digit rendered as blank) is CAUGHT", () => {
  const o = craft(0x05); // digit mode -> digit tiles
  const c = craft(0x05);
  oracle(o);
  brokenWrongMode(c); // writes 0x10 everywhere instead
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong render mode — it is worthless");
  console.log(`  TEETH(mode): digit-as-blank caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});
