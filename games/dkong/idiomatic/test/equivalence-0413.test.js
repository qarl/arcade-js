// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0413 (ROM 0x0413) — the per-frame entry to the state-0 colour
 * cycle: advance a running sweep, re-arm a fresh one at the frame-counter wrap, else repaint.
 *
 * loc_0413 gates on two RAM bytes and routes three ways:
 *
 *   - COLOUR_CYCLE_ACTIVE (0x6391) != 0        -> advanceColorCycleSweep (ROM 0x0426).
 *   - active == 0, FRAME (0x601A) != 0         -> dispatchColorCyclePaint (ROM 0x0486): repaint.
 *   - active == 0, FRAME == 0 (the wrap)       -> set COLOUR_CYCLE_ACTIVE = 1, then
 *                                                 advanceColorCycleSweep (arm + advance).
 *
 * Its callers (entry_03fb / entry_0400) tail-jump into it, and both callees tail-jump onward,
 * so down EVERY path the oracle nets exactly ONE caller-return pop and only READS the stack
 * (the pushed bytes land in STACK_SCRATCH, excluded by the memory-equivalence contract). The
 * idiomatic routine models the Z80 stack as the JS call stack (direct calls, no push16/ret of
 * its own), so the harness performs ONE m.ret() on the candidate to line pc + SP up with the
 * oracle. A `new Machine(ROM)` with no overrides runs the pure translated subtree for every
 * m.call, so the oracle side is the frozen translated cascade; the candidate side is the
 * idiomatic cascade via direct imports. Every case runs on a FRESH clone (the callees write
 * memory).
 *
 *   1. REALISM (captured) — hook 0x0413 in a real attract run and confirm loc_0413 == oracle
 *      over every natural dispatch, classified by the route the entry forces. All three routes
 *      (active, repaint, start-of-sweep) occur naturally in a 25m attract.
 *
 *   2. EQUAL (crafted) — force the active arm (active==1 and active==0x40 to prove "nonzero"
 *      not "==1"), the repaint arm (FRAME==5 and FRAME==0x80 to prove "nonzero" not "==1", plus
 *      the rivet board), and the start-of-sweep arm (a mid-sweep re-arm, a re-arm that
 *      immediately tops the sweep out, and a re-arm that lands on a 32-frame boundary reload),
 *      each over the whole contract (RAM - the stack scratch below the entry SP + pc + SP) plus a route-discriminating
 *      non-vacuity check.
 *
 *   3. TEETH — four deliberately-broken twins, each reusing the real idiomatic callees so the
 *      only divergence is the injected bug, each MUST be caught:
 *      (a) dropped re-arm write     — the wrap arm forgets COLOUR_CYCLE_ACTIVE=1; caught at 0x6391.
 *      (b) repaint arm advances     — repaint route steps the sweep counter; caught at 0x6390.
 *      (c) inverted active gate      — active route repaints instead of advancing; caught at 0x6390.
 *      (d) active gate tests ==1     — an active==0x40 entry repaints instead of advancing; caught at 0x6390.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0413.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0413 as oracle } from "../../translated/loc_0413.js";
import { serviceColorCycle as loc_0413 } from "../serviceColorCycle.js";
import { advanceColorCycleSweep } from "../advanceColorCycleSweep.js";
import { dispatchColorCyclePaint } from "../dispatchColorCyclePaint.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, COLOUR_CYCLE_ACTIVE, FRAME, BOARD } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0413;
const RET_ADDR = 0x03fb;        // a plausible caller-return for the one net pop (any value works)
const SWEEP_COUNTER = 0x6390;   // colour-cycle sweep counter (unnamed in names.js — kept hex)
const OBJ_RELOAD_GATE = 0x6393; // advanceColorCycleSweep's reload gate: 0 -> boundary reload arm
const SWEEP_TOP = 0x80;         // the counter's top of range (advanceColorCycleSweep resets there)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hb = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
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

/** Run the ORACLE on a fresh clone. Its colour tail chain performs the net `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call stack, so it
 * does not touch pc/SP itself — the harness supplies the one return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the full contract: RAM - the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${hb(ram.a)} cand=${hb(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds realistic values.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted 0x0413 entry onto a clone of the base: a clean stack with a plausible caller
 * return (so the net `ret` has a sane target), the two gate bytes (active flag + frame counter),
 * and the callee inputs (sweep counter, reload gate, board) so the routed sub-cascade is
 * deterministic. loc_0413 reads the two gates and hands off; the callees read the rest from RAM.
 */
function craft(base, { active, frame, sweep = 0x10, gate = 1, board = 1 } = {}) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(COLOUR_CYCLE_ACTIVE, active & 0xff);
  m.mem.write8(FRAME, frame & 0xff);
  m.mem.write8(SWEEP_COUNTER, sweep & 0xff);
  m.mem.write8(OBJ_RELOAD_GATE, gate & 0xff);
  m.mem.write8(BOARD, board & 0xff);
  return m;
}

// Classify the route a given entry forces, from the SAME logic the routine uses.
function routeOf(entry) {
  if (entry.mem.read8(COLOUR_CYCLE_ACTIVE) !== 0) return "active";
  if (entry.mem.read8(FRAME) !== 0) return "repaint";
  return "start";
}

// -- 1. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x0413 dispatches match the oracle", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    // Capture enough consecutive dispatches to span several full frame-counter periods, so the
    // active sweep, the repaint idle, and the once-per-256-frame re-arm are all reached.
    if (caps.length < 3500) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0413 dispatch during attract");

  const seen = { active: 0, repaint: 0, start: 0 };
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_0413);
    assert.equal(diffs.length, 0, `real dispatch (${routeOf(cap)}): ${diffs.join("; ")}`);
    seen[routeOf(cap)]++;
  }
  // In a 25m attract the frame counter wraps every 256 frames and the sweep runs ~128 of those,
  // so all three routes are exercised many times over 8000 frames.
  assert.ok(seen.active >= 1, "expected at least one natural active-sweep dispatch");
  assert.ok(seen.repaint >= 1, "expected at least one natural repaint dispatch");
  assert.ok(seen.start >= 1, "expected at least one natural start-of-sweep (frame-wrap) dispatch");
  console.log(`  REALISM: ${caps.length} real 0x0413 dispatches identical to the oracle (${seen.active} active, ${seen.repaint} repaint, ${seen.start} start)`);
});

// -- 2. EQUAL (crafted, all three routes) -------------------------------------

test("EQUAL (crafted): the active, repaint, and start-of-sweep arms all match the oracle", () => {
  const base = attractBase();

  const cases = [
    // active flag set -> advanceColorCycleSweep (the flag is NOT re-armed, the counter advances)
    { name: "active==1 (advance a running sweep)", active: 0x01, frame: 0x33, sweep: 0x10, gate: 1, route: "active" },
    { name: "active==0x40 (nonzero, not ==1)", active: 0x40, frame: 0x33, sweep: 0x10, gate: 1, route: "active" },
    // no sweep, FRAME nonzero -> dispatchColorCyclePaint (repaint only; counter NOT advanced)
    { name: "repaint (FRAME==5, low-code arm)", active: 0x00, frame: 0x05, sweep: 0x22, gate: 1, board: 1, route: "repaint" },
    { name: "repaint (FRAME==0x80, high-code arm — nonzero not ==1)", active: 0x00, frame: 0x80, sweep: 0x60, gate: 1, board: 1, route: "repaint" },
    { name: "repaint on the rivet board (100m blink block)", active: 0x00, frame: 0x05, sweep: 0x22, gate: 1, board: 4, route: "repaint" },
    // no sweep, FRAME==0 (the wrap) -> arm COLOUR_CYCLE_ACTIVE=1, then advance
    { name: "start-of-sweep (re-arm + advance, mid-sweep)", active: 0x00, frame: 0x00, sweep: 0x10, gate: 1, board: 1, route: "start" },
    { name: "start-of-sweep where the armed sweep tops out at 0x80", active: 0x00, frame: 0x00, sweep: 0x7f, gate: 1, board: 1, route: "start" },
    { name: "start-of-sweep landing on a 32-frame boundary reload", active: 0x00, frame: 0x00, sweep: 0x1f, gate: 0, board: 1, route: "start" },
  ];

  for (const c of cases) {
    const entry = craft(base, c);
    assert.equal(routeOf(entry), c.route, `${c.name}: crafted the wrong route (${routeOf(entry)})`);

    const diffs = contractDiffs(entry, loc_0413);
    assert.equal(diffs.length, 0, `${c.name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    if (c.route === "active") {
      // Advanced a running sweep: the flag is untouched by loc_0413 (only the driver's top-of-sweep
      // reset could clear it — not reached here, sweep 0x10 -> 0x11), and the counter stepped.
      assert.equal(after.mem.read8(COLOUR_CYCLE_ACTIVE), c.active, `${c.name}: active flag must be untouched`);
      assert.equal(after.mem.read8(SWEEP_COUNTER), u8(c.sweep + 1), `${c.name}: sweep counter must advance`);
    } else if (c.route === "repaint") {
      // Repaint only: the flag stays clear and the sweep counter is NOT advanced.
      assert.equal(after.mem.read8(COLOUR_CYCLE_ACTIVE), 0, `${c.name}: repaint must not arm the flag`);
      assert.equal(after.mem.read8(SWEEP_COUNTER), c.sweep, `${c.name}: repaint must not advance the counter`);
    } else {
      // Start-of-sweep: loc_0413 re-arms the flag, then advances. When the advance tops the sweep
      // out (sweep 0x7f -> 0x80) the driver's reset clears both back to 0; otherwise the flag stays 1.
      const topsOut = u8(c.sweep + 1) === SWEEP_TOP;
      assert.equal(after.mem.read8(COLOUR_CYCLE_ACTIVE), topsOut ? 0 : 1, `${c.name}: wrong post-arm flag`);
      assert.equal(after.mem.read8(SWEEP_COUNTER), topsOut ? 0 : u8(c.sweep + 1), `${c.name}: wrong post-arm counter`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (active x2, repaint x3, start x3) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): the wrap arm forgets to re-arm COLOUR_CYCLE_ACTIVE before advancing. */
function teethDroppedRearm(m) {
  const { mem } = m;
  if (mem.read8(COLOUR_CYCLE_ACTIVE) !== 0) { advanceColorCycleSweep(m); return; }
  if (mem.read8(FRAME) !== 0) { dispatchColorCyclePaint(m); return; }
  // BUG: no `mem.write8(COLOUR_CYCLE_ACTIVE, 1)` here
  advanceColorCycleSweep(m);
}

/** BUG (b): the repaint arm advances the sweep instead of repainting. */
function teethRepaintAdvances(m) {
  const { mem } = m;
  if (mem.read8(COLOUR_CYCLE_ACTIVE) !== 0) { advanceColorCycleSweep(m); return; }
  if (mem.read8(FRAME) !== 0) { advanceColorCycleSweep(m); return; } // BUG: should repaint
  mem.write8(COLOUR_CYCLE_ACTIVE, 1);
  advanceColorCycleSweep(m);
}

/** BUG (c): inverts the active gate — the active route repaints instead of advancing. */
function teethInvertedActiveGate(m) {
  const { mem } = m;
  if (mem.read8(COLOUR_CYCLE_ACTIVE) === 0) { advanceColorCycleSweep(m); return; } // BUG: should be !== 0
  if (mem.read8(FRAME) !== 0) { dispatchColorCyclePaint(m); return; }
  mem.write8(COLOUR_CYCLE_ACTIVE, 1);
  advanceColorCycleSweep(m);
}

/** BUG (d): tests the active gate for ==1 instead of nonzero — an active==0x40 sweep is missed. */
function teethActiveGateEqualsOne(m) {
  const { mem } = m;
  if (mem.read8(COLOUR_CYCLE_ACTIVE) === 1) { advanceColorCycleSweep(m); return; } // BUG: should be !== 0
  if (mem.read8(FRAME) !== 0) { dispatchColorCyclePaint(m); return; }
  mem.write8(COLOUR_CYCLE_ACTIVE, 1);
  advanceColorCycleSweep(m);
}

test("TEETH: dropped-rearm, repaint-advances, inverted-gate, and equals-one twins are all CAUGHT", () => {
  const base = attractBase();

  // (a) dropped re-arm: a start entry that does NOT top out (sweep 0x10 -> 0x11). The oracle arms
  //     the flag (0x6391 -> 1) and keeps it through the advance; the twin leaves it 0.
  const aEntry = craft(base, { active: 0x00, frame: 0x00, sweep: 0x10, gate: 1, board: 1 });
  const aDiffs = contractDiffs(aEntry, teethDroppedRearm);
  assert.notEqual(aDiffs.length, 0, "the dropped-rearm twin escaped — the gate is worthless");
  assert.ok(aDiffs[0].startsWith(`RAM@${hx(COLOUR_CYCLE_ACTIVE)}`), `expected a ${hx(COLOUR_CYCLE_ACTIVE)} diff, got ${aDiffs[0]}`);

  // (b) repaint advances: a repaint entry (active 0, FRAME 5). The oracle repaints (0x6390 put),
  //     the twin advances it (0x6390 -> 0x23); caught at the sweep counter.
  const bEntry = craft(base, { active: 0x00, frame: 0x05, sweep: 0x22, gate: 1, board: 1 });
  const bDiffs = contractDiffs(bEntry, teethRepaintAdvances);
  assert.notEqual(bDiffs.length, 0, "the repaint-advances twin escaped — the gate is worthless");
  assert.ok(bDiffs[0].startsWith(`RAM@${hx(SWEEP_COUNTER)}`), `expected a ${hx(SWEEP_COUNTER)} diff, got ${bDiffs[0]}`);

  // (c) inverted active gate: an active entry (active 1, FRAME nonzero). The oracle advances
  //     (0x6390 -> 0x11), the twin repaints (0x6390 put); caught at the sweep counter.
  const cEntry = craft(base, { active: 0x01, frame: 0x33, sweep: 0x10, gate: 1, board: 1 });
  const cDiffs = contractDiffs(cEntry, teethInvertedActiveGate);
  assert.notEqual(cDiffs.length, 0, "the inverted-active-gate twin escaped — the gate is worthless");
  assert.ok(cDiffs[0].startsWith(`RAM@${hx(SWEEP_COUNTER)}`), `expected a ${hx(SWEEP_COUNTER)} diff, got ${cDiffs[0]}`);

  // (d) equals-one gate: an active==0x40 entry. The oracle advances (nonzero), the twin misses it
  //     (0x40 != 1) and repaints; caught at the sweep counter.
  const dEntry = craft(base, { active: 0x40, frame: 0x33, sweep: 0x10, gate: 1, board: 1 });
  const dDiffs = contractDiffs(dEntry, teethActiveGateEqualsOne);
  assert.notEqual(dDiffs.length, 0, "the equals-one twin escaped — the gate is worthless");
  assert.ok(dDiffs[0].startsWith(`RAM@${hx(SWEEP_COUNTER)}`), `expected a ${hx(SWEEP_COUNTER)} diff, got ${dDiffs[0]}`);

  console.log(`  TEETH: dropped-rearm caught (${aDiffs[0]}); repaint-advances caught (${bDiffs[0]}); inverted-gate caught (${cDiffs[0]}); equals-one caught (${dDiffs[0]})`);
});
