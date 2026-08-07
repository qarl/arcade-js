// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_12fb — memory-equivalent to the frozen oracle at ROM 0x12FB.
 *
 * WHAT IT IS. Four work-RAM cells written from fixed addresses: three cleared, one loaded from a
 * byte of the program image, and then one of the three written a SECOND time from a fold over two
 * more program bytes. The fold's arithmetic goes through the already-decompiled offsetAddress, so
 * that transfer is dissolved into a direct call here. Nothing is read out of work RAM at all, so
 * the routine's whole input is the image.
 *
 * ★ NO TAPE REACHES THIS ENTRY, and the UNREACHED arm asserts it: three sessions dispatch it ZERO
 *   times in 2000 frames. Its two callers sit on a restart path none of them takes. Because it
 *   reads no work RAM and no register, ANY real captured machine is a valid entry state for it —
 *   so the corpus here is a real machine captured at a busy sibling entry, with the four cells it
 *   writes poked to a spread of priors. That is a crafted entry in the strict sense: a real state
 *   with a surgical nudge, and the nudge is only to the cells the routine overwrites anyway.
 *
 * ★ THE FOLD IS THE REASON THE SECOND WRITE EXISTS, and it is checked rather than assumed. On an
 *   unaltered image it comes to zero, so the second write agrees with the first; the FOLD arm
 *   asserts that, and then MODIFIES one image byte the fold reads — on a private copy of the image
 *   belonging to one crafted machine — and asserts the two sides still agree with each other while
 *   the value written CHANGES. That is what stops "the fold folds to zero" from being a claim no
 *   arm could refute.
 *
 * GATE: crafted-entry off a busy sibling's real capture, plus a whole-run diff. Holes stated:
 *
 *   1. UNREACHED — three sessions' dispatch counts for this entry, measured and asserted.
 *   2. EQUAL at the crafted entry — identical outside the scratch window.
 *   3. NOT VACUOUS — a no-op FAILS that same masked diff on a real cell.
 *   4. EXCLUDED — the registers that move over the whole cross, pinned.
 *   5. CRAFTED CROSS — every one of the four written cells given a spread of priors.
 *   6. FOLD — the fold's value on an unaltered image, and on an altered one.
 *   7. WHOLE-MACHINE — the entry wired into a whole driven session. It never dispatches there, so
 *      this arm is VACUOUS BY CONSTRUCTION and says so; it is kept only to record that the wiring
 *      is inert, and the teeth below are unit teeth.
 *   8. TEETH — eight twins, each with an exact catch count over the cross AND a verdict on the
 *      altered-image machine, which is the only arm that can see a twin that drops the fold.
 *
 * HOLE: there is no natural corpus and no whole-run tooth. Everything here rests on the unit arms.
 * HOLE: the entry state is borrowed from another routine's dispatch. That is sound only because
 * this routine reads no work RAM and no register — which arm 4 and the write-set below establish
 * rather than assume.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-12fb.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { loc_12fb } from "../loc_12fb.js";
import { loc_12fb as oracle } from "../../translated/loc_12fb.js";
import { PLAY_ACTIVE, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, ACTIVE_PLAYER } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x12fb;

/** A busy entry whose real captured state is borrowed, since this one is never dispatched. */
const BORROWED_FROM = 0x0809;

const PHASE_SOURCE = 0x16d3;
const FOLD_STEP = 0x4901;
const FOLD_BASE = 0x4902;
const FOLD_BIAS = 155;

const WRITTEN = [PLAY_ACTIVE, SEQUENCE_SUBSTEP, ACTIVE_PLAYER, SEQUENCE_PHASE];

/** Measured: the oracle's own call bracket around the fold's arithmetic. */
const SCRATCH_BYTES = 2;

const MOVED = ["a", "f", "sp"];
const HELD = ["b", "c", "d", "e", "ix", "iy"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1200;
const ENTRY_BUDGET = 1200;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const sharedMachine = (overrides) => makeMachine(overrides);
const TAPES = [["shared", {}], ["attract", { tape: [] }], ["turning", { tape: turnTape() }]];

// ── the borrowed entry ──────────────────────────────────────────────────────────────────

let entry = null;
function entryState() {
  if (entry !== null) return entry;
  const siblingFn = makeMachine().routines.get(BORROWED_FROM);
  const m = sharedMachine(
    new Map([[BORROWED_FROM, (mm, ...args) => {
      if (entry === null) entry = mm.clone();
      return siblingFn(mm, ...args);
    }]]),
  );
  m.runFrames(ENTRY_BUDGET);
  assert.notEqual(entry, null, "vacuous: the sibling entry was never dispatched either");
  return entry;
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

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

/** The borrowed machine with every cell this entry writes given a prior. */
function craft(priors) {
  const m = entryState().clone();
  for (const [i, addr] of WRITTEN.entries()) m.mem8[addr] = priors[i];
  return m;
}

/** The same borrowed machine with ONE byte the fold reads moved, on a private copy of the image. */
function craftAltered(priors = [255, 255, 255, 255]) {
  const m = craft(priors);
  m.mem.rom = Uint8Array.from(m.mem.rom);
  m.mem.rom[FOLD_STEP] = (m.mem.rom[FOLD_STEP] + 1) & 0xff;
  return m;
}

/** unitDiff on a machine whose private image both sides share. */
function alteredDiff(candidate) {
  const a = craftAltered();
  const b = a.clone();
  b.mem.rom = a.mem.rom;
  const sp = a.regs.sp;
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

const PRIORS = [
  [0, 0, 0, 0],
  [255, 255, 255, 255],
  [1, 2, 3, 4],
  [0, 255, 0, 255],
  [255, 0, 255, 0],
  [16, 32, 64, 128],
  [127, 128, 129, 130],
];

// ── the whole-run diff ──────────────────────────────────────────────────────────────────

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

function wholeRun(candidate) {
  const base = sharedMachine();
  const baseFrames = base.runFrames(WHOLE_FRAMES);
  let fired = 0;
  const host = sharedMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  const hostFrames = host.runFrames(WHOLE_FRAMES);
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = baseFrames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.stateOffsetToAddr(o));
  }
  return { cells: [...cells], frames: n, fired };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

function foldValue(m) {
  const moved = (m.mem16[FOLD_BASE] + m.mem8[FOLD_STEP]) & 0xffff;
  return ((moved & 0xff) ^ (moved >> 8)) - FOLD_BIAS;
}

/** BUG: the in-play flag is left standing, so a restart still counts as a game in progress. */
function brokenPlayFlagHeld(m) {
  const { mem8 } = m;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[ACTIVE_PLAYER] = 0;
  mem8[SEQUENCE_PHASE] = mem8[PHASE_SOURCE];
  mem8[SEQUENCE_SUBSTEP] = foldValue(m);
}

/** BUG: the third cell is never cleared. */
function brokenThirdCellHeld(m) {
  const { mem8 } = m;
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[SEQUENCE_PHASE] = mem8[PHASE_SOURCE];
  mem8[SEQUENCE_SUBSTEP] = foldValue(m);
}

/** BUG: the outer phase is a constant, and a different one. */
function brokenPhaseImmediate(m) {
  const { mem8 } = m;
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[ACTIVE_PLAYER] = 0;
  mem8[SEQUENCE_PHASE] = 2;
  mem8[SEQUENCE_SUBSTEP] = foldValue(m);
}

/** BUG: the phase byte is read one address along. */
function brokenPhaseSourceOffByOne(m) {
  const { mem8 } = m;
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[ACTIVE_PLAYER] = 0;
  mem8[SEQUENCE_PHASE] = mem8[PHASE_SOURCE + 1];
  mem8[SEQUENCE_SUBSTEP] = foldValue(m);
}

/** BUG: the fold is dropped, so a tampered image restarts as cleanly as a genuine one. */
function brokenFoldDropped(m) {
  const { mem8 } = m;
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[ACTIVE_PLAYER] = 0;
  mem8[SEQUENCE_PHASE] = mem8[PHASE_SOURCE];
}

/** BUG: the fold's constant is one out. */
function brokenFoldBiasOffByOne(m) {
  const { mem8 } = m;
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[ACTIVE_PLAYER] = 0;
  mem8[SEQUENCE_PHASE] = mem8[PHASE_SOURCE];
  const moved = (m.mem16[FOLD_BASE] + m.mem8[FOLD_STEP]) & 0xffff;
  mem8[SEQUENCE_SUBSTEP] = ((moved & 0xff) ^ (moved >> 8)) - FOLD_BIAS - 1;
}

/** BUG: the fold folds the LOW half against itself, so an altered image is not detected. */
function brokenFoldWrongHalf(m) {
  const { mem8 } = m;
  mem8[PLAY_ACTIVE] = 0;
  mem8[SEQUENCE_SUBSTEP] = 0;
  mem8[ACTIVE_PLAYER] = 0;
  mem8[SEQUENCE_PHASE] = mem8[PHASE_SOURCE];
  const moved = (m.mem16[FOLD_BASE] + m.mem8[FOLD_STEP]) & 0xffff;
  mem8[SEQUENCE_SUBSTEP] = ((moved & 0xff) ^ (moved & 0xff)) - FOLD_BIAS;
}

/**
 * Per twin: its catch count over the crafted priors, and whether the ALTERED-image machine catches
 * it. Two of them cannot be caught on a genuine image at all — the fold comes to zero there, so
 * dropping it writes the same byte the clear already wrote — and the altered column is what holds
 * those. A twin that is invisible in BOTH columns would be no tooth at all.
 */
const TWINS = [
  ["no-op", brokenNoOp, 7, true],
  ["play-flag-held", brokenPlayFlagHeld, 5, true],
  ["third-cell-held", brokenThirdCellHeld, 5, true],
  ["phase-wrong-constant", brokenPhaseImmediate, 7, true],
  ["phase-source-off-by-one", brokenPhaseSourceOffByOne, 7, true],
  ["fold-dropped", brokenFoldDropped, 0, true],
  ["fold-bias-off-by-one", brokenFoldBiasOffByOne, 7, true],
  ["fold-wrong-half", brokenFoldWrongHalf, 7, true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: no session dispatches this entry, so the entry state is borrowed", { skip }, () => {
  const counts = [];
  for (const [label, opts] of TAPES) {
    let dispatches = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => (dispatches++, oracle(mm))]]), opts);
    const ran = m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} tape stopped early: ${m.stoppedBy}`);
    assert.equal(ran.length, CORPUS_FRAMES, `the ${label} tape ran short`);
    counts.push(`${label} ${dispatches}`);
    assert.equal(dispatches, 0, `the ${label} tape now reaches this entry, so it HAS a natural ` +
      "corpus and the borrowed entry should be replaced by it");
  }
  console.log(`  UNREACHED: ${counts.join(", ")}`);
});

test("EQUAL at the borrowed entry: identical outside the scratch window", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  loc_12fb(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: borrowed entry sp ${hex4(sp)}; ${all.length} differing bytes, ${strays.length} outside`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft([255, 255, 255, 255]));
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const priors of PRIORS) {
    const a = craft(priors);
    const b = a.clone();
    oracle(a);
    loc_12fb(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    for (const addr of WRITTEN) assert.equal(a.mem8[addr], b.mem8[addr], `live-out ${hex4(addr)}`);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k)), MOVED, "the excluded set changed shape");
  for (const k of HELD) assert.ok(!moved.has(k), `a register a caller may rely on moved (${k})`);
});

test("CRAFTED: every prior for the four written cells is identical", { skip }, () => {
  for (const priors of PRIORS) {
    const d = unitDiff(loc_12fb, craft(priors));
    assert.equal(d, null, `priors ${priors.join(",")}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${PRIORS.length} prior sets identical`);
});

test("WRITE SET: exactly four cells change, and no work-RAM cell is READ", { skip }, () => {
  const before = craft([255, 255, 255, 255]);
  const after = before.clone();
  oracle(after);
  const changed = allDiffs(before, after)
    .filter((d) => !inScratch(d.addr, before.regs.sp))
    .map((d) => d.addr)
    .sort((x, y) => x - y);
  console.log(`  WRITE SET: ${changed.map(hex4).join(" ")}`);
  assert.deepEqual(changed, [...WRITTEN].sort((x, y) => x - y), "the write set moved");

  // Reading no work RAM is what makes a BORROWED entry state sound, so it is measured: the same
  // four cells come out the same whatever the rest of work RAM holds.
  const scrambled = craft([255, 255, 255, 255]);
  for (let addr = 0xa800; addr < 0xaf00; addr++) scrambled.mem8[addr] = (addr * 7) & 0xff;
  oracle(scrambled);
  for (const addr of WRITTEN) {
    assert.equal(scrambled.mem8[addr], after.mem8[addr], `${hex4(addr)} depends on work RAM`);
  }
});

test("FOLD: it comes to zero on an unaltered image, and does NOT on an altered one", { skip }, () => {
  const clean = craft([255, 255, 255, 255]);
  oracle(clean);
  assert.equal(clean.mem8[SEQUENCE_SUBSTEP], 0, "the fold no longer comes to zero on this image");

  // A private copy of the image for ONE machine, with one byte the fold reads moved.
  const altered = craft([255, 255, 255, 255]);
  altered.mem.rom = Uint8Array.from(altered.mem.rom);
  altered.mem.rom[FOLD_STEP] = (altered.mem.rom[FOLD_STEP] + 1) & 0xff;
  const alteredTwin = altered.clone();
  alteredTwin.mem.rom = altered.mem.rom;
  oracle(altered);
  loc_12fb(alteredTwin);
  console.log(
    `  FOLD: unaltered gives ${clean.mem8[SEQUENCE_SUBSTEP]}, altered gives ` +
      `${altered.mem8[SEQUENCE_SUBSTEP]}`,
  );
  assert.notEqual(altered.mem8[SEQUENCE_SUBSTEP], 0, "moving a byte the fold reads left it at " +
    "zero, so the fold reads nothing that can change and the second write is dead");
  assert.equal(
    alteredTwin.mem8[SEQUENCE_SUBSTEP],
    altered.mem8[SEQUENCE_SUBSTEP],
    "the rewrite and the oracle disagree once the image is altered",
  );
});

test("WHOLE-MACHINE: wiring the rewrite in changes nothing, because it never fires", { skip }, () => {
  const r = wholeRun(loc_12fb);
  console.log(`  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches — VACUOUS by construction`);
  assert.equal(r.fired, 0, "the entry now dispatches in a driven session, so this arm is no " +
    "longer vacuous and should be turned into a real whole-run gate");
  assert.deepEqual(r.cells, [], "the run diverged without the override ever firing");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, alteredCatches] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = PRIORS.filter((p) => unitDiff(twin, craft(p)) !== null).length;
    const altered = alteredDiff(twin) !== null;
    console.log(
      `  TEETH/${label}: caught on ${caught} of ${PRIORS.length} genuine-image entries; ` +
        `altered image ${altered ? "catches it" : "does NOT"}`,
    );
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.equal(altered, alteredCatches, `the ${label} twin's altered-image verdict changed`);
    assert.ok(caught > 0 || altered, `the ${label} twin is invisible to every arm here`);
  });
}
