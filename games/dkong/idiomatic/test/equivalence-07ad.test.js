// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for writeDigitPairWithCarry (ROM 0x07ad) — the two-tile digit
 * writer with the 10 -> tens-carry split.
 *
 * sub_07ad WRITES video RAM (E at HL, D at HL+2, and on D==10 a ones 0 at HL+2 plus
 * a tens 1 at the fixed carry cell 0x758E) and hands off DE=0x0201 / HL=0x768C to
 * the fall-through second pass — so DE and HL are LIVE-OUT registers, not just
 * memory. It reads no work RAM; its inputs are the HL/DE registers. It is gated by
 * capture / clone / replay (docs/decompiler-pipeline) on a FRESH clone per case — never the full
 * register file, never cycles. The compared contract is game-visible RAM (minus
 * STACK_SCRATCH) + the live-out registers D/E/H/L. The oracle's terminal `ret` pops
 * the stack (SP += 2) and vectors PC; the idiomatic layer drops that bookkeeping, so
 * SP/pc are NOT compared against the oracle — instead the idiomatic routine is
 * asserted to leave SP and pc untouched from entry (the JS call stack replaces them).
 * A and FLAGS are dead ABI (the fall-through reloads A via `ld a,d` and recomputes
 * flags via `sub 0x0a` before reading either) and are excluded.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x07ad in a real boot/attract run and
 *      clone at each true dispatch. handler_0779 fires it TWICE (the coins pass
 *      HL=0x756C and the static "1 2" pass HL=0x768C). For each, run the ORACLE and
 *      writeDigitPairWithCarry on two fresh clones and confirm identical game-visible
 *      RAM and identical live-out DE/HL, and that SP/pc are untouched.
 *
 *   2. EQUAL (crafted digit + carry sweep) — attract only ever feeds D=2, so the
 *      D==10 tens-carry arm and the digit breadth are exercised by crafted entries:
 *      the target VRAM band (0x7550-0x75A0, covering HL / HL+2 / 0x758E) is painted
 *      with a SENTINEL identically on both sides, D is swept (incl. 10) and E swept,
 *      and each combo is compared to the oracle on RAM + live-out DE/HL. The sentinel
 *      pins the exact write footprint: a cell the candidate writes-but-oracle-doesn't
 *      (or misses) holds the sentinel on one side and a real value on the other.
 *
 *   3. TEETH — a wrong-column-stride twin (second digit at HL+1 not HL+2) MUST be
 *      caught, on the sentinel sweep AND on real captures; and a carry-dropping twin
 *      (never writes the D==10 split) MUST be caught on the D==10 arm while still
 *      agreeing with the oracle on D != 10 (proving the teeth is specific, not blunt).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-07ad.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_07ad as oracle } from "../../translated/loc_07ad.js";
import { writeDigitPairWithCarry } from "../writeDigitPairWithCarry.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x07ad;
const COINS_PASS_HL = 0x756c; // handler_0779's first call: DE from 0x6022, HL here
const STATIC_PASS_HL = 0x768c; // the fall-through second pass: DE=0x0201, HL here
const CARRY_CELL = 0x758e; // fixed VRAM tens-digit cell written only when D==10

// The band that contains every cell any pass can touch off the coins base:
// HL=0x756C, HL+2=0x756E, and the fixed carry cell 0x758E.
const CRAFT_BAND = { lo: 0x7550, hi: 0x75a0 };

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hx8 = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- comparison plumbing ------------------------------------------------------

/** First GAME-VISIBLE RAM byte that differs (outside the stack scratch below the entry SP), or null. */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { bad: { addr, a: da[i], b: db[i] } };
  }
  return { bad: null };
}

/** First live-out register (D/E/H/L) that differs, or null. */
function liveOutRegDiff(a, b) {
  for (const k of ["d", "e", "h", "l"]) {
    if ((a.regs[k] & 0xff) !== (b.regs[k] & 0xff)) {
      return { reg: k, a: a.regs[k] & 0xff, b: b.regs[k] & 0xff };
    }
  }
  return null;
}

/** Run oracle and candidate on two FRESH clones (memory-writer) and diff. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ram: ramDiffMinusStack(a, b, entry.regs.sp), regs: liveOutRegDiff(a, b) };
}

/**
 * Hook 0x07ad in a real boot/attract run and clone the machine at up to K true
 * dispatches. handler_0779 (state-1 substate-0) `call`s it and then falls through,
 * so a short boot captures BOTH the coins pass and the static pass.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** The real coins-pass capture (HL=0x756C) used as the base for crafted entries. */
function coinsBase(maxFrames = 400) {
  const caps = captureDispatches(64, maxFrames);
  const base = caps.find((c) => c.regs.hl === COINS_PASS_HL);
  assert.ok(base, "need a real coins-pass (HL=0x756C) capture to craft from");
  return base;
}

/** Clone a base twice, paint the target band with `sentinel`, and set D/E — both sides identical. */
function craftPair(base, { d, e, sentinel }) {
  const a = base.clone();
  const b = base.clone();
  for (const mm of [a, b]) {
    for (let addr = CRAFT_BAND.lo; addr < CRAFT_BAND.hi; addr++) mm.mem.write8(addr, sentinel);
    mm.regs.d = d & 0xff;
    mm.regs.e = e & 0xff;
  }
  return { a, b };
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): both passes match on RAM + live-out DE/HL; SP/pc untouched", () => {
  const caps = captureDispatches(64, 400);
  assert.ok(caps.length >= 1, "expected at least one real 0x07ad dispatch during boot/attract");

  let sawCoins = false;
  let sawStatic = false;
  for (const entry of caps) {
    if (entry.regs.hl === COINS_PASS_HL) sawCoins = true;
    if (entry.regs.hl === STATIC_PASS_HL) sawStatic = true;

    const { ram, regs } = replay(entry, writeDigitPairWithCarry);
    assert.equal(
      ram.bad,
      null,
      ram.bad && `game-visible RAM diff at ${hx(ram.bad.addr)} (oracle=${ram.bad.a} idiomatic=${ram.bad.b})`,
    );
    assert.equal(
      regs,
      null,
      regs && `live-out reg ${regs && regs.reg} diff: oracle=${regs && hx8(regs.a)} idiomatic=${regs && hx8(regs.b)}`,
    );

    // No stack modelling: SP and pc unchanged from entry.
    const c = entry.clone();
    const sp0 = c.regs.sp;
    const pc0 = c.pc;
    writeDigitPairWithCarry(c);
    assert.equal(c.regs.sp, sp0, "writeDigitPairWithCarry must leave SP unchanged (no stack modelling)");
    assert.equal(c.pc, pc0, "writeDigitPairWithCarry must leave pc unchanged (no ret modelling)");
  }
  assert.ok(sawCoins, "expected the coins pass (HL=0x756C)");
  assert.ok(sawStatic, "expected the static '1 2' pass (HL=0x768C)");
  console.log(`  EQUAL/captured: ${caps.length} real dispatches (coins + static) — identical RAM & live-out DE/HL`);
});

// -- 2. EQUAL (crafted digit + tens-carry sweep) ------------------------------

const DS = [0x00, 0x01, 0x02, 0x09, 0x0a, 0x0b, 0x64, 0xff]; // includes the D==10 carry arm
const ES = [0x00, 0x01, 0x05, 0x09, 0xff];
const SENTINELS = [0xee, 0x55]; // distinct from every D/E and the carry constants 0/1

test("EQUAL (crafted): digit + tens-carry breadth matches the oracle (D incl. 10, E swept)", () => {
  const base = coinsBase();

  let n = 0;
  for (const sentinel of SENTINELS) {
    for (const d of DS) {
      for (const e of ES) {
        const { a, b } = craftPair(base, { d, e, sentinel });
        const aFloor = a.regs.sp;
        oracle(a);
        writeDigitPairWithCarry(b);
        const { bad } = ramDiffMinusStack(a, b, aFloor);
        const rd = liveOutRegDiff(a, b);
        n++;
        assert.equal(
          bad,
          null,
          bad && `D=${hx8(d)} E=${hx8(e)} sentinel=${hx8(sentinel)}: RAM diff at ${hx(bad.addr)} ` +
            `(oracle=${bad.a} idiomatic=${bad.b})`,
        );
        assert.equal(
          rd,
          null,
          rd && `D=${hx8(d)} E=${hx8(e)}: live-out reg ${rd && rd.reg} diff`,
        );
      }
    }
  }
  console.log(`  EQUAL/crafted: ${n} (D,E,sentinel) combos identical to the oracle — carry arm covered`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: writes the second digit at HL+1 instead of HL+2 (wrong column stride). */
function brokenStride(m) {
  const { regs, mem } = m;
  mem.write8(regs.hl, regs.e);
  const secondCell = (regs.hl + 1) & 0xffff; // BUG: should be +2
  mem.write8(secondCell, regs.d);
  if (regs.d === 0x0a) {
    mem.write8(secondCell, 0x00);
    mem.write8(CARRY_CELL, 0x01);
  }
  regs.de = 0x0201;
  regs.hl = 0x768c;
}

/** Broken twin: drops the D==10 tens-carry split entirely (writes D raw, never the carry cell). */
function brokenCarry(m) {
  const { regs, mem } = m;
  mem.write8(regs.hl, regs.e);
  mem.write8((regs.hl + 2) & 0xffff, regs.d); // BUG: no D==10 split -> "10" as one tile, no carry
  regs.de = 0x0201;
  regs.hl = 0x768c;
}

test("TEETH: wrong-stride and carry-drop twins are CAUGHT", () => {
  const base = coinsBase();

  // Wrong stride — guaranteed on the sentinel sweep (0x756E holds the sentinel on the
  // twin vs the oracle's D), and also on real captures.
  {
    const { a, b } = craftPair(base, { d: 0x02, e: 0x01, sentinel: 0xee });
    const aFloor = a.regs.sp;
    oracle(a);
    brokenStride(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.notEqual(bad, null, "the RAM gate FAILED to catch the wrong-column-stride twin — it is worthless");

    const caps = captureDispatches(64, 400);
    let caughtReal = false;
    for (const cap of caps) {
      const oa = cap.clone();
      const tb = cap.clone();
      oracle(oa);
      brokenStride(tb);
      if (ramDiffMinusStack(oa, tb, cap.regs.sp).bad) { caughtReal = true; break; }
    }
    assert.ok(caughtReal, "the wrong-stride twin was not caught on any real capture");
  }

  // Carry-drop — caught on the D==10 arm, and must AGREE with the oracle on D != 10
  // (so the teeth is specific to the carry logic, not a blunt mismatch).
  {
    const { a, b } = craftPair(base, { d: 0x0a, e: 0x05, sentinel: 0xee });
    const aFloor = a.regs.sp;
    oracle(a);
    brokenCarry(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.notEqual(bad, null, "the RAM gate FAILED to catch the carry-drop twin on D==10 — it is worthless");

    const { a: a2, b: b2 } = craftPair(base, { d: 0x02, e: 0x05, sentinel: 0xee });
    const a2Floor = a2.regs.sp;
    oracle(a2);
    brokenCarry(b2);
    assert.equal(
      ramDiffMinusStack(a2, b2, a2Floor).bad,
      null,
      "the carry-drop twin should be identical to the oracle when D != 10 (teeth must be specific)",
    );
  }

  console.log("  TEETH: wrong-stride caught (crafted + real); carry-drop caught on D==10, agrees on D!=10");
});
