// SPDX-License-Identifier: GPL-3.0-only
/**
 * spawnEnemyCraftWhenBandUnderTwo vs the frozen oracle, held to the frogger standard: RAM (masked for
 * the dead stack scratch the dissolved tails leave) is the contract, and only the routine's genuine
 * register live-outs are pinned beside it. The sole caller (driveEnemyWaveForLifePhase) tail-returns
 * this result and reads no register back — b is seated only for the owed run's search counter and the
 * cursors ride in as callee params, so none survive the return: GENUINE_LIVE_OUTS is empty and memory
 * is the whole of the contract. Poked real dispatches, the four decision branches, and a full
 * occupancy x gate x owed-kills sweep. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-379f.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { spawnEnemyCraftWhenBandUnderTwo as candidate } from "../spawnEnemyCraftWhenBandUnderTwo.js";
import { loc_379f as oracle } from "../../translated/loc_379f.js";
import { loc_3793 } from "../loc_3793.js";
import { spawnEnemyIntoFreeSlotElseStepSearch as spawn } from "../spawnEnemyIntoFreeSlotElseStepSearch.js";

const TARGET = 0x379f;
const GATE_CELL = 0xad05;
const CRAFT_BAND = 0xa850;
const RECORD_STRIDE = 0x10;
const BAND_SLOTS = 7;
const OWED_KILLS = 0xad02;
const CRAFT_SPAWN_SLOT_COUNT = 0xacc1;
const OPEN_PHASE = 0x30;

// The two cells that steer the caller into this address, and from which frame the poke forces them.
const PHASE_MID = 0xad06;
const DISPATCH_DIGIT = 0x08;
const POKE_FROM = 600;
const CAP = 60;

// Every data write lands at or below here; the stack scratch sits above it, so masking the scratch
// can never hide a real byte. The frozen side's window is asserted to stay above it.
const DATA_TOP = 0xadff;

// The frogger standard: RAM is the contract and only genuine register live-outs are pinned beside it.
// The sole caller tail-returns and reads no register, so there are none — memory is the whole of it.
const GENUINE_LIVE_OUTS = [];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d ? `${d.addr == null ? "register/return" : hex4(d.addr)}: oracle=${d.a} cand=${d.b}` : "identical";

// ── real dispatches ───────────────────────────────────────────────────────────────────────────

let capturedCache = null;
function captured() {
  if (capturedCache) return capturedCache;
  const entries = [];
  let collecting = true;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (collecting && entries.length < CAP) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  m.pokes = [{ frame: POKE_FROM, addr: PHASE_MID, val: DISPATCH_DIGIT }];
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the poked run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the poked run ran short");
  capturedCache = entries;
  return entries;
}

// ── the masked comparison (frogger standard) ────────────────────────────────────────────────────

// Oracle vs candidate on independent clones. The frozen side tail-calls a body that pushes below its
// seat and pops a return the rewrite never models, so [low, seat) is masked with low watched off the
// oracle's own pushes. Anything outside that window in RAM, or a genuine register live-out, has
// escaped. Registers are NOT pinned by a ceiling — only GENUINE_LIVE_OUTS (empty) is.
function unitDiff(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const rO = oracle(a);
  let rC, threw = null;
  try { rC = cand(b); } catch (e) { threw = String(e).slice(0, 60); }
  if (threw) return { addr: null, a: "returned", b: threw };
  if (low <= DATA_TOP) throw new Error(`the stack window ${hex4(low)} reached game data`);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue; // the frozen side's dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  if (rO !== rC) return { addr: null, a: `ret=${rO}`, b: `ret=${rC}` };
  return null;
}
const diverges = (cand, m) => unitDiff(cand, m) !== null;

// Cells the oracle moves at or below the data top from a state — a turn's footprint.
function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  }
  return n;
}

// ── crafted states ────────────────────────────────────────────────────────────────────────────

function craft({ gate, occ = 0, kills = 3 }) {
  const m = captured()[0].clone();
  m.regs.hl = GATE_CELL;
  m.mem8[GATE_CELL] = gate;
  for (let i = 0; i < BAND_SLOTS; i++) {
    m.mem8[CRAFT_BAND + i * RECORD_STRIDE] = (occ >> i) & 1 ? 0xff : 0;
  }
  m.mem8[OWED_KILLS] = kills;
  return m;
}

// Every occupancy against each gate value (idle-open, phase-open, shut) and each owed-kills arm.
function corpus() {
  const out = [];
  for (const gate of [0x00, OPEN_PHASE, 0x55]) {
    for (const kills of [0, 3]) {
      for (let occ = 0; occ < 1 << BAND_SLOTS; occ++) out.push(craft({ gate, occ, kills }));
    }
  }
  return out;
}

// ── broken twins ──────────────────────────────────────────────────────────────────────────────

// The rewrite with one deliberate defect; defaults match the candidate. Re-implemented rather than
// wrapped so the defect governs the whole body, not a patch after it.
function twin({ noop = false, ceiling = 0x02, openPhase = OPEN_PHASE, honorMode = true }) {
  return function body(m) {
    if (noop) return;
    const { regs, mem8 } = m;
    regs.a = mem8[regs.hl];
    regs.and(regs.a);
    if (regs.a !== 0x00) { regs.cp(openPhase); if (regs.a !== openPhase) return; }
    regs.hl = CRAFT_BAND; regs.de = RECORD_STRIDE; regs.b = BAND_SLOTS; regs.c = 0x00;
    do {
      regs.a = mem8[regs.hl];
      regs.and(regs.a);
      if (regs.a !== 0x00) regs.c = regs.inc8(regs.c);
      regs.hl = (regs.hl + regs.de) & 0xffff;
    } while (regs.djnz() !== 0);
    regs.a = regs.c;
    regs.cp(ceiling);
    if (regs.a >= ceiling) return;
    regs.a = mem8[OWED_KILLS];
    regs.and(regs.a);
    if (honorMode && regs.a === 0x00) return loc_3793(m);
    regs.a = mem8[CRAFT_SPAWN_SLOT_COUNT]; regs.b = regs.a; regs.ix = 0xa8b0; regs.iy = 0xaa26;
    return spawn(m);
  };
}

// A register-only twin: with no genuine register live-outs it is DELIBERATELY not flagged.
const scribbleScratchReg = (m) => { const r = candidate(m); m.regs.c = (m.regs.c + 1) & 0xff; return r; };
// A RAM scribble on a data cell the routine never touches: the same measurement must still bite it.
const SCRIBBLE_CELL = 0xacc2;
const scribbleData = (m) => { const r = candidate(m); m.mem8[SCRIBBLE_CELL] ^= 0xff; return r; };

const TWINS = [
  ["no-op", twin({ noop: true }), 32],
  ["wrong-ceiling", twin({ ceiling: 0x03 }), 84],
  ["gate-only-zero", twin({ openPhase: 0x00 }), 16],
  ["skip-mode", twin({ honorMode: false }), 16],
];

function sweep(cand, states) {
  let caught = 0;
  for (const e of states) if (diverges(cand, e)) caught++;
  return caught;
}

// ── the gate ──────────────────────────────────────────────────────────────────────────────────

test("REAL: every poked dispatch replays identically, and some write", { skip }, () => {
  const entries = captured();
  assert.ok(entries.length > 0, "vacuous: forcing the phase digit no longer reaches this address");
  for (const e of entries) assert.equal(unitDiff(candidate, e), null, () => show(unitDiff(candidate, e)));
  const wrote = entries.filter((e) => footprint(e) > 0).length;
  assert.ok(wrote > 0, "no poked dispatch makes the oracle write, so this arm would pass a no-op");
  console.log(`  REAL: ${entries.length} dispatches identical, ${wrote} of them write`);
});

test("PATHS: the four decision branches each replay, and the branch really branches", { skip }, () => {
  const shut = craft({ gate: 0x55 });
  const busy2 = craft({ gate: 0x00, occ: 0b0000011 });
  const via3793 = craft({ gate: 0x00, occ: 0, kills: 0 });
  const via37d6 = craft({ gate: OPEN_PHASE, occ: 0, kills: 3 });
  for (const [name, m] of [["shut", shut], ["busy2", busy2], ["via3793", via3793], ["via37d6", via37d6]]) {
    assert.equal(unitDiff(candidate, m), null, `${name}: ${show(unitDiff(candidate, m))}`);
  }
  // ★ Vacuity guard: the shut and busy branches write nothing while both spawn branches do, so a
  // rewrite that ignored the gate, the count or the mode could not pass all four.
  assert.equal(footprint(shut), 0, "the shut gate wrote something");
  assert.equal(footprint(busy2), 0, "the two-busy bank wrote something");
  assert.ok(footprint(via3793) > 0 && footprint(via37d6) > 0, "a spawn branch wrote nothing");
  console.log(`  PATHS: shut/busy write ${footprint(shut)}/${footprint(busy2)}, spawns ` +
    `${footprint(via3793)}/${footprint(via37d6)}`);
});

test("CORPUS: occupancy x gate x owed-kills all replay, and the sweep is not all no-ops",
  { skip }, () => {
    const states = corpus();
    for (const e of states) assert.equal(unitDiff(candidate, e), null, () => show(unitDiff(candidate, e)));
    const writing = states.filter((e) => footprint(e) > 0).length;
    assert.ok(writing > 0, "no crafted state makes the oracle write, so the sweep is decoration");
    console.log(`  CORPUS: ${states.length} states identical, ${writing} write`);
  });

test("SP AND RETURN: the frozen window stays above the data, returns equal on every path", { skip }, () => {
  for (const m of [craft({ gate: 0x55 }), craft({ gate: 0x00, occ: 0, kills: 0 }),
    craft({ gate: OPEN_PHASE, occ: 0, kills: 3 })]) {
    // unitDiff throws if the frozen side's stack window reaches game data, and pins the return.
    assert.equal(unitDiff(candidate, m), null, () => show(unitDiff(candidate, m)));
  }
  console.log("  SP: stack window over the data on every path; returns identical");
});

test("SCRATCH NOT PINNED: a register-only twin passes; a RAM scribble is caught", { skip }, () => {
  // No genuine register live-outs, so a twin that only scribbles a scratch register after the routine
  // is DELIBERATELY not flagged — yet the same measurement must still catch a scribbled RAM cell, or
  // the clean read on the register twin would be worthless.
  const states = [captured()[0], ...corpus().slice(0, 24)];
  for (const s of states) {
    assert.equal(unitDiff(scribbleScratchReg, s), null,
      "a scratch-register scribble was flagged, but this step has no genuine register live-outs to pin");
    const d = unitDiff(scribbleData, s);
    assert.notEqual(d, null, "the RAM measurement missed a scribbled cell, so it has no teeth");
    assert.notEqual(d.addr, null, "the RAM scribble must be caught on a cell, not a register");
  }
  console.log(`  SCRATCH NOT PINNED: register twin ignored; RAM twin caught on all ${states.length}`);
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught in RAM on an exact count of crafted states`, { skip }, () => {
    const states = corpus();
    const caught = sweep(brokenTwin, states);
    assert.ok(caught > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught}/${states.length}`);
  });
}
