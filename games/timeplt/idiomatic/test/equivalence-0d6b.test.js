// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintHighScoreReadout — memory-equivalent to the frozen oracle at ROM 0x0D6B.
 *
 * Three constants and a fall-through into the six-digit readout printer at ROM 0x0D73 (already
 * decompiled): the tally to print (from its highest byte, because the printer walks downward), the
 * cell its leftmost digit lands in, and the digit colour. The rewrite calls paintSixDigitFieldSuppressingLeadingZeros directly;
 * dissolving that transfer is this caller's unit, and the printer is gated by its own file, so what
 * this file gates is the CHOICE of the three arguments and the dissolve.
 *
 * The oracle reaches the printer through `m.call`, so the printer's body pushes return addresses
 * below the entry seat and takes a return the direct call never takes — leaving DEAD STACK SCRATCH
 * below the seat and moving a, f, sp and pc (the declared ceiling). The window is MEASURED, not
 * assumed: the WINDOW arm instruments the oracle's own `push16` at the captured entry and every
 * dispatch and reports the deepest stack pointer reached. Every other arm walks the whole dump and
 * masks ONLY that window.
 *
 * Strict unit-capture at the real dispatch with the printer RUNNING, plus the argument triple
 * PINNED as values, plus a corpus and teeth. The PINNED arm records the triple off the ORACLE by
 * replacing the printer in the routine registry, and requires the module's own text to name the
 * same three constants (a sibling entry's text is the control).
 *   ★ HOLE: the registry recorder reaches the ORACLE only. The rewrite's transfer is a direct call
 *   no registry entry can intercept, so the candidate side of the argument comparison is carried by
 *   the masked whole-RAM diff at the real dispatch and over the corpus — the printer runs for real
 *   on both arms and every cell it touches is compared — and by the twins.
 *
 * HOLE: one dispatch per session, at one point in the sequence, so nothing exercises the printer
 * against a different screen state. HOLE: nothing here establishes what the tally being printed IS.
 * This gate pins pc but leaves sp in the excluded set, so a rewrite that leaked stack without
 * writing memory passes here.
 * No gate now owns that: the whole-game gate idiomatic.test.js compares memory only, outside the
 * stack window, under an engine that leaves SP unused.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0d6b.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { assertDeadAtExit, TAPE_SESSIONS } from "./_deadAtExit.js";
import { paintHighScoreReadout } from "../paintHighScoreReadout.js";
import { paintSixDigitFieldSuppressingLeadingZeros } from "../paintSixDigitFieldSuppressingLeadingZeros.js";
import { loc_0d6b as oracle } from "../../translated/loc_0d6b.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x0d6b;
const PRINTER = 0x0d73;
const CORPUS_FRAMES = 2500;

/** The triple this entry exists to choose, asserted as values rather than merely compared. */
const TALLY_TOP_BYTE = 0xa98d;
const FIRST_DIGIT_CELL = 0xa641;
const DIGIT_COLOUR = 0x10;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 8;

/** The ceiling on divergence: a BOUND, not a demand — a rewrite diverging on fewer still passes. */
/**
 * c (the pen colour) is NOT a live-out: the printer now takes its colour as an argument, so the rewrite
 * leaves c alone where the oracle leaves the colour in it. Measured on the ORACLE by the DEAD AT EXIT
 * arm below, over every tape session (each reaches the return at 0x162C once): c complemented where
 * this entry hands back is heard nowhere.
 * The other caller's continuation (0x0CDA) reloads a and reaches the 1-UP/2-UP readouts, which
 * seat their own colour, without reading c.
 */
const MOVED = ["a", "f", "sp", "c"];

const TAPES = [
  ["driven", {}],
  ["attract", { tape: [] }],
];
const DISPATCHES = { driven: 1, attract: 1 };

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The module's text against the printer it is supposed to CALL. The printer is identified by a
 * name out of its own body; the module must name the printer's file, call it, and NOT carry that
 * name. The same predicate runs over the printer itself as a positive control, so the absence is
 * evidence only once the check is shown able to see the thing present.
 */
const HELPER = ["paintSixDigitFieldSuppressingLeadingZeros", "../paintSixDigitFieldSuppressingLeadingZeros.js", "paintTwoSuppressedDigitsFromByte"];

function callsRatherThanRestates(text, [name, file, ownName]) {
  return text.includes(`from "./${file.slice(3)}"`) &&
    text.includes(`${name}(m`) &&
    !text.includes(ownName);
}

/** The module must name all three of the ROM's constants, not merely some of them. */
function namesTheTriple(text) {
  // The tally byte 0xA98D is imported by its goal-3 name HIGH_SCORE_HI and the destination cell is now
  // imported by its address-retrofit name, so accept either the imported name or the raw literal for
  // each; the colour is still a literal in the module. The sibling readout names a DIFFERENT tally (its
  // own player-score cell) and a different destination, so it matches no form and still fails the check.
  const hasTally = text.includes("HIGH_SCORE_HI") || text.includes("0x" + TALLY_TOP_BYTE.toString(16));
  const hasCell = text.includes("HIGH_SCORE_READOUT_BASE") || text.includes("0x" + FIRST_DIGIT_CELL.toString(16));
  return hasTally && hasCell && text.includes("0x" + DIGIT_COLOUR.toString(16));
}

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => {
  if (!d) return "identical";
  return d.addr === null
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    makeMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) gate(paintHighScoreReadout);
  return entry;
}

/** A clone whose printer is a recorder. Reaches the ORACLE only — see the PINNED arm's hole. */
function severed(machine, log) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  c.routines.set(PRINTER, (mm) => {
    log.push({ source: mm.regs.hl, destination: mm.regs.de, colour: mm.regs.c });
  });
  return c;
}

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The masked window, and nothing else: the bytes the oracle's own pushes reach and no others. */
function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/**
 * Oracle vs candidate on clones of `machine`, with the printer running on both: the whole state
 * dump masked to the measured window, then every register outside the ceiling. A candidate that
 * raises rather than writing counts as caught; only the candidate's side is wrapped, because a
 * raise from the oracle is a harness fault and must not be swallowed.
 */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, reg: "raised", a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** How far below its seat the oracle's own pushes take the stack pointer, on one entry state. */
function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  let deepest = 0;
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      deepest = Math.max(deepest, oracleDepth(mm));
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, deepest };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, paintHighScoreReadout) }));
  return sessionCache;
}

// ── teeth ───────────────────────────────────────────────────────────────────────────────
// Each is the module with one thing wrong, via a DIRECT call to the printer — not `m.call`, which
// would match the oracle's stack traffic, never be masked, and let the teeth pass unexercised.

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: prints one of the OTHER two siblings' tallies. */
function brokenWrongSource(m) {
  m.regs.de = FIRST_DIGIT_CELL;
  m.regs.hl = 0xad35;
  m.regs.c = DIGIT_COLOUR;
  paintSixDigitFieldSuppressingLeadingZeros(m);
}

/** BUG: prints into one of the other siblings' screen positions. */
function brokenWrongDestination(m) {
  m.regs.de = 0xa781;
  m.regs.hl = TALLY_TOP_BYTE;
  m.regs.c = DIGIT_COLOUR;
  paintSixDigitFieldSuppressingLeadingZeros(m);
}

/** BUG: picks a different colour for the digits. */
function brokenWrongColour(m) {
  m.regs.de = FIRST_DIGIT_CELL;
  m.regs.hl = TALLY_TOP_BYTE;
  m.regs.c = DIGIT_COLOUR + 1;
  paintSixDigitFieldSuppressingLeadingZeros(m);
}

/** BUG: walks the tally upward from its lowest byte instead of down from its highest. */
function brokenLowestByteFirst(m) {
  m.regs.de = FIRST_DIGIT_CELL;
  m.regs.hl = TALLY_TOP_BYTE - 2;
  m.regs.c = DIGIT_COLOUR;
  paintSixDigitFieldSuppressingLeadingZeros(m);
}

/** BUG: fixes the arguments and never transfers, so nothing is printed. */
function brokenSkipsThePrinter(m) {
  m.regs.de = FIRST_DIGIT_CELL;
  m.regs.hl = TALLY_TOP_BYTE;
  m.regs.c = DIGIT_COLOUR;
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["wrong-source", brokenWrongSource],
  ["wrong-destination", brokenWrongDestination],
  ["wrong-colour", brokenWrongColour],
  ["lowest-byte-first", brokenLowestByteFirst],
  ["skips-the-printer", brokenSkipsThePrinter],
];

/**
 * The BOUNDARY arm's probe: the ORACLE ITSELF, plus one byte flipped at `sp + offset`. Built on
 * the oracle rather than on the rewrite so that what the arm reports is a property of the MASK
 * alone — a broken rewrite must fail the arms that judge the rewrite, not be re-reported here as
 * a mis-placed window.
 */
function scribbler(offset) {
  return (m) => {
    const at = (m.regs.sp + offset) & 0xffff;
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the measured window", { skip }, () => {
  gate(paintHighScoreReadout);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  paintHighScoreReadout(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: seat ${hex4(sp)}; ${all.length} differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k] && !MOVED.includes(k)),
    [],
    "a register outside the declared ceiling diverged",
  );
  assert.equal(b.pc, e.pc, "the dissolved chain never steps, so the rewrite leaves pc where it " +
    "found it; the oracle's pc is its caller's return address instead");
});

test("WINDOW: the oracle's own deepest push, measured at the entry and every dispatch", { skip }, () => {
  const seen = sessions();
  const deepest = Math.max(oracleDepth(entryState()), ...seen.map((s) => s.deepest));
  console.log(
    `  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat — ` +
      `${seen.map((s) => `${s.label} ${s.deepest}`).join(", ")}`,
  );
  for (const s of seen) assert.ok(s.dispatches > 0, `vacuous: ${s.label} never dispatched`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const sp = entryState().regs.sp;
  const below = unitDiff(scribbler(-SCRATCH_BYTES - 1), entryState());
  const seat = unitDiff(scribbler(0), entryState());
  const inside = unitDiff(scribbler(-1), entryState());
  console.log(
    `  BOUNDARY: ${hex4(sp - SCRATCH_BYTES - 1)} caught, ${hex4(sp)} caught, ` +
      `${hex4(sp - 1)} masked`,
  );
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed, so the " +
    "exclusion is wider than it declares and a leaking stack pointer would walk out of sight");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed: the window must lie " +
    "strictly below the seat, and live stack above it must still fail");
  assert.equal(inside, null, "a divergence INSIDE the window was caught, so the two catches above " +
    "are the instrument catching everything rather than the boundary being where it says");
});

test("PINNED: the ROM's argument triple, and the module names the same three", { skip }, () => {
  const log = [];
  const a = severed(entryState(), log);
  oracle(a);
  assert.equal(log.length, 1, "vacuous: the recorder is not wired — the oracle did not reach it");
  assert.deepEqual(
    log[0],
    { source: TALLY_TOP_BYTE, destination: FIRST_DIGIT_CELL, colour: DIGIT_COLOUR },
    "the argument triple moved, so the constants this file names are no longer the ROM's",
  );
  assert.equal(
    allDiffs(entryState(), a).length,
    0,
    "with the printer severed the oracle may write nothing at all",
  );
  // The text check is only evidence if it can tell one module from another. A sibling entry
  // chooses a different tally and a different cell, and must FAIL the same predicate.
  assert.ok(namesTheTriple(read("../paintHighScoreReadout.js")), "the module does not name the ROM's triple");
  assert.ok(!namesTheTriple(read("../paintPlayerOneScoreReadout.js")), "a sibling entry that chooses a different " +
    "tally and cell passes the same text check, so the check proves nothing");
  console.log(
    `  PINNED: source=${hex4(TALLY_TOP_BYTE)} destination=${hex4(FIRST_DIGIT_CELL)} ` +
      `colour=${DIGIT_COLOUR}, named by the module and recorded off the oracle`,
  );
});

/** Which registers a candidate parts company with the oracle on, at the captured entry. */
function movedOver(candidate) {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  try {
    candidate(b);
  } catch {
    return new Set();
  }
  return new Set(REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]));
}

/** Frames each TAPE_SESSIONS session runs for the DEAD AT EXIT arm. */
const DEAD_FRAMES = 2500;

test("DEAD AT EXIT: on the frozen game, c is dead where this entry hands back", { skip }, () => {
  assertDeadAtExit({ at: TARGET, poison: ["c"], sessions: TAPE_SESSIONS, frames: DEAD_FRAMES });
});

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(paintHighScoreReadout);
  // The absence below is only evidence if the same measurement CAN report a register outside the
  // ceiling. The wrong-destination twin leaves the cursor elsewhere, and the control says so.
  const control = movedOver(brokenWrongDestination);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
    "the measurement reports nothing outside the ceiling even for a twin that moves the cursor, " +
      "so a clean reading below proves nothing");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${MOVED.join(", ")}; the control twin also moves ` +
    `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
  // MOVED is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

test("CORPUS: the one dispatch of each session replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} tape never reached the routine`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} dispatches over two sessions, identical outside the window`);
});

test("CALLS, NOT RESTATES: the module's text, with the printer as a positive control", () => {
  const module = read("../paintHighScoreReadout.js");
  assert.ok(callsRatherThanRestates(module, HELPER), `the module does not call ${HELPER[0]}`);
  assert.ok(!callsRatherThanRestates(read(HELPER[1]), HELPER), `the check passes ${HELPER[0]}'s ` +
    "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  console.log(`  CALLS, NOT RESTATES: ${HELPER[0]} is called, and its own body fails the same check`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT at the real dispatch`, { skip }, () => {
    const d = unitDiff(twin, entryState());
    assert.notEqual(d, null, `the masked gate PASSED the ${label} twin — it has no teeth`);
    assert.notEqual(d.addr, null, `the ${label} twin is caught on a register alone, so nothing ` +
      "says the cells it prints into are wrong");
    console.log(`  TEETH/${label}: caught — ${show(d)}`);
  });
}
