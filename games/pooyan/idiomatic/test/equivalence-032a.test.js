// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for copyObjectRecordsToDisplayList (ROM 0x032a) — "copy four raw
 * bytes of each object record into the display list": list pointer in HL, record base in IX,
 * record stride in DE, object count in B. Per record it emits +0x06, +0x10, +0x04, +0x0f into
 * four successive list slots (the list's LOW byte advances alone, wrapping within its page),
 * then steps IX by DE.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so each case runs on a FRESH
 * clone per side. The go-forward contract is:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP), AND the HL live-out.
 *
 * The caller (rebuildSpriteDisplayList) chains its next copy from the advanced HL without reloading it, so the
 * module's return (the advanced list pointer) is compared against the oracle clone's final HL.
 * IX/B/A/DE are left as plumbing (the caller resets IX+B per call, DE is unchanged), so they are
 * not part of the contract.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x032a in a real run; any dispatch must agree in RAM + HL.
 *   2. CRAFTED — pre-dirty the list to 0xAA, seed varied records/stride/count; both land the same
 *      bytes and the same advanced HL. Includes a PAGE-WRAP case (low byte near 0xff) that a naive
 *      full-16-bit list increment would get wrong.
 *   3. TEETH — a twin that writes a WRONG record byte MUST be caught in the list; a twin that
 *      advances the FULL 16-bit list pointer (crossing the page) MUST be caught by the HL return.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-032a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_032a as oracle } from "../../translated/loc_032a.js";
import { copyObjectRecordsToDisplayList } from "../copyObjectRecordsToDisplayList.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE, SPRITE_DISPLAY_LIST } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x032a;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), dead);
}

/**
 * Build a machine with a distinctive object arena (varied bytes at each record's +0x04/+0x06/
 * +0x0f/+0x10) and the display list region pre-dirtied to 0xAA, with HL/IX/DE/B seeded.
 */
function craft({ list, rec, stride, count }) {
  const m = new Machine(ROM);
  // Distinctive record bytes so the copy is observable: byte = (recordIndex<<4) | (offset&0x0f).
  for (let i = 0; i < count; i++) {
    const base = (rec + i * stride) & 0xffff;
    for (const off of [0x04, 0x06, 0x0f, 0x10]) {
      m.mem.write8((base + off) & 0xffff, ((i << 4) | (off & 0x0f)) & 0xff);
    }
  }
  // Pre-dirty a generous span of the list page so surgical writes are provable.
  for (let i = 0; i < 0x100; i++) m.mem.write8(((list & 0xff00) + i) & 0xffff, 0xaa);
  m.regs.hl = list & 0xffff;
  m.regs.ix = rec & 0xffff;
  m.regs.de = stride & 0xffff;
  m.regs.b = count & 0xff;
  return m;
}

const CASES = [
  { list: SPRITE_DISPLAY_LIST, rec: ACTOR_TABLE, stride: 0x18, count: 0x02 }, // the real rebuildSpriteDisplayList shape
  { list: SPRITE_DISPLAY_LIST, rec: 0x8ae0, stride: 0x18, count: 0x01 },
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
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(32, 4000) : [];

test("CAPTURE: real 0x032a dispatches — module == oracle in RAM (−stack) and HL", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    const ret = copyObjectRecordsToDisplayList(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.hl, `HL live-out: module ${hx(ret)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.hl, o.regs.hl, `module must SET HL for the translated chain: ${hx(c.regs.hl)} != ${hx(o.regs.hl)}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: varied records/stride/count — RAM identical, advanced HL identical, page-wrap correct", () => {
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    const ret = copyObjectRecordsToDisplayList(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${JSON.stringify(cs)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, o.regs.hl, `${JSON.stringify(cs)}: HL module ${hx(ret)} != oracle ${hx(o.regs.hl)}`);
    assert.equal(c.regs.hl, o.regs.hl, `${JSON.stringify(cs)}: module must SET HL ${hx(c.regs.hl)} != oracle ${hx(o.regs.hl)}`);
    // The high byte of HL never changes (Z80 inc's L only).
    assert.equal(ret & 0xff00, cs.list & 0xff00, `${JSON.stringify(cs)}: HL high byte must be unchanged`);
  }
  console.log(`  CRAFTED: ${CASES.length} cases stamped identically (incl. page-wrap)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts one copied record byte in the list. */
function brokenByte(m, list = m.regs.hl, rec = m.regs.ix, stride = m.regs.de, count = m.regs.b) {
  const ret = copyObjectRecordsToDisplayList(m, list, rec, stride, count);
  m.mem.write8(list & 0xffff, (m.mem.read8(list & 0xffff) ^ 0x01) & 0xff); // BUG: wrong first list byte
  return ret;
}

test("TEETH: a wrong copied byte is CAUGHT in the list", () => {
  let caught = null;
  for (const cs of CASES) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    brokenByte(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong copied byte — it is worthless");
  console.log(`  TEETH: wrong byte caught at ${hx(caught.addr ?? 0)} (oracle=${caught.a} broken=${caught.b})`);
});

test("TEETH: a full-16-bit list advance (crossing the page) is CAUGHT by the HL return", () => {
  // The page-wrap case: a naive `list + 4*count` crosses into the next page; the oracle keeps H.
  const cs = CASES[3]; // list 0x88fe, count 3 -> low byte wraps
  const o = craft(cs);
  oracle(o);
  const wrongRet = (cs.list + 4 * cs.count) & 0xffff; // full 16-bit advance (crosses page)
  assert.notEqual(wrongRet, o.regs.hl, "a full-16-bit advance must differ from the oracle's page-wrapped HL");
  assert.equal(o.regs.hl & 0xff00, cs.list & 0xff00, "oracle HL stays in the list's page");
  console.log(`  TEETH: full-16 advance ${hx(wrongRet)} != oracle page-wrapped ${hx(o.regs.hl)}`);
});
