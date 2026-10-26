// SPDX-License-Identifier: GPL-3.0-only
/**
 * drawTextRunByIndex — memory-equivalent to the frozen oracle at ROM 0x0BF2.
 *
 * GATE: strict unit-capture on the undriven attract run with ONE exclusion, every captured
 *   dispatch replayed, a sweep of the whole index range the pointer table actually spans, a
 *   whole-machine replay, and teeth.
 *   1. EQUAL at the real dispatch — identical outside a two-byte stack-scratch window, which is
 *      the return address the original brackets its table fetch with and the rewrite models no
 *      stack for. Every arm PINS that window: it walks the whole dump and asserts nothing escapes.
 *   2. NOT VACUOUS — a no-op candidate fails the same masked diff at the real dispatch.
 *   3. EXCLUDED, deliberately, bounded by a measured set: a register outside it fails, a rewrite
 *      that clobbers fewer of them does not. The cursor the painting leaves behind is NOT in it —
 *      it is the live-out and must agree. The colour register IS in it: the rewrite hands the
 *      colour to the painter as an argument and leaves no copy in C. So is the run pointer: the
 *      rewrite hands it to the painter as an argument and gets back only the cursor, while the
 *      frozen painter leaves HL on the terminator.
 *   3a. C IS DEAD WHERE THIS HANDS BACK, asked of the ORACLE (assertDeadAtExit) rather than argued
 *      from the rewrite.
 *      Read off the frozen callers: the ring drain loop (0x0B93) reloads C from the ring at 0x0B9E
 *      before it reads it, and the three call sites inside 0x0C90 fall into 0x0D57 or 0x0D61, each
 *      of which loads C (0x0D5D, 0x0D67) before reading it. The vertical-blank interrupt saves the
 *      whole main set with pushes, runs on the exchanged bank, and pops it back. Measured: C is
 *      complemented on every exit of the all-frozen game over the attract and coin -> start
 *      sessions, and the ONE cell that ever differs is the byte `push bc` at 0x00DA lays C into
 *      when the interrupt lands on the drain loop (SP 0xB000: return address, then AF, then BC) —
 *      a saved copy the interrupt pops straight back into C, which the loop then overwrites. Two
 *      controls on the same instrument: the index complemented on ENTRY is heard, and SP moved at
 *      the EXIT is heard, so both the entry and the exit poison land.
 *   3b. HL IS DEAD WHERE THIS HANDS BACK, on the same instrument, sessions and controls: H and L
 *      complemented on every exit move no cell of per-frame state at all.
 *   4. CORPUS — every dispatch the attract run produces, with the set of indices it presented.
 *   5. INDEX SWEEP — every index of the pointer table, which is far more than real play uses.
 *   6. WHOLE-MACHINE — the session replayed with the rewrite wired through a measured shim.
 *   7. TEETH — six twins, each caught on an exact declared count. A twin that dies counts as
 *      caught: a wrong destination aims the painting at program space and is refused there.
 *
 * HOLE: THE SWEEP STOPS AT THE END OF THE TABLE, and where the table ends is established by the
 *   original's own behaviour rather than by a length written down anywhere: past that point the
 *   word fetched is not a record pointer, the painting is aimed at whatever it happens to name,
 *   and on many of those indices the ORIGINAL itself walks into memory that refuses the write.
 *   Those indices are outside this gate, and the arm asserts where the survivable run stops so
 *   the boundary cannot move silently.
 * HOLE: real play presents a small handful of indices, twice each per attract loop. The sweep is
 *   what covers the rest, and the per-twin counts say which twins need it.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0bf2.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { assertDeadAtExit, heard, heardAs } from "./_deadAtExit.js";
import { drawTextRunByIndex } from "../drawTextRunByIndex.js";
import { loc_0bf2 as oracle } from "../../translated/loc_0bf2.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { drawTextRun } from "../drawTextRun.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x0bf2;

const CAPTION_TABLE = 0x0c50;
const HEADER_BYTES = 3;
const END_OF_TEXT = 185;

const SCRATCH_BYTES = 2;
const MOVED = ["a", "f", "c", "h", "l", "sp"];
/** The run pointer the frozen painter leaves on the terminator; nothing after this exit reads it. */
const HL_DEAD_AT_EXIT = ["h", "l"];
/** The byte the vertical-blank interrupt's `push bc` (0x00DA) saves C into when it lands on the
 *  ring drain loop, whose stack pointer is 0xB000: 0xAFFE/F the return address, 0xAFFC/D AF. */
const NMI_SAVED_C = 0xaffa;
const DEAD_SESSIONS = [["attract", []], ["coin -> start", undefined]];
const CORPUS_FRAMES = 1400;
const WHOLE_FRAMES = 1400;
const RET_TSTATES = 10;

/** Measured over the corpus below; a move is a finding. */
const DISPATCHES = 528;
const REAL_INDICES = [0, 1, 3, 4, 5, 6, 7, 8, 19, 20, 21, 31];

/** The table's extent, measured: the largest prefix the ORIGINAL survives. See the hole above. */
const LAST_INDEX = 32;
const INDICES = Array.from({ length: LAST_INDEX + 1 }, (_unused, i) => i);

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const factory = (overrides) => makeMachine(overrides, { tape: [] });

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(factory, TARGET, oracle, (m) => {
    if (entry === null) entry = m.clone();
    return candidate(m);
  }, { maxFrames: ENTRY_FRAMES });
}

function entryState() {
  if (entry === null) gate(drawTextRunByIndex);
  return entry;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

/** Every differing byte of two dumps, as {addr, a, b} — the scratch window included. */
function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** Oracle vs candidate on clones: masked RAM first, then the live-out cursor. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.de !== b.regs.de) return { addr: null, a: a.regs.de, b: b.regs.de };
  return null;
}

// ── the corpus ──────────────────────────────────────────────────────────────────────────

let corpus = null;
function captureCorpus() {
  if (corpus) return corpus;
  const entries = [];
  const indices = new Set();
  const m = factory(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    indices.add(mm.regs.a);
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `corpus run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "corpus run ran short");
  corpus = { entries, indices };
  return corpus;
}

/** A real captured machine holding one chosen index — the crafted-entry idiom. */
function withIndex(index) {
  const m = entryState().clone();
  m.regs.a = index;
  return m;
}

/**
 * A twin counts as CAUGHT when it diverges OR when it dies. A wrong destination aims the painting
 * at program space, which the address space refuses, and refusing to call that a catch would let
 * the loudest possible failure read as a pass.
 */
function caught(candidate, machine) {
  try {
    return unitDiff(candidate, machine) !== null;
  } catch {
    return true;
  }
}

const sweepCaught = (candidate) => INDICES.filter((i) => caught(candidate, withIndex(i))).length;

// ── the shim, measured rather than asserted ─────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

/**
 * Every cell that EVER differs between an all-oracle session and one with the candidate wired.
 * A first-difference helper cannot express "differs only inside the scratch window", so this walks
 * the whole trace and hands back the set.
 */
let baseline = null;
function wholeRunCells(candidate) {
  if (baseline === null) {
    const base = factory();
    const frames = base.runFrames(WHOLE_FRAMES);
    assert.equal(base.stoppedBy, null, `baseline stopped early: ${base.stoppedBy}`);
    assert.equal(frames.length, WHOLE_FRAMES, "baseline ran short");
    baseline = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  let fired = 0;
  const host = factory(new Map([[TARGET, (mm) => (fired++, candidate(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(baseline.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = baseline.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(baseline.offsetToAddr(o));
  }
  const live = liveStackDiffs(baseline.frames, hostFrames, floors, (o) => baseline.offsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

/** The scratch window as ADDRESSES, taken from the real entry. */
const scratchWindow = () => {
  const sp = entryState().regs.sp;
  return Array.from({ length: SCRATCH_BYTES }, (_unused, i) => sp - SCRATCH_BYTES + i);
};

// ── the twins ───────────────────────────────────────────────────────────────────────────

const recordOf = (m) => m.mem16[CAPTION_TABLE + 2 * m.regs.a];

/** The correct painting, so the twins below break the HEADER and not the painting itself. */
function paint(m, destination, colour, run) {
  m.regs.de = destination;
  m.regs.c = colour;
  m.regs.hl = run;
  drawTextRun(m);
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the index is ignored, so every caption comes out as the first one. */
function brokenAlwaysFirstRecord(m) {
  const record = m.mem16[CAPTION_TABLE];
  paint(m, m.mem16[record], m.mem8[record + 2], record + HEADER_BYTES);
}

/** BUG: the index is not doubled, so it selects a byte boundary instead of an entry. */
function brokenIndexNotDoubled(m) {
  const record = m.mem16[CAPTION_TABLE + m.regs.a];
  paint(m, m.mem16[record], m.mem8[record + 2], record + HEADER_BYTES);
}

/** BUG: the destination word is read the other way round, so the caption lands elsewhere. */
function brokenDestinationSwapped(m) {
  const record = recordOf(m);
  const destination = (m.mem8[record] << 8) | m.mem8[record + 1];
  paint(m, destination, m.mem8[record + 2], record + HEADER_BYTES);
}

/** BUG: the colour byte is taken as part of the destination, so the run starts one byte early. */
function brokenRunStartsEarly(m) {
  const record = recordOf(m);
  paint(m, m.mem16[record], m.mem8[record + 2], record + HEADER_BYTES - 1);
}

/** BUG: the colour is whatever the caller was holding rather than the record's own. */
function brokenKeepsCallersColour(m) {
  const record = recordOf(m);
  paint(m, m.mem16[record], m.regs.c, record + HEADER_BYTES);
}

/** Per twin: its exact catch count over the index sweep, and its verdict at the real dispatch. */
const TWINS = [
  ["no-op", brokenNoOp, 33, true],
  ["always-first-record", brokenAlwaysFirstRecord, 32, true],
  ["index-not-doubled", brokenIndexNotDoubled, 32, true],
  ["destination-swapped", brokenDestinationSwapped, 33, true],
  ["run-starts-early", brokenRunStartsEarly, 33, true],
  // 31, not 33: on indices 24 (an empty run) and 32 the wrong colour reaches no cell, so the
  // twin is memory-identical there; the dead C register was the only thing that told them apart.
  ["keeps-callers-colour", brokenKeepsCallersColour, 31, true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the two-byte scratch window", { skip }, () => {
  gate(drawTextRunByIndex);
  assert.notEqual(entry, null, "vacuous: the attract run never reached the routine");
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  drawTextRunByIndex(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(unitDiff(drawTextRunByIndex, entryState()), null, "a live-out register diverged");
  console.log(`  EQUAL: index ${entryState().regs.a}, sp ${hex4(sp)}; only the scratch window moves`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "and it must be caught on a real cell, not on a register alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers and pc, but NOT the live-out cursor", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  drawTextRunByIndex(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(
    moved.filter((k) => !MOVED.includes(k)),
    [],
    "a register outside the declared excluded set diverged",
  );
  assert.equal(a.regs.de, b.regs.de, "the cursor is the live-out and must agree");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, SCRATCH_BYTES, "the oracle returns; the rewrite does not");
  console.log(`  EXCLUDED: ${MOVED.join(", ")} and pc, plus ${SCRATCH_BYTES} scratch bytes`);
});

test("C AND HL ARE DEAD AT EXIT: complemented on every exit of the ORACLE; C moves only the interrupt's saved copy, HL nothing", { skip }, () => {
  const exits = assertDeadAtExit({
    at: TARGET, poison: ["c"], frames: ENTRY_FRAMES, reachEvery: true, scratch: [NMI_SAVED_C],
    sessions: DEAD_SESSIONS.map(([label, tape]) => ({ label, tape })),
    controls: [
      // H and L at the same exits: silent here, and held to NO cell at all below.
      { label: "HL", poison: HL_DEAD_AT_EXIT, expect: "silent", reachEvery: true },
      // ENTRY CONTROL: the index this routine reads, complemented on the way in, must be heard.
      { label: "entry", poison: ["a"], before: true, every: true, reachEvery: true },
    ],
  });
  for (const r of exits) {
    const hl = r.controls.HL;
    assert.equal(r.dead.stopped, null, `${r.label}: the poisoned run stopped early: ${r.dead.stopped}`);
    // The saved copy is the ONE cell C moves, and it does move: the exit poison is seen landing.
    assert.deepEqual(r.dead.cells.map(hex4), [hex4(NMI_SAVED_C)],
      `${r.label}: C was read after this routine handed back, somewhere other than the interrupt's ` +
        "save slot");
    assert.equal(hl.stopped, null, `${r.label}: the HL-poisoned run stopped early: ${hl.stopped}`);
    assert.equal(hl.frames, ENTRY_FRAMES, `${r.label}: compared ${hl.frames} of ${ENTRY_FRAMES} frames`);
    assert.equal(hl.poisoned, r.dead.poisoned, `${r.label}: the HL run poisoned a different set of exits`);
    assert.deepEqual(hl.cells.map(hex4), [],
      `${r.label}: the run pointer was read after this routine handed back`);
    // EXIT CONTROL: SP moved where this hands back; the ROM returns through it, so every session hears it.
    assert.ok(heard(r.exitControl),
      `${r.label}: the exit control was not heard, so the exit poison never lands`);
  }
  console.log(`  DEAD AT EXIT: C moves only ${hex4(NMI_SAVED_C)}, H and L nothing; entry and exit controls ` +
    `heard in every session (${exits.map((r) => `${r.label} ${heardAs(r.exitControl)}`).join("; ")})`);
});

test("CORPUS: every captured dispatch replays identically", { skip }, () => {
  const { entries, indices } = captureCorpus();
  assert.equal(entries.length, DISPATCHES, "the dispatch count moved");
  assert.deepEqual(
    [...indices].sort((x, y) => x - y),
    REAL_INDICES,
    "the index set real play presents moved, so the sweep covers a different hole",
  );
  for (const captured of entries) {
    assert.equal(unitDiff(drawTextRunByIndex, captured), null, "a captured dispatch diverged");
  }
  console.log(`  CORPUS: ${entries.length} dispatches over ${indices.size} distinct indices`);
});

test("INDEX SWEEP: every entry of the pointer table paints identically", { skip }, () => {
  for (const i of INDICES) {
    const d = unitDiff(drawTextRunByIndex, withIndex(i));
    assert.equal(d, null, `index ${i}: ${show(d)}`);
  }
  assert.throws(
    () => {
      const m = withIndex(LAST_INDEX + 1);
      oracle(m);
    },
    /unmapped/,
    "the first index past the table must be one the ORIGINAL cannot survive — if it is not, the " +
      "table is longer than this file says and the sweep is short",
  );
  console.log(`  INDEX SWEEP: ${INDICES.length} indices identical; ${LAST_INDEX + 1} kills the oracle`);
});

test("WHOLE-MACHINE: the session differs only in the scratch window and the interrupt's saved C", { skip }, () => {
  const r = wholeRunCells(hosted(drawTextRunByIndex));
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early: ${r.stopped}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  // The rewrite leaves C holding what the caller had, so the interrupt's saved copy of it differs;
  // the DEAD AT EXIT arm is what licenses that one cell.
  assert.deepEqual(r.cells, [NMI_SAVED_C, ...scratchWindow()].sort((x, y) => x - y),
    "a divergence escaped the scratch window and the interrupt's saved C");
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, only ` +
      `${r.cells.map(hex4).join(" ")} differ`,
  );
});

test("TEETH: removing the shim's return kills the run, so the shim is load-bearing", { skip }, () => {
  const r = wholeRunCells(drawTextRunByIndex);
  assert.ok(
    r.threw !== null || r.stopped !== null,
    "the run COMPLETED without the shim, so the callers of this address no longer expect a " +
      "return and the whole-machine arm above should drop the shim rather than keep it",
  );
  console.log(`  TEETH/shim: the unshimmed rewrite dies — ${r.threw ?? r.stopped}`);
});

for (const [label, twin, swept, seenAtDispatch] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of indices`, { skip }, () => {
    assert.equal(sweepCaught(twin), swept, `the ${label} twin's sweep catch count moved`);
    console.log(`  TEETH/${label}: caught on ${swept} of ${INDICES.length} indices`);
  });

  test(`TEETH: the ${label} twin at the real dispatch, hole pinned`, { skip }, () => {
    const seen = caught(twin, entryState());
    assert.equal(seen, seenAtDispatch, `the real dispatch's view of the ${label} twin moved`);
    console.log(`  TEETH/${label}: real dispatch ${seen ? "catches it" : "is BLIND, as recorded"}`);
  });
}
