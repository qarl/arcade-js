// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3156 — memory-equivalent to the frozen oracle at ROM 0x3156.
 *
 * GATE: poked-natural dispatch through unitEquivalence, with a negative control and a sweep over
 *   the one thing this routine decides. Five bytes: `ld a,0x28` then `jp 0x30D1`. Everything the
 *   game observes afterwards belongs to 0x30D1, so what a gate must catch is a WRONG FILL BYTE
 *   reaching it — which it can, because 0x30D1 stores that byte into eight cells at 0xAA60 on a
 *   stride of two, and those cells are in the state dump.
 *
 * WHY A POKE IS NEEDED, AND WHAT IT IS. The single `jp z,0x3156` at 0x30CC fires only when the era
 *   index equals four, and neither the shared coin -> start tape nor undriven attract gets that
 *   far in 4000 frames. The poke holds ERA_INDEX at four from frame 260; the round-scenery setup
 *   then dispatches this routine itself. One cell, nothing else forced.
 *
 * What it exercises, holes stated:
 *   1. NEGATIVE CONTROL — the identical attract run without the poke dispatches 0x3156 zero times
 *      and unitEquivalence throws "never entered". Asserted.
 *   2. EQUAL at the poked dispatch — RAM byte-identical across the whole state dump, registers too.
 *   3. THE BYTE ACTUALLY LANDS — after the dispatch the eight stride-two cells from 0xAA60 all
 *      read the fill byte, so the RAM arm is demonstrably not vacuous on the cells that matter.
 *   4. TEETH — a no-op twin, a twin that sets the byte and forgets the transfer, a twin that
 *      transfers without setting the byte (which lets the caller's stale value through), and
 *      neighbouring fill bytes one either side. Every one is caught.
 *
 * HOLE: one era. The dispatch condition pins the era index to four, so this covers the era-four
 * arm of 0x30D1 and no other. It also does not establish what the filled cells mean — they are
 * the second band of the eight scenery sprite entries, and this file claims nothing beyond the
 * byte arriving in them.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3156.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3156 } from "../loc_3156.js";
import { loc_3156 as oracle } from "../../translated/loc_3156.js";
import { ERA_INDEX } from "../names.js";
import { unitEquivalence } from "../../../../core/equivalence.js";

const TARGET = 0x3156;
const ERA_THAT_DISPATCHES = 4;
const POKE_FROM_FRAME = 260;

/** The fill byte this entry chooses, and the run of cells 0x30D1 writes it into. */
const FILL_BYTE = 40;
const FILLED_RUN_START = 0xaa60;
const FILLED_RUN_STRIDE = 2;
const FILLED_RUN_CELLS = 8;

/** The byte 0x30D1 would otherwise have been handed, reached by falling through 0x30CF. */
const THE_OTHER_FILL_BYTE = 0xcc;

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function attract(poked) {
  return (overrides) => {
    const m = makeMachine(overrides, { tape: [] });
    if (poked) {
      m.pokes = [{ addr: ERA_INDEX, val: ERA_THAT_DISPATCHES, frame: POKE_FROM_FRAME, dur: null }];
    }
    return m;
  };
}

let entry = null;

function gate(candidate, poked = true) {
  return unitEquivalence(
    attract(poked),
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) gate(loc_3156);
  return entry;
}

function filledRun(machine) {
  const out = [];
  for (let i = 0; i < FILLED_RUN_CELLS; i++) {
    out.push(machine.mem8[FILLED_RUN_START + i * FILLED_RUN_STRIDE]);
  }
  return out;
}

// ── the control ─────────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: at any era the game reaches on its own, it never dispatches", { skip: SKIP }, () => {
  assert.throws(
    () => gate(loc_3156, false),
    /never entered/,
    "an unpoked attract run must not reach this arm — if it does, the poke proves nothing",
  );
  console.log("  CONTROL: zero dispatches with the era left alone");
});

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("EQUAL at the poked dispatch: loc_3156 == oracle on RAM and registers", { skip: SKIP }, () => {
  const r = gate(loc_3156);
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  assert.equal(r.regs, null, `a register diverged — ${JSON.stringify(r.regs)}`);
  assert.notEqual(entry, null, "vacuous: the poked run never reached the routine");
  console.log(`  EQUAL: dispatched with ${hex4(ERA_INDEX)}=${ERA_THAT_DISPATCHES}; RAM identical`);
});

test("THE BYTE LANDS: the filled run holds the chosen byte, so the RAM arm is not vacuous", { skip: SKIP }, () => {
  const m = entryState().clone();
  loc_3156(m);
  const run = filledRun(m);
  assert.deepEqual(run, new Array(FILLED_RUN_CELLS).fill(FILL_BYTE), "every filled cell must hold it");
  assert.notEqual(FILL_BYTE, THE_OTHER_FILL_BYTE, "the two fill bytes must actually differ");
  console.log(`  LANDS: ${FILLED_RUN_CELLS} cells from ${hex4(FILLED_RUN_START)} all read ${FILL_BYTE}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

const DESTINATION = 0x30d1;

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: chooses the byte and forgets to hand control on. */
function brokenNoTransfer(m) {
  m.regs.a = FILL_BYTE;
}

/** BUG: hands control on without choosing the byte, so the caller's stale value is used. */
function brokenNoChoice(m) {
  return m.call(DESTINATION);
}

/** BUG: the byte the fall-through path would have used. */
function brokenOtherByte(m) {
  m.regs.a = THE_OTHER_FILL_BYTE;
  return m.call(DESTINATION);
}

const neighbour = (delta) => (m) => {
  m.regs.a = FILL_BYTE + delta;
  return m.call(DESTINATION);
};

for (const [label, twin] of [
  ["no-op", brokenNoOp],
  ["chooses-but-does-not-transfer", brokenNoTransfer],
  ["transfers-without-choosing", brokenNoChoice],
  ["uses-the-fall-through-byte", brokenOtherByte],
  ["one-below", neighbour(-1)],
  ["one-above", neighbour(+1)],
]) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip: SKIP }, () => {
    const r = gate(twin);
    assert.notEqual(r.ram, null, `the gate PASSED the ${label} twin — it has no teeth`);
    assert.equal(r.equal, false, "a RAM divergence must fail the whole comparison");
    console.log(`  TEETH/${label}: caught — ${show(r.ram)}`);
  });
}
