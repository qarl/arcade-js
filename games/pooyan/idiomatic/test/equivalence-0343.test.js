// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for buildDisplayEntriesFromMovingObjects (ROM 0x0343, Pooyan) — "build sprite display-list entries
 * from moving-object records, with coordinate math": list pointer in HL, record base in IX, record
 * stride in DE, count in B. Per record it emits four bytes into successive list slots — a coordinate
 * from the (rec+5:rec+6) sub-pixel pair ((pair>>5)-8), the raw (rec+0x10) byte, a coordinate from
 * the (rec+3:rec+4) pair, and the raw (rec+0x0f) byte — then steps IX by DE. The list's LOW byte
 * advances alone (Z80 `inc l`), so writes wrap within its 256-byte page.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so each case runs on a FRESH clone
 * per side. The go-forward contract is RAM (dumpState, minus stack scratch below the entry SP) AND the HL live-out.
 * rebuildSpriteDisplayList chains its next display-list copy (loc_032a) from the advanced HL without reloading it,
 * so HL is LOAD-BEARING: the module's return is compared against the oracle clone's final HL, and
 * the module must also SET HL on its own clone. IX/B/A/DE are plumbing (the caller resets IX/B per
 * call), not part of the contract. pc/SP are NOT compared.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — replay any real 0x0343 dispatch a boot reaches: RAM + HL identical.
 *   2. CRAFTED — varied records/stride/count incl. a PAGE-WRAP (low byte crosses 0xff): identical
 *      RAM, identical advanced HL, high byte unchanged.
 *   3. WRITE-SET — with distinctive non-0xAA record bytes over a pre-dirtied list, the oracle writes
 *      EXACTLY the 4*count expected cells. Documents the footprint.
 *   4. TEETH — a twin that corrupts a copied byte MUST be caught in the list; a twin that advances
 *      the FULL 16-bit list pointer (crossing the page) MUST be caught by the HL return.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0343.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0343 as oracle } from "../../translated/loc_0343.js";
import { buildDisplayEntriesFromMovingObjects } from "../buildDisplayEntriesFromMovingObjects.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPRITE_DISPLAY_LIST, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x0343;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/**
 * The four list bytes the routine derives from the record at `recBase`, read from the crafted
 * machine `m`. Reads REAL memory so overlapping records (a stride smaller than the 0x11-byte
 * record span lets record N+1's setup clobber record N's +0x0f/+0x10) are reflected exactly as
 * the oracle sees them: coord(rec+5:rec+6), raw(rec+0x10), coord(rec+3:rec+4), raw(rec+0x0f),
 * where coord(hi,lo) = ((hi<<3)|(lo>>5)) - 8 — the oracle's sub-pixel-to-screen math.
 */
function expectedBytes(m, recBase) {
  const scr = (hi, lo) => (((hi << 3) | (lo >> 5)) - 0x08) & 0xff;
  const rd = (off) => m.mem.read8((recBase + off) & 0xffff);
  return [scr(rd(0x06), rd(0x05)), rd(0x10), scr(rd(0x04), rd(0x03)), rd(0x0f)];
}

/**
 * A machine with `count` object records (distinctive non-0xAA bytes at +0x03..+0x06/+0x0f/+0x10),
 * the list page pre-dirtied to 0xAA, and HL/IX/DE/B seated.
 */
function craft({ list, rec, stride, count }) {
  const m = new Machine(ROM);
  for (let i = 0; i < count; i++) {
    const base = (rec + i * stride) & 0xffff;
    m.mem.write8((base + 0x03) & 0xffff, i & 0xff); // (rec+3) low of the 2nd sub-pixel pair
    m.mem.write8((base + 0x04) & 0xffff, i & 0xff); // (rec+4) high of the 2nd pair
    m.mem.write8((base + 0x05) & 0xffff, i & 0xff); // (rec+5) low of the 1st pair
    m.mem.write8((base + 0x06) & 0xffff, i & 0xff); // (rec+6) high of the 1st pair
    m.mem.write8((base + 0x0f) & 0xffff, (0x11 + i) & 0xff); // raw byte
    m.mem.write8((base + 0x10) & 0xffff, (0x22 + i) & 0xff); // raw byte
  }
  for (let i = 0; i < 0x100; i++) m.mem.write8(((list & 0xff00) + i) & 0xffff, 0xaa);
  m.regs.hl = list & 0xffff;
  m.regs.ix = rec & 0xffff;
  m.regs.de = stride & 0xffff;
  m.regs.b = count & 0xff;
  m.regs.sp = 0x8fe0; // dead stack for the oracle's ret
  return m;
}

const CASES = [
  { list: SPRITE_DISPLAY_LIST, rec: ENEMY_ACTOR_TABLE, stride: 0x18, count: 0x12 }, // the real rebuildSpriteDisplayList shape
  { list: SPRITE_DISPLAY_LIST, rec: 0x8a80, stride: 0x18, count: 0x01 },
  { list: 0x8850, rec: 0x8a80, stride: 0x0c, count: 0x05 },
  { list: 0x88fe, rec: 0x8a80, stride: 0x18, count: 0x03 }, // PAGE-WRAP: low byte crosses 0xff
];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  try {
    const host = new Machine(ROM, { overrides: snap });
    host.runFrames(maxFrames);
  } catch {
    /* keep whatever we captured if a boot path unwinds */
  }
  return caps;
}

test("CAPTURE: real 0x0343 dispatches — module == oracle in RAM (−stack) and HL", () => {
  const caps = ROM_PRESENT ? captureDispatches(24, 4000) : [];
  for (const cap of caps) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = buildDisplayEntriesFromMovingObjects(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.hl, `HL live-out: module ${hx(ret)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.hl, o.regs.hl, `module must SET HL for the translated chain: ${hx(c.regs.hl)} != ${hx(o.regs.hl)}`);
  }
  console.log(`  CAPTURE: ${caps.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: varied records/stride/count — RAM identical, advanced HL identical, page-wrap correct", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    const ret = buildDisplayEntriesFromMovingObjects(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${JSON.stringify(cs)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.hl, `${JSON.stringify(cs)}: HL module ${hx(ret)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.hl, o.regs.hl, `${JSON.stringify(cs)}: module must SET HL ${hx(c.regs.hl)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(ret & 0xff00, cs.list & 0xff00, `${JSON.stringify(cs)}: HL high byte must be unchanged (inc l only)`);
  }
  console.log(`  CRAFTED: ${CASES.length} cases stamped identically (incl. page-wrap)`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes exactly the 4*count derived list cells", () => {
  const cs = CASES[2]; // list 0x8850, count 5 -> 20 writes, no wrap
  const before = craft(cs);
  const after = craft(cs);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // stack scratch is not part of the write footprint
    changed.set(addr, a1[off]);
  }
  const page = cs.list & 0xff00;
  let lo = cs.list & 0xff;
  let expectedCount = 0;
  for (let i = 0; i < cs.count; i++) {
    const recBase = (cs.rec + i * cs.stride) & 0xffff;
    for (const val of expectedBytes(before, recBase)) {
      const addr = page + ((lo++) & 0xff);
      assert.ok(changed.has(addr), `expected a write at ${hx(addr)} (record ${i})`);
      assert.equal(changed.get(addr), val, `cell ${hx(addr)} expected ${hx(val)} got ${hx(changed.get(addr))}`);
      expectedCount++;
    }
  }
  assert.equal(changed.size, expectedCount, `expected exactly ${expectedCount} writes, got ${changed.size}`);
  console.log(`  WRITE-SET: ${expectedCount} cells := derived coords/raw bytes`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong copied byte is CAUGHT in the list", () => {
  const cs = CASES[0];
  const o = craft(cs);
  const c = craft(cs);
  oracle(o);
  buildDisplayEntriesFromMovingObjects(c);
  const firstCell = cs.list & 0xffff; // a real written cell (record 0's first coordinate)
  c.mem.write8(firstCell, (c.mem.read8(firstCell) ^ 0x01) & 0xff); // BUG: corrupt a copied byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte — it is worthless");
  console.log(`  TEETH(byte): wrong copied byte caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a full-16-bit list advance (crossing the page) is CAUGHT by the HL return", () => {
  const cs = CASES[3]; // list 0x88fe, count 3 -> low byte wraps
  const o = craft(cs);
  oracle(o);
  const wrongRet = (cs.list + 4 * cs.count) & 0xffff; // naive full-16-bit advance crosses the page
  assert.notEqual(wrongRet, o.regs.hl, "a full-16-bit advance must differ from the oracle's page-wrapped HL");
  assert.equal(o.regs.hl & 0xff00, cs.list & 0xff00, "oracle HL stays in the list's page");
  console.log(`  TEETH(HL): full-16 advance ${hx(wrongRet)} != oracle page-wrapped ${hx(o.regs.hl)}`);
});
