// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1980 — memory-equivalent to the frozen oracle at ROM 0x1980.
 *
 * GATE: crafted-entry, because the strict gate CANNOT run here. Its two call sites are
 *   `call z,0x1980` at 0x18F3 and 0x18FF, inside the initials-entry handler at 0x18C3, and neither
 *   the shared coin -> start tape nor undriven attract reaches that screen — measured at zero
 *   dispatches in 4000 frames on both. unitEquivalence throws "never entered", and the first arm
 *   ASSERTS the throw rather than quietly raising the budget past what the harness exports.
 *
 *   The entry is therefore built rather than captured: a REAL machine, cloned at the end of the
 *   shared tape's session, with only the one live-in — the pointer — set to what the callers pass.
 *   Video RAM, colour RAM, work RAM and the stack are the state the game itself produced.
 *
 * WHAT THE CALLERS PASS. The handler walks a pointer DOWN a run of four shift registers at
 *   0xA995..0xA998, rolling one control bit into each every other frame. Only the lower two are
 *   ever handed to this routine: 0xA996 when it reads 0xFF, and 0xA995 when it reads 0x7F. Those
 *   are the two starts swept below. Neither cell is named in names.js, so both stay hex.
 *
 * What it exercises, holes stated:
 *   1. UNREACHED, ASSERTED — the strict harness throws on both tapes.
 *   2. EXHAUSTIVE — each of the two real cells swept over all 256 priors, oracle against rewrite,
 *      full state dump each time.
 *   3. LIVE-OUT — RAM equality is BLIND to half of what this routine does. It hands a zero back as
 *      well as writing one, and the twin that writes the cell but leaves the handed-back byte
 *      alone is identical in RAM on all 256 priors. The BLIND arm asserts that, and the live-out
 *      comparison is what catches it.
 *   4. NEIGHBOURS UNTOUCHED — the cells either side of the target are PAINTED non-zero and then
 *      asserted unchanged, so a one-off pointer error cannot hide behind an already-zero
 *      neighbour.
 *   5. PARAMETER FORM — the rewrite takes the pointer as an argument with the register as its
 *      default; both forms are asserted to agree.
 *   6. TEETH — wrong cell, writes a non-zero, and the leaves-the-byte-alone twin, each caught on
 *      every case. The no-op twin is caught on every prior BUT ZERO, where the cell already holds
 *      what the routine writes and no RAM diff can exist; that one exemption is asserted to be
 *      exactly one case per cell rather than described and waved through.
 *
 * HOLE: one backdrop, and two starts. The routine reads nothing but the pointer it is given, so
 * the prior sweep covers its whole input space at those starts; other starts are not exercised
 * because no caller passes one. Nothing here establishes what the shift registers mean.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1980.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_1980 } from "../loc_1980.js";
import { loc_1980 as oracle } from "../../translated/loc_1980.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";

const TARGET = 0x1980;

/** The two shift registers the callers hand this routine, and the values that select each. */
const CELLS = [
  { addr: 0xa995, saturated: 0x7f },
  { addr: 0xa996, saturated: 0xff },
];

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

let backdrop = null;

/** A real end-of-session machine, produced by the shared tape and nothing else. */
function pristine() {
  if (backdrop === null) {
    const m = makeMachine();
    m.runFrames(ENTRY_FRAMES);
    backdrop = m.clone();
  }
  return backdrop;
}

/** A non-zero marker derived from the address, so no two painted bytes collide. */
const marker = (addr) => ((addr & 0xff) ^ 0x5a) || 0x5a;

/**
 * The cells either side are PAINTED non-zero. On the raw backdrop a neighbour can already read
 * zero, and a twin that clears the wrong one is then invisible; painting removes that blind spot
 * instead of leaving it in the teeth count.
 */
function craft(cell, prior) {
  const m = pristine().clone();
  m.regs.hl = cell;
  for (const d of [-1, 1]) {
    const addr = u16(cell + d);
    m.mem8[addr] = marker(addr);
  }
  m.mem8[cell] = prior;
  return m;
}

/** Oracle against a candidate from the same crafted entry. */
function compare(candidate, cell, prior) {
  const a = craft(cell, prior);
  const b = craft(cell, prior);
  oracle(a);
  candidate(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    oracleByte: a.regs.a,
    candidateByte: b.regs.a,
    a,
    b,
  };
}

// ── the routine is unreached, and that is asserted ──────────────────────────────────────────

test("UNREACHED: neither tape dispatches it, so the strict harness throws", { skip: SKIP }, () => {
  for (const [label, opts] of [["coin -> start", {}], ["undriven attract", { tape: [] }]]) {
    assert.throws(
      () => unitEquivalence((ov) => makeMachine(ov, opts), TARGET, oracle, loc_1980, {
        maxFrames: ENTRY_FRAMES,
      }),
      /never entered/,
      `${label} unexpectedly reached the routine — the crafted gate should become a real capture`,
    );
  }
  console.log("  UNREACHED: both tapes throw 'never entered' — crafted entries it is");
});

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("EXHAUSTIVE: both real cells, every prior, RAM identical", { skip: SKIP }, () => {
  let cases = 0;
  for (const { addr } of CELLS) {
    for (let prior = 0; prior < 256; prior++) {
      const r = compare(loc_1980, addr, prior);
      assert.equal(r.ram, null, `${hex4(addr)} prior=${prior}: ${show(r.ram)}`);
      cases++;
    }
  }
  assert.equal(cases, 512, "must have swept both cells over every prior");
  console.log(`  EXHAUSTIVE: ${cases} crafted cases identical`);
});

test("LIVE-OUT: the cell is cleared and a zero is handed back", { skip: SKIP }, () => {
  for (const { addr, saturated } of CELLS) {
    const r = compare(loc_1980, addr, saturated);
    assert.equal(r.b.mem8[addr], 0, `${hex4(addr)} must be cleared`);
    assert.equal(r.candidateByte, r.oracleByte, "the handed-back byte must match the original");
    assert.equal(r.candidateByte, 0, "the handed-back byte must be zero");
    assert.equal(loc_1980(pristine().clone(), addr), 0, "the return value must be zero too");
  }
  console.log("  LIVE-OUT: cleared cell and a zero handed back, on both real cells");
});

test("NEIGHBOURS UNTOUCHED: the cells either side keep their values", { skip: SKIP }, () => {
  for (const { addr } of CELLS) {
    const m = pristine().clone();
    const below = u16(addr - 1);
    const above = u16(addr + 1);
    m.mem8[below] = 0x5a;
    m.mem8[above] = 0xa5;
    m.regs.hl = addr;
    loc_1980(m);
    assert.equal(m.mem8[below], 0x5a, `${hex4(below)} must not be touched`);
    assert.equal(m.mem8[above], 0xa5, `${hex4(above)} must not be touched`);
  }
  console.log("  NEIGHBOURS: untouched either side of both cells");
});

test("PARAMETER FORM: the argument and the register agree", { skip: SKIP }, () => {
  for (const { addr, saturated } of CELLS) {
    const viaRegister = pristine().clone();
    viaRegister.mem8[addr] = saturated;
    viaRegister.regs.hl = addr;
    loc_1980(viaRegister);

    const viaArgument = pristine().clone();
    viaArgument.mem8[addr] = saturated;
    viaArgument.regs.hl = 0x0000;
    loc_1980(viaArgument, addr);

    assert.equal(viaArgument.mem8[addr], viaRegister.mem8[addr], "both forms must clear the cell");
    assert.equal(viaArgument.regs.a, viaRegister.regs.a, "both forms must hand back the same byte");
  }
  console.log("  PARAMETER FORM: argument and register agree on both cells");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing. */
function brokenNoOp() {}

/** BUG: clears the cell one below the pointer. */
function brokenWrongCell(m, cell = m.regs.hl) {
  m.mem8[u16(cell - 1)] = 0;
  m.regs.a = 0;
}

/** BUG: writes a value that is not zero. */
function brokenNonZero(m, cell = m.regs.hl) {
  m.mem8[cell] = 1;
  m.regs.a = 0;
}

/** BUG: clears the cell but leaves the byte the caller goes on to test. RAM CANNOT SEE THIS. */
function brokenKeepsTheByte(m, cell = m.regs.hl) {
  m.mem8[cell] = 0;
}

for (const [label, twin] of [
  ["wrong-cell", brokenWrongCell],
  ["writes-non-zero", brokenNonZero],
]) {
  test(`TEETH: the ${label} twin is CAUGHT in RAM on every prior`, { skip: SKIP }, () => {
    let caught = 0;
    for (const { addr } of CELLS) {
      for (let prior = 0; prior < 256; prior++) if (compare(twin, addr, prior).ram) caught++;
    }
    assert.equal(caught, 512, `the sweep missed the ${label} twin on ${512 - caught} case(s)`);
    console.log(`  TEETH/${label}: caught on all ${caught} cases`);
  });
}

test("TEETH: the no-op twin is caught on every prior BUT ZERO, which is exactly one per cell", { skip: SKIP }, () => {
  const blind = [];
  let caught = 0;
  for (const { addr } of CELLS) {
    for (let prior = 0; prior < 256; prior++) {
      if (compare(brokenNoOp, addr, prior).ram) caught++;
      else blind.push({ addr, prior });
    }
  }
  assert.deepEqual(
    blind.map((b) => b.prior),
    CELLS.map(() => 0),
    "the ONLY prior a no-op may survive is the one where the cell already holds what it writes",
  );
  assert.equal(caught, 512 - CELLS.length, "everything else must be caught");
  console.log(`  TEETH/no-op: caught ${caught}, blind only where the cell already read zero`);
});

test("TEETH: the keeps-the-byte twin is BLIND to RAM and caught by the live-out", { skip: SKIP }, () => {
  let ramCaught = 0;
  let liveOutCaught = 0;
  for (const { addr } of CELLS) {
    for (let prior = 0; prior < 256; prior++) {
      const r = compare(brokenKeepsTheByte, addr, prior);
      if (r.ram) ramCaught++;
      if (r.candidateByte !== r.oracleByte) liveOutCaught++;
    }
  }
  assert.equal(ramCaught, 0, "if RAM now catches it, this header's blindness claim is stale");
  assert.ok(liveOutCaught > 0, "the live-out must catch what RAM cannot");
  console.log(`  TEETH/keeps-the-byte: RAM caught ${ramCaught}, live-out caught ${liveOutCaught}`);
});
