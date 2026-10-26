// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceFallStep (ROM 0x3fd5) — "advance a falling actor
 * one gravity step and report whether it is still airborne": add the fall velocity
 * (+0x09) into the fixed-point fraction (+0x03), carry an 8-bit overflow into the
 * integer row (+0x04), then answer C = (row < landing row 0x1e).
 *
 * This is the CYCLE-FREE / memory-equivalence gate. advanceFallStep WRITES RAM, so every
 * case uses a FRESH clone per side. The oracle runs on one clone, advanceFallStep on
 * another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP) + the declared live-out (the boolean).
 *
 * The register input is the actor-record base in IX; both sides read it from regs.ix
 * (the module's sanctioned default). The boolean live-out is derived from the ORACLE
 * clone's carry flag (regs.fC after `cp 0x1e`), never from the module under test.
 *
 * SP is not compared (the oracle's only SP move is its terminal `ret`, the stack ABI the
 * direct-call layer replaces with a JS return).
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x3fd5 in a real run; if any dispatch is seen, oracle
 *      vs advanceFallStep leave identical RAM (−stack) and the same boolean.
 *   2. CRAFTED — the load-bearing arm (the fall step is a gameplay leaf, rarely reached in
 *      a short attract). Seed actor records exercising both the no-carry and carry
 *      (row-increment) paths and the landing-row boundary; both sides agree in RAM and the
 *      boolean matches the oracle's carry.
 *   3. WRITE-SET — the oracle touches only +0x03 and (on overflow) +0x04.
 *   4. TEETH — a twin that writes a WRONG fraction byte MUST be caught at rec+0x03.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3fd5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3fd5 as oracle } from "../../translated/loc_3fd5.js";
import { advanceFallStep } from "../advanceFallStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x3fd5;
const REC = ACTOR_TABLE; // 0x8a80: a sane record base inside the actor arena (work RAM)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/**
 * Build a machine with an actor record seeded at REC and IX pointing at it. Fields:
 * frac (+0x03), row (+0x04), vel (+0x09). Surrounding record bytes pre-dirtied to 0xAA
 * so any stray write shows up in the diff.
 */
function craft(frac, row, vel) {
  const m = new Machine(ROM);
  for (let i = 0; i < 0x18; i++) m.mem.write8((REC + i) & 0xffff, 0xaa);
  m.mem.write8((REC + 0x03) & 0xffff, frac);
  m.mem.write8((REC + 0x04) & 0xffff, row);
  m.mem.write8((REC + 0x09) & 0xffff, vel);
  m.regs.ix = REC;
  return m;
}

// frac, row, vel — chosen to cover: no-carry / carry-with-row-inc / boundary / at-or-past landing.
const CASES = [
  { frac: 0x80, row: 0x10, vel: 0x40 }, // no overflow, row 0x10 < 0x1e -> still falling
  { frac: 0xc0, row: 0x10, vel: 0x80 }, // overflow -> row 0x11, still < 0x1e -> still falling
  { frac: 0xff, row: 0x1d, vel: 0x01 }, // overflow -> row 0x1e == landing -> landed (C clear)
  { frac: 0x10, row: 0x1e, vel: 0x10 }, // no overflow, row already 0x1e -> landed
  { frac: 0x00, row: 0x20, vel: 0x00 }, // no motion, row past landing -> landed
  { frac: 0xfe, row: 0x00, vel: 0x03 }, // overflow at the top, row 0x00 -> 0x01, still falling
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

test("CAPTURE: real 0x3fd5 dispatches — advanceFallStep == oracle in RAM (−stack) + boolean", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x3fd5 dispatch in the run window");
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    const oc = oracle(o);
    const still = advanceFallStep(c);

    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(still, o.regs.fC, "boolean must equal the oracle's carry (still-falling)");
    // Live-out SIDE EFFECT: the bridge must SET carry, not merely return the boolean —
    // the frozen translated callers (advanceFallingEnemyAndTallyCatchOnLanding/advanceObjectFallStepThenBlankBandOnLand) read the result via `ret c`.
    assert.equal(c.regs.fC, o.regs.fC, "module must SET carry for the translated `ret c` dispatch");
    void oc;
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: seeded fall records — RAM identical + boolean matches oracle carry", () => {
  for (const cs of CASES) {
    const o = craft(cs.frac, cs.row, cs.vel);
    const c = craft(cs.frac, cs.row, cs.vel);
    oracle(o);
    const still = advanceFallStep(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(
      d, null,
      d && `case ${JSON.stringify(cs)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`,
    );
    assert.equal(
      still, o.regs.fC,
      `case ${JSON.stringify(cs)}: boolean ${still} != oracle carry ${o.regs.fC}`,
    );
    // Live-out SIDE EFFECT: prove the bridge actually SET carry (a return-only rewrite
    // would pass the boolean check above but leave carry unset for `ret c` callers).
    assert.equal(
      c.regs.fC, o.regs.fC,
      `case ${JSON.stringify(cs)}: module carry ${c.regs.fC} != oracle carry ${o.regs.fC}`,
    );
  }
  console.log(`  CRAFTED: ${CASES.length} seeded records identical (RAM −stack) + boolean`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle writes only +0x03 and (on overflow) +0x04", () => {
  for (const cs of CASES) {
    const before = craft(cs.frac, cs.row, cs.vel);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      assert.ok(
        addr === ((REC + 0x03) & 0xffff) || addr === ((REC + 0x04) & 0xffff),
        `case ${JSON.stringify(cs)}: oracle wrote unexpected addr ${hx(addr)} (${b0[off]}->${a1[off]})`,
      );
    }
  }
  console.log("  WRITE-SET: every oracle write is +0x03 or +0x04");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts the stored fraction by one — must be caught at rec+0x03. */
function brokenAdvanceFallStep(m, rec = m.regs.ix) {
  const still = advanceFallStep(m, rec);
  m.mem.write8((rec + 0x03) & 0xffff, (m.mem.read8((rec + 0x03) & 0xffff) + 1) & 0xff); // BUG
  return still;
}

test("TEETH: a wrong stored fraction is CAUGHT at rec+0x03", () => {
  let caught = null;
  for (const cs of CASES) {
    const o = craft(cs.frac, cs.row, cs.vel);
    const c = craft(cs.frac, cs.row, cs.vel);
    oracle(o);
    brokenAdvanceFallStep(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong fraction store — it is worthless");
  assert.equal(caught.addr, (REC + 0x03) & 0xffff, `teeth caught the wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong fraction store caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
