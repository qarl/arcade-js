// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for flagHighScoreTableCorruptOnChecksumMiss (ROM 0x0644) — the
 * high-score-table checksum guard: the header byte must be the 0xc8 marker and the four checksum
 * bytes summed (byte-carries counted separately) minus the carry count must equal 0x59, else the
 * table was altered and HISCORE_TABLE_CORRUPT_FLAG is raised. A clean table touches nothing.
 *
 * CYCLE-FREE / memory-equivalence gate. The only observable effect is the possible write of
 * HISCORE_TABLE_CORRUPT_FLAG, so the go-forward contract is RAM only (dumpState minus stack scratch below the entry SP);
 * the caller ignores A and the flags. The checksum bytes live in ROM (0x778a..) — read-only and
 * excluded from dumpState — so on the real machine only the genuine ROM path (header 0xc8,
 * checksum == 0x59 -> PASS, no write) runs. A flat-RAM arm then drives all three code paths,
 * which the fixed ROM cannot.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x0644 in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — real machine, varied corrupt-flag seeds; the module must match the oracle in RAM.
 *   3. PATHS — flat RAM (ROM bytes writable): PASS / bad-header / wrong-checksum each match the oracle.
 *   4. TEETH — a twin that writes a WRONG corrupt flag MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0644.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0644 as oracle } from "../../translated/loc_0644.js";
import { flagHighScoreTableCorruptOnChecksumMiss } from "../flagHighScoreTableCorruptOnChecksumMiss.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { Regs } from "../../../../core/cpu/z80.js";
import { STACK_SCRATCH, HISCORE_CHECKSUM_BASE, HISCORE_TABLE_CORRUPT_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x0644;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A fresh real machine with the corrupt flag seeded; SP parked in dead-stack. */
function craft(flagSeed) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10;
  m.mem.write8(HISCORE_TABLE_CORRUPT_FLAG, flagSeed & 0xff);
  return m;
}

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

const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x0644 dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    flagHighScoreTableCorruptOnChecksumMiss(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (real machine; real ROM path is PASS -> no write) --------------

const FLAG_SEEDS = [0x00, 0x01, 0x5a];

test("CRAFTED: real machine, varied corrupt-flag seeds — RAM identical to the oracle", () => {
  for (const seed of FLAG_SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    flagHighScoreTableCorruptOnChecksumMiss(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed ${hx(seed)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CRAFTED: ${FLAG_SEEDS.length} flag seeds agree (real ROM path)`);
});

// -- 3. PATHS (flat RAM: the checksum bytes are writable here) -----------------

const CALLER_RET = 0xabcd;

/** Flat 64K oracle machine (ROM writable) — mirrors the translated loc_0644 mock. */
function makeFlatOracle() {
  const regs = new Regs();
  const ram = new Uint8Array(0x10000);
  const mem = {
    read8: (a) => ram[a & 0xffff],
    write8: (a, v) => { ram[a & 0xffff] = v & 0xff; },
  };
  const m = {
    regs, mem, ram, tstates: 0, pc: 0x0644,
    step(nextAddr, cycles) { this.pc = nextAddr; this.tstates += cycles; },
    push16(v) { regs.sp = (regs.sp - 2) & 0xffff; mem.write8(regs.sp, v & 0xff); mem.write8((regs.sp + 1) & 0xffff, (v >> 8) & 0xff); },
    pop16() { const lo = mem.read8(regs.sp); const hi = mem.read8((regs.sp + 1) & 0xffff); regs.sp = (regs.sp + 2) & 0xffff; return lo | (hi << 8); },
    ret(cycles = 10) { this.step(this.pop16(), cycles); },
  };
  regs.sp = 0x8780;
  m.push16(CALLER_RET); // seat a return so the terminal ret has somewhere to land (0x877e/f, off-window)
  return m;
}

// [name, [b0,b1,b2,b3], flagSeed]: PASS balances (0xc8+0x92 carry -> 0x5a, D=1, 0x5a-1==0x59);
// BADHDR wrong header; FAIL header ok but 0xc9-0==0xc9 != 0x59; FAIL_OVER seeds a nonzero flag to
// prove the write is an absolute :=1 (not an increment).
const PATH_CASES = [
  ["PASS", [0xc8, 0x92, 0x00, 0x00], 0x77],
  ["BADHDR", [0x00, 0x11, 0x22, 0x33], 0x00],
  ["FAIL", [0xc8, 0x01, 0x00, 0x00], 0x00],
  ["FAIL_OVER", [0xc8, 0x01, 0x00, 0x00], 0x05],
];

test("PATHS: PASS / bad-header / wrong-checksum each match the oracle in work RAM", () => {
  for (const [name, bytes, seed] of PATH_CASES) {
    const o = makeFlatOracle();
    const mod = new Uint8Array(0x10000);
    for (let i = 0; i < 4; i++) {
      o.mem.write8(HISCORE_CHECKSUM_BASE + i, bytes[i]);
      mod[HISCORE_CHECKSUM_BASE + i] = bytes[i];
    }
    o.mem.write8(HISCORE_TABLE_CORRUPT_FLAG, seed);
    mod[HISCORE_TABLE_CORRUPT_FLAG] = seed;

    oracle(o);
    flagHighScoreTableCorruptOnChecksumMiss({ mem8: mod });

    // Work RAM 0x8800..0x8fff is the only place this routine can write; nothing else may differ.
    for (let a = 0x8800; a <= 0x8fff; a++) {
      assert.equal(mod[a], o.ram[a], `${name}: RAM diff at ${hx(a)}: oracle=${o.ram[a]} module=${mod[a]}`);
    }
    // Derive the expected flag from the ORACLE, never the module.
    assert.equal(mod[HISCORE_TABLE_CORRUPT_FLAG], o.ram[HISCORE_TABLE_CORRUPT_FLAG], `${name}: corrupt flag`);
  }
  console.log(`  PATHS: ${PATH_CASES.length} code paths agree in work RAM`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: always perturbs the corrupt flag (+2) regardless of the checksum — must be caught. */
function brokenGuard(m) {
  flagHighScoreTableCorruptOnChecksumMiss(m);
  m.mem.write8(HISCORE_TABLE_CORRUPT_FLAG, (m.mem.read8(HISCORE_TABLE_CORRUPT_FLAG) + 2) & 0xff); // BUG
}

test("TEETH: a wrong corrupt flag is CAUGHT", () => {
  let caught = null;
  for (const seed of FLAG_SEEDS) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    brokenGuard(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong flag — it is worthless");
  assert.equal(caught.addr, HISCORE_TABLE_CORRUPT_FLAG, `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong flag caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
