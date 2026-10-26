// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for loc_1fac (ROM 0x1FAC).
 *
 * REACHABILITY WAS MEASURED FIRST, and it is what this file is shaped around: a capturing
 * override at 0x1FAC over 3000 attract frames sees 446 real dispatches, the first at frame ~728,
 * spread over six OBJ_ARRAY_67 record bases. So the captured half is not vacuous — but attract
 * exercises only part of the routine, and the header says which part.
 *
 * COVERAGE — ATTRACT ONLY, PLUS ONE CRAFTED SWEEP. Nothing here enters credited gameplay, board
 * 2-4 or two-player. Two things attract cannot produce are covered by crafted entries built on a
 * REAL capture: the record byte +0x15 is 0 on every one of the 446 dispatches (so the rotate that
 * builds the arrival sprite code is never exercised naturally — only the constant is), and the
 * travel field never wraps past its top value.
 *
 * WHY REHOST AND NOT clone(). 0x1FAC's tail chain RE-ENTERS 0x1FAC: the shared sprite tail at ROM
 * 0x21BA jumps back into the per-slot walk, which dispatches the remaining slots. `Machine.clone()`
 * rebuilds its registry from `assets`, so a clone would carry this file's capturing override and
 * recurse. Every replay here is therefore rehosted into a FRESH, override-free `Machine`, where
 * nested dispatches run the pure oracle on both sides.
 *
 * EVERY DISPATCH IS REPLAYED, INLINE, TWICE OVER — no sampling. At each dispatch the harness
 * rehosts twice, runs the oracle on one and the candidate on the other, compares, and discards, so
 * the cost is O(1) in memory. The two replay modes are:
 *
 *   CHAIN   — the frozen tails at ROM 0x1FCE and 0x21BA run for real, so the whole rest of the
 *             10-slot walk executes on both sides. Because this rewrite performs every one of the
 *             oracle's stack operations (the entire tail chain is still the oracle, and the head
 *             touches the stack on neither arm), the stack region legitimately matches, so the
 *             comparison is the FULL state dump INCLUDING STACK_SCRATCH, plus pc, SP, the whole
 *             register file, and the return value.
 *   STUBBED — both tails are replaced, on each fresh machine, by a marker stub that records where
 *             control was handed over and in what register state, and returns. This is the
 *             manufactured observable for a routine whose return value is always `undefined`: it
 *             isolates the head, pins WHICH tail the branch chose, and is the only thing that
 *             makes the shadow-bank swap visible (the real 0x21BA swaps back, hiding it). The stub
 *             is installed on each fresh machine — a stub does not survive a rehost any more than
 *             a clone — and every replay asserts the marker actually fired.
 *
 * Checks: EQUAL over all 446 captured dispatches in both modes; EQUAL over the crafted sweep; four
 * broken twins, each observed catching its own defect, with the shift-for-rotate twin asserted to
 * be INVISIBLE to every natural dispatch and caught by the crafted sweep alone; and a live-wire run
 * of the whole attract sequence with the rewrite dispatched at 0x1FAC, against a baseline that is
 * the same machine with an oracle-delegating override at the same address, so the ONLY difference
 * between the two runs is this routine. That run asserts a non-zero dispatch count on both sides.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1fac.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import manifest from "../../manifest.js";
import { installEntropyPin } from "../../../../core/entropy-pin.js";
import { runCycleFree } from "../../../../core/frame-stepped.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";
import { loc_1fac as oracle } from "../../translated/loc_1fac.js";
import { loc_1fac } from "../loc_1fac.js";
import { OBJ_Y, OBJ_SPRITE_CODE, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const ATTRACT_FRAMES = 3000;
const LIVE_FRAMES = 3000;

// Record-field offsets the routine touches that names.js does not name; the same three the
// rewrite keeps as file-local consts. Repeated here rather than exported, so breaking the
// rewrite cannot silently move the test's idea of where the fields are.
const TRAVEL_TARGET_Y = 0x17;
const ARRIVAL_CODE_SOURCE = 0x15;
const ARM_SELECT = 0x02;
const ARRIVAL_CODE_BASE = 21;

const TAIL_TRAVEL = 0x1fce; // still travelling
const TAIL_ARRIVED = 0x21ba; // shared sprite-record tail

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * The register set compared AT THE HAND-OFF, which is a DERIVED set, not "all of them". The
 * accumulator and the flag byte are excluded because both hand-off targets overwrite them before
 * reading — and that is not taken on trust: the DERIVATION test below poisons exactly those two at
 * exactly that seam, on the ORACLE, and shows nothing downstream moves. Everything else IS
 * compared, including the shadow set, which is what makes the bank swap observable here.
 * (After the CHAIN replay the full register file including the accumulator does match, because the
 * tail chain has run and overwritten it; that comparison is unrestricted.)
 */
const HANDOFF_REGS = REG_FIELDS.filter((k) => k !== "a" && k !== "f");

/**
 * A fresh, OVERRIDE-FREE Machine holding this machine's observable state. Mirrors
 * `Machine.clone()` except that it does NOT carry the source's override map, which is the whole
 * point: this routine's tail chain re-enters this routine, and a clone would re-enter the
 * capturing hook instead of the oracle.
 */
function rehost(src, prep) {
  const c = new Machine(ROM, {});
  c.mem.workRam.set(src.mem.workRam);
  c.mem.spriteRam.set(src.mem.spriteRam);
  c.mem.videoRam.set(src.mem.videoRam);
  c.mem.discardedWrites = src.mem.discardedWrites;
  c.regs.copyFrom(src.regs);
  c.io.loadStateFrom(src.io);
  c.cycles = src.cycles;
  c.pc = src.pc;
  c.pcKnown = src.pcKnown;
  c.frame = src.frame;
  c.nmiCount = src.nmiCount;
  c.booted = src.booted;
  return prep ? prep(c) ?? c : c;
}

/**
 * Replace both hand-off targets on ONE fresh machine with a marker stub, and return the list the
 * stubs append to. The marker records the target, the whole register file (which is what makes a
 * dropped bank swap observable) and the record's five relevant fields.
 */
function stubTails(c) {
  const marks = [];
  const stub = (label) => (mm) => {
    const rec = mm.regs.ix;
    const fields = [ARM_SELECT, OBJ_Y, OBJ_SPRITE_CODE, ARRIVAL_CODE_SOURCE, TRAVEL_TARGET_Y]
      .map((d) => mm.mem8[rec + d])
      .join("/");
    marks.push(`${label} regs[${HANDOFF_REGS.map((k) => mm.regs[k]).join(",")}] fields[${fields}]`);
  };
  c.routines.set(TAIL_TRAVEL, stub("0x1FCE"));
  c.routines.set(TAIL_ARRIVED, stub("0x21BA"));
  c.tailMarks = marks;
  return c;
}

/** First differing state byte, classified as stack scratch or live RAM. */
function stateDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  let stack = null;
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) {
      if (stack === null) stack = { kind: "stack", addr, a: da[i], b: db[i] };
      continue;
    }
    return { kind: "ram", addr, a: da[i], b: db[i] };
  }
  return stack;
}

/**
 * Replay ONE entry state both ways and return the first contract breach, or null.
 * A fault is a RESULT, not a crashed run: a broken twin can walk a record off its rails and throw
 * from somewhere unrelated, and that has to be reported as the breach rather than killing the test.
 */
function contractBreach(entry, candidate, { stubbed }) {
  const prep = stubbed ? stubTails : undefined;
  const a = rehost(entry, prep);
  const aFloor = a.regs.sp;
  const b = rehost(entry, prep);

  let ra;
  try {
    ra = oracle(a);
  } catch (e) {
    return { kind: "ORACLE FAULT", addr: null, a: `${e.name}: ${e.message}`, b: "" };
  }
  let rb;
  try {
    rb = candidate(b);
  } catch (e) {
    return { kind: "candidate fault", addr: null, a: "(no fault)", b: `${e.name}: ${e.message}` };
  }

  if (stubbed) {
    // The stub must be LIVE — a stub nobody can see fire is indistinguishable from no stub, and
    // it would make this whole mode vacuous.
    if (a.tailMarks.length === 0) return { kind: "ORACLE FAULT", addr: null, a: "stub never fired", b: "" };
    if (b.tailMarks.length !== a.tailMarks.length) {
      return { kind: "hand-off count", addr: null, a: a.tailMarks.length, b: b.tailMarks.length };
    }
    for (let i = 0; i < a.tailMarks.length; i++) {
      if (a.tailMarks[i] !== b.tailMarks[i]) {
        return { kind: "hand-off state", addr: null, a: a.tailMarks[i], b: b.tailMarks[i] };
      }
    }
  }

  const st = stateDiff(a, b, aFloor);
  if (st) return st;
  if (a.regs.sp !== b.regs.sp) return { kind: "SP", addr: null, a: hx(a.regs.sp), b: hx(b.regs.sp) };
  // pc and the FULL register file are asserted only where they legitimately hold — after the
  // frozen tail chain has run, which is what puts them back on the oracle's values. In STUBBED
  // mode the tail is gone, so the head's own cycle-free pc (and the dead accumulator it leaves)
  // would false-fail a correct rewrite; the hand-off comparison above covers that mode instead.
  if (!stubbed) {
    if (a.pc !== b.pc) return { kind: "pc", addr: null, a: hx(a.pc), b: hx(b.pc) };
    for (const k of REG_FIELDS) {
      if (a.regs[k] !== b.regs[k]) return { kind: `register ${k}`, addr: null, a: a.regs[k], b: b.regs[k] };
    }
  }
  if (String(ra) !== String(rb)) return { kind: "return", addr: null, a: String(ra), b: String(rb) };
  return null;
}

// ── Capture: replay EVERY dispatch inline, in both modes, and keep only what crafting needs ────

function sweepAttract(candidate) {
  const breaches = { chain: [], stubbed: [] };
  let dispatches = 0;
  let arrivals = 0;
  const bases = new Map();
  const sourceValues = new Set();
  let arrivalBase = null; // one REAL arrival-arm entry, kept to craft on

  const host = new Machine(ROM, {
    overrides: {
      "1fac": (mm) => {
        const rec = mm.regs.ix;
        const arrives = mm.mem8[rec + TRAVEL_TARGET_Y] === u8(mm.mem8[rec + OBJ_Y] + 1);
        dispatches++;
        bases.set(rec, (bases.get(rec) ?? 0) + 1);
        sourceValues.add(mm.mem8[rec + ARRIVAL_CODE_SOURCE]);
        if (arrives) {
          arrivals++;
          if (arrivalBase === null) arrivalBase = rehost(mm);
        }
        for (const stubbed of [false, true]) {
          const breach = contractBreach(mm, candidate, { stubbed });
          if (breach) breaches[stubbed ? "stubbed" : "chain"].push({ base: rec, arrives, breach });
        }
        return oracle(mm); // the HOST run always continues on the oracle
      },
    },
  });
  host.runFrames(ATTRACT_FRAMES);
  return { breaches, dispatches, arrivals, bases, sourceValues, arrivalBase };
}

const ATTRACT = ROM_PRESENT
  ? sweepAttract(loc_1fac)
  : { breaches: { chain: [], stubbed: [] }, dispatches: 0, arrivals: 0, bases: new Map(), sourceValues: new Set(), arrivalBase: null };

// ── Crafted entries, built on a REAL arrival-arm capture ───────────────────────────────────────

/** One crafted entry: a real capture with exactly one field poked. */
function craft(poke) {
  return rehost(ATTRACT.arrivalBase, (c) => {
    poke(c, c.regs.ix);
  });
}

/** The rotate sweep: every value of +0x15 on a real arrival-arm entry. */
const CRAFTED_SOURCES = ROM_PRESENT
  ? Array.from({ length: 256 }, (_, v) => ({
      label: `arrival, +0x15 = ${v}`,
      entry: craft((c, rec) => {
        c.mem8[rec + ARRIVAL_CODE_SOURCE] = v;
      }),
    }))
  : [];

/** The travel field wrapping past its top value — attract keeps it in 79..208. */
const CRAFTED_WRAP = ROM_PRESENT
  ? [
      {
        label: "travel wraps to 0 and arrives",
        entry: craft((c, rec) => {
          c.mem8[rec + OBJ_Y] = 255;
          c.mem8[rec + TRAVEL_TARGET_Y] = 0;
        }),
      },
      {
        label: "travel wraps to 0 and does not arrive",
        entry: craft((c, rec) => {
          c.mem8[rec + OBJ_Y] = 255;
          c.mem8[rec + TRAVEL_TARGET_Y] = 255;
        }),
      },
    ]
  : [];

const CRAFTED = [...CRAFTED_SOURCES, ...CRAFTED_WRAP];

function craftedBreaches(candidate, { stubbed }) {
  return CRAFTED.map((c) => ({ label: c.label, breach: contractBreach(c.entry, candidate, { stubbed }) }))
    .filter((r) => r.breach !== null);
}

// ── 1. EQUAL ───────────────────────────────────────────────────────────────────────────────────

test("EQUAL: loc_1fac matches the oracle on every captured attract dispatch, both replay modes", () => {
  assert.ok(
    ATTRACT.dispatches > 0,
    "no dispatch of 0x1FAC was captured — the harness never engaged, so this gate proves nothing",
  );
  for (const mode of ["chain", "stubbed"]) {
    const b = ATTRACT.breaches[mode];
    assert.equal(
      b.length,
      0,
      b.length
        ? `${mode}: ${b.length} of ${ATTRACT.dispatches} dispatches breached; first at base ` +
          `${hx(b[0].base)} (${b[0].arrives ? "arrival" : "travel"} arm) — ${b[0].breach.kind}` +
          `${b[0].breach.addr === null ? "" : " at " + hx(b[0].breach.addr)} ` +
          `oracle=${b[0].breach.a} rewrite=${b[0].breach.b}`
        : "",
    );
  }
  const bases = [...ATTRACT.bases].map(([b, n]) => `${hx(b)}x${n}`).join(" ");
  console.log(
    `  EQUAL: ${ATTRACT.dispatches} of ${ATTRACT.dispatches} real dispatches replayed inline in ` +
      `${ATTRACT_FRAMES} attract frames, chain AND stubbed; ${ATTRACT.arrivals} took the arrival arm; ` +
      `bases: ${bases}`,
  );
});

test("EQUAL: the crafted entries attract cannot produce also match", () => {
  assert.ok(CRAFTED.length > 0, "no crafted entry was built — there was no real arrival capture to craft on");
  for (const stubbed of [true, false]) {
    const b = craftedBreaches(loc_1fac, { stubbed });
    assert.equal(
      b.length,
      0,
      b.length ? `${b.length} crafted breach(es), first: ${b[0].label} — ${b[0].breach.kind} oracle=${b[0].breach.a} rewrite=${b[0].breach.b}` : "",
    );
  }
  console.log(
    `  CRAFTED: ${CRAFTED.length} entries on a real arrival capture (${CRAFTED_SOURCES.length} values of ` +
      `+0x15, ${CRAFTED_WRAP.length} travel-wrap) — attract produced only +0x15 = ` +
      `${[...ATTRACT.sourceValues].join(",")}`,
  );
});

// This is what makes the crafted sweep load-bearing rather than decorative: state the hole it
// fills, and prove the hole is real.
test("COVERAGE: attract never exercises the rotate, so the crafted sweep is the only cover for it", () => {
  assert.deepEqual(
    [...ATTRACT.sourceValues],
    [0],
    "attract now produces a non-zero +0x15 — the header's claim that the rotate is crafted-only is stale",
  );
});

// ── 2. The one thing the contract DROPS, measured at the seam it is dropped at ─────────────────

/**
 * POISON AT THE SEAM. The rewrite hands control to a still-frozen tail with the accumulator and
 * flags left wherever its arithmetic put them, which differs from the oracle. That is only safe if
 * nothing downstream reads them — so poison exactly those two, on the ORACLE, at exactly the moment
 * it hands over (the FIRST entry to either tail, not after the whole chain has run), and show the
 * entire rest of the frame is unmoved. A probe aimed past the seam would only prove the chain
 * overwrote them eventually.
 */
test("DERIVATION: the accumulator and flags are dead at the hand-off, measured at the seam", () => {
  let checked = 0;
  const breaches = [];
  const host = new Machine(ROM, {
    overrides: {
      "1fac": (mm) => {
        const clean = rehost(mm);
        const cleanFloor = clean.regs.sp;
        const dirty = rehost(mm, (c) => {
          let armed = true;
          for (const addr of [TAIL_TRAVEL, TAIL_ARRIVED]) {
            const inner = c.routines.get(addr); // the machine's OWN oracle for that address
            c.routines.set(addr, (m2) => {
              if (armed) {
                armed = false;
                m2.regs.a = m2.regs.a ^ 0xa5;
                m2.regs.f = m2.regs.f ^ 0xff;
              }
              return inner(m2);
            });
          }
        });
        oracle(clean);
        oracle(dirty);
        checked++;
        const st = stateDiff(clean, dirty, cleanFloor);
        if (st) breaches.push(st);
        else if (clean.pc !== dirty.pc) breaches.push({ kind: "pc", addr: null, a: hx(clean.pc), b: hx(dirty.pc) });
        else if (clean.regs.sp !== dirty.regs.sp) breaches.push({ kind: "SP", addr: null, a: hx(clean.regs.sp), b: hx(dirty.regs.sp) });
        return oracle(mm);
      },
    },
  });
  host.runFrames(ATTRACT_FRAMES);

  assert.ok(checked > 0, "no dispatch reached the poison probe — the derivation is vacuous");
  assert.equal(
    breaches.length,
    0,
    breaches.length
      ? `poisoning the accumulator and flags at the hand-off MOVED something: ${breaches[0].kind}` +
        `${breaches[0].addr === null ? "" : " at " + hx(breaches[0].addr)} clean=${breaches[0].a} poisoned=${breaches[0].b}` +
        " — they are live at the seam and the contract must compare them"
      : "",
  );
  console.log(
    `  DERIVATION: accumulator ^ 0xA5 and the whole flag byte ^ 0xFF injected at the first entry to ` +
      `0x1FCE / 0x21BA on ${checked} real dispatches — state dump, pc and SP unmoved every time`,
  );
});

// ── 3. TEETH ───────────────────────────────────────────────────────────────────────────────────

/** Does this entry state take the arrival arm? Read from the entry, not from the rewrite. */
const arrives = (m) => m.mem8[m.regs.ix + TRAVEL_TARGET_Y] === u8(m.mem8[m.regs.ix + OBJ_Y] + 1);

/** Broken twin: builds the arrival sprite code with a SHIFT, so the wrapped bits are lost. */
function twinShiftNotRotate(m) {
  const rec = m.regs.ix;
  const hit = arrives(m);
  const source = m.mem8[rec + ARRIVAL_CODE_SOURCE];
  const out = loc_1fac(m);
  if (hit) m.mem8[rec + OBJ_SPRITE_CODE] = ((source << 2) & 0xff) + ARRIVAL_CODE_BASE;
  return out;
}

/** Broken twin: the shadow-bank swap never happens (this one cancels the rewrite's). */
function twinNoBankSwap(m) {
  m.regs.exx();
  return loc_1fac(m);
}

/** Broken twin: the record keeps its old arm-select bits, so it stays on this arm. */
function twinNoArmFlip(m) {
  const rec = m.regs.ix;
  const before = m.mem8[rec + ARM_SELECT];
  const hit = arrives(m);
  const out = loc_1fac(m);
  if (hit) m.mem8[rec + ARM_SELECT] = before;
  return out;
}

/** Broken twin: the travel step is computed but never kept. */
function twinNoTravelStep(m) {
  const rec = m.regs.ix;
  const before = m.mem8[rec + OBJ_Y];
  const out = loc_1fac(m);
  m.mem8[rec + OBJ_Y] = before;
  return out;
}

const TEETH = [
  { name: "shift for rotate", twin: twinShiftNotRotate, caughtBy: "crafted" },
  { name: "dropped bank swap", twin: twinNoBankSwap, caughtBy: "captured" },
  { name: "dropped arm-select flip", twin: twinNoArmFlip, caughtBy: "captured" },
  { name: "dropped travel step", twin: twinNoTravelStep, caughtBy: "captured" },
];

for (const { name, twin, caughtBy } of TEETH) {
  test(`TEETH: a twin with a ${name} is CAUGHT (by the ${caughtBy} half)`, () => {
    const captured = sweepAttract(twin);
    const naturalChain = captured.breaches.chain.length;
    const naturalStubbed = captured.breaches.stubbed.length;
    const crafted = craftedBreaches(twin, { stubbed: true }).length;

    assert.ok(
      naturalChain + naturalStubbed + crafted > 0,
      `the gate FAILED to catch the ${name} twin anywhere — it proves nothing`,
    );
    if (caughtBy === "captured") {
      assert.ok(naturalChain > 0, `expected the captured chain replay to catch the ${name} twin`);
    } else {
      assert.equal(
        naturalChain + naturalStubbed,
        0,
        `the ${name} twin was expected to ESCAPE every natural dispatch (attract holds +0x15 at 0); ` +
          "if it no longer does, the crafted-only claim in the header is stale",
      );
      assert.ok(crafted > 0, `expected the crafted sweep to catch the ${name} twin`);
    }
    const first = captured.breaches.chain[0] ?? captured.breaches.stubbed[0];
    console.log(
      `  TEETH/${name}: captured chain ${naturalChain}/${captured.dispatches}, ` +
        `captured stubbed ${naturalStubbed}/${captured.dispatches}, crafted ${crafted}/${CRAFTED.length}` +
        (first
          ? `; first natural breach: ${first.breach.kind}${first.breach.addr === null ? "" : " at " + hx(first.breach.addr)} ` +
            `oracle=${first.breach.a} twin=${first.breach.b}`
          : ""),
    );
  });
}

// ── 4. LIVE-WIRE: the whole attract run, with only this routine swapped ────────────────────────

const NOOP = () => {};

/**
 * Price the HEAD ONLY, non-recursively. The rewrite still runs the frozen tail chain itself, so
 * that chain already charges its own cycles; charging the oracle's total on top would double-count
 * it. Stubbing both tails on a throwaway rehost measures exactly the fragment this rewrite
 * replaced — and rehosting (rather than cloning) is what stops the probe re-entering the live
 * override and pricing itself.
 */
function chargeHeadThenRun(m) {
  const probe = rehost(m);
  probe.routines.set(TAIL_TRAVEL, NOOP);
  probe.routines.set(TAIL_ARRIVED, NOOP);
  const before = probe.cycles;
  oracle(probe);
  // step(), not tick(): the head's cost is charged BEFORE the rewrite runs, so the pc it sets is
  // immediately overwritten by the frozen tail — and tick() would clear pcKnown.
  m.step(probe.pc, probe.cycles - before);
  return loc_1fac(m);
}

function liveRun(handler) {
  let dispatches = 0;
  const m = new Machine(ROM, { overrides: { "1fac": (mm) => { dispatches++; return handler(mm); } } });
  installEntropyPin(m, manifest.entropyPin);
  const trace = [];
  const r = runCycleFree(m, {
    pollPCs: manifest.convergence.pollPCs,
    maxFrames: LIVE_FRAMES,
    stepBudget: LIVE_FRAMES * 200000,
    onFrame: (mm) => trace.push(Buffer.from(mm.dumpState())),
  });
  assert.equal(r.stopError, null, `live run errored: ${r.stop}`);
  return { trace, dispatches, m };
}

test("LIVE-OUT: wired live for a whole attract run, the rewrite leaves the same trace as the oracle", () => {
  const baseline = liveRun(oracle);
  const live = liveRun(chargeHeadThenRun);

  // Without this the run can pass while the routine never executes. Measured: 588 dispatches.
  assert.ok(baseline.dispatches > 0, "the baseline run never dispatched 0x1FAC — the live arm is vacuous");
  assert.equal(
    live.dispatches,
    baseline.dispatches,
    `dispatch count forked: baseline ${baseline.dispatches}, live ${live.dispatches} — the cheapest fork tell`,
  );
  assert.equal(live.trace.length, baseline.trace.length, "the two runs did not reach the same frame count");

  for (let f = 0; f < baseline.trace.length; f++) {
    for (let i = 0; i < baseline.trace[f].length; i++) {
      if (baseline.trace[f][i] === live.trace[f][i]) continue;
      assert.fail(
        `frame ${f}: ${hx(baseline.m.stateOffsetToAddr(i))} baseline=${baseline.trace[f][i]} live=${live.trace[f][i]}`,
      );
    }
  }
  console.log(
    `  LIVE-OUT: ${baseline.trace.length} frames byte-identical (FULL dump, stack scratch included) ` +
      `with 0x1FAC wired live, ${live.dispatches} dispatches each side; the head's own cycle cost is ` +
      "restored per dispatch and the spin-counter RNG is pinned on both sides",
  );
});
