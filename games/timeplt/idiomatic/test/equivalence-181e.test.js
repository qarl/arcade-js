// SPDX-License-Identifier: GPL-3.0-only
/**
 * parkSpritesAndArmLineWipeThenAdvanceSequence — memory-equivalent to the frozen oracle at ROM 0x181E.
 *
 * WHAT IT IS. One step of a screen-clearing sequence: every sprite parked out of sight, one
 * character cell's glyph and colour copied into a fixed record, the line wipe armed, and the
 * sequence's inner index stepped. All four routines it reaches are already decompiled, so every
 * call and the closing transfer are dissolved into direct calls in the rewrite.
 *
 * ★ IT IS AN ARM OF AN INLINE JUMP TABLE, not a call target, and the REACHED arm derives that from
 *   the image rather than taking it on trust. Every absolute call, jump and sixteen-bit load
 *   carries its target as a little-endian word, and so does a table pointer, so one scan over every
 *   byte offset covers all of them; the relative forms are scanned apart. The address is spelled
 *   exactly twice: once as the first word of the table just past 0x17FE, and once straddling two
 *   entries of an unrelated run of byte pairs, whose structure is asserted so that the second hit
 *   is shown not to be a pointer rather than waved away. A control address the image plainly calls
 *   is scanned alongside, so a quiet zero cannot pass for a finding.
 *
 * ★ HOW THIS FILE HANDLES THE MISSING RETURN, and why the neighbouring entry's reasoning is NOT
 *   reused. 0x17FE omits a push its own oracle performs, because the arm it dispatches returns
 *   through the slot it would have pushed. THIS file is that arm, and its position is different:
 *   its oracle ends by transferring into a routine that returns for it, so the oracle nets exactly
 *   one return and the rewrite performs none — the plain omitted-return shape. It parks nothing,
 *   because every routine it reaches is already lifted, so no still-frozen callee is left waiting
 *   for a slot to pop. The candidate is therefore run THROUGH the dispatch seam, which MEASURES
 *   what the rewrite did to the stack and throws if it is neither recognised shape, and SP and pc
 *   are compared for EQUALITY below. Nothing in this file asserts that the candidate DIFFERS from
 *   the oracle anywhere.
 *
 * ★ THE REAL ENTRY IS PARTLY IDEMPOTENT and the gate says so instead of hiding it: the record this
 *   entry copies into ALREADY holds the glyph and colour it is about to write, so the copy is
 *   invisible there and only the crafted entries hold it. The IDEMPOTENT arm asserts that, and the
 *   twin that drops the copy is recorded as caught by the crafted cross and by no real dispatch.
 *
 * GATE: crafted-entry over the four things this entry reads or overwrites, plus the single real
 *   dispatch, a whole-machine replay wired through the seam, and teeth. The crafted CROSS carries a
 *   subset-bounded register CEILING (SP, pc and both index registers asserted outside it), and the
 *   EFFECTS arm shows the oracle reaches all four of its parts so no one-part entry passes for
 *   coverage.
 *
 * HOLE: one captured machine and one dispatch. What the sequence does either side of this step is
 * not exercised, and neither is a second visit — the game makes exactly one in the corpus budget.
 * HOLE: the sampled record's consumer is not reached here, so nothing in this file says what the
 * copied pair is later used for.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-181e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { parkSpritesAndArmLineWipeThenAdvanceSequence } from "../parkSpritesAndArmLineWipeThenAdvanceSequence.js";
import { loc_181e as oracle } from "../../translated/loc_181e.js";
import { BLANK_LINES_LEFT, BLANK_LINE_CURSOR, SEQUENCE_SUBSTEP } from "../names.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import { armLineWipeFromFifthLine } from "../armLineWipeFromFifthLine.js";
import { hideAllSprites } from "../hideAllSprites.js";
import { sampleCellGlyphAndColour } from "../sampleCellGlyphAndColour.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x181e;

/** The inline word table the neighbouring dispatcher indexes, and the slot this entry sits in. */
const ARM_TABLE = 0x1806;
const ARM_INDEX = 0;

const PROGRAM_BYTES = 0x6000;
const RELATIVE_OPCODES = [0x10, 0x18, 0x20, 0x28, 0x30, 0x38];
/** Reached by an ordinary call, so the branch scan below has something it must find. */
const CALLED_CONTROL = 0x3deb;

/**
 * The word scan finds this entry's address a second time, and it is NOT a reference: it straddles
 * two entries of a run of byte pairs whose second byte is constant and whose first counts down. The
 * REACHED arm asserts that structure rather than waving the hit away, because a hit that is not
 * checked is the same size on the page as one that is.
 */
const COINCIDENTAL_HIT = 0x02e7;
const PAIR_RUN_FROM = 0x02e0;
const PAIR_RUN_TO = 0x02f0;
const PAIR_CONSTANT = 0x1e;

const SAMPLED_CELL = 0xa5fc;
const COLOUR_PLANE_CELL = 0xa1fc;
const SAMPLE_RECORD = 0xacbe;
const FIRST_SLOT_NATIVE_Y = 0xaa41;
const SLOT_STRIDE = 2;
const SLOT_COUNT = 24;
const WIPE_FIRST_CELL = 0xa404;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

/** Measured: the widest divergence below the entry stack pointer, over the corpus and the cross. */
const SCRATCH_BYTES = 2;

/**
 * A CEILING on the registers that may differ, not a pin. Membership is asserted as a subset, so a
 * rewrite that happens to agree on one of these still passes; what is asserted positively is that
 * SP, pc and the two index registers are NOT in it.
 */
const MAY_MOVE = ["a", "f", "b", "c", "d", "e", "h", "l"];
const HELD = ["ix", "iy", "sp"];

const CORPUS_FRAMES = 2000;
const SESSIONS = [
  ["coin-start", {}],
  ["demo", { tape: [] }],
];
/** Measured over CORPUS_FRAMES. The sequence reaches this step ONCE, and the demo never does. */
const DISPATCHES = { "coin-start": 1, demo: 0 };

/**
 * Measured: the dead stack bytes a whole wired session leaves differing. The lower pair is this
 * entry's own call bracket, which the oracle writes and the rewrite does not. The upper pair is
 * interrupt residue: the rewrite spends no cycles, so the interrupt lands between different
 * instructions and its pushed bytes come to rest at a different depth, popped again before any
 * frame is sampled.
 */
const SESSION_SCRATCH = [0xafe4, 0xafe5, 0xaffd, 0xaffe];
const STACK_FLOOR = 0xaf00;
const STACK_TOP = 0xb000;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** The candidate as an assembled run reaches it: through the seam that supplies the omitted return. */
const seam = (candidate) => withOmittedRet(candidate, TARGET);

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

/** Oracle vs seam-wrapped candidate on two clones: masked RAM, then SP, then pc. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  seam(candidate)(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.sp !== b.regs.sp) return { addr: null, key: "sp", a: a.regs.sp, b: b.regs.sp };
  if (a.pc !== b.pc) return { addr: null, key: "pc", a: a.pc, b: b.pc };
  return null;
}

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the coin-then-start tape never reached the routine");
  return entry;
}

/** A real captured machine with one or more of the cells this entry reads or overwrites forced. */
function craft(edit) {
  const m = entryState().clone();
  const { glyph, colour, record, band, substep, wipeLeft, wipeCursor } = edit;
  if (glyph !== undefined) m.mem8[SAMPLED_CELL] = glyph;
  if (colour !== undefined) m.mem8[COLOUR_PLANE_CELL] = colour;
  if (record !== undefined) {
    m.mem8[SAMPLE_RECORD] = record[0];
    m.mem8[SAMPLE_RECORD + 1] = record[1];
  }
  if (band !== undefined) {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      m.mem8[FIRST_SLOT_NATIVE_Y + slot * SLOT_STRIDE] = band(slot);
    }
  }
  if (substep !== undefined) m.mem8[SEQUENCE_SUBSTEP] = substep;
  if (wipeLeft !== undefined) m.mem8[BLANK_LINES_LEFT] = wipeLeft;
  if (wipeCursor !== undefined) m.mem16[BLANK_LINE_CURSOR] = wipeCursor;
  return m;
}

const GLYPHS = [0, 1, 56, 165, 241, 255];
const COLOURS = [0, 5, 16, 255];
const MARKER = [0xaa, 0xbb];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [["as captured", {}]];
  for (const glyph of GLYPHS) {
    for (const colour of COLOURS) {
      out.push([`glyph ${glyph} colour ${colour}`, { glyph, colour, record: MARKER }]);
    }
  }
  for (const record of [[0, 0], [255, 255], [56, 5]]) {
    out.push([`record already ${record.join("/")}`, { record }]);
  }
  out.push(["band all clear", { band: () => 0 }]);
  out.push(["band all set", { band: () => 255 }]);
  out.push(["band ascending", { band: (slot) => slot + 1 }]);
  out.push(["band descending", { band: (slot) => 255 - slot }]);
  for (const substep of [0, 1, 5, 127, 254, 255]) out.push([`substep ${substep}`, { substep }]);
  out.push(["wipe cells clear", { wipeLeft: 0, wipeCursor: 0 }]);
  out.push(["wipe cells set", { wipeLeft: 255, wipeCursor: 0xffff }]);
  out.push(["wipe already armed", { wipeLeft: 27, wipeCursor: WIPE_FIRST_CELL }]);
  crossCache = out;
  return out;
}

const craftedCaught = (candidate) =>
  cross().filter(([, edit]) => unitDiff(candidate, craft(edit)) !== null).length;

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = SESSIONS.map(([label, opts]) => ({ label, ...replaySession(opts, parkSpritesAndArmLineWipeThenAdvanceSequence) }));
  }
  return sessionCache;
}

function wholeRunCells(candidate) {
  const base = makeMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(new Map([[TARGET, seam((mm) => (fired++, candidate(mm)))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 90);
  }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(base.stateOffsetToAddr(o));
    }
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => base.stateOffsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the sprites are left where they were, so the old picture shows through the wipe. */
function brokenNoHide(m) {
  sampleCellGlyphAndColour(m, SAMPLED_CELL, SAMPLE_RECORD);
  armLineWipeFromFifthLine(m);
  advanceSequenceSubStep(m);
}

/** BUG: the cell is never copied, so the record keeps whatever it held. */
function brokenNoSample(m) {
  hideAllSprites(m);
  armLineWipeFromFifthLine(m);
  advanceSequenceSubStep(m);
}

/** BUG: the wipe is never armed, so nothing blanks the plane afterwards. */
function brokenNoArm(m) {
  hideAllSprites(m);
  sampleCellGlyphAndColour(m, SAMPLED_CELL, SAMPLE_RECORD);
  advanceSequenceSubStep(m);
}

/** BUG: the sequence never steps, so this step runs again on the next tick. */
function brokenNoAdvance(m) {
  hideAllSprites(m);
  sampleCellGlyphAndColour(m, SAMPLED_CELL, SAMPLE_RECORD);
  armLineWipeFromFifthLine(m);
}

/** BUG: the two planes change places, so the record holds the colour first and the glyph second. */
function brokenPlanesSwapped(m) {
  hideAllSprites(m);
  sampleCellGlyphAndColour(m, COLOUR_PLANE_CELL, SAMPLE_RECORD);
  armLineWipeFromFifthLine(m);
  advanceSequenceSubStep(m);
}

/** BUG: the copy lands one byte along, so it half-overwrites its neighbour instead. */
function brokenRecordOffByOne(m) {
  hideAllSprites(m);
  sampleCellGlyphAndColour(m, SAMPLED_CELL, SAMPLE_RECORD + 1);
  armLineWipeFromFifthLine(m);
  advanceSequenceSubStep(m);
}

/** BUG: the neighbouring cell is sampled, so the record describes the wrong place on screen. */
function brokenCellOffByOne(m) {
  hideAllSprites(m);
  sampleCellGlyphAndColour(m, SAMPLED_CELL + 1, SAMPLE_RECORD);
  armLineWipeFromFifthLine(m);
  advanceSequenceSubStep(m);
}

/**
 * Measured: how many crafted entries each twin is caught on, and whether the ONE real dispatch
 * catches it. One of them it cannot, and that is recorded here rather than glossed.
 */
const TWINS = [
  ["no-op", brokenNoOp, 41, true],
  ["no-hide", brokenNoHide, 40, true],
  ["no-sample", brokenNoSample, 26, false],
  ["no-arm", brokenNoArm, 40, true],
  ["no-advance", brokenNoAdvance, 41, true],
  ["planes-swapped", brokenPlanesSwapped, 39, true],
  ["record-off-by-one", brokenRecordOffByOne, 41, true],
  ["cell-off-by-one", brokenCellOffByOne, 40, true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

/** Every offset in the program image where the little-endian word for `addr` appears. */
function wordOffsets(image, addr) {
  const low = addr & 0xff;
  const high = (addr >> 8) & 0xff;
  const out = [];
  for (let at = 0; at < PROGRAM_BYTES - 1; at++) if (image[at] === low && image[at + 1] === high) out.push(at);
  return out;
}

/** Every offset holding a relative-branch opcode whose displacement lands on `addr`. */
function relativeOffsets(image, addr) {
  const out = [];
  for (let at = 0; at < PROGRAM_BYTES - 1; at++) {
    if (!RELATIVE_OPCODES.includes(image[at])) continue;
    if (((at + 2 + ((image[at + 1] << 24) >> 24)) & 0xffff) === addr) out.push(at);
  }
  return out;
}

test("REACHED: no branch targets this address; the inline table's first word does", { skip }, () => {
  const m = entryState();
  const image = new Uint8Array(PROGRAM_BYTES);
  for (let at = 0; at < PROGRAM_BYTES; at++) image[at] = m.mem8[at];
  // An absolute call or jump carries its target as a little-endian word, and so does a table
  // pointer, so one scan over every byte offset covers both. The relative forms are scanned apart.
  const control = wordOffsets(image, CALLED_CONTROL);
  assert.ok(control.length > 0, "the word scan cannot find an address the image plainly calls, so " +
    "what it reports about this entry measures the scan and not the image");
  assert.deepEqual(relativeOffsets(image, TARGET), [], "a relative branch now lands on this entry");
  assert.deepEqual(
    wordOffsets(image, TARGET),
    [COINCIDENTAL_HIT, ARM_TABLE + ARM_INDEX * 2],
    "the offsets at which the image spells this address changed, so the reason it is reachable " +
      "at all has changed",
  );
  assert.equal((COINCIDENTAL_HIT - PAIR_RUN_FROM) % 2, 1, "the coincidental hit is no longer " +
    "straddling the run's pairs, so the reason it is not a pointer has gone");
  for (let at = PAIR_RUN_FROM; at < PAIR_RUN_TO; at += 2) {
    assert.equal(image[at + 1], PAIR_CONSTANT, `${hex4(at + 1)} breaks the run's constant byte`);
    const previous = image[at - 2];
    if (at > PAIR_RUN_FROM) assert.equal(image[at], previous - 1, `${hex4(at)} breaks the count down`);
  }
  assert.equal(
    m.mem16[ARM_TABLE + ARM_INDEX * 2],
    TARGET,
    "the table word that selects this entry moved, so the reason it is reachable at all has changed",
  );
  const seen = sessions();
  const total = seen.reduce((n, s) => n + s.dispatches, 0);
  assert.ok(total > 0, "vacuous: nothing dispatches this entry, so this file gates nothing");
  console.log(`  REACHED: table word ${hex4(ARM_TABLE)} holds ${hex4(TARGET)}; ${total} dispatches`);
});

test("EQUAL at the real dispatch: RAM, SP and pc all identical", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  seam(parkSpritesAndArmLineWipeThenAdvanceSequence)(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.sp, b.regs.sp, "the stack pointer must come back to the same seat");
  assert.equal(a.pc, b.pc, "the seam must land pc on the address the caller's slot held");
  console.log(`  EQUAL: sp ${hex4(a.regs.sp)} pc ${hex4(a.pc)}; identical outside [sp-${SCRATCH_BYTES}, sp)`);
});

test("NOT VACUOUS: a do-nothing twin FAILS the same comparison at the real entry", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked comparison passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("IDEMPOTENT: the sample write is INVISIBLE at the real entry, as recorded", { skip }, () => {
  const e = entryState();
  assert.equal(e.mem8[SAMPLE_RECORD], e.mem8[SAMPLED_CELL], "the record's first byte no longer " +
    "already holds the glyph, so the real dispatch may now see the copy and this file's account " +
    "of why the crafted cross carries it is stale");
  assert.equal(e.mem8[SAMPLE_RECORD + 1], e.mem8[COLOUR_PLANE_CELL], "the record's second byte no " +
    "longer already holds the colour; see above");
  assert.equal(unitDiff(brokenNoSample, e), null, "dropping the copy is now CAUGHT at the real " +
    "entry — good news, but this file documents the opposite and must be rewritten");
  console.log(
    `  IDEMPOTENT: the record already holds ${e.mem8[SAMPLED_CELL]}/${e.mem8[COLOUR_PLANE_CELL]}`,
  );
});

test("SEAM: SP and pc agree on the real dispatch and every crafted entry", { skip }, () => {
  for (const [label, edit] of cross()) {
    const m = craft(edit);
    const sp = m.regs.sp;
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    seam(parkSpritesAndArmLineWipeThenAdvanceSequence)(b);
    assert.equal(b.regs.sp, a.regs.sp, `${label}: the seam left SP adrift`);
    assert.equal(b.pc, a.pc, `${label}: the seam left pc adrift`);
    assert.equal(a.regs.sp, (sp + 2) & 0xffff, `${label}: the oracle did not net exactly one return`);
  }
  for (const s of sessions()) assert.equal(s.caught, 0, `${s.label} diverged`);
  console.log(`  SEAM: ${cross().length} crafted entries and the real dispatch place identically`);
});

test("EXCLUDED: the registers that move, bounded by a ceiling; SP, pc and the slots are held", { skip }, () => {
  const moved = new Set();
  for (const [label, edit] of cross()) {
    const m = craft(edit);
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    seam(parkSpritesAndArmLineWipeThenAdvanceSequence)(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    for (const k of HELD) assert.equal(b.regs[k], a.regs[k], `${label}: ${k} must be held`);
  }
  const list = REG_FIELDS.filter((k) => moved.has(k));
  for (const k of list) assert.ok(MAY_MOVE.includes(k), `${k} moved and is not on the ceiling`);
  console.log(`  EXCLUDED (measured): ${list.join(", ")} — ceiling ${MAY_MOVE.join(", ")}`);
});

test("CRAFTED: every entry of the cross is identical", { skip }, () => {
  for (const [label, edit] of cross()) {
    const d = unitDiff(parkSpritesAndArmLineWipeThenAdvanceSequence, craft(edit));
    assert.equal(d, null, `${label}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${cross().length} entries identical`);
});

test("EFFECTS: the cross reaches all four parts of the oracle, not one of them", { skip }, () => {
  let hid = 0;
  let copied = 0;
  let armed = 0;
  let stepped = 0;
  let wrapped = 0;
  for (const [, edit] of cross()) {
    const before = craft(edit);
    const after = before.clone();
    oracle(after);
    const bandCleared = [...Array(SLOT_COUNT)].some(
      (_unused, slot) => before.mem8[FIRST_SLOT_NATIVE_Y + slot * SLOT_STRIDE] !== 0,
    );
    if (bandCleared) hid++;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      assert.equal(after.mem8[FIRST_SLOT_NATIVE_Y + slot * SLOT_STRIDE], 0, "a sprite was left showing");
    }
    if (before.mem8[SAMPLE_RECORD] !== after.mem8[SAMPLE_RECORD] ||
        before.mem8[SAMPLE_RECORD + 1] !== after.mem8[SAMPLE_RECORD + 1]) copied++;
    if (before.mem16[BLANK_LINE_CURSOR] !== after.mem16[BLANK_LINE_CURSOR] ||
        before.mem8[BLANK_LINES_LEFT] !== after.mem8[BLANK_LINES_LEFT]) armed++;
    if (before.mem8[SEQUENCE_SUBSTEP] !== after.mem8[SEQUENCE_SUBSTEP]) stepped++;
    if (before.mem8[SEQUENCE_SUBSTEP] === 255) {
      assert.equal(after.mem8[SEQUENCE_SUBSTEP], 0, "the step past 255 must come back to zero");
      wrapped++;
    }
    assert.equal(after.mem16[BLANK_LINE_CURSOR], WIPE_FIRST_CELL, "the wipe cursor moved");
  }
  assert.ok(hid > 0 && copied > 0 && armed > 0 && stepped > 0 && wrapped > 0, "a part is unreached");
  console.log(`  EFFECTS: hid ${hid}, copied ${copied}, armed ${armed}, stepped ${stepped}, wrapped ${wrapped}`);
});

test("CORPUS: the one real dispatch replays identically; the demo makes none", { skip }, () => {
  for (const s of sessions()) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
  }
  console.log(`  CORPUS: ${sessions().map((s) => `${s.label} ${s.dispatches}`).join("; ")}`);
});

test("WHOLE-MACHINE: a wired driven session differs only in dead stack bytes", { skip }, () => {
  const r = wholeRunCells(parkSpritesAndArmLineWipeThenAdvanceSequence);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(r.cells, SESSION_SCRATCH, "the set of dead stack bytes a whole run leaves " +
    "differing moved, so the exclusion is no longer the measured one");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

test("WHOLE-MACHINE TEETH: the same instrument CATCHES a do-nothing twin", { skip }, () => {
  const r = wholeRunCells(brokenNoOp);
  assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
  const escaped = r.cells.filter((c) => !SESSION_SCRATCH.includes(c));
  assert.ok(
    r.threw !== null || escaped.length > 0,
    "the whole-machine arm passed a candidate that does nothing, so it proves only that the seam " +
      "places the dispatch and nothing about the routine",
  );
  console.log(`  WHOLE-MACHINE TEETH: the no-op leaves ${escaped.length} cells outside the window`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, expected, realSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = craftedCaught(twin);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
    assert.equal(caught, expected, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
  });

  test(`TEETH: the real dispatch's verdict on the ${label} twin is as recorded`, { skip }, () => {
    const seen = unitDiff(twin, entryState()) !== null;
    assert.equal(seen, realSees, `the real dispatch's verdict on the ${label} twin changed`);
    console.log(`  TEETH/${label}: the real dispatch ${seen ? "catches it" : "is BLIND, as recorded"}`);
  });
}
