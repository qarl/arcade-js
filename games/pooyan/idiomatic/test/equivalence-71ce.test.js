// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEagleApproachAndPaintGridMarker (ROM 0x71ce, Pooyan) — the eagle/arrow approach state
 * machine, run once per frame. A hold counter at 0x8f36 gates entry (nonzero -> tick down and
 * return). Once zero, the machine ORs the target presence at 0x8c90 with 0x8a99 to pick a branch,
 * then drives the aim flags at 0x8a87 from the eagle X (0x8a84) against thresholds 0x59/0x60 and
 * the records-arrived sub-phase (0x8f39), latching the enemy X (0x8f5b) past 0x60. On the final
 * sub-phase, once armed (finish flag 0x8f3e clear) and every eighth frame (tick 0x8f3b & 7 == 0),
 * it stamps a grid marker tile 0x2c into video RAM (base 0x87e0, offset by the record column
 * 0x8c96 / coordinate 0x8c94) plus its colour attribute, and delegates the grid-edge guard 0x7287
 * and the phase-reset epilogue 0x7292. On the grid-edge path the guard runs 0x7292 (which repoints
 * the running pointer at 0x8f39), so the marker lands relocated — a real path this test covers.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine writes work + video
 * RAM, so each case runs the oracle on one FRESH clone and advanceEagleApproachAndPaintGridMarker on another, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * LIVE-OUT: none. Every exit leaves scratch registers in a state the sole caller (which reloads HL
 * and A immediately) never reads, so the contract is memory only — pc/SP/cycles and the register
 * file are NOT compared. advanceEagleApproachAndPaintGridMarker takes no register inputs; every input is a memory cell, seated
 * identically on both sides. The delegated guard/epilogue run as the real routines under the
 * oracle and as the validated idiomatic modules under advanceEagleApproachAndPaintGridMarker, so their writes must agree too.
 *
 * Jobs:
 *   1. EQUAL (crafted sweep) — one poke-set per control-flow arm (hold, both idle-aim exits, the
 *      three sub-phase steps, both delegations, the eighth-frame grid stamp, the loop-back, and the
 *      grid-EDGE relocation): oracle == advanceEagleApproachAndPaintGridMarker in RAM(−stack).
 *   2. TARGETED — pin the concrete effect of the hold tick, the idle-aim latch, the eighth-frame
 *      marker/colour stamp, and the grid-edge relocation (finish flag + epilogue + relocated stamp).
 *   3. WRITE-SET — the eighth-frame stamp writes exactly {tick, marker cell, colour cell}.
 *   4. TEETH — a wrong aim byte and a wrong marker byte are both CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-71ce.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_71ce as oracle } from "../../translated/loc_71ce.js";
import { advanceEagleApproachAndPaintGridMarker } from "../advanceEagleApproachAndPaintGridMarker.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const HOLD = 0x8f36;      // entry hold counter
const TARGET0 = 0x8c90;   // target presence byte
const GATE2 = 0x8a99;     // second presence byte ORed with TARGET0
const AIM = 0x8a87;       // player aim flags
const LATCHED_X = 0x8f5b; // latched enemy X
const EAGLE_X = 0x8a84;   // eagle approach coordinate
const ARRIVED = 0x8f39;   // records-arrived sub-phase
const FINISH = 0x8f3e;    // grid-advance finish flag
const TICK = 0x8f3b;      // eighth-frame grid tick
const GRID_COL = 0x8c96;  // grid record column
const GRID_POS = 0x8c94;  // grid record coordinate (guard reads this)
const PHASE = 0x8f38;     // eagle-wave outer phase (epilogue advances it)
const GRID_BASE = 0x87e0; // video-RAM marker base
const COLOUR_OFFSET = 0x400;
const MARKER = 0x2c;
const EDGE = 0xd0;

const BASELINE = [HOLD, TARGET0, GATE2, AIM, LATCHED_X, EAGLE_X, ARRIVED, FINISH, TICK, GRID_COL, GRID_POS, PHASE];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: dead stack seated, the control cells zeroed to a known baseline, then `vals`
 *  applied. advanceEagleApproachAndPaintGridMarker takes no register inputs, so only memory is seated. */
function craft(vals) {
  const m = BASE.clone();
  m.regs.sp = STACK_SCRATCH.hi - 0x10; // the oracle's ret/tail-call framing reads the dead stack
  for (const a of BASELINE) m.mem.write8(a, 0);
  for (const [a, v] of Object.entries(vals)) m.mem.write8(Number(a), v);
  return m;
}

/** Marker + colour cells for the non-edge eighth-frame stamp, from the record column/coordinate. */
function gridCells(col, pos) {
  const rows = (col >> 3) + 1;
  const cell0 = (GRID_BASE - 0x20 * rows) & 0xffff;
  const marker = (cell0 + ((pos >> 3) + 1)) & 0xffff;
  const colour = (marker - COLOUR_OFFSET) & 0xffff;
  return { marker, colour };
}

const CASES = [
  { name: "hold gate (nonzero -> tick down)", vals: { [HOLD]: 5 } },
  { name: "idle, latched -> on-target", vals: { [LATCHED_X]: 0x40, [AIM]: 0x00 } },
  { name: "idle, unlatched, eagleX >= far -> latch + below", vals: { [EAGLE_X]: 0x70, [AIM]: 0xff } },
  { name: "idle, unlatched, eagleX < far -> below only", vals: { [EAGLE_X]: 0x50, [AIM]: 0x00 } },
  { name: "sub-phase arrived 0 -> 1 (clear aim)", vals: { [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 0, [AIM]: 0xff } },
  { name: "sub-phase arrived 1 -> 2 (arm aim)", vals: { [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 1, [AIM]: 0x00 } },
  { name: "sub-phase 2, finish set -> epilogue", vals: { [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 2, [FINISH]: 1, [AIM]: 0x33, [LATCHED_X]: 0x22, [PHASE]: 0x05 } },
  { name: "sub-phase 2, off eighth-frame -> guard only", vals: { [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 2, [FINISH]: 0, [TICK]: 0x02, [GRID_POS]: 0x40 } },
  { name: "sub-phase 2, eighth-frame stamp (non-edge)", vals: { [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 2, [FINISH]: 0, [TICK]: 0x07, [GRID_COL]: 0x36, [GRID_POS]: 0x1a } },
  { name: "sub-phase eagleX > near -> loop back to idle aim", vals: { [TARGET0]: 1, [EAGLE_X]: 0x70, [LATCHED_X]: 0, [AIM]: 0x00 } },
  { name: "sub-phase eagleX < near -> below", vals: { [TARGET0]: 1, [EAGLE_X]: 0x40, [AIM]: 0xff } },
  { name: "sub-phase 2, eighth-frame stamp (grid EDGE)", vals: { [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 2, [FINISH]: 0, [TICK]: 0x07, [GRID_COL]: 0x36, [GRID_POS]: EDGE, [LATCHED_X]: 0x11, [AIM]: 0x22, [PHASE]: 0x03 } },
];

// -- 1. EQUAL (crafted sweep) -------------------------------------------------

test("EQUAL: crafted control-flow arms — advanceEagleApproachAndPaintGridMarker == oracle in RAM (−stack)", () => {
  for (const { name, vals } of CASES) {
    const o = craft(vals);
    const c = craft(vals);
    oracle(o);
    advanceEagleApproachAndPaintGridMarker(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted arms identical (RAM −stack)`);
});

// -- 2. TARGETED --------------------------------------------------------------

test("TARGETED: hold gate ticks the counter down and returns", () => {
  const c = craft({ [HOLD]: 5 });
  advanceEagleApproachAndPaintGridMarker(c);
  assert.equal(c.mem.read8(HOLD), 4, "hold counter decremented");
});

test("TARGETED: idle unlatched past the far threshold latches X and shows below", () => {
  const c = craft({ [EAGLE_X]: 0x70, [AIM]: 0xff });
  advanceEagleApproachAndPaintGridMarker(c);
  assert.equal(c.mem.read8(LATCHED_X), 0x70, "enemy X latched");
  assert.equal(c.mem.read8(AIM), (0xff & 0xfb) | 0x08, "aim: bit2 cleared, bit3 set");
});

test("TARGETED: eighth-frame stamp writes the marker tile and colour attribute", () => {
  const col = 0x36, pos = 0x1a;
  const { marker, colour } = gridCells(col, pos);
  const c = craft({ [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 2, [FINISH]: 0, [TICK]: 0x07, [GRID_COL]: col, [GRID_POS]: pos });
  advanceEagleApproachAndPaintGridMarker(c);
  assert.equal(c.mem.read8(TICK), 0x08, "tick advanced onto the eighth-frame boundary");
  assert.equal(c.mem.read8(marker), MARKER, `marker tile at ${hx(marker)}`);
  assert.equal(c.mem.read8(colour), 0xc0, `colour attribute at ${hx(colour)}`); // col&6==6, pos&6==2
});

test("TARGETED: grid-EDGE runs the epilogue and relocates the stamp", () => {
  const c = craft({ [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 2, [FINISH]: 0, [TICK]: 0x07, [GRID_COL]: 0x36, [GRID_POS]: EDGE, [LATCHED_X]: 0x11, [AIM]: 0x22, [PHASE]: 0x03 });
  advanceEagleApproachAndPaintGridMarker(c);
  // The guard arms the finish flag and runs the epilogue at the edge.
  assert.equal(c.mem.read8(FINISH), 1, "finish flag armed at the edge");
  assert.equal(c.mem.read8(AIM), 0, "epilogue cleared the aim flags");
  assert.equal(c.mem.read8(LATCHED_X), 0, "epilogue cleared the latched X");
  assert.equal(c.mem.read8(PHASE), 0x04, "epilogue advanced the outer phase");
  assert.equal(c.mem.read8(ARRIVED), 0, "epilogue cleared the sub-phase");
  // With the pointer relocated to the sub-phase cell, the marker lands one cell on (0x8f3a).
  const marker = (ARRIVED + 1) & 0xffff;
  assert.equal(c.mem.read8(marker), MARKER, `relocated marker at ${hx(marker)}`);
  assert.equal(c.mem.read8((marker - COLOUR_OFFSET) & 0xffff), 0x80, "relocated colour attribute"); // col&6==6, pos&6==0
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the eighth-frame stamp writes exactly {tick, marker, colour}", () => {
  const col = 0x36, pos = 0x1a;
  const { marker, colour } = gridCells(col, pos);
  const m = craft({ [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 2, [FINISH]: 0, [TICK]: 0x07, [GRID_COL]: col, [GRID_POS]: pos });
  m.mem.write8(marker, 0xee); // pre-dirty so the stamp is observable
  m.mem.write8(colour, 0xee);
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's ret/tail-call framing lands in the dead stack
    changed.push(addr);
  }
  const set = new Set(changed);
  assert.equal(changed.length, 3, `expected 3 writes, got ${changed.length}: ${changed.map(hx)}`);
  for (const cell of [TICK, marker, colour]) assert.ok(set.has(cell), `missing a write at ${hx(cell)}`);
  console.log(`  WRITE-SET: ${hx(TICK)} / ${hx(marker)} / ${hx(colour)} (3 cells)`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong aim byte is CAUGHT by the RAM diff", () => {
  const vals = { [EAGLE_X]: 0x50, [AIM]: 0x00 }; // idle, unlatched, below -> aim := 0x08
  const o = craft(vals);
  const c = craft(vals);
  oracle(o);
  advanceEagleApproachAndPaintGridMarker(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(AIM, 0x00); // BUG: aim must be 0x08 (below), not 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong aim byte — it is worthless");
  assert.equal(d.addr, AIM, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(AIM)})`);
  console.log(`  TEETH/aim: wrong aim byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong marker byte is CAUGHT by the RAM diff", () => {
  const col = 0x36, pos = 0x1a;
  const { marker } = gridCells(col, pos);
  const vals = { [TARGET0]: 1, [EAGLE_X]: 0x59, [ARRIVED]: 2, [FINISH]: 0, [TICK]: 0x07, [GRID_COL]: col, [GRID_POS]: pos };
  const o = craft(vals);
  const c = craft(vals);
  oracle(o);
  advanceEagleApproachAndPaintGridMarker(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(marker, MARKER ^ 0xff); // BUG: wrong marker tile
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong marker byte — it is worthless");
  assert.equal(d.addr, marker, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(marker)})`);
  console.log(`  TEETH/marker: wrong marker byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
