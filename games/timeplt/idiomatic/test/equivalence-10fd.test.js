// SPDX-License-Identifier: GPL-3.0-only
/**
 * spinRemainingSpriteMultiplexSlots — memory-equivalent to the frozen oracle at ROM 0x10FD.
 * GATE: crafted entries over machines captured at the enclosing pass, driving all three entry arms
 *   (skip / trade-from-register / restart); the raster pinned so the sweeps time writes not the
 *   hold; the whole dump compared with nothing masked; and teeth. Each entry is seated as the frozen
 *   CALL hands it over: the held byte from A, and the request test from the Z flag (`dispatched`).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { spinRemainingSpriteMultiplexSlots } from "../spinRemainingSpriteMultiplexSlots.js";
import { loc_10fd as oracle } from "../../translated/loc_10fd.js";
import { loc_10f8 } from "../loc_10f8.js";
import { loc_1098 as enclosing } from "../../translated/loc_1098.js";
import { loc_15ca as caller } from "../../translated/loc_15ca.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x10fd;
const CALLER = 0x15ca;
const ENCLOSING = 0x1098;
const RASTER = 0xc000;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const HALF = 128;
const Z = 0x40;

/** The first slot is handled from the entry register; the four tail slots are read from memory. */
const FIRST = { request: 0xb437, partner: 0xb036 };
const TAIL = [
  { request: 0xb439, partner: 0xb038 },
  { request: 0xb43b, partner: 0xb03a },
  { request: 0xb43d, partner: 0xb03c },
  { request: 0xb43f, partner: 0xb03e },
];
/** The slot BEFORE this range, which the tail of another pass owns and this routine must not. */
const BEFORE = { request: 0xb435, partner: 0xb034 };

/** Winds the raster to 200: past every hold, so a busy slot trades at once with no spin. */
const PIN = 43190;
const PATTERNS = 1 << TAIL.length;

/** The ceiling on divergence: the oracle churns these and takes a return the rewrite does not. */
const MOVED = ["a", "c", "f", "sp"];

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** Drop decoded graphics from a captured machine: nothing here renders and cloning one is slow. */
function lean(mm) {
  mm.assets = {};
  mm.video = null;
  return mm;
}

let captured = null;
function capture() {
  if (captured) return captured;
  const entries = [];
  const m = makeMachine(new Map([[ENCLOSING, (mm) => {
    if (entries.length < 60) entries.push(lean(mm.clone()));
    return enclosing(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "capture run ran short");
  assert.ok(entries.length > 0, "vacuous: the enclosing routine was never dispatched either");
  captured = entries;
  return captured;
}

/** A captured machine, raster pinned, with the entry register/flag and slot bytes set by `setup`. */
function craft(setup) {
  const m = capture()[0].clone();
  m.cycles = PIN;
  setup(m);
  return m;
}

/** Set Z (skip the first slot) or clear it (the first slot is live), and seat the held byte. */
function entry(m, zSet, held) {
  m.regs.f = zSet ? m.regs.f | Z : m.regs.f & ~Z;
  m.regs.a = held;
}

/** The rewrite entered as the frozen CALL enters 0x10FD: held byte in A, request test as Z clear. */
const dispatched = (m) => spinRemainingSpriteMultiplexSlots(m, m.regs.a, (m.regs.f & Z) === 0);

/** Oracle vs candidate on independent clones: the whole dump, then every register but the ceiling. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  return null;
}

/** Quiet the slots this routine reads; the slot BEFORE it is left BUSY so a reach-back shows. */
function quiet(m) {
  m.mem8[FIRST.request] = 0;
  m.mem8[FIRST.partner] = 40;
  m.mem8[BEFORE.request] = HALF + 7;
  m.mem8[BEFORE.partner] = 41;
  for (let i = 0; i < TAIL.length; i++) {
    m.mem8[TAIL[i].request] = 0;
    m.mem8[TAIL[i].partner] = 50 + i;
  }
}

// ── the crafted regimes, each returning how many diverged ─────────────────────────────────

/** SKIP: Z set, so the first slot is stepped over; all 16 tail patterns, each slot distinct. */
function sweepSkip(candidate) {
  let caught = 0;
  for (let mask = 0; mask < PATTERNS; mask++) {
    const m = craft((mm) => {
      entry(mm, true, 200);
      quiet(mm);
      mm.mem8[FIRST.request] = 200;
      for (let i = 0; i < TAIL.length; i++) mm.mem8[TAIL[i].request] = (mask >> i) & 1 ? HALF + i : 9 + i;
    });
    if (unitDiff(candidate, m)) caught++;
  }
  return caught;
}

/** TRADE: Z clear and the held byte forces carry; the first slot trades from that byte, not memory.
 *  `held` is walked over every value that carries at this raster, so both halves of the mask show. */
function sweepTrade(candidate) {
  let caught = 0;
  for (let held = 56; held < 256; held++) {
    const m = craft((mm) => {
      entry(mm, false, held);
      quiet(mm);
      mm.mem8[FIRST.request] = 5;
      mm.mem8[TAIL[0].request] = HALF + 3;
    });
    if (unitDiff(candidate, m)) caught++;
  }
  return caught;
}

/** RESTART: Z clear but the held byte cannot carry, so the whole pass restarts and re-reads memory. */
function sweepRestart(candidate) {
  let caught = 0;
  for (let mask = 0; mask < PATTERNS; mask++) {
    const m = craft((mm) => {
      entry(mm, false, 0);
      quiet(mm);
      mm.mem8[FIRST.request] = 200;
      for (let i = 0; i < TAIL.length; i++) mm.mem8[TAIL[i].request] = (mask >> i) & 1 ? HALF + i : 9 + i;
    });
    if (unitDiff(candidate, m)) caught++;
  }
  return caught;
}

/** PARTNERS: one slot requesting, its partner walked over every value so the byte wrap is covered. */
function sweepPartners(candidate) {
  let caught = 0;
  for (let value = 0; value < 256; value++) {
    const m = craft((mm) => {
      entry(mm, false, 200);
      quiet(mm);
      mm.mem8[FIRST.partner] = value;
      mm.mem8[TAIL[0].request] = HALF;
      mm.mem8[TAIL[0].partner] = value;
    });
    if (unitDiff(candidate, m)) caught++;
  }
  return caught;
}

const RUNS = { skip: PATTERNS, trade: 200, restart: PATTERNS, partners: 256 };
const sweepAll = (c) => sweepSkip(c) + sweepTrade(c) + sweepRestart(c) + sweepPartners(c);

// ── broken twins ──────────────────────────────────────────────────────────────────────────

/** BUG: does nothing, the tell of a gate measuring an idle entry. */
function brokenNoOp() {}

/** BUG: the whole pass from memory always — the marshalling leak, ignoring the entry register. */
const brokenAlwaysHead = (m) => loc_10f8(m);

/** BUG: the first slot subtracts the half instead of clearing the top bit; a bit-7-clear held wraps. */
function brokenSubtractHalf(m) {
  const { regs, mem8 } = m;
  if (!regs.fZ) {
    if (((regs.a + mem8[RASTER]) & 0x100) === 0) return loc_10f8(m);
    mem8[FIRST.request] = (regs.a - HALF) & 0xff;
    mem8[FIRST.partner] = mem8[FIRST.partner] + HALF;
  }
  for (const s of TAIL) {
    const request = mem8[s.request];
    if (request < HALF) continue;
    mem8[s.request] = request - HALF;
    mem8[s.partner] = mem8[s.partner] + HALF;
  }
}

/** BUG: trades the first slot without waiting for the raster, so the restart arm is skipped. */
function brokenIgnoreCarry(m) {
  const { regs, mem8 } = m;
  if (!regs.fZ) {
    mem8[FIRST.request] = regs.a & 0x7f;
    mem8[FIRST.partner] = mem8[FIRST.partner] + HALF;
  }
  for (const s of TAIL) {
    const request = mem8[s.request];
    if (request < HALF) continue;
    mem8[s.request] = request - HALF;
    mem8[s.partner] = mem8[s.partner] + HALF;
  }
}

/** BUG: reaches back into the slot before this range, which the pass ahead of it owns. */
function brokenReachesBack(m) {
  dispatched(m);
  const { mem8 } = m;
  if (mem8[BEFORE.request] >= HALF) mem8[BEFORE.request] = mem8[BEFORE.request] - HALF;
}

/** BUG: scribbles on an index register, the in-arm control that the ceiling check sees one move. */
function brokenMovesIndex(m) {
  dispatched(m);
  m.regs.ix = (m.regs.ix + 1) & 0xffff;
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["always-head", brokenAlwaysHead],
  ["subtract-half", brokenSubtractHalf],
  ["ignore-carry", brokenIgnoreCarry],
  ["reaches-back", brokenReachesBack],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("REACHABILITY: nothing dispatches this address, with a positive control", { skip }, () => {
  const seen = { [TARGET]: 0, [CALLER]: 0, [ENCLOSING]: 0 };
  for (const opts of [{}, { tape: [] }]) {
    const overrides = new Map([
      [TARGET, (mm) => (seen[TARGET]++, oracle(mm))],
      [CALLER, (mm) => (seen[CALLER]++, caller(mm))],
      [ENCLOSING, (mm) => (seen[ENCLOSING]++, enclosing(mm))],
    ]);
    const m = makeMachine(overrides, opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `reachability run stopped early: ${m.stoppedBy}`);
  }
  // ★ The zero is evidence ONLY because the same taps, in the same runs, counted the enclosing pass.
  assert.ok(seen[ENCLOSING] > 0, "the tap counted nothing for the enclosing pass either, so the " +
    "instrument is broken and the zero beside it means nothing");
  assert.equal(seen[TARGET], 0, "this address IS dispatched now, so the crafted entries below are " +
    "no longer the best evidence and the gate should capture real ones");
  assert.equal(seen[CALLER], 0, "the caller runs now, so real captures at this address are available");
  console.log(`  REACHABILITY: ${hex4(TARGET)} entered ${seen[TARGET]}, its caller ` +
    `${hex4(CALLER)} ${seen[CALLER]}; the control ${hex4(ENCLOSING)} ${seen[ENCLOSING]}`);
});

test("WINDOW: the oracle pushes nothing, so the whole dump is compared", { skip }, () => {
  let deepest = 0;
  for (const setup of [
    (m) => entry(m, true, 200),
    (m) => (entry(m, false, 255), (m.mem8[FIRST.request] = 200)),
    (m) => entry(m, false, 0),
  ]) {
    const m = craft((mm) => {
      for (const s of [FIRST, ...TAIL]) mm.mem8[s.request] = 200;
      setup(mm);
    });
    const seat = m.regs.sp;
    let low = seat;
    const push = m.push16.bind(m);
    m.push16 = (v) => {
      const r = push(v);
      if (m.regs.sp < low) low = m.regs.sp;
      return r;
    };
    oracle(m);
    deepest = Math.max(deepest, seat - low);
  }
  assert.equal(deepest, 0, "the oracle now pushes, so a masked window is owed and every arm here " +
    "is comparing bytes it has no right to");
  console.log("  WINDOW (measured): the oracle reaches 0 bytes below its seat");
});

test("SKIP: Z set steps over the first slot; the tail trades on its own bits", { skip }, () => {
  assert.equal(sweepSkip(dispatched), 0, "a skip pattern diverged");
  const untouched = craft((m) => {
    entry(m, true, 200);
    quiet(m);
    m.mem8[FIRST.request] = 200;
  });
  dispatched(untouched);
  assert.equal(untouched.mem8[FIRST.request], 200, "the first slot was traded even though Z was set");
  console.log(`  SKIP: ${RUNS.skip} patterns identical; the first slot stands when Z is set`);
});

test("TRADE: Z clear trades the first slot FROM THE REGISTER, not from memory", { skip }, () => {
  assert.equal(sweepTrade(dispatched), 0, "a trade value diverged");
  // The one call site is a CALL NZ, so the rewrite's default is the request-set entry.
  assert.equal(sweepTrade((mm) => spinRemainingSpriteMultiplexSlots(mm)), 0,
    "the default entry diverged from a CALL NZ entry");
  // ★ The load-bearing property: the first slot's new request is the held byte masked, and memory
  //   held something else entirely — a rewrite that re-read memory would land 5, not 100.
  const m = craft((mm) => {
    entry(mm, false, 100);
    quiet(mm);
    mm.mem8[FIRST.request] = 5;
  });
  dispatched(m);
  assert.equal(m.mem8[FIRST.request], 100, "the first slot must come from the held byte, not memory");
  console.log(`  TRADE: ${RUNS.trade} held values identical; the first slot lands the register byte`);
});

test("RESTART: Z clear but no carry restarts the pass and re-reads every slot", { skip }, () => {
  assert.equal(sweepRestart(dispatched), 0, "a restart pattern diverged");
  console.log(`  RESTART: ${RUNS.restart} patterns identical`);
});

test("PARTNERS: the partner byte over every value, the wrap included", { skip }, () => {
  assert.equal(sweepPartners(dispatched), 0, "a partner value diverged");
  const wrap = craft((m) => {
    entry(m, false, 200);
    quiet(m);
    m.mem8[TAIL[0].request] = HALF;
    m.mem8[TAIL[0].partner] = 200;
  });
  dispatched(wrap);
  assert.equal(wrap.mem8[TAIL[0].partner], 72, "the partner must wrap in a byte, not widen");
  console.log(`  PARTNERS: ${RUNS.partners} values identical, including the wrap`);
});

/** Which registers a candidate parts company with the oracle on, over the trade regime. */
function movedOver(candidate) {
  const moved = new Set();
  for (let held = 56; held < 256; held += 25) {
    const m = craft((mm) => {
      entry(mm, false, held);
      quiet(mm);
      mm.mem8[TAIL[0].request] = HALF;
    });
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

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(dispatched);
  const control = movedOver(brokenMovesIndex);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
    "the measurement reports nothing outside the ceiling even for a twin that scribbles on an " +
      "index register, so a clean reading below proves nothing");
  // ★ MOVED is a CEILING: deepEqual against it would DEMAND the divergence and refuse a fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${MOVED.join(", ")}`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const s = sweepSkip(twin);
    const t = sweepTrade(twin);
    const r = sweepRestart(twin);
    const p = sweepPartners(twin);
    console.log(`  TEETH/${label}: caught on ${s}/${RUNS.skip} skip, ${t}/${RUNS.trade} trade, ` +
      `${r}/${RUNS.restart} restart, ${p}/${RUNS.partners} partners`);
    assert.ok(s + t + r + p > 0, `every sweep PASSED the ${label} twin`);
  });
}
