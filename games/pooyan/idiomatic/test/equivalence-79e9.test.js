// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifyRoutineChecksumOrDivert (ROM 0x79e9, Pooyan) — "code-region integrity self-check".
 * Sums the bytes of the routine based at 0x68ac (forward until the terminating 0xc9 ret opcode)
 * into a 16-bit accumulator (low byte + carry count as the high byte) and matches it against the
 * stored word at 0x7a0b/0x7a0c. A low-byte miss throws (integrity trap); a high-byte miss diverts
 * to 0x1a85; a clean match returns.
 *
 * Cycle-free memory-equivalence gate. With an intact ROM the check matches, so the routine writes
 * NO memory — the RAM (dumpState minus stack scratch below the entry SP) arm is trivially satisfied, and the
 * meaningful contract is the DE register LIVE-OUT: the computed 16-bit checksum, left in DE by the
 * oracle. DE is declared + set + compared (no caller is known to consume it, but without it the
 * gate over a write-free routine would pass any no-op). The checksum is also recomputed here,
 * independently of both routines, and must equal the stored word (proving the clean-match path).
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack) and in DE; DE also equals the independent checksum.
 *   2. WRITE-SET — the routine changes NO game-state cell (only transient stack framing).
 *   3. TEETH — a wrong DE (live-out check) and an injected RAM write (RAM diff) are both caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-79e9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_79e9 as oracle } from "../../translated/loc_79e9.js";
import { verifyRoutineChecksumOrDivert } from "../verifyRoutineChecksumOrDivert.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROUTINE_BASE = 0x68ac;
const CHECKSUM_WORD = 0x7a0b;
const RET_OPCODE = 0xc9;
const SCRATCH_CELL = 0x8850; // an arbitrary work-RAM cell for the injected-write teeth

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft() {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // dead stack: any ret/pop framing touches excluded RAM
  return m;
}

/** Recompute the checksum straight from ROM bytes — independent of both routines. */
function independentChecksum() {
  let low = 0;
  let high = 0;
  let addr = ROUTINE_BASE;
  while (ROM[addr] !== RET_OPCODE) {
    const acc = low + ROM[addr];
    low = acc & 0xff;
    if (acc > 0xff) high = (high + 1) & 0xff;
    addr++;
  }
  return (high << 8) | low;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: verifyRoutineChecksumOrDivert == oracle in RAM (−stack) + DE, and DE == the independent checksum", () => {
  const expected = independentChecksum();
  const storedWord = ROM[CHECKSUM_WORD] | (ROM[CHECKSUM_WORD + 1] << 8);
  assert.equal(expected, storedWord, `self-check should match on an intact ROM: computed ${hx(expected)} vs stored ${hx(storedWord)}`);

  const o = craft();
  const c = craft();
  oracle(o);
  const ret = verifyRoutineChecksumOrDivert(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.regs.de & 0xffff, o.regs.de & 0xffff, "DE live-out mismatch (module vs oracle)");
  assert.equal(ret & 0xffff, o.regs.de & 0xffff, "returned checksum must match the oracle's DE");
  assert.equal(o.regs.de & 0xffff, expected, "the oracle's DE must equal the independent checksum");
  console.log(`  EQUAL: DE = ${hx(expected)} (matches oracle + independent sum); no RAM writes`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the routine changes no game-state cell (only transient stack framing)", () => {
  const m = craft();
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) changed.push(addr);
  }
  assert.deepEqual(changed, [], `expected no game-state writes, got ${changed.map(hx)}`);
  console.log("  WRITE-SET: 0 game-state cells written");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong DE is CAUGHT by the live-out check", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  const ret = verifyRoutineChecksumOrDivert(c);
  assert.equal(ret & 0xffff, o.regs.de & 0xffff, "sanity: module DE matches the oracle");
  // an off-by-one checksum is a plausible bug the DE equality must reject
  assert.notEqual((ret + 1) & 0xffff, o.regs.de & 0xffff, "the DE live-out check must reject an off-by-one checksum");
  console.log(`  TEETH(DE): module DE ${hx(ret & 0xffff)} == oracle; off-by-one ${hx((ret + 1) & 0xffff)} rejected`);
});

test("TEETH: an injected RAM write is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  verifyRoutineChecksumOrDivert(c);
  c.mem.write8(SCRATCH_CELL, (c.mem.read8(SCRATCH_CELL) ^ 0x5a) & 0xff); // BUG: a write this routine never makes
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an injected RAM write — the RAM arm is worthless");
  assert.equal(d.addr, SCRATCH_CELL, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): injected write caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
