// SPDX-License-Identifier: GPL-3.0-only
/**
 * seedRandomRegister — memory-equivalent to the frozen oracle at ROM 0x4B67.
 *
 * WHAT IT IS. A block copy out of program space into the random register's seventeen bytes, then a
 * guard: three bytes taken from two fixed words of program space, added to a constant, and a
 * transfer to an address outside the image unless the total comes round to zero. THE TRANSFER IS
 * THE THROW. It is a guard branch inside a real routine, not a stub standing in for missing work —
 * the routine emulates its copy and its arithmetic, and the SEED and GUARD arms below both run.
 *
 * ★ HOW THE LIVE-OUT WAS DERIVED, AND IT IS FROM THE ORACLE. The oracle's only ordinary exit is its
 *   own return. Of the two return sites this port has transcribed, one stores the ACCUMULATOR to a
 *   latch as its very next instruction and the other loads a fresh address pair before reading
 *   anything; so the accumulator is live and the rest of the register dance is not. The rewrite
 *   therefore leaves the accumulator holding the guard total and drops the rest, and the EXCLUDED
 *   arm asserts the accumulator HELD rather than merely permitted to move.
 *
 * ★ NO STACK IS MASKED, AND THAT IS MEASURED. The oracle pushes nothing at all on this path, so
 *   every comparison here is the WHOLE dump, scratch included. The NO SCRATCH arm instruments the
 *   oracle's own `push16` over the whole sweep and requires zero, with a control that the same
 *   instrument reports a nonzero when a push really happens.
 *
 * ★ THE GUARD BRANCH IS EXERCISED, NOT ARGUED ABOUT. Its operands live in program space, which the
 *   address space refuses to write, so no poke can reach them. The GUARD arm instead builds a
 *   machine on a TAMPERED COPY of the image with the state of a real captured dispatch carried
 *   over, and requires BOTH sides to fault there and NEITHER to fault on the shipped image. That
 *   is also the positive control for the absence: without it, "the guard never fires" would be
 *   indistinguishable from a gate that cannot make it fire.
 *
 * ★ SP AND pc BELONG TO THE DISPATCH SEAM. The oracle nets one return; the rewrite performs none.
 *   The candidate runs THROUGH `withOmittedRet`, and SP and pc are then compared for EQUALITY.
 *
 * GATE: strict unit-capture over every dispatch of two real sessions, a crafted sweep over the
 *   destination's prior contents, a tampered-image arm, and a whole-machine replay.
 *
 *   1. REACH — dispatch counts per session, measured and pinned.
 *   2. EQUAL — the whole dump identical at the first dispatch of each session, SP and pc included.
 *   3. NOT VACUOUS — a candidate that does nothing FAILS the same comparison.
 *   4. NO SCRATCH — the oracle's push depth over the whole sweep, with a control.
 *   5. CORPUS — every dispatch of both sessions replays identically.
 *   6. CRAFTED — the seventeen bytes and both neighbours forced to eight prior patterns, which is
 *      what makes "wrote the right bytes" separable from "found them already right".
 *   7. THE SEED IS FAITHFUL — the destination is compared against the source range read back out
 *      of program space at run time, so the expected bytes are never written down here, and both
 *      neighbours are required untouched.
 *   8. GUARD — the tampered image above.
 *   9. VERDICT — the accumulator both sides leave, and that it is the total the guard tested.
 *  10. EXCLUDED — the registers that move, bounded by a CEILING asserted as a subset, with the
 *      accumulator asserted HELD and a positive control.
 *  11. WHOLE-MACHINE — a wired session of each tape through a shim that also restores the oracle's
 *      T-state cost, differing only in dead stack bytes; and the same instrument catching a
 *      do-nothing twin.
 *  12. TEETH — eight twins on exact counts, including one the sound image is BLIND to and only the
 *      tampered image catches.
 *
 * WHY THE WHOLE-MACHINE SHIM RESTORES T-STATES. No idiomatic module spends any, and the engine this
 * arm drives is cycle-driven, so a rewrite moves the frame phase. Measured here: without the shim
 * this arm reports a dozen character cells differing, all of them phase and none of them memory.
 *
 * HOLE: the SOURCE cannot be varied. It lives in program space, which the address space refuses to
 * write, so every arm varies the destination and reads the source as it is. The GUARD arm is the
 * one exception and it reaches program space by REBUILDING the machine, not by writing to it.
 * HOLE: the corpus is three dispatches across two sessions, all in boot or attract restart, so the
 * crafted priors are doing all the discriminating.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4b67.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { seedRandomRegister } from "../seedRandomRegister.js";
import { loc_4b67 as oracle } from "../../translated/loc_4b67.js";
import { RANDOM_REGISTER } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x4b67;

const SEED_SOURCE = 0x4b84;
const SEED_BYTES = 17;
const GUARD_WORD_A = 0x086d;
const GUARD_BIAS = 0x44;

const CORPUS_FRAMES = 2500;
const SESSIONS = [["coin-start", {}], ["demo", { tape: [] }]];

/** Measured over CORPUS_FRAMES. A move is a finding about the tapes, not a tolerance to widen. */
const DISPATCHES = { "coin-start": 1, demo: 2 };

/** Prior contents forced onto the destination and both its neighbours. */
const PRIORS = [0x00, 0xff, 0x55, 0xaa, 0x01, 0x80, 0x7f, 0xf0];
const CRAFTED = 24;

/**
 * A CEILING on the registers that may differ, not a pin: asserted as a subset, so a rewrite that
 * happens to agree on one of these still passes. What is asserted positively is HELD.
 */
const MAY_MOVE = ["f", "b", "d", "e", "h", "l", "ix"];
const HELD = ["a", "sp"];

/** Measured: the dead stack cells a whole wired session leaves differing, as a CEILING. */
const SESSION_SCRATCH = [0xafec, 0xafed];
const STACK_FLOOR = 0xaf00;
const STACK_TOP = 0xb000;
const RET_TSTATES = 10;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d === null || d === undefined ? "identical" : `${d.key ?? hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}`;

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

/** Oracle vs candidate on clones of one machine, over the WHOLE dump — nothing is masked here. */
function diffOf(candidate, machine) {
  const before = machine.dumpState();
  const a = machine.clone();
  const b = machine.clone();
  let faultA = null;
  let faultB = null;
  try { oracle(a); } catch (e) { faultA = e.constructor.name; }
  try { seam(candidate)(b); } catch (e) { faultB = e.constructor.name; }
  if (faultA !== null || faultB !== null) {
    return { faulted: true, faultA, faultB, raw: [], moved: [], informative: false,
      caught: faultA !== faultB, spDiff: null, pcDiff: null, a, b };
  }
  const raw = allDiffs(a, b);
  const da = a.dumpState();
  let informative = false;
  for (let i = 0; i < da.length; i++) if (da[i] !== before[i]) { informative = true; break; }
  const spDiff = a.regs.sp !== b.regs.sp ? { key: "sp", a: a.regs.sp, b: b.regs.sp } : null;
  const pcDiff = a.pc !== b.pc ? { key: "pc", a: a.pc, b: b.pc } : null;
  return {
    faulted: false, faultA, faultB, raw, informative,
    moved: REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    spDiff, pcDiff, a, b,
    caught: raw.length > 0 || spDiff !== null || pcDiff !== null,
  };
}

/** How far below its seat a function's own pushes take the stack pointer, on one machine. */
function pushDepth(fn, machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  try { fn(c); } catch { /* a faulting run still pushed whatever it pushed */ }
  return seat - deepest;
}

/**
 * The same machine on a CHANGED program image. Program space is read-only through the address
 * space, so the only way to put a different byte there is to build the machine around one — the
 * captured state is carried over exactly as `clone` carries it, and the frame machinery is
 * neutralised the same way, so the only difference from a clone is the one byte.
 */
function onTamperedImage(entry, at) {
  const rom = Uint8Array.from(entry.rom);
  rom[at] = (rom[at] + 1) & 0xff;
  const t = new Machine(rom, entry.routines, entry.assets);
  t.mem.colorRam.set(entry.mem.colorRam);
  t.mem.videoRam.set(entry.mem.videoRam);
  t.mem.workRam.set(entry.mem.workRam);
  t.mem.sprite0.set(entry.mem.sprite0);
  t.mem.sprite1.set(entry.mem.sprite1);
  t.regs.copyFrom(entry.regs);
  t.io.loadStateFrom(entry.io);
  t.cycles = entry.cycles;
  t.pc = entry.pc;
  t.nextBoundary = Infinity;
  t.nextNmi = Infinity;
  t.maxFrames = Infinity;
  t.maxCycles = Infinity;
  return t;
}

// ── the sessions ────────────────────────────────────────────────────────────────────────

const entries = new Map();
const sessionCache = new Map();

function runSession(label, opts) {
  const captured = [];
  const moved = new Set();
  let caught = 0;
  let informative = 0;
  let deepest = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    captured.push(mm.clone());
    if (!entries.has(label)) entries.set(label, mm.clone());
    const r = diffOf(seedRandomRegister, mm);
    if (r.informative) informative++;
    for (const k of r.moved) moved.add(k);
    if (r.caught) caught++;
    deepest = Math.max(deepest, pushDepth(oracle, mm));
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `the ${label} session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, `the ${label} session ran short`);
  return { label, captured, moved, caught, informative, deepest };
}

function session(label) {
  if (!sessionCache.has(label)) {
    const spec = SESSIONS.find(([l]) => l === label);
    sessionCache.set(label, runSession(label, spec[1]));
  }
  return sessionCache.get(label);
}

const sessions = () => SESSIONS.map(([label]) => session(label));

function entryFor(label) {
  session(label);
  const e = entries.get(label);
  assert.notEqual(e, undefined, `the ${label} session never reaches the routine`);
  return e;
}

/** A real captured machine with the destination and both neighbours filled with one byte. */
function craft(machine, prior) {
  const m = machine.clone();
  m.mem8[RANDOM_REGISTER - 1] = prior;
  for (let i = 0; i < SEED_BYTES; i++) m.mem8[RANDOM_REGISTER + i] = prior;
  m.mem8[RANDOM_REGISTER + SEED_BYTES] = prior;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  crossCache = [];
  for (const s of sessions()) {
    for (const captured of s.captured) {
      for (const prior of PRIORS) crossCache.push({ label: s.label, machine: craft(captured, prior), prior });
    }
  }
  return crossCache;
}

const craftedCaught = (twin) => cross().filter((c) => diffOf(twin, c.machine).caught).length;

// ── the twins ───────────────────────────────────────────────────────────────────────────

const copy = (m, dest, src, n) => {
  for (let i = 0; i < n; i++) m.mem8[dest + i] = m.mem8[src + i];
};
const guard = (m) => {
  const a = m.mem16[GUARD_WORD_A];
  const b = m.mem16[GUARD_WORD_A + 3];
  m.regs.a = ((a & 0xff) + (a >> 8) + (b & 0xff) + GUARD_BIAS) & 0xff;
  if (m.regs.a !== 0) throw new Error("the guard total did not come to zero");
};

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: stops one byte short, so the last seed byte is stale. */
function brokenOneShort(m) { copy(m, RANDOM_REGISTER, SEED_SOURCE, SEED_BYTES - 1); guard(m); }

/** BUG: runs one byte long, so the cell past the register is trampled. */
function brokenOneLong(m) { copy(m, RANDOM_REGISTER, SEED_SOURCE, SEED_BYTES + 1); guard(m); }

/** BUG: lands one byte low, so the whole register is shifted and its neighbour trampled. */
function brokenOffsetDestination(m) { copy(m, RANDOM_REGISTER - 1, SEED_SOURCE, SEED_BYTES); guard(m); }

/** BUG: takes the block from one byte on, so every seed byte is off. */
function brokenOffsetSource(m) { copy(m, RANDOM_REGISTER, SEED_SOURCE + 1, SEED_BYTES); guard(m); }

/** BUG: copies the block backwards. */
function brokenReversed(m) {
  for (let i = 0; i < SEED_BYTES; i++) m.mem8[RANDOM_REGISTER + i] = m.mem8[SEED_SOURCE + SEED_BYTES - 1 - i];
  guard(m);
}

/** BUG: the guard is dropped, so a changed image is waved through. Invisible on a sound one. */
function brokenNoGuard(m) {
  copy(m, RANDOM_REGISTER, SEED_SOURCE, SEED_BYTES);
  m.regs.a = 0;
}

/** BUG: the guard's constant is one out, so a sound image is refused. */
function brokenWrongBias(m) {
  copy(m, RANDOM_REGISTER, SEED_SOURCE, SEED_BYTES);
  const a = m.mem16[GUARD_WORD_A];
  const b = m.mem16[GUARD_WORD_A + 3];
  m.regs.a = ((a & 0xff) + (a >> 8) + (b & 0xff) + GUARD_BIAS + 1) & 0xff;
  if (m.regs.a !== 0) throw new Error("the guard total did not come to zero");
}

/** NOT A TWIN OF THIS ROUTINE: the positive control for the held-register instrument. */
function clobbersAHeldRegister(m) {
  seedRandomRegister(m);
  m.regs.a = (m.regs.a + 1) & 0xff;
}

/**
 * Measured: crafted catches on the shipped image, then whether the changed image catches it. A
 * twin that throws where the oracle throws is NOT caught there — the comparison stops at the
 * matching fault — so `false` in the second column is the ordinary case and only a twin that
 * changes WHETHER the guard fires shows up in it.
 */
const TWINS = [
  ["no-op", brokenNoOp, 24, true],
  ["one-short", brokenOneShort, 24, false],
  ["one-long", brokenOneLong, 21, false],
  ["offset-destination", brokenOffsetDestination, 24, false],
  ["offset-source", brokenOffsetSource, 24, false],
  ["reversed", brokenReversed, 24, false],
  ["no-guard", brokenNoGuard, 0, true],
  ["wrong-bias", brokenWrongBias, 24, false],
];

// ── the whole machine ───────────────────────────────────────────────────────────────────

const baselineCache = new Map();
function baselineFrames(label, opts) {
  if (!baselineCache.has(label)) {
    const base = makeMachine(undefined, opts);
    baselineCache.set(label, {
      frames: base.runFrames(CORPUS_FRAMES),
      toAddr: (o) => base.stateOffsetToAddr(o),
    });
  }
  return baselineCache.get(label);
}

/**
 * The candidate wired as the game dispatches it, with the oracle's own T-state cost measured on a
 * clone and given back, so the arm reports on memory rather than on frame phase.
 */
function hosted(candidate, fired) {
  return seam((mm) => {
    fired.n++;
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const spent = probe.cycles - before;
    const r = candidate(mm);
    mm.tick(spent - RET_TSTATES);
    return r;
  });
}

function wholeRunCells(candidate, label, opts) {
  const { frames: baseFrames, toAddr } = baselineFrames(label, opts);
  const fired = { n: 0 };
  const host = makeMachine(new Map([[TARGET, hosted(candidate, fired)]]), opts);
  let hostFrames = [];
  let threw = null;
  try { hostFrames = host.runFrames(CORPUS_FRAMES); } catch (e) { threw = String(e).slice(0, 100); }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(toAddr(o));
    }
  }
  return { cells: [...cells].sort((x, y) => x - y), frames: n, fired: fired.n, threw,
    stopped: host.stoppedBy };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REACH: the dispatch count of each session", { skip }, () => {
  for (const s of sessions()) {
    assert.ok(s.captured.length > 0, `vacuous: the ${s.label} session never reaches the routine`);
    assert.equal(s.captured.length, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.ok(s.informative > 0, `no ${s.label} dispatch writes anything at all`);
    console.log(`  REACH/${s.label}: ${s.captured.length} dispatches, ${s.informative} informative`);
  }
});

test("EQUAL at the first dispatch of each session: the whole dump, SP and pc", { skip }, () => {
  for (const [label] of SESSIONS) {
    const r = diffOf(seedRandomRegister, entryFor(label));
    assert.equal(r.faultA, null, `${label}: the oracle faulted (${r.faultA})`);
    assert.equal(r.faultB, null, `${label}: the rewrite faulted (${r.faultB})`);
    assert.deepEqual(r.raw, [], `${label}: ${show(r.raw[0])}`);
    assert.equal(r.spDiff, null, `${label}: the stack pointer must come back to the same seat`);
    assert.equal(r.pcDiff, null, `${label}: the seam must land pc where the caller's slot pointed`);
    console.log(`  EQUAL/${label}: every byte identical, the stack scratch included`);
  }
});

test("NOT VACUOUS: a candidate that does nothing FAILS the same comparison", { skip }, () => {
  for (const [label] of SESSIONS) {
    const r = diffOf(brokenNoOp, craft(entryFor(label), 0x5a));
    assert.ok(r.caught, `${label}: the comparison passed a candidate that does nothing`);
  }
  const r = diffOf(brokenNoOp, craft(entryFor(SESSIONS[0][0]), 0x5a));
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(r.raw[0])}`);
});

test("NO SCRATCH: the oracle pushes nothing here, measured, with a control", { skip }, () => {
  let deepest = 0;
  for (const s of sessions()) deepest = Math.max(deepest, s.deepest);
  for (const c of cross()) deepest = Math.max(deepest, pushDepth(oracle, c.machine));
  const probe = (mm) => { mm.push16(0x1234); oracle(mm); mm.pop16(); };
  const control = pushDepth(probe, entryFor(SESSIONS[0][0]));
  assert.ok(control > 0, "the depth instrument reports zero even for a run that pushes, so the " +
    "zero below is a property of the instrument rather than of the oracle");
  assert.equal(deepest, 0, `the oracle now reaches ${deepest} bytes below its seat, so this file ` +
    "compares stack scratch it can no longer justify comparing");
  console.log(`  NO SCRATCH: oracle depth ${deepest}; the same instrument reports ${control} for a ` +
    "run that pushes");
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.captured.length;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical over the whole dump`);
});

test("CRAFTED: every prior pattern of the destination is identical", { skip }, () => {
  assert.equal(cross().length, CRAFTED, "the crafted sweep changed size");
  let informative = 0;
  for (const c of cross()) {
    const r = diffOf(seedRandomRegister, c.machine);
    assert.equal(r.faulted, false, `${c.label} prior ${c.prior}: ${r.faultA} vs ${r.faultB}`);
    assert.deepEqual(r.raw, [], `${c.label} prior ${c.prior}: ${show(r.raw[0])}`);
    assert.equal(r.spDiff, null, "the seam left SP adrift");
    assert.equal(r.pcDiff, null, "the seam left pc adrift");
    if (r.informative) informative++;
  }
  assert.ok(informative > 0, "no crafted entry wrote anything, so `identical` here is a comparison " +
    "with no power");
  console.log(`  CRAFTED: ${cross().length} destination patterns identical, ${informative} informative`);
});

test("THE SEED IS FAITHFUL: the register equals the source, read back at run time", { skip }, () => {
  const m = craft(entryFor(SESSIONS[0][0]), 0x5a);
  seedRandomRegister(m);
  const wrong = [];
  for (let i = 0; i < SEED_BYTES; i++) {
    if (m.mem8[RANDOM_REGISTER + i] !== m.mem8[SEED_SOURCE + i]) wrong.push(i);
  }
  assert.deepEqual(wrong, [], "the copy did not reproduce the source range");
  assert.equal(m.mem8[RANDOM_REGISTER - 1], 0x5a, "the byte before the register must be left alone");
  assert.equal(m.mem8[RANDOM_REGISTER + SEED_BYTES], 0x5a, "and so must the byte after it");
  // The source must not be uniform, or "reproduced the source" would be satisfied by any fill.
  const distinct = new Set(Array.from({ length: SEED_BYTES }, (_u, i) => m.mem8[SEED_SOURCE + i]));
  assert.ok(distinct.size > 1, "the source range is one repeated byte, so this arm cannot tell a " +
    "faithful copy from a fill");
  console.log(`  FAITHFUL: ${SEED_BYTES} bytes match the source (${distinct.size} distinct), ` +
    "neither neighbour touched");
});

test("GUARD: a changed image makes BOTH sides fault, a sound one makes neither", { skip }, () => {
  for (const [label] of SESSIONS) {
    const sound = diffOf(seedRandomRegister, entryFor(label));
    assert.equal(sound.faulted, false, `${label}: the shipped image already trips the guard`);
    const tampered = onTamperedImage(entryFor(label), GUARD_WORD_A);
    const r = diffOf(seedRandomRegister, tampered);
    assert.equal(r.faulted, true, `${label}: a changed image did NOT trip the guard, so the guard ` +
      "branch is untested and the throw might be reachable by nothing at all");
    // The frozen twin jumps outside the image and faults there; the rewrite stops at the jump with
    // the unreached marker.
    assert.ok(r.faultA, `${label}: the frozen twin did not fault`);
    assert.equal(r.faultB, "NotImplemented", `${label}: the rewrite faulted as ${r.faultB}`);
    // Both sides seed BEFORE they test, so the copy must already agree at the point of the fault.
    assert.deepEqual(allDiffs(r.a, r.b), [], `${label}: the two sides had already parted company ` +
      "in memory before the guard fired");
    console.log(`  GUARD/${label}: the shipped image passes; one changed byte at ` +
      `${hex4(GUARD_WORD_A)} faults BOTH sides with ${r.faultA}, memory still identical`);
  }
});

test("VERDICT: the accumulator both sides leave is the guard's own total", { skip }, () => {
  for (const [label] of SESSIONS) {
    const e = entryFor(label);
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    seedRandomRegister(b);
    assert.equal(b.regs.a, a.regs.a, `${label}: the accumulator the caller stores next diverged`);
    assert.equal(a.regs.a, 0, `${label}: the oracle's own total is not zero on the shipped image, ` +
      "so this arm is pinning the wrong value");
    console.log(`  VERDICT/${label}: both sides leave ${a.regs.a}`);
  }
});

test("EXCLUDED: the registers that move, bounded by a ceiling; the verdict is held", { skip }, () => {
  const moved = new Set();
  for (const s of sessions()) for (const k of s.moved) moved.add(k);
  for (const c of cross()) for (const k of diffOf(seedRandomRegister, c.machine).moved) moved.add(k);
  const list = REG_FIELDS.filter((k) => moved.has(k));
  console.log(`  EXCLUDED (measured): ${list.join(", ")} — ceiling ${MAY_MOVE.join(", ")}`);
  // A CEILING, never `deepEqual`: an equality here would DEMAND the divergence and go red on a
  // rewrite that became register-exact.
  assert.deepEqual(list.filter((k) => !MAY_MOVE.includes(k)), [], "a register outside the ceiling moved");
  for (const k of HELD) assert.ok(!moved.has(k), `a register asserted held moved (${k})`);
  const control = new Set(diffOf(clobbersAHeldRegister, entryFor(SESSIONS[0][0])).moved);
  assert.ok(control.has("a"), "the register instrument cannot see the held verdict being clobbered, " +
    "so the assertion above proves nothing");
  console.log(`  EXCLUDED control: the same instrument reports ${[...control].join(", ")} on a clobbered twin`);
});

test("WHOLE-MACHINE: a wired session of each tape differs only in dead stack bytes", { skip }, () => {
  for (const [label, opts] of SESSIONS) {
    const r = wholeRunCells(seedRandomRegister, label, opts);
    assert.equal(r.threw, null, `${label}: the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `${label}: the run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `${label}: compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.ok(r.fired > 0, `${label}: vacuous — the override never dispatched`);
    for (const cell of r.cells) {
      assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${label}: ${hex4(cell)} is not a stack address`);
    }
    assert.deepEqual(r.cells.filter((c) => !SESSION_SCRATCH.includes(c)), [],
      `${label}: a cell outside the measured dead-stack set differs`);
    console.log(`  WHOLE-MACHINE/${label}: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
  }
});

test("WHOLE-MACHINE TEETH: the same instrument catches a do-nothing twin", { skip }, () => {
  for (const [label, opts] of SESSIONS) {
    const r = wholeRunCells(brokenNoOp, label, opts);
    assert.ok(r.fired > 0, `${label}: vacuous — the twin never dispatched`);
    const escaped = r.cells.filter((c) => !SESSION_SCRATCH.includes(c));
    assert.ok(r.threw !== null || escaped.length > 0,
      `${label}: the whole-machine arm passed a candidate that does nothing`);
    console.log(`  WHOLE-MACHINE TEETH/${label}: the no-op leaves ${escaped.length} cells outside the set`);
  }
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crafted, tamperedCatches] of TWINS) {
  test(`TEETH: the ${label} twin, on the shipped image and on a changed one`, { skip }, () => {
    const caught = craftedCaught(twin);
    assert.equal(caught, crafted, `the ${label} twin's crafted catch count moved`);
    const t = diffOf(twin, onTamperedImage(entryFor(SESSIONS[0][0]), GUARD_WORD_A));
    assert.equal(t.caught, tamperedCatches, `the tampered image's view of the ${label} twin moved`);
    assert.ok(caught > 0 || t.caught, `neither image caught the ${label} twin at all`);
    console.log(
      `  TEETH/${label}: ${caught} of ${cross().length} crafted entries` +
        (caught === 0 ? " — BLIND on the shipped image" : "") +
        `; changed image ${t.caught ? "catches" : "does not catch"} it`,
    );
  });
}
