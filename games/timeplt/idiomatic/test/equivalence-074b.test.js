// SPDX-License-Identifier: GPL-3.0-only
/**
 * armPenRouteInColour5ThenAdvanceStep — memory-equivalent to the frozen oracle at ROM 0x074B.
 * GATE: crafted-entry. This arm is table-dispatched and NEITHER shipped tape reaches it, so entries
 *   are POKED -- forcing the sequence sub-step to zero makes the ROM dispatch it itself, coherent.
 *   RAM is compared outside the dead stack scratch the oracle's nested calls write and the rewrite
 *   does not; the +2 SP re-seat (the tail callee pops the caller's slot) and the return value are
 *   asserted; registers are not, the dissolved callees not reproducing the dance and every exit
 *   being a tail transfer whose product is memory. Both sides throwing on a tampered image is
 *   agreement. Run: node --test games/timeplt/idiomatic/test/equivalence-074b.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { armPenRouteInColour5ThenAdvanceStep as candidate } from "../armPenRouteInColour5ThenAdvanceStep.js";
import { loc_074b as oracle } from "../../translated/loc_074b.js";
import { loc_08fa } from "../loc_08fa.js";
import { armThePenRouteThenColdStartOnATamperedImage as armPen } from "../armThePenRouteThenColdStartOnATamperedImage.js";
import { advanceSequenceSubStep as advance } from "../advanceSequenceSubStep.js";
import { SEQUENCE_PHASE, SEQUENCE_SUBSTEP } from "../names.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x074b;
const DISPATCHER = 0x1651; // reads the sub-step and dispatches this arm when it is zero
const PEN_COLOUR = 0xad0c;
const STAMP_GLYPH = 0xad0b;
const CHECKED_BLOCK = 0x4aa0;
const GENUINE_TOTAL = 0xb8;
const PEN_COLOUR_VALUE = 5;
const BLANKING_GLYPH = 0xf1;
const DATA_TOP = 0xadff; // every data write lands at/below here; the stack seats above it
const POKE_FROM = 600;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

/**
 * Oracle vs a candidate on independent clones. The oracle parks flags and nests calls, leaving dead
 * words in the stack scratch the rewrite never writes, so the diff excludes [low, seat) with low
 * measured from the oracle's own pushes. Both sides faulting is agreement; one side alone escapes.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  let retO, retC, threwO = false, threwC = false;
  try { retO = oracle(a); } catch { threwO = true; }
  try { retC = cand(b); } catch { threwC = true; }
  if (threwO || threwC) return { escaped: threwO !== threwC ? "throw" : null, low, seat };
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retO, retC };
}

// ── the poked dispatch, and the crafted branch entries ────────────────────────────────────

let poked = null;
function capturePoked() {
  if (poked) return poked;
  const entries = [];
  let collecting = true;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (collecting) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  m.pokes = [
    { frame: POKE_FROM, addr: SEQUENCE_PHASE, val: 1 },
    { frame: POKE_FROM, addr: SEQUENCE_SUBSTEP, val: 0 },
  ];
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the poked run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the poked run ran short");
  poked = entries;
  return poked;
}

const craft = (base, mutate) => { const m = base.clone(); mutate(m); return m; };

/** The captured entry holds the pen colour unset; the two branches are poked from it. */
function scenarios() {
  const base = capturePoked()[0];
  return [
    ["captured", base.clone()],
    ["penSet", craft(base, (m) => { m.mem8[PEN_COLOUR] = PEN_COLOUR_VALUE; })],
    ["penUnset", craft(base, (m) => { m.mem8[PEN_COLOUR] = 3; })],
  ];
}

const substepAfterOracle = (machine) => { const a = machine.clone(); oracle(a); return a.mem8[SEQUENCE_SUBSTEP]; };

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every parameter matches armPenRouteInColour5ThenAdvanceStep by default. */
function twin({ block = CHECKED_BLOCK, colour = PEN_COLOUR_VALUE, glyph = BLANKING_GLYPH,
               arm = true, advanceExtra = true, advanceBase = true } = {}) {
  return (m) => {
    const { regs, mem8 } = m;
    let total = 0;
    for (let i = 0; i < 0x100; i++) total = u8(total + mem8[u16(block + i)]);
    regs.a = total;
    regs.sub(GENUINE_TOTAL);
    if (regs.fNZ) return loc_08fa(m);
    const wasSet = mem8[PEN_COLOUR] === PEN_COLOUR_VALUE;
    mem8[PEN_COLOUR] = colour;
    mem8[STAMP_GLYPH] = glyph;
    if (arm) armPen(m);
    if (wasSet && advanceExtra) advance(m);
    if (advanceBase) return advance(m);
    return undefined;
  };
}

const TWINS = [
  ["no-op", () => {}, 3],
  ["wrong-colour", twin({ colour: 4 }), 3],
  ["wrong-glyph", twin({ glyph: 0xf0 }), 3],
  ["skip-arm", twin({ arm: false }), 3],
  ["skip-advance", twin({ advanceBase: false }), 3],
  // ★ the extra step is visible only when the pen colour already held its set value.
  ["single-advance-only", twin({ advanceExtra: false }), 1],
  ["wrong-checksum-block", twin({ block: 0x4b00 }), 3],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither tape dispatches this arm; its dispatcher is the live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["attract", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [DISPATCHER]: 0 };
    const realDisp = TRANSLATED.get(DISPATCHER);
    const m = makeMachine(new Map([
      [TARGET, (mm) => { seen[TARGET]++; return oracle(mm); }],
      [DISPATCHER, (mm) => { seen[DISPATCHER]++; return realDisp(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // ★ The zero counts only because the SAME tap saw the dispatcher run; an instrument that could
    // never fire looks identical to an address nothing reaches.
    assert.ok(seen[DISPATCHER] > 0, `the ${label} run saw nothing at the dispatcher, so the zero means nothing`);
    assert.equal(seen[TARGET], 0, `${label} now dispatches this arm, so the poked entries are no longer the best evidence`);
    console.log(`  UNREACHED: ${label} -- ${hex4(TARGET)} ${seen[TARGET]}x, dispatcher ${hex4(DISPATCHER)} ${seen[DISPATCHER]}x`);
  }
});

test("POKED DISPATCH: forcing the sub-step to zero makes the ROM dispatch this arm, and each replays", { skip }, () => {
  const entries = capturePoked();
  assert.ok(entries.length > 0, "vacuous: forcing the sub-step to zero no longer dispatches this arm");
  for (const e of entries) {
    const r = compare(candidate, e);
    assert.equal(r.escaped, null, r.escaped && `a poked dispatch escaped at ${hex4(r.escaped.addr ?? 0)}`);
  }
  const r0 = compare(candidate, entries[0]);
  // ★ The mask is safe only if its floor sits above every data cell the routine writes.
  assert.ok(r0.low > DATA_TOP, `the stack window ${hex4(r0.low)} reached into game data`);
  console.log(`  POKED: ${entries.length} dispatches identical; window [${hex4(r0.low)},${hex4(r0.seat)})`);
});

test("PATHS: both advance branches are equivalent, and they really differ", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped`);
  }
  const [, penSet] = scenarios()[1];
  const [, penUnset] = scenarios()[2];
  // ★ Vacuity guard: the pen-colour branch must move the sub-step by a different amount.
  assert.notEqual(substepAfterOracle(penSet), substepAfterOracle(penUnset),
    "both pen-colour branches leave the same sub-step, so this would pass a rewrite that ignored it");
  console.log(`  PATHS: penSet sub-step ${substepAfterOracle(penSet)}, penUnset ${substepAfterOracle(penUnset)}`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return alike", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops the caller's slot via the tail callee and the rewrite does not`);
    assert.equal(r.retO, r.retC, `${label}: the return value diverged`);
  }
  console.log("  SP: +2 on every path; return values identical");
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of scenarios`, { skip }, () => {
    let caught = 0;
    for (const [, m] of scenarios()) if (compare(brokenTwin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${scenarios().length} scenarios`);
  });
}
