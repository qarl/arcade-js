// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintSuppressedDigit — memory-equivalent to the frozen oracle at ROM 0x0DAF.
 *
 * GATE: strict unit-capture with ONE exclusion, every dispatch of two tapes replayed, an
 *   exhaustive sweep of the two inputs that decide what is painted, and a poked-image arm.
 *
 *   1. CORPUS — every dispatch of the shared coin -> start tape and of undriven attract, each
 *      replayed oracle against rewrite over the whole state dump.
 *   2. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, pinned to [SP-4, SP): the oracle brackets
 *      the table lookup with a push of the run pointer and pushes a return for the lookup, and
 *      the rewrite models no stack. Every arm walks the whole dump and asserts nothing escapes
 *      that window, so the exclusion cannot quietly widen.
 *   3. REGISTERS AND PC ARE EXCLUDED, DELIBERATELY, and pinned to exactly {a, f, sp}. Everything
 *      else the routine leaves behind — the flag byte's neighbour in the pair, the cursor, the
 *      run pointer — is reproduced and compared, not excused. A holds the colour the oracle's
 *      `ld a,c` leaves; the DEAD AT EXIT arm measures it unread by every caller (complemented on
 *      every exit of the all-frozen game over the tape sessions, nothing moves, with the SP flip
 *      and the live flag in B both heard at the same exit).
 *   4. WHAT THE REAL DISPATCHES COVER — the digits and flag values the tapes actually present,
 *      asserted as sets per tape, so the sweep below is aimed at the hole rather than at a guess.
 *      And the raw backdrop is only PARTLY able to catch a no-op there: the count of dispatches
 *      at which it can is measured, which is why the sweep poisons both planes.
 *   5. EXHAUSTIVE — all 256 incoming values crossed with a spread of flag priors, over poisoned
 *      tilemap planes so that every cell the routine paints is visible.
 *   6. IT READS THE IMAGE FOR THE BLANK — a twin that carries the blank entry as a constant is
 *      byte-identical on an unaltered image, so one arm pokes that byte and re-runs: the routine
 *      must follow the poke and the twin must not. Its blindness without the poke is asserted,
 *      so its agreement on a genuine image is never read as reassurance.
 *   7. TEETH — twins, each caught inside the poisoned planes.
 *
 * HOLE: nothing here says what the glyph codes look like on screen, nor what the run of these a
 * caller strings together is displaying. The suppression is established as an effect on the
 * index, from the index alone.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0daf.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { TAPE_SESSIONS, assertDeadAtExit } from "./_deadAtExit.js";
import { paintSuppressedDigit } from "../paintSuppressedDigit.js";
import { loc_0daf as oracle } from "../../translated/loc_0daf.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x0daf;

const GLYPHS = 0x0dcc;
const BLANK_ENTRY_CELL = 0x3246;
const CHARACTER_PLANE_BIT = 0x0400;
const LOW_NIBBLE = 0x0f;

/** The two 1KB tilemap planes, colour first in the address space. */
const COLOUR_PLANE = 0xa000;
const CHARACTER_PLANE = 0xa400;
const PLANE_BYTES = 0x400;
/** No glyph code and no colour this routine can lay down, so any write is visible. */
const POISON = 0x5a;

const SCRATCH_BYTES = 4;
const EXCLUDED = ["a", "f", "sp"];
const DEAD_FRAMES = 2500;

const DISPATCHES = { shared: 12, attract: 24 };
const TAPES = [["shared", {}], ["attract", { tape: [] }]];

/** Measured per tape. Narrow, which is why the sweep below is the load-bearing arm. */
const REAL_DIGITS = { shared: [0, 1], attract: [0, 1, 3, 4, 5, 6, 8] };
const REAL_FLAGS = [0, 1];
/** Measured: how many real dispatches paint something a no-op would have left different. */
const NOOP_CAUGHT_RAW = { shared: 4, attract: 23 };

const POKED_BLANK = 0x07;

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr >= sp - SCRATCH_BYTES && addr < sp;

/** The masked RAM comparison alone — no register arm, so it measures the BACKDROP's reach. */
function ramDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

/** Oracle against candidate on clones of one machine: masked RAM, then the reproduced registers. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  const moved = REG_FIELDS.find((k) => !EXCLUDED.includes(k) && a.regs[k] !== b.regs[k]);
  return moved ? { addr: null, a: a.regs[moved], b: b.regs[moved] } : null;
}

let corpusCache = null;
function corpus() {
  if (corpusCache) return corpusCache;
  corpusCache = TAPES.map(([label, opts]) => {
    const states = [];
    const digits = new Set();
    const flags = new Set();
    const host = makeMachine(
      new Map([[TARGET, (mm) => {
        states.push(mm.clone());
        digits.add(mm.regs.a & LOW_NIBBLE);
        flags.add(mm.regs.b);
        return oracle(mm);
      }]]),
      opts,
    );
    const frames = host.runFrames(ENTRY_FRAMES);
    assert.equal(host.stoppedBy, null, `the ${label} session stopped early: ${host.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, `the ${label} session ran short`);
    assert.equal(states.length, DISPATCHES[label], `the ${label} dispatch count moved`);
    return { label, states, digits, flags };
  });
  return corpusCache;
}

const anEntry = () => corpus()[0].states[0];

/** A real captured machine with both planes poisoned and the two inputs forced. */
function craft(value, flag) {
  const m = anEntry().clone();
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) m.mem8[a] = POISON;
  m.regs.a = value;
  m.regs.b = flag;
  return m;
}

const FLAG_PRIORS = [0, 1, 2, 255];
const SWEEP_SIZE = 256 * FLAG_PRIORS.length;

function sweepCaught(candidate) {
  let caught = 0;
  for (let value = 0; value < 256; value++) {
    for (const flag of FLAG_PRIORS) if (unitDiff(candidate, craft(value, flag))) caught++;
  }
  return caught;
}

/** Run `body` with one program-image byte forced, then put it back whatever happens. */
function withPokedImage(m, addr, value, body) {
  const image = m.mem.rom;
  const was = image[addr];
  image[addr] = value;
  try {
    return body();
  } finally {
    image[addr] = was;
  }
}

/** The glyph the oracle actually paints, from a crafted entry. */
function glyphPaintedByOracle(value, flag) {
  const s = craft(value, flag);
  const cell = s.regs.de;
  oracle(s);
  return s.mem8[cell];
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: every dispatch of two real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of corpus()) {
    assert.ok(s.states.length > 0, `vacuous: the ${s.label} tape never reached the routine`);
    for (const state of s.states) {
      const d = unitDiff(paintSuppressedDigit, state);
      assert.equal(d, null, `${s.label}: ${show(d)}`);
    }
    total += s.states.length;
  }
  console.log(`  CORPUS: ${total} real dispatches over two sessions, identical on each`);
});

test("THE RAW BACKDROP IS PARTLY BLIND, MEASURED: not every dispatch catches a no-op", { skip }, () => {
  for (const s of corpus()) {
    const caught = s.states.filter((state) => ramDiff(brokenNoOp, state)).length;
    assert.equal(caught, NOOP_CAUGHT_RAW[s.label], `the ${s.label} no-op catch count moved`);
    assert.ok(caught < s.states.length,
      `every ${s.label} dispatch now catches a no-op on the raw backdrop, so this file's reason ` +
        "for poisoning the planes is stale and the sweep should be re-derived");
  }
  const d = ramDiff(brokenNoOp, craft(0, 0));
  assert.notEqual(d, null, "the poisoned entry passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not on a register");
  console.log(
    `  RAW BACKDROP: a no-op is caught on ${Object.values(NOOP_CAUGHT_RAW).join("/")} of ` +
      `${corpus().map((s) => s.states.length).join("/")} real dispatches; poisoned, ${show(d)}`,
  );
});

test("EXCLUDED, deliberately: the flag byte, the stack pointer, pc and the scratch push", { skip }, () => {
  const entry = anEntry();
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  paintSuppressedDigit(b);
  assert.deepEqual(REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]), EXCLUDED,
    "the excluded register set changed shape");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.deepEqual(allDiffs(a, b).filter((d) => !inScratch(d.addr, sp)), [],
    "a divergence escaped the scratch window");
  assert.ok(allDiffs(a, b).length > 0, "the scratch push vanished, so the window claims too much");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")}, pc, and [SP-${SCRATCH_BYTES}, SP) at sp=${hex4(sp)}`);
});

test("A IS DEAD AT EXIT: the colour the oracle leaves in A is read by no caller", { skip }, () => {
  assertDeadAtExit({
    at: TARGET, poison: ["a"], sessions: TAPE_SESSIONS, frames: DEAD_FRAMES,
    // CONTROL, same instrument and exit: the flag in B, which the caller carries on, must be heard.
    controls: [{ label: "live B", poison: ["b"] }],
  });
});

test("WHAT THE REAL DISPATCHES COVER: a handful of digits and two flag values", { skip }, () => {
  for (const s of corpus()) {
    assert.deepEqual([...s.digits].sort((x, y) => x - y), REAL_DIGITS[s.label],
      `the ${s.label} tape's digit set moved, so the sweep covers a different hole than stated`);
  }
  const flags = new Set(corpus().flatMap((s) => [...s.flags]));
  assert.deepEqual([...flags].sort((x, y) => x - y), REAL_FLAGS,
    "the tapes now present a wider set of flag priors");
  console.log(
    `  COVERAGE: real digits ${corpus().map((s) => `${s.label} {${[...s.digits].sort((x, y) => x - y)}}`).join(", ")}; ` +
      `flag priors {${[...flags]}} — the sweep carries the rest`,
  );
});

test("EXHAUSTIVE: 256 incoming values crossed with four flag priors, over poisoned planes", { skip }, () => {
  assert.equal(sweepCaught(paintSuppressedDigit), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} value x flag comparisons identical`);
});

test("THE SUPPRESSION IS REAL: the same zero paints two different glyphs", { skip }, () => {
  const suppressed = glyphPaintedByOracle(0, 0);
  const shown = glyphPaintedByOracle(0, 1);
  assert.notEqual(suppressed, shown,
    "a zero paints the same glyph whether the flag is set or clear, so there is no suppression " +
      "here and the rewrite's branch is describing something that does not happen");
  assert.equal(shown, glyphPaintedByOracle(0, 255), "any non-zero flag must show the same glyph");
  console.log(`  SUPPRESSION: zero paints ${hex4(suppressed)} with the flag clear, ${hex4(shown)} with it set`);
});

test("IT READS THE IMAGE FOR THE BLANK: the suppressed glyph follows a poked byte", { skip }, () => {
  const entry = anEntry();
  const genuine = glyphPaintedByOracle(0, 0);
  withPokedImage(entry, BLANK_ENTRY_CELL, POKED_BLANK, () => {
    const poked = glyphPaintedByOracle(0, 0);
    assert.notEqual(poked, genuine, "the oracle ignored the poked byte, so nothing is read here");
    assert.equal(sweepCaught(paintSuppressedDigit), 0, "the rewrite diverged under the poke");
    assert.ok(sweepCaught(brokenBakedBlank) > 0, "the poked sweep also passed the baked twin");
  });
  assert.equal(glyphPaintedByOracle(0, 0), genuine, "the poke leaked past its own scope");
  console.log(`  READS THE IMAGE: the suppressed glyph tracks the poked byte, and the poke is undone`);
});

test("TEETH: the baked-blank twin is BLIND on a genuine image and caught under the poke", { skip }, () => {
  assert.equal(sweepCaught(brokenBakedBlank), 0,
    "a genuine image was expected to be blind to it; if it is not, the poked arm proves nothing");
  const entry = anEntry();
  const caught = withPokedImage(entry, BLANK_ENTRY_CELL, POKED_BLANK, () =>
    sweepCaught(brokenBakedBlank));
  assert.ok(caught > 0, "the poked sweep ALSO passed it — nothing tests that the read is live");
  console.log(`  TEETH/baked-blank: blind on a genuine image, caught on ${caught}/${SWEEP_SIZE} poked`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

/** The shared tail every twin below shares with the routine: look up, paint, colour, step on. */
function paint(m, entry) {
  const { mem8, regs } = m;
  const held = regs.hl;
  regs.hl = GLYPHS;
  regs.a = entry;
  const glyph = fetchTableByte(m);
  regs.hl = held;
  const cell = regs.de;
  mem8[cell] = glyph;
  regs.a = regs.c;
  mem8[cell & ~CHARACTER_PLANE_BIT] = regs.a;
  regs.de = cell | CHARACTER_PLANE_BIT;
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: no suppression — a zero always paints entry zero. */
function brokenNoSuppression(m) {
  const digit = m.regs.a & LOW_NIBBLE;
  if (digit !== 0) m.regs.b = m.regs.b + 1;
  paint(m, digit);
}

/** BUG: suppresses every zero, so a zero inside a number is blanked too. */
function brokenAlwaysBlank(m) {
  const { mem8, regs } = m;
  const digit = regs.a & LOW_NIBBLE;
  if (digit !== 0) regs.b = regs.b + 1;
  paint(m, digit !== 0 ? digit : mem8[BLANK_ENTRY_CELL]);
}

/** BUG: never steps the flag on, so every zero after the first digit stays blank. */
function brokenFlagNeverSet(m) {
  const { mem8, regs } = m;
  const digit = regs.a & LOW_NIBBLE;
  paint(m, digit !== 0 ? digit : regs.b === 0 ? mem8[BLANK_ENTRY_CELL] : 0);
}

/** BUG: takes the whole incoming byte instead of its low four bits. */
function brokenWholeByte(m) {
  const { mem8, regs } = m;
  const digit = regs.a;
  if (digit !== 0) regs.b = regs.b + 1;
  paint(m, digit !== 0 ? digit : regs.b === 0 ? mem8[BLANK_ENTRY_CELL] : 0);
}

/** BUG: lays the colour in the character plane instead of the one below. */
function brokenColourPlane(m) {
  const { mem8, regs } = m;
  const digit = regs.a & LOW_NIBBLE;
  if (digit !== 0) regs.b = regs.b + 1;
  const entry = digit !== 0 ? digit : regs.b === 0 ? mem8[BLANK_ENTRY_CELL] : 0;
  const held = regs.hl;
  regs.hl = GLYPHS;
  regs.a = entry;
  const glyph = fetchTableByte(m);
  regs.hl = held;
  const cell = regs.de;
  mem8[cell] = glyph;
  regs.a = regs.c;
  mem8[cell | CHARACTER_PLANE_BIT] = regs.a;
  regs.de = cell | CHARACTER_PLANE_BIT;
}

/** BUG: reads the glyph table one entry along. */
function brokenTableOffByOne(m) {
  const { mem8, regs } = m;
  const digit = regs.a & LOW_NIBBLE;
  if (digit !== 0) regs.b = regs.b + 1;
  const entry = digit !== 0 ? digit : regs.b === 0 ? mem8[BLANK_ENTRY_CELL] : 0;
  paint(m, entry + 1);
}

/** BUG: carries the blank entry as a constant instead of reading it. */
function brokenBakedBlank(m) {
  const { regs } = m;
  const digit = regs.a & LOW_NIBBLE;
  if (digit !== 0) regs.b = regs.b + 1;
  paint(m, digit !== 0 ? digit : regs.b === 0 ? 0x0a : 0);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["no-suppression", brokenNoSuppression],
  ["always-blank", brokenAlwaysBlank],
  ["flag-never-set", brokenFlagNeverSet],
  ["whole-byte-not-nibble", brokenWholeByte],
  ["colour-in-the-wrong-plane", brokenColourPlane],
  ["table-off-by-one", brokenTableOffByOne],
];

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT in the crafted sweep`, { skip }, () => {
    const caught = sweepCaught(twin);
    assert.ok(caught > 0, `the sweep PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${SWEEP_SIZE} crafted entries`);
  });
}
