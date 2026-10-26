// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifyPlayfieldTileChecksumOnce (ROM 0x68ac) — "once-only playfield tile-region tamper
 * checksum". Guarded by a latch (0x8f55): if already set it returns immediately. Otherwise it
 * sets the latch, sums the tilemap region (from 0x8402, 29-cell columns stepped +1, a 3-cell
 * gap between rows, pages up to 0x88) into a low byte + wrap count, looks the low byte up in
 * the 4-entry table at 0x68eb, then checks the wrap count against the paired entries. A miss
 * on either is a tamper condition — in the ROM a jump into data, modelled in both the oracle
 * and the idiomatic module as a thrown Error.
 *
 * Because the ONLY memory write is the latch increment (it happens before the checksum loop,
 * so on the throw path too), equivalence is: for identical crafted states, oracle and module
 * make the SAME throw-vs-return decision AND leave identical RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP/cycles are NOT compared; there is no register live-out.
 *
 * Positive controls: a latch-already-set state (clean return, no throw); a region CRAFTED to
 * sum to the first table entry (returns via the paired match); a region crafted to a low byte
 * absent from the table (both throw). TEETH: a wrong latch byte (RAM diff) and a twin that
 * never throws against an oracle that does (throw-agreement).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-68ac.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_68ac as oracle } from "../../translated/loc_68ac.js";
import { verifyPlayfieldTileChecksumOnce } from "../verifyPlayfieldTileChecksumOnce.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LATCH = 0x8f55;
const TABLE = 0x68eb;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Run a routine, reporting only whether it threw (the tamper trap). */
function run(fn, m) {
  try { fn(m); return { threw: false }; } catch { return { threw: true }; }
}

/** The exact addresses the checksum reads, replicating the routine's pointer walk. */
function scannedAddrs() {
  const addrs = [];
  let h = 0x84;
  let l = 0x02;
  for (;;) {
    addrs.push((h << 8) | l);
    l = (l + 1) & 0xff;
    if ((l & 0x1f) !== 0x1f) continue;
    const s = l + 0x03;
    l = s & 0xff;
    if (s <= 0xff) continue;
    h = (h + 1) & 0xff;
    if (h < 0x88) continue;
    break;
  }
  return addrs;
}

const SCANNED = ROM_PRESENT ? scannedAddrs() : [];

/** Seat the scanned region so its low-byte sum == E and wrap count == D (total = D*256 + E). */
function fillRegion(m, targetE, targetD) {
  let remaining = targetD * 256 + targetE;
  for (const addr of SCANNED) {
    const v = remaining > 0xff ? 0xff : remaining;
    m.mem.write8(addr, v);
    remaining -= v;
  }
}

function craft(latch) {
  const m = BASE.clone();
  m.mem.write8(LATCH, latch);
  m.regs.sp = 0x8ffe;
  return m;
}

// -- 1. AGREE: latch already set (clean return positive control) --------------

test("AGREE: latch already set — both return, no throw, RAM identical", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  const ro = run(oracle, o);
  const rc = run(verifyPlayfieldTileChecksumOnce, c);
  assert.equal(rc.threw, ro.threw, "throw-agreement");
  assert.equal(ro.threw, false, "an already-run latch must return, not throw");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  console.log("  AGREE: latch set -> clean return, RAM identical");
});

// -- 2. AGREE: crafted return (checksum-return positive control) --------------

test("AGREE: region crafted to the first table entry — both return via the paired match", () => {
  const e = BASE.mem.read8(TABLE);
  const dPair = BASE.mem.read8(TABLE + 1);
  const o = craft(0x00);
  const c = craft(0x00);
  fillRegion(o, e, dPair);
  fillRegion(c, e, dPair);
  const ro = run(oracle, o);
  const rc = run(verifyPlayfieldTileChecksumOnce, c);
  assert.equal(rc.threw, ro.threw, "throw-agreement");
  assert.equal(ro.threw, false, "a matching checksum must return, not throw");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  assert.equal(c.mem.read8(LATCH), 0x01, "latch set on the first run");
  console.log(`  AGREE: crafted sum E=${hx(e)} D=${hx(dPair)} -> both return, latch set`);
});

// -- 3. AGREE: crafted tamper (throw positive control) ------------------------

test("AGREE: region crafted to a low byte absent from the table — both throw", () => {
  const candidates = new Set([0, 1, 2, 3].map((i) => BASE.mem.read8(TABLE + i)));
  let badE = 0;
  while (candidates.has(badE)) badE++;
  const o = craft(0x00);
  const c = craft(0x00);
  fillRegion(o, badE, 0x00);
  fillRegion(c, badE, 0x00);
  const ro = run(oracle, o);
  const rc = run(verifyPlayfieldTileChecksumOnce, c);
  assert.equal(rc.threw, ro.threw, "throw-agreement");
  assert.equal(ro.threw, true, "an unmatched checksum must throw");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  console.log(`  AGREE: crafted sum E=${hx(badE)} (absent) -> both throw, latch still set`);
});

// -- 4. AGREE: the real booted tilemap (equivalence on live state) ------------

test("AGREE: latch clear over the booted tilemap — same decision + RAM", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  const ro = run(oracle, o);
  const rc = run(verifyPlayfieldTileChecksumOnce, c);
  assert.equal(rc.threw, ro.threw, "throw-agreement on the real tilemap");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  console.log(`  AGREE: booted tilemap -> oracle ${ro.threw ? "threw" : "returned"}, module matched`);
});

// -- 5. WRITE-SET: the only write is the latch increment -----------------------

test("WRITE-SET: the only memory write is the latch (0x8f55) increment", () => {
  const before = craft(0x00);
  const after = craft(0x00);
  const b0 = before.dumpState();
  run(oracle, after); // throw or return: the latch write precedes both
  const a1 = after.dumpState();
  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.set(after.stateOffsetToAddr(off), a1[off]);
  }
  assert.equal(changed.size, 1, `expected exactly 1 written cell, got ${changed.size}`);
  assert.equal(changed.get(LATCH), 0x01, "latch must go 0 -> 1");
  console.log("  WRITE-SET: 0x8f55 := 1 (the sole write)");
});

// -- 6. TEETH -----------------------------------------------------------------

test("TEETH: a wrong latch byte is CAUGHT by the RAM diff", () => {
  const e = BASE.mem.read8(TABLE);
  const dPair = BASE.mem.read8(TABLE + 1);
  const o = craft(0x00);
  const c = craft(0x00);
  fillRegion(o, e, dPair);
  fillRegion(c, e, dPair);
  run(oracle, o);
  run(verifyPlayfieldTileChecksumOnce, c);
  c.mem.write8(LATCH, 0x00); // BUG: the latch must be set after a run

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong latch byte — it is worthless");
  assert.equal(d.addr, LATCH, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(LATCH)})`);
  console.log(`  TEETH/RAM: wrong latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a twin that never throws is CAUGHT by throw-agreement on a tamper state", () => {
  const candidates = new Set([0, 1, 2, 3].map((i) => BASE.mem.read8(TABLE + i)));
  let badE = 0;
  while (candidates.has(badE)) badE++;
  const o = craft(0x00);
  const c = craft(0x00);
  fillRegion(o, badE, 0x00);
  fillRegion(c, badE, 0x00);
  const ro = run(oracle, o);
  // a broken twin that mirrors only the latch write and never runs the tamper trap
  const brokenNeverThrows = (m) => { m.mem.write8(LATCH, (m.mem.read8(LATCH) + 1) & 0xff); };
  const rBroken = run(brokenNeverThrows, c);
  assert.equal(ro.threw, true, "sanity: the tamper state makes the oracle throw");
  assert.notEqual(rBroken.threw, ro.threw, "throw-agreement must reject a twin that never throws");
  console.log("  TEETH/THROW: oracle threw, never-throwing twin caught by throw-agreement");
});
