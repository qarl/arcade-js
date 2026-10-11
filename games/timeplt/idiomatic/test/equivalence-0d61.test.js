// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintPlayerTwoScoreReadout — memory-equivalent to the frozen oracle at ROM 0x0D61.
 *
 * Three constants and a tail transfer to the shared digit painter at ROM 0x0D73 (already
 * decompiled): the first character-plane cell, the high end of the packed-decimal field walked
 * downward, and the pen colour. The rewrite calls paintSixDigitFieldSuppressingLeadingZeros directly; dissolving that transfer is
 * this caller's unit, and the painter is gated by its own file, so what this file gates is the
 * CHOICE of the three arguments and the dissolve.
 *
 * CRAFTED-ENTRY, because no dispatch of 0x0D61 exists to capture: the shared coin->start tape is
 * one-player, and the caller picks between this entry and its sibling 0x0D57 on a cell the tape
 * never sets. The UNREACHED arm runs the whole tape with a counting hook and asserts zero
 * dispatches, so the crafting is forced. The entry state is a REAL machine, captured at a live
 * dispatch of that sibling, with this routine run on clones of it.
 *
 * The oracle reaches the painter through `m.call`, so the painter's body pushes return addresses
 * below the entry seat and takes a return the direct call never takes — leaving DEAD STACK SCRATCH
 * below the seat and moving a, f, sp and pc (the declared ceiling). The window is MEASURED, not
 * assumed: the WINDOW arm instruments the oracle's own `push16` over the whole sweep and reports
 * the deepest stack pointer reached. Every other arm walks the whole dump and masks ONLY that window.
 *
 * Both planes are filled with a marker so every painted cell is visible, and the two adjacent
 * fields are loaded with different digits so a wrong-field twin diverges at a painted cell rather
 * than in masked scratch. Every twin is required to be caught inside the planes.
 *
 * HOLE: one captured machine, and it is the sibling's dispatch, so the surrounding state is one
 * this entry is never really called with. Position and colour are constants; the twins vary them.
 * This gate pins pc but leaves sp in the excluded set, so a rewrite that leaked stack without
 * writing memory passes here.
 * No gate now owns that: the whole-game gate idiomatic.test.js compares memory only, outside the
 * stack window, under an engine that leaves SP unused.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0d61.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { assertDeadAtExit, TAPE_SESSIONS } from "./_deadAtExit.js";
import { paintPlayerTwoScoreReadout } from "../paintPlayerTwoScoreReadout.js";
import { paintSixDigitFieldSuppressingLeadingZeros } from "../paintSixDigitFieldSuppressingLeadingZeros.js";
import { loc_0d61 as oracle } from "../../translated/loc_0d61.js";
import { loc_0d57 as sibling } from "../../translated/loc_0d57.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x0d61;
const SIBLING = 0x0d57;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const FIRST_CELL = 0xa501;
const FIELD_HIGH_END = 0xad38;
const FIELD_BYTES = 3;
const COLOUR = 0x10;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 8;

/** The ceiling on divergence: a BOUND, not a demand — a rewrite diverging on fewer still passes. */
/**
 * c (the pen colour) is NOT a live-out: the painter now takes its colour as an argument, so the rewrite
 * leaves c alone where the oracle leaves the colour in it. Measured on the ORACLE by the DEAD AT EXIT
 * arm below, over every tape session (only tapes/two-player.poke.json reaches this entry, once): c
 * complemented where this entry hands back is heard only as the vblank service's saved copy of BC in
 * the stack page (VBLANK_SAVED_BC), never in game state.
 */
const MOVED = ["a", "f", "sp", "c"];
/** Where the vblank service (0x00D9) pushes BC on entry and pops it back: a poisoned C shows here as a
 * saved copy and nowhere else, so this one stack-page cell is scratch to DEAD AT EXIT. */
const VBLANK_SAVED_BC = 0xaffa;

const COLOUR_PLANE = 0xa000;
const CHARACTER_PLANE = 0xa400;
const PLANE_BYTES = 0x400;
const POISON = 0x5a;
/** Two packed-decimal fields that share no digit, so reading the wrong one shows. */
const MINE_DIGITS = [0x12, 0x34, 0x56];
const OTHER_DIGITS = [0x98, 0x76, 0x54];

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The module's text against the painter it is supposed to CALL. The painter is identified by a
 * name out of its own body; the module must name the painter's file, call it, and NOT carry that
 * name. The same predicate runs over the painter itself as a positive control, so the absence is
 * evidence only once the check is shown able to see the thing present.
 */
const HELPER = ["paintSixDigitFieldSuppressingLeadingZeros", "../paintSixDigitFieldSuppressingLeadingZeros.js", "paintTwoSuppressedDigitsFromByte"];

function callsRatherThanRestates(text, [name, file, ownName]) {
  return text.includes(`from "./${file.slice(3)}"`) &&
    text.includes(`${name}(m`) &&
    !text.includes(ownName);
}

let entry = null;

/** A real machine, taken at a live dispatch of the sibling entry. */
function entryState() {
  if (entry === null) {
    const ov = new Map([
      [SIBLING, (mm) => {
        if (entry === null) entry = mm.clone();
        return sibling(mm);
      }],
    ]);
    makeMachine(ov).runFrames(ENTRY_FRAMES);
    assert.notEqual(entry, null, `the sibling at 0x0d57 never dispatched in ${ENTRY_FRAMES}`);
  }
  return entry;
}

function poisoned() {
  const mm = entryState().clone();
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) mm.mem8[a] = POISON;
  for (let i = 0; i < FIELD_BYTES; i++) {
    mm.mem8[FIELD_HIGH_END - i] = MINE_DIGITS[i];
    mm.mem8[FIELD_HIGH_END - FIELD_BYTES - i] = OTHER_DIGITS[i];
  }
  return mm;
}

/** A clone of the crafted entry with the packed-decimal field loaded from `bytes`. */
function withField(bytes) {
  const mm = entryState().clone();
  for (let i = 0; i < FIELD_BYTES; i++) mm.mem8[FIELD_HIGH_END - i] = bytes[i];
  return mm;
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
 * Oracle vs candidate on clones: the whole dump masked to the window, then registers outside the
 * ceiling. A raising candidate is caught; only its side is wrapped (an oracle raise is a harness fault).
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

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => {
  if (!d) return "identical";
  return d.addr === null
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

const FIELD_CASES = [];
for (let hi = 0; hi < 256; hi += 17) FIELD_CASES.push([hi, (hi * 7) & 0xff, (hi * 13) & 0xff]);
FIELD_CASES.push([0, 0, 0], [0x99, 0x99, 0x99], [0xff, 0xff, 0xff], [0x0a, 0xbc, 0xde]);

/** Every machine this file compares on. What the WINDOW arm measures the oracle over. */
function sweep() {
  return [entryState(), poisoned(), ...FIELD_CASES.map(withField)];
}

// ── broken twins ────────────────────────────────────────────────────────────────────────
// Each is the module with one constant wrong, via a DIRECT call to the painter — not `m.call`,
// which would match the oracle's stack traffic, never be masked, and let the teeth pass unexercised.

/** BUG: does nothing. */
function brokenNoOp() {}

/** BUG: starts the run one cell further along the line. */
function brokenWrongCell(m) {
  const { regs } = m;
  regs.de = FIRST_CELL + 1;
  regs.hl = FIELD_HIGH_END;
  regs.c = COLOUR;
  paintSixDigitFieldSuppressingLeadingZeros(m);
}

/** BUG: reads the other player's field. */
function brokenWrongField(m) {
  const { regs } = m;
  regs.de = FIRST_CELL;
  regs.hl = FIELD_HIGH_END - FIELD_BYTES;
  regs.c = COLOUR;
  paintSixDigitFieldSuppressingLeadingZeros(m);
}

/** BUG: lays down a different colour beside every cell. */
function brokenWrongColour(m) {
  const { regs } = m;
  regs.de = FIRST_CELL;
  regs.hl = FIELD_HIGH_END;
  regs.c = COLOUR + 1;
  paintSixDigitFieldSuppressingLeadingZeros(m);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["wrong-cell", brokenWrongCell],
  ["wrong-field", brokenWrongField],
  ["wrong-colour", brokenWrongColour],
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

test("UNREACHED: the shared tape never dispatches this address", { skip }, () => {
  let hits = 0;
  let siblingHits = 0;
  const ov = new Map([
    [TARGET, (mm) => { hits++; return oracle(mm); }],
    [SIBLING, (mm) => { siblingHits++; return sibling(mm); }],
  ]);
  makeMachine(ov).runFrames(ENTRY_FRAMES);
  assert.ok(siblingHits > 0, "the counting hook is not wired: even the sibling shows no hits");
  assert.equal(hits, 0, "the tape DOES reach this entry now — capture it instead of crafting");
  console.log(`  UNREACHED: 0 dispatches in ${ENTRY_FRAMES} frames (sibling: ${siblingHits})`);
});

test("EQUAL on the crafted entry: identical outside the measured window", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  paintPlayerTwoScoreReadout(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: real machine taken at the sibling's dispatch, seat ${hex4(sp)}; ${all.length} ` +
      `differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
  assert.equal(b.pc, e.pc, "the dissolved chain never steps, so the rewrite leaves pc where it " +
    "found it; the oracle's pc is its caller's return address instead");
});

test("WINDOW: the oracle's own deepest push, measured over the whole sweep", { skip }, () => {
  let deepest = 0;
  for (const m of sweep()) deepest = Math.max(deepest, oracleDepth(m));
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
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

test("PAINTS: over a poisoned plane the run really appears, in both planes", { skip }, () => {
  const after = poisoned();
  oracle(after);
  const glyphs = [];
  const colours = [];
  for (let a = COLOUR_PLANE; a < CHARACTER_PLANE + PLANE_BYTES; a++) {
    if (after.mem8[a] === POISON) continue;
    (a >= CHARACTER_PLANE ? glyphs : colours).push(a);
  }
  assert.ok(glyphs.length > 0, "no character cell was written: this gate has no teeth");
  assert.ok(colours.length > 0, "no colour cell was written: the colour argument is untested");
  assert.ok(
    colours.every((a) => after.mem8[a] === COLOUR),
    "a colour cell was written with something other than the colour this entry fixes",
  );
  console.log(
    `  PAINTS: ${glyphs.length} character cells from ${hex4(glyphs[0])}, ` +
      `${colours.length} colour cells from ${hex4(colours[0])}`,
  );
});

/** Which registers a candidate parts company with the oracle on, over the whole sweep. */
function movedOver(candidate) {
  const moved = new Set();
  for (const m of sweep()) {
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    try {
      candidate(b);
    } catch {
      continue;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

/** Frames each TAPE_SESSIONS session runs for the DEAD AT EXIT arm. */
const DEAD_FRAMES = 2500;

test("DEAD AT EXIT: on the frozen game, c is dead where this entry hands back", { skip }, () => {
  assertDeadAtExit({ at: TARGET, poison: ["c"], sessions: TAPE_SESSIONS, frames: DEAD_FRAMES, scratch: [VBLANK_SAVED_BC] });
});

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(paintPlayerTwoScoreReadout);
  // The absence below is only evidence if the same measurement CAN report a register outside the
  // ceiling. The wrong-cell twin leaves the cursor elsewhere, and the control asserts it is seen.
  const control = movedOver(brokenWrongCell);
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

test("PRIORS: the same run is painted for every field value tried", { skip }, () => {
  for (const bytes of FIELD_CASES) {
    const d = unitDiff(paintPlayerTwoScoreReadout, withField(bytes));
    assert.equal(d, null, `field=${bytes.join(",")}: ${show(d)}`);
  }
  console.log(`  PRIORS: ${FIELD_CASES.length} field values identical outside the window`);
});

test("CALLS, NOT RESTATES: the module's text, with the painter as a positive control", () => {
  const module = read("../paintPlayerTwoScoreReadout.js");
  assert.ok(callsRatherThanRestates(module, HELPER), `the module does not call ${HELPER[0]}`);
  assert.ok(!callsRatherThanRestates(read(HELPER[1]), HELPER), `the check passes ${HELPER[0]}'s ` +
    "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  console.log(`  CALLS, NOT RESTATES: ${HELPER[0]} is called, and its own body fails the same check`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT, at a plane cell`, { skip }, () => {
    const d = unitDiff(twin, poisoned());
    assert.notEqual(d, null, `the masked comparison PASSED the ${label} twin — it has no teeth`);
    assert.notEqual(d.addr, null, `the ${label} twin is caught on a register alone, so nothing ` +
      "says the cells it paints are wrong");
    assert.ok(
      d.addr >= COLOUR_PLANE && d.addr < CHARACTER_PLANE + PLANE_BYTES,
      `the ${label} twin diverges first at ${hex4(d.addr)}, outside the two planes — the ` +
        "teeth would then rest on stack scratch rather than on anything painted",
    );
    console.log(`  TEETH/${label}: caught at a plane cell — ${show(d)}`);
  });
}
