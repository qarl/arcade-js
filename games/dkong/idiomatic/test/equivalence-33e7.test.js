// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_33e7 (ROM 0x33E7) — run an object's sprite-animation
 * step, then nudge its per-object step counter up (state != 8) or down at half rate
 * (state 8, paced by a sub-timer).
 *
 * loc_33e7 IS reached during attract — transitively through the translated closure chain
 * (entry_30ed -> entry_31b1 -> entry_3202 -> `call 0x33e7`), so the gate replays REAL captured
 * dispatches AND broadens coverage with a crafted grid. The crafted grid aims the object
 * pointer at a genuine object record (IX = 0x6400) and sweeps the fields that drive the routine
 * plus the two bytes its callee reads, covering every arm deterministically:
 *
 *   - state != 8            -> step counter UP, stop
 *   - state == 8, timer!=0  -> tick the sub-timer down, stop
 *   - state == 8, timer==0  -> reload sub-timer to 2, step counter DOWN
 *
 * The oracle brackets its `call 0x3409` with a push16(0x33ea) that the callee's ret pops,
 * and each exit is a `ret`. The idiomatic routine DIRECT-CALLS the (already idiomatic)
 * animation stepper and models no stack, so the oracle's dead push16 lands in STACK_SCRATCH
 * and the compare excludes it (the memory-equivalence contract). runCandidate performs ONE
 * m.ret() after the routine so pc + SP line up with the oracle's terminal caller-return.
 *
 *   1. REACHABILITY — confirm 0x33E7 IS dispatched in attract (via its translated caller).
 *   2. EQUAL (captured) — hook 0x33E7 in a real attract run, clone at each dispatch, and
 *      confirm loc_33e7 == oracle over RAM (minus the stack scratch below the entry SP) + pc + SP on every real state.
 *   3. EQUAL (crafted grid) — loc_33e7 == oracle across the full field grid, every arm exercised.
 *   4. EXCLUSION IS EXACT — without the stack exclusion the ONLY diff is inside STACK_SCRATCH
 *      (the dissolved push16 bracket), never a live cell.
 *   5. TEETH — deliberately-broken twins the same grid MUST catch.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-33e7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_33e7 as oracle } from "../../translated/loc_33e7.js";
import { loc_33e7 } from "../loc_33e7.js";
import { stepObjectSpriteFrame } from "../stepObjectSpriteFrame.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x33e7;
const IX_BASE = 0x6400;        // a real object-array record base; its touched fields are work RAM
const CALLER_RET = 0x3294;     // plausible return into entry_3202 (right after `call 0x33e7`)

// Object-record field offsets this routine reads/writes.
const STATE_OFF = 0x0d;
const COUNTER_OFF = 0x0f;
const SUBTIMER_OFF = 0x14;
const CALLEE_TIMER_OFF = 0x15; // stepObjectSpriteFrame's animation down-counter
const CALLEE_CODE_OFF = 0x07;  // stepObjectSpriteFrame's sprite-tile code

const STATE_ADDR = IX_BASE + STATE_OFF;       // 0x640d
const COUNTER_ADDR = IX_BASE + COUNTER_OFF;   // 0x640f
const SUBTIMER_ADDR = IX_BASE + SUBTIMER_OFF; // 0x6414

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, { liveFloor = null } = {}) {
  const dead = liveFloor === null ? () => false : deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, { liveFloor: entry.regs.sp });
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM (and the 0x6400
// object array) hold realistic values. The routine is crafted onto clones of this by poking.
function attractBase(frames = 200) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x33E7 dispatch onto a clone of the base: the object pointer at a real
 * record, a stack with a plausible caller return (so the terminal ret has a sane target and
 * lands in STACK_SCRATCH), and the five record bytes the routine + its callee read.
 */
function craft(base, { state, counter, subTimer, calleeTimer, calleeCode }) {
  const m = base.clone();
  m.regs.ix = IX_BASE;
  m.regs.sp = 0x6c00;
  m.push16(CALLER_RET); // the routine's terminal ret pops this; the bytes land in STACK_SCRATCH
  m.mem.write8(STATE_ADDR, state);
  m.mem.write8(COUNTER_ADDR, counter);
  m.mem.write8(SUBTIMER_ADDR, subTimer);
  m.mem.write8(IX_BASE + CALLEE_TIMER_OFF, calleeTimer);
  m.mem.write8(IX_BASE + CALLEE_CODE_OFF, calleeCode);
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  return m;
}

// The crafted input grid. States cover ==8 and several !=8; sub-timers cover 0 and nonzero;
// counters cover both wrap edges (0->0xff on dec, 0xff->0 on inc); the callee bytes cover its
// running/expired timer and the nibble-boundary sprite-code toggle.
const STATES = [0x00, 0x07, 0x08, 0x09, 0xff];
const SUBTIMERS = [0x00, 0x01, 0x02, 0xff];
const COUNTERS = [0x00, 0x01, 0x80, 0xff];
const CALLEE_TIMERS = [0x00, 0x01, 0x02];
const CALLEE_CODES = [0x00, 0x0e, 0x0f, 0x2e, 0xff];

function* grid() {
  for (const state of STATES)
    for (const subTimer of SUBTIMERS)
      for (const counter of COUNTERS)
        for (const calleeTimer of CALLEE_TIMERS)
          for (const calleeCode of CALLEE_CODES)
            yield { state, counter, subTimer, calleeTimer, calleeCode };
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x33E7 is dispatched during attract (via its translated caller)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);
  assert.ok(count > 0, "0x33E7 should be dispatched — it is reached through entry_30ed->31b1->3202");
  console.log(`  REACHABILITY: ${count} natural 0x33E7 dispatches in 1500 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------
//
// Hook 0x33E7 in a real attract run, clone the machine at each dispatch, and confirm the
// idiomatic routine reproduces the oracle on every state the game actually produces. The
// captured state already has the caller's return address pushed (entry_3202's `call`), so the
// terminal ret pops a real target and the pushed 0x33ea lands in the live stack scratch.

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

test("EQUAL (captured): loc_33e7 == oracle on every real attract dispatch", () => {
  const caps = captureDispatches(200, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x33E7 dispatch during attract");

  let up = 0, downTick = 0, downStep = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_33e7);
    assert.equal(diffs.length, 0, `captured dispatch (ix=${hx(entry.regs.ix)}): ${diffs.join("; ")}`);
    // Classify the arm the oracle took (from the record fields) for reporting.
    const st = entry.mem.read8((entry.regs.ix + STATE_OFF) & 0xffff);
    const stw = entry.mem.read8((entry.regs.ix + SUBTIMER_OFF) & 0xffff);
    if (st !== 0x08) up++; else if (stw !== 0) downTick++; else downStep++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (${up} state!=8 up, ${downTick} state8 sub-tick, ${downStep} state8 down-step)`);
});

// -- 2. EQUAL (crafted grid) --------------------------------------------------

test("EQUAL (crafted grid): loc_33e7 == oracle across the field grid, every arm exercised", () => {
  const base = attractBase();
  let count = 0, up = 0, downTick = 0, downStep = 0;

  for (const opts of grid()) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_33e7);
    assert.equal(diffs.length, 0, `state=${hx(opts.state)} sub=${hx(opts.subTimer)} cnt=${hx(opts.counter)} t=${hx(opts.calleeTimer)} code=${hx(opts.calleeCode)}: ${diffs.join("; ")}`);
    count++;
    if (opts.state !== 0x08) up++;
    else if (opts.subTimer !== 0) downTick++;
    else downStep++;
  }

  assert.ok(up > 0 && downTick > 0 && downStep > 0, "the grid must exercise all three arms");
  assert.equal(count, STATES.length * SUBTIMERS.length * COUNTERS.length * CALLEE_TIMERS.length * CALLEE_CODES.length);
  console.log(`  EQUAL/crafted: ${count} crafted entries identical to the oracle (${up} state!=8 up, ${downTick} state8 sub-tick, ${downStep} state8 down-step)`);
});

// -- 3. EXCLUSION IS EXACT ----------------------------------------------------

test("EXCLUSION: the only un-excluded diff is the dissolved push16 bracket, inside STACK_SCRATCH", () => {
  const base = attractBase();
  // A state-8 expired case: the routine writes the sub-timer + counter, and the oracle also
  // pushed 0x33ea for its internal call. With STACK included, the first (and only) diff must
  // be inside STACK_SCRATCH — proving the exclusion targets exactly the dead push, no live cell.
  const entry = craft(base, { state: 0x08, subTimer: 0x00, counter: 0x40, calleeTimer: 0x00, calleeCode: 0x0e });
  const o = runOracle(entry);
  const c = runCandidate(entry, loc_33e7);

  // Non-stack RAM must be identical.
  assert.equal(firstRamDiff(o, c, { liveFloor: entry.regs.sp }), null, "a live (non-stack) cell diverged");

  // Including the stack, any diff that exists must lie within STACK_SCRATCH (the pushed 0x33ea).
  const withStack = firstRamDiff(o, c);
  assert.ok(withStack !== null, "expected the oracle's push16(0x33ea) to show as a stack-only diff");
  assert.ok(deadStackBelow(STACK_SCRATCH, entry.regs.sp)(withStack.addr), `the un-excluded diff at ${hx(withStack.addr)} is NOT in the stack scratch below the entry SP — the exclusion is hiding a live cell`);
  console.log(`  EXCLUSION: only diff at ${hx(withStack.addr)} (oracle=${withStack.a} cand=${withStack.b}) — inside STACK_SCRATCH, exactly the dissolved push`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): steps the counter UP instead of DOWN on the state-8 expired arm. */
function brokenCounterUp(m) {
  const { mem, regs } = m;
  const objBase = regs.ix;
  stepObjectSpriteFrame(m, objBase);
  const stateAddr = (objBase + STATE_OFF) & 0xffff;
  const counterAddr = (objBase + COUNTER_OFF) & 0xffff;
  const subTimerAddr = (objBase + SUBTIMER_OFF) & 0xffff;
  if (mem.read8(stateAddr) !== 0x08) { mem.write8(counterAddr, mem.read8(counterAddr) + 1); return; }
  const subTimer = mem.read8(subTimerAddr);
  if (subTimer !== 0) { mem.write8(subTimerAddr, subTimer - 1); return; }
  mem.write8(subTimerAddr, 0x02);
  mem.write8(counterAddr, mem.read8(counterAddr) + 1); // BUG: should step DOWN
}

/** Broken twin (b): reloads the sub-timer to 3 instead of 2 on the expired arm. */
function brokenReload(m) {
  const { mem, regs } = m;
  const objBase = regs.ix;
  stepObjectSpriteFrame(m, objBase);
  const stateAddr = (objBase + STATE_OFF) & 0xffff;
  const counterAddr = (objBase + COUNTER_OFF) & 0xffff;
  const subTimerAddr = (objBase + SUBTIMER_OFF) & 0xffff;
  if (mem.read8(stateAddr) !== 0x08) { mem.write8(counterAddr, mem.read8(counterAddr) + 1); return; }
  const subTimer = mem.read8(subTimerAddr);
  if (subTimer !== 0) { mem.write8(subTimerAddr, subTimer - 1); return; }
  mem.write8(subTimerAddr, 0x03); // BUG: should reload to 2
  mem.write8(counterAddr, mem.read8(counterAddr) - 1);
}

/** Broken twin (c): inverts the state gate (== 8 goes up, != 8 goes down). */
function brokenStateGate(m) {
  const { mem, regs } = m;
  const objBase = regs.ix;
  stepObjectSpriteFrame(m, objBase);
  const stateAddr = (objBase + STATE_OFF) & 0xffff;
  const counterAddr = (objBase + COUNTER_OFF) & 0xffff;
  const subTimerAddr = (objBase + SUBTIMER_OFF) & 0xffff;
  if (mem.read8(stateAddr) === 0x08) { mem.write8(counterAddr, mem.read8(counterAddr) + 1); return; } // BUG: !== 8
  const subTimer = mem.read8(subTimerAddr);
  if (subTimer !== 0) { mem.write8(subTimerAddr, subTimer - 1); return; }
  mem.write8(subTimerAddr, 0x02);
  mem.write8(counterAddr, mem.read8(counterAddr) - 1);
}

function firstCaught(twin) {
  const base = attractBase();
  for (const opts of grid()) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, twin);
    if (diffs.length > 0) return { opts, diffs };
  }
  return null;
}

test("TEETH: the counter-up, wrong-reload, and inverted-state-gate twins are CAUGHT", () => {
  const up = firstCaught(brokenCounterUp);
  assert.ok(up, "the counter-up twin escaped the whole grid — the gate is worthless");
  assert.ok(up.diffs[0].startsWith(`RAM@${hx(COUNTER_ADDR)}`), `counter-up should diverge at ${hx(COUNTER_ADDR)}, got ${up.diffs[0]}`);

  const reload = firstCaught(brokenReload);
  assert.ok(reload, "the wrong-reload twin escaped the whole grid — the gate is worthless");
  assert.ok(reload.diffs[0].startsWith(`RAM@${hx(SUBTIMER_ADDR)}`), `wrong-reload should diverge at ${hx(SUBTIMER_ADDR)}, got ${reload.diffs[0]}`);

  const gate = firstCaught(brokenStateGate);
  assert.ok(gate, "the inverted-state-gate twin escaped the whole grid — the gate is worthless");

  console.log(`  TEETH: counter-up caught (${up.diffs[0]}); wrong-reload caught (${reload.diffs[0]}); inverted-state-gate caught (${gate.diffs[0]})`);
});
