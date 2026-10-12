// SPDX-License-Identifier: GPL-3.0-only
/**
 * dressSpriteForHeadingOrRetireAtEdge — memory-equivalent to the frozen oracle at ROM 0x4447. A pure leaf: every ROM call is
 * dissolved to a direct import, so the rewrite pushes no return and omits its own ret. Nothing
 * reaches it on either tape (REACH proves it, with a positive control), so the gate runs on CRAFTED
 * entries poked onto real captured machines to force each path, RAM compared with the dead stack
 * scratch masked, the +2 re-seat and the return checked, and registers held to a measured ceiling.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4447.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { dressSpriteForHeadingOrRetireAtEdge as candidate } from "../dressSpriteForHeadingOrRetireAtEdge.js";
import { loc_4447 as oracle } from "../../translated/loc_4447.js";
import { hasReachedBoundaryBandSelectedByHeading } from "../hasReachedBoundaryBandSelectedByHeading.js";
import { retireEntryPairIntoCooldown } from "../retireEntryPairIntoCooldown.js";
import { offsetAddress } from "../offsetAddress.js";
import { restartAnimationCounterThenDressFlutterSprite } from "../restartAnimationCounterThenDressFlutterSprite.js";
import { dressSpriteFlutterShapesByFrameTickBit } from "../dressSpriteFlutterShapesByFrameTickBit.js";
import { ERA_INDEX, FRAME_TICK } from "../names.js";
import { u8, u16 } from "../../../../core/int.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x4447;
/** The entry the tapes DO reach, which seats this object's chain; the base source and the control. */
const CONTROL_ENTRY = 0x43b7;
const CORPUS_FRAMES = 2500;
const BASE_SPACING = 200;
const BASES = 4;
const SESSIONS = [["coin-start", {}], ["demo", { tape: [] }]];

const IX = 0xa8a0;
const IY = 0xaa24;
const FLUTTER_ERA = 0x04;
const SETTLED = 0x07;
const SHAPE_PAIRS = 0x44f1;
const COLOUR_TABLE = 0x4531;

/** Every data write lands at or below here; the stack seats above it, so the mask hides nothing. */
const DATA_TOP = 0xadff;
/** The registers the dissolved callees leave adrift; asserted as a SUBSET, so an exact rewrite passes. */
const EXCLUDED = ["a", "f", "b", "c", "d", "e", "h", "l", "sp"];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── crafted entries ───────────────────────────────────────────────────────────────────────────
//
// Each row forces one path. heading < 0x40 keeps the boundary test on the near band and takes the
// final swap arm; 0x50 takes the far band and the plain arm. coordY 0xed trips the edge (retire);
// 0x00 clears every boundary window and headByte 0x40 keeps the wrap window shut, so the era logic
// is reached. era 4 is the flutter branch; seed and cc drive its counter; other eras hit the tables.
// [label, era, heading, coordY, headByte, seed, cc]
const SCENARIOS = [
  ["retire", 2, 0x10, 0xed, 0x40, 0x05, 0x00],
  ["flutter-settled", 4, 0x10, 0x00, 0x40, 0x07, 0x00],
  ["flutter-second-colour-keep", 4, 0x10, 0x00, 0x40, 0x05, 0x7f],
  ["flutter-second-colour-clear", 4, 0x10, 0x00, 0x40, 0x05, 0x82],
  ["flutter-cap", 4, 0x10, 0x00, 0x40, 0x01, 0x0a],
  ["flutter-run", 4, 0x10, 0x00, 0x40, 0x40, 0x05],
  ["dress-swapped-0", 0, 0x10, 0x00, 0x40, 0x03, 0x00],
  ["dress-swapped-2", 2, 0x10, 0x00, 0x40, 0x01, 0x00],
  ["dress-plain-3", 3, 0x50, 0x00, 0x40, 0x02, 0x00],
  ["dress-plain-5", 5, 0x50, 0x00, 0x40, 0x00, 0x00],
];

function craft(base, scenario) {
  const [, era, heading, coordY, headByte, seed, cc] = scenario;
  const m = base.clone();
  m.regs.ix = IX;
  m.regs.iy = IY;
  m.mem8[IX + 2] = heading;
  m.mem8[IX + 4] = seed;
  m.mem8[IX + 6] = cc;
  m.mem8[IY + 0x31] = coordY;
  m.mem8[IY] = headByte;
  m.mem8[ERA_INDEX] = era;
  return m;
}

let reachCache = null;
function reach() {
  if (reachCache) return reachCache;
  const perSession = {};
  const bases = [];
  for (const [label, opts] of SESSIONS) {
    let here = 0;
    let control = 0;
    const keep = TRANSLATED.get(CONTROL_ENTRY);
    const m = makeMachine(new Map([
      [TARGET, (mm) => { here++; return oracle(mm); }],
      [CONTROL_ENTRY, (mm) => {
        if (label === "coin-start" && control % BASE_SPACING === 0 && bases.length < BASES) {
          bases.push(mm.clone());
        }
        control++;
        return keep(mm);
      }],
    ]), opts);
    const frames = m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} session stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, CORPUS_FRAMES, `the ${label} session ran short`);
    perSession[label] = { here, control };
  }
  reachCache = { perSession, bases };
  return reachCache;
}

const bases = () => reach().bases;

function corpus() {
  const out = [];
  for (const base of bases()) for (const s of SCENARIOS) out.push([s[0], craft(base, s)]);
  return out;
}

/** Oracle vs candidate on independent clones, the stack scratch masked off the oracle's own pushes. */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const retOracle = oracle(a);
  const retCand = cand(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  let reg = null;
  for (const k of REG_FIELDS) {
    if (EXCLUDED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) { reg = { k, a: a.regs[k], b: b.regs[k] }; break; }
  }
  return { escaped, reg, low, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** The set of data cells (at or below the data top) the oracle moves — the crafted entry's footprint. */
function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  oracle(a);
  const now = a.dumpState();
  const cells = new Set();
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr <= DATA_TOP) cells.add(addr);
  }
  return cells;
}

// ── broken twins: the rewrite with one deliberate defect each ────────────────────────────────
function twin(f) {
  return function body(m) {
    const { regs, mem8 } = m;
    const record = regs.ix;
    const entry = regs.iy;
    if (hasReachedBoundaryBandSelectedByHeading(m)) { if (!f.skipRetire) retireEntryPairIntoCooldown(m); return; }
    const era = mem8[ERA_INDEX];
    if (era === FLUTTER_ERA) {
      const seed = mem8[record + 4];
      if (seed !== SETTLED) {
        const counter = u8(mem8[record + 6] + 1);
        mem8[record + 6] = counter;
        regs.c = counter;
        if (counter & 0x80) return restartAnimationCounterThenDressFlutterSprite(m);
        if (u8(seed + 2) < counter && !f.noCap) mem8[record + 6] = 0x80;
      }
      mem8[entry + 0x30] = f.flutterCode ?? 0x70;
      mem8[entry + 0x32] = f.flutterCode ?? 0x70;
      return dressSpriteFlutterShapesByFrameTickBit(m);
    }
    const index = u8(u8(era * 16) + (mem8[FRAME_TICK] & 0x02));
    const quadrant = (u8(SETTLED - mem8[record + 4]) >> 1) & 0x03;
    regs.hl = SHAPE_PAIRS;
    regs.a = u8(quadrant * 4 + index);
    offsetAddress(m);
    const lo = mem8[regs.hl];
    const hi = mem8[u16(regs.hl + 1)];
    regs.hl = COLOUR_TABLE;
    regs.a = era;
    offsetAddress(m);
    const colour = mem8[regs.hl];
    if (u8(mem8[record + 2] + 0x40) < 0x80) {
      mem8[entry + 1] = f.noSwap ? lo : hi;
      mem8[entry + 3] = f.noSwap ? hi : lo;
      mem8[entry + 0x30] = f.biasCarry ? u8(colour + 0x80) : colour;
      mem8[entry + 0x32] = f.biasCarry ? u8(colour + 0x80) : colour;
    } else {
      mem8[entry + 1] = lo;
      mem8[entry + 3] = hi;
      mem8[entry + 0x30] = f.noBias ? colour : u8(colour + 0x80);
      mem8[entry + 0x32] = f.noBias ? colour : u8(colour + 0x80);
    }
  };
}

/** [label, twin, the scenarios it must be caught on]. */
const TWINS = [
  ["no-op", () => {}, SCENARIOS.map((s) => s[0])],
  ["skip-retire", twin({ skipRetire: true }), ["retire"]],
  ["no-cap", twin({ noCap: true }), ["flutter-cap"]],
  ["flutter-code", twin({ flutterCode: 0x71 }), ["flutter-settled", "flutter-cap", "flutter-run"]],
  ["no-swap", twin({ noSwap: true }), ["dress-swapped-0", "dress-swapped-2"]],
  ["bias-carry", twin({ biasCarry: true }), ["dress-swapped-0", "dress-swapped-2"]],
  ["no-bias", twin({ noBias: true }), ["dress-plain-3", "dress-plain-5"]],
];

/** BUG: scribbles a cursor outside the ceiling; the control for EXCLUDED. */
function brokenMovesCursor(m) {
  const r = candidate(m);
  m.regs.ix = (m.regs.ix + 1) & 0xffff;
  return r;
}

function movedOver(cand) {
  const moved = new Set();
  for (const [, c] of corpus()) {
    const a = c.clone();
    const b = c.clone();
    oracle(a);
    cand(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────
test("REACH: nothing dispatches this address on either tape, with a live control", { skip }, () => {
  for (const [label] of SESSIONS) {
    const r = reach().perSession[label];
    assert.equal(r.here, 0, `${label} now dispatches this address, so crafted entries are no longer the best evidence`);
    // ★ The zero is evidence only because the same run counted an entry that IS reached.
    assert.ok(r.control > 0, `${label}: the control entry was not reached either, so the zero says nothing`);
    console.log(`  REACH/${label}: this address ${r.here}; the control ${hex4(CONTROL_ENTRY)} ${r.control}`);
  }
  assert.equal(bases().length, BASES, "the crafted base count moved");
});

test("EQUAL: every crafted path replays identically, and the corpus is not vacuous", { skip }, () => {
  for (const [label, c] of corpus()) {
    const r = compare(candidate, c);
    assert.equal(r.escaped, null, `${label}: escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.equal(r.reg, null, `${label}: register ${r.reg && r.reg.k} diverged`);
    // ★ The mask is safe only if it never covers a data cell: its floor must sit above them all.
    assert.ok(r.low > DATA_TOP, `${label}: the stack window ${hex4(r.low)} reached into game data`);
  }
  const informative = corpus().filter(([, c]) => footprint(c).size > 0).length;
  assert.equal(informative, corpus().length, "some crafted entry makes the oracle write nothing, so its comparison has no power");
  console.log(`  EQUAL: ${corpus().length} crafted entries identical, all informative`);
});

test("PATHS: the branches move different memory, so no twin that confuses them is invisible", { skip }, () => {
  const foot = (label) => footprint(craft(bases()[0], SCENARIOS.find((s) => s[0] === label)));
  const eq = (x, y) => x.size === y.size && [...x].every((v) => y.has(v));
  assert.ok(!eq(foot("retire"), foot("flutter-settled")), "retire and flutter touch the same cells");
  assert.ok(!eq(foot("dress-swapped-0"), foot("flutter-cap")), "the dress and flutter arms touch the same cells");
  console.log(`  PATHS: retire ${foot("retire").size}, flutter ${foot("flutter-settled").size}, dress ${foot("dress-swapped-0").size} cells`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const [label, c] of corpus()) {
    const r = compare(candidate, c);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops a return the rewrite does not`);
    assert.equal(r.retOracle, r.retCand, `${label}: the return value diverged`);
  }
  console.log("  SP: +2 on every path; return values identical");
});

test("EXCLUDED, measured: nothing moves outside the ceiling, with a control that does", { skip }, () => {
  const moved = movedOver(candidate);
  const control = movedOver(brokenMovesCursor);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !EXCLUDED.includes(k)),
    "the instrument reports nothing even for a twin that scribbles a cursor, so a clean reading proves nothing");
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k)), [],
    "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: observed moving ${EXCLUDED.filter((k) => moved.has(k)).join(", ")}; ` +
    `control also moves ${REG_FIELDS.filter((k) => control.has(k) && !EXCLUDED.includes(k)).join(", ")}`);
});

for (const [label, brokenTwin, targets] of TWINS) {
  test(`TEETH: the ${label} twin is caught`, { skip }, () => {
    let caught = 0;
    const on = new Set();
    for (const [name, c] of corpus()) if (compare(brokenTwin, c).escaped || compare(brokenTwin, c).reg) {
      caught++;
      on.add(name);
    }
    assert.ok(caught > 0, `every crafted entry PASSED the ${label} twin`);
    assert.deepEqual([...on].sort(), [...targets].sort(), `the ${label} twin's caught scenarios moved`);
    assert.equal(caught, targets.length * BASES, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${corpus().length} crafted entries`);
  });
}
