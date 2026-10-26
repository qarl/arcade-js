// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for verifyTableChecksum (ROM 0x585b-0x5870, Pooyan) — the ROM
 * integrity tripwire: sum `count` bytes from HL into a 16-bit accumulator (A low, D high,
 * D bumped on each 8-bit carry); the table is intact only when the sum is exactly 0x1dc1
 * (low 0xc1, high 0x1d), on which it returns quietly. Every other total sets the tamper
 * flag (0x882b) = 1.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. verifyTableChecksum conditionally
 * WRITES RAM (the tamper flag), so every case uses a FRESH clone per side, compared on the
 * go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The routine is memory-only — its accumulator registers are scratch and no caller reads
 * them — so there is no return to compare; the tamper flag IS the contract. The register
 * inputs are HL (table ptr), B (count), A (low seed), D (high seed); both sides read them
 * from regs (the module via its `= m.regs.*` defaults).
 *
 * Jobs:
 *   1. REAL — the true entry (HL=0x0bb5 ROM, B=0x52, A=0, D=0), the exact checksum the eagle
 *      spawn path runs. Oracle vs module agree in RAM whatever the verdict.
 *   2. CRAFTED — the load-bearing arm. Small RAM tables driving the OK (no-write) branch, the
 *      low-mismatch and high-mismatch write branches, and the 8-bit carry-into-D path.
 *   3. WRITE-SET — the oracle's only possible live write is the tamper flag.
 *   4. TEETH — a twin that stamps a WRONG tamper byte MUST be caught at the tamper flag.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-585b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_585b as oracle } from "../../translated/loc_585b.js";
import { verifyTableChecksum } from "../verifyTableChecksum.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SCORE_DRIP_ACCUM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const TABLE = 0x8b80; // scratch work-RAM to hold a crafted checksum table (away from the flag + stack)
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Machine seeded with HL/B/A/D and (for crafted cases) a byte table written at TABLE. */
function craft({ ptr = TABLE, bytes = [], seedA = 0, seedD = 0 }) {
  const m = new Machine(ROM);
  m.regs.hl = ptr & 0xffff;
  m.regs.b = bytes.length ? bytes.length : m.regs.b; // set below for REAL
  m.regs.a = seedA & 0xff;
  m.regs.d = seedD & 0xff;
  bytes.forEach((v, i) => m.mem.write8((TABLE + i) & 0xffff, v & 0xff));
  return m;
}

// Crafted tables. sum-with-carries + seeds pick the branch:
//   OK  : seedD 0x1d, no-carry bytes summing to 0xc1 -> low 0xc1, high 0x1d -> no write.
//   LOW : same but summing to 0xc2 -> low mismatch -> tamper write.
//   HIGH: seedD 0x1c, bytes to 0xc1 -> high mismatch -> tamper write.
//   CARRY: seedD 0, bytes 0xff,0x02 -> carry bumps D to 1, low 0x01 -> tamper write.
const CRAFTED = [
  { name: "OK (0x1dc1) — no write", bytes: [0x40, 0x40, 0x41], seedA: 0, seedD: 0x1d },
  { name: "LOW mismatch — tamper", bytes: [0x40, 0x40, 0x42], seedA: 0, seedD: 0x1d },
  { name: "HIGH mismatch — tamper", bytes: [0x40, 0x40, 0x41], seedA: 0, seedD: 0x1c },
  { name: "CARRY into D — tamper", bytes: [0xff, 0x02], seedA: 0, seedD: 0x00 },
];

// -- 1. REAL entry ------------------------------------------------------------

test("REAL: HL=0x0bb5 ROM table, B=0x52 — verifyTableChecksum == oracle in RAM (−stack)", () => {
  const base = new Machine(ROM);
  base.regs.hl = 0x0bb5;
  base.regs.b = 0x52;
  base.regs.a = 0;
  base.regs.d = 0;
  const o = base.clone();
  const c = base.clone();
  oracle(o);
  verifyTableChecksum(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log(`  REAL: 0x0bb5..+0x52 checksum — tamper flag now ${c.mem.read8(SCORE_DRIP_ACCUM)}`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: OK / low-mismatch / high-mismatch / carry — RAM identical (−stack)", () => {
  for (const cs of CRAFTED) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    verifyTableChecksum(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cs.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CRAFTED: ${CRAFTED.length} tables identical (RAM −stack), both verdict branches`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle's only live write is the tamper flag (0x882b)", () => {
  for (const cs of CRAFTED) {
    const before = craft(cs);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();
    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      assert.ok(
        addr === SCORE_DRIP_ACCUM || inDeadStack(addr),
        `${cs.name}: oracle wrote unexpected addr ${hx(addr)} (${b0[off]}->${a1[off]})`,
      );
    }
  }
  // The OK case must NOT touch the flag; a mismatch case must set it to 1.
  const ok = craft(CRAFTED[0]); oracle(ok);
  assert.equal(ok.mem.read8(SCORE_DRIP_ACCUM), 0, "OK checksum must leave the tamper flag clear");
  const bad = craft(CRAFTED[1]); oracle(bad);
  assert.equal(bad.mem.read8(SCORE_DRIP_ACCUM), 1, "a mismatch must set the tamper flag to 1");
  console.log("  WRITE-SET: only the tamper flag moves; OK leaves it 0, mismatch sets 1");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: stamps a WRONG tamper byte regardless of the verdict — caught at 0x882b. */
function brokenVerify(m, ptr = m.regs.hl, count = m.regs.b, low = m.regs.a, high = m.regs.d) {
  verifyTableChecksum(m, ptr, count, low, high);
  m.mem.write8(SCORE_DRIP_ACCUM, 0xee); // BUG: wrong tamper value / spurious write
}

test("TEETH: a wrong tamper byte is CAUGHT at the tamper flag", () => {
  let caught = null;
  for (const cs of CRAFTED) {
    const o = craft(cs);
    const c = craft(cs);
    oracle(o);
    brokenVerify(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong tamper store — it is worthless");
  assert.equal(caught.addr, SCORE_DRIP_ACCUM, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong tamper store caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
