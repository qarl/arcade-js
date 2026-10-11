// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for layOutEnemyAimPointsFromPlayerHeading vs the frozen oracle: real tape dispatches, a full scroll-angle
// sweep of the sub-mode-7 body, the sub-mode gate, and broken twins caught in MEMORY.
// Run: node --test games/timeplt/idiomatic/test/equivalence-326c.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { layOutEnemyAimPointsFromPlayerHeading } from "../layOutEnemyAimPointsFromPlayerHeading.js";
import { loc_326c as oracle } from "../../translated/loc_326c.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x326c;
const OBJECT = 0xac64;
const SCROLL_ANGLE = 0xa802;
const SUBMODE = 0x07;
const FIELDS = Array.from({ length: 12 }, (_, i) => 0x10 + i);
const SEED = 0xee;
const STACK = 0xafe4;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// The oracle takes its own trailing ret (sp += 2) where the rewrite leaves it to the dispatch seam,
// computes flags the rewrite skips, and its ex-de-hl parks the velocity-table pointer in DE; a is
// dead scratch, and hl is the velocity high-byte scratch the rewrite folds into JS locals (live-out
// is fields 0x10-0x1b only). ix is the oracle's `ld ix,0xac64` field base, and it too is dead: the
// only caller (reaimAndAnimate at 0x31b4) tail-calls this routine, so its ret unwinds to the
// per-frame dispatcher loc_1199, whose next routine 0x1edf reloads ix (`ld ix,0xa800`) before any
// read -- so the rewrite folding the base into a JS constant leaves ix unwritten with no observer.
// All excluded regs are checked as a ceiling, never asserted equal; memory + the other registers
// keep teeth (see the TEETH twins below, which a wrong memory write still trips).
const EXCLUDED = ["sp", "f", "d", "e", "a", "h", "l", "ix"];

const hex = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

function craft(scroll, cLow, sp = STACK) {
  const m = makeMachine(null);
  for (let a = 0xa800; a < 0xb000; a++) m.mem8[a] = (a * 7) & 0xff;
  for (const f of FIELDS) m.mem8[OBJECT + f] = SEED; // seed so a body that never writes is visible
  m.regs.c = (0x30 | cLow) & 0xff;
  m.regs.b = 0x55; m.regs.d = 0x11; m.regs.e = 0x22; m.regs.h = 0x33; m.regs.l = 0x44;
  m.regs.a = 0x99; m.regs.ix = 0x1234; m.regs.iy = 0x5678; m.regs.sp = sp;
  m.mem8[SCROLL_ANGLE] = scroll;
  return m;
}

// Oracle (pushes watched) and candidate on independent clones; the frozen side scribbles the return
// slots in [low, seat) that the rewrite never touches, so that window is masked out of the diff.
function split(candidate, machine) {
  const a = machine.clone(), b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  candidate(b);
  return { a, b, low, seat };
}

function memDiff({ a, b, low, seat }) {
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

function regDiff({ a, b }) {
  for (const k of REG_FIELDS) {
    if (EXCLUDED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

// Fields the oracle rewrites away from the seed -- a non-vacuity control for crafted machines.
function footprint(machine) {
  const a = machine.clone();
  oracle(a);
  let n = 0;
  for (const f of FIELDS) if (a.mem8[OBJECT + f] !== machine.mem8[OBJECT + f]) n++;
  return n;
}

let dispatches = null;
function captureDispatches() {
  if (dispatches) return dispatches;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => { entries.push(mm.clone()); return oracle(mm); }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the tape run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the tape run ran short");
  assert.ok(entries.length > 0, "vacuous: the tape never dispatched this address");
  dispatches = entries;
  return dispatches;
}

test("REAL DISPATCHES: every tape dispatch is byte-identical within the ceiling", { skip }, () => {
  const entries = captureDispatches();
  let body = 0;
  for (const e of entries) {
    const s = split(layOutEnemyAimPointsFromPlayerHeading, e);
    const md = memDiff(s);
    assert.equal(md, null, `a dispatch diverged in memory: ${JSON.stringify(md)}`);
    const rd = regDiff(s);
    assert.equal(rd, null, `a dispatch diverged in a register: ${JSON.stringify(rd)}`);
    if ((e.regs.c & 0x0f) === SUBMODE) body++;
  }
  assert.ok(body > 0, "vacuous: no captured dispatch took the sub-mode-7 body");
  console.log(`  REAL: ${entries.length} dispatches identical, ${body} took the body`);
});

test("SCROLL SWEEP: all 256 angles through the sub-mode-7 body are identical", { skip }, () => {
  let moved = 0;
  for (let scroll = 0; scroll < 256; scroll++) {
    const m = craft(scroll, SUBMODE);
    const s = split(layOutEnemyAimPointsFromPlayerHeading, m);
    const md = memDiff(s);
    assert.equal(md, null, `angle ${hex(scroll)} diverged: ${JSON.stringify(md)}`);
    const rd = regDiff(s);
    assert.equal(rd, null, `angle ${hex(scroll)} register: ${JSON.stringify(rd)}`);
    if (footprint(m) > 0) moved++;
  }
  assert.equal(moved, 256, `only ${moved}/256 angles rewrote the fields -- the sweep is vacuous`);
  console.log(`  SWEEP: 256 angles identical, all rewrote the object fields`);
});

test("SUB-MODE GATE: the body runs iff the low nibble is 7, matching the oracle", { skip }, () => {
  for (let cLow = 0; cLow < 16; cLow++) {
    const m = craft(0x80, cLow);
    const md = memDiff(split(layOutEnemyAimPointsFromPlayerHeading, m));
    assert.equal(md, null, `nibble ${cLow} diverged: ${JSON.stringify(md)}`);
    const wrote = footprint(m) > 0;
    assert.equal(wrote, cLow === SUBMODE, `nibble ${cLow}: body ran=${wrote}, expected ${cLow === SUBMODE}`);
  }
  console.log("  GATE: only low-nibble 7 rewrites the fields, both sides agree");
});

// ── broken twins ────────────────────────────────────────────────────────────
// BUG: never runs -- the fields keep their seed where the body should have written.
function brokenNoOp() {}
// BUG: the block-1 mirror is dropped, so the four negative slots are never seated.
function brokenNoMirror(m) {
  layOutEnemyAimPointsFromPlayerHeading(m);
  for (const f of [0x14, 0x15, 0x16, 0x17]) m.mem8[OBJECT + f] = SEED;
}
// BUG: the sub-mode gate is forced open, so the body writes on every mode, not just 7.
function brokenNoGate(m) {
  const c = m.regs.c;
  m.regs.c = (c & 0xf0) | SUBMODE;
  layOutEnemyAimPointsFromPlayerHeading(m);
  m.regs.c = c;
}

let repCache = null;
function reps() {
  if (repCache) return repCache;
  repCache = [];
  for (const s of [0x00, 0x11, 0x37, 0x40, 0x80, 0xc0, 0xe0, 0xfe]) repCache.push(craft(s, SUBMODE));
  for (let n = 0; n < 16; n++) if (n !== SUBMODE) repCache.push(craft(0x80, n));
  return repCache;
}

function caughtInMemory(twin) {
  let n = 0;
  for (const m of reps()) if (memDiff(split(twin, m))) n++;
  return n;
}

for (const [label, twin] of [["no-op", brokenNoOp], ["no-mirror", brokenNoMirror], ["no-gate", brokenNoGate]]) {
  test(`TEETH: the ${label} twin is CAUGHT in memory`, { skip }, () => {
    const caught = caughtInMemory(twin);
    assert.ok(caught > 0, `every machine PASSED the ${label} twin`);
    console.log(`  TEETH/${label}: caught on ${caught}/${reps().length} machines`);
  });
}

test("TEETH CONTROL: the real rewrite is clean on the same set", { skip }, () => {
  assert.equal(caughtInMemory(layOutEnemyAimPointsFromPlayerHeading), 0, "the rewrite itself diverged on a teeth machine");
  console.log(`  CONTROL: layOutEnemyAimPointsFromPlayerHeading clean on all ${reps().length} teeth machines`);
});
