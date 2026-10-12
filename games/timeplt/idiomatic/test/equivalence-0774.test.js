// SPDX-License-Identifier: GPL-3.0-only
/**
 * postLifeStartCaptionsAndResetPlayfield — memory-equivalent to the frozen oracle at ROM 0x0774.
 * GATE: real dispatches (reached only by computed dispatch off the sub-step table) plus crafted
 *   branch entries — second player up, play inactive, an occupied command ring, and a tampered
 *   image built by patching a private copy of the ROM; RAM compared with the dead stack scratch
 *   below the seated SP masked out, the +2 SP re-seat and the undefined return asserted, teeth.
 *   Run: node --test games/timeplt/idiomatic/test/equivalence-0774.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { postLifeStartCaptionsAndResetPlayfield as candidate } from "../postLifeStartCaptionsAndResetPlayfield.js";
import { loc_0774 as oracle } from "../../translated/loc_0774.js";
import { advanceSequencePhase } from "../advanceSequencePhase.js";
import { postCommand } from "../postCommand.js";
import { drawKillMeter } from "../drawKillMeter.js";
import { resetPlayfieldForLifeStart } from "../resetPlayfieldForLifeStart.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import { PLAY_ACTIVE, ACTIVE_PLAYER, ROUND_INTRO_PENDING, SEQUENCE_PHASE } from "../names.js";

const TARGET = 0x0774;
const HOT_CONTROL = 0x37bd; // fires hundreds of times, so the tap is known to see dispatches
const COINSTART_DISPATCHES = 2;
const ATTRACT_DISPATCHES = 1;

const GUARD_SPAN_BASE = 0x4c99;
const GUARD_SPAN_BYTES = 256;
const GUARD_GENUINE_FOLD = 0x6b;
const WRITE_CURSOR = 0xa9b2;
const COMMAND_RING = 0xac00;
// Every cell this routine writes sits at or below here; the stack seats far above it (0xafxx), so
// masking the scratch window can never hide a data divergence. Asserted against the measured floor.
const DATA_TOP = 0xadff;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs candidate on independent clones. The oracle's tail jump runs a callee that pops the
 * caller's slot and its nested calls push return addresses the rewrite never writes, so the diff
 * excludes [low, seat) — low measured by watching the oracle's own pushes. Anything outside escapes.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const retOracle = oracle(a);
  let retCand, threw = null;
  try { retCand = cand(b); } catch (e) { threw = e; }
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  if (threw) escaped = { addr: null, oracle: "ran", candidate: String(threw).slice(0, 40) };
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** Cells at or below DATA_TOP the oracle moves from a state — a branch's footprint. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  oracle(a);
  const now = a.dumpState();
  const cells = [];
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr <= DATA_TOP) cells.push(addr);
  }
  return cells;
}

// ── captured entries, and the crafted branch entries ──────────────────────────────────────

const captured = new Map();
function entriesFor(label, opts) {
  if (!captured.has(label)) {
    const got = [];
    const m = makeMachine(new Map([[TARGET, (mm) => { got.push(mm.clone()); return oracle(mm); }]]), opts);
    m.runFrames(ENTRY_FRAMES);
    captured.set(label, got);
  }
  return captured.get(label);
}
const realEntries = () => [...entriesFor("coin", {}), ...entriesFor("attract", { tape: [] })];

function craft(mutate) {
  const m = entriesFor("coin", {})[0].clone();
  mutate(m);
  return m;
}

/** High bit set = free, so postCommand writes; clear = occupied, so it drops. */
function ring(m, free) {
  for (let k = 0; k < 6; k++) m.mem8[COMMAND_RING + ((m.mem8[WRITE_CURSOR] + k) & 0x3f)] = free ? 0xff : 0x00;
}

/** ROM is read-only through the address space, so the tamper is a private patched image: clones
 * rebuild from `machine.rom`, so both sides of the comparison see the same patched byte. */
function tamper(m) {
  m.rom = Uint8Array.from(m.rom);
  m.rom[GUARD_SPAN_BASE] ^= 0x01;
  m.mem.rom = m.rom;
}

const setup = (active, player, armed, free = true) => (m) => {
  m.mem8[PLAY_ACTIVE] = active;
  m.mem8[ACTIVE_PLAYER] = player;
  m.mem8[ROUND_INTRO_PENDING] = armed;
  ring(m, free);
};

function scenarios() {
  return [
    ["p1-armed", craft(setup(0xff, 0, 0xff))],
    ["p1-unarmed", craft(setup(0xff, 0, 0))],
    ["p2-armed", craft(setup(0xff, 1, 0xff))],
    ["p2-unarmed", craft(setup(0xff, 1, 0))],
    ["inactive", craft(setup(0, 0, 0xff))],
    ["p2-armed-occupied", craft(setup(0xff, 1, 0xff, false))],
    ["tampered-p2-armed", craft((m) => { setup(0xff, 1, 0xff)(m); tamper(m); })],
  ];
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every parameter matches postLifeStartCaptionsAndResetPlayfield by default. */
function twin({ guard = true, player = true, armedCmd = 7, armedBranch = true, inactiveArg = 2, meter = true, reset = true, substep = true }) {
  return (m) => {
    const { mem8 } = m;
    if (guard) {
      let fold = 0;
      for (let i = 0; i < GUARD_SPAN_BYTES; i++) fold ^= mem8[GUARD_SPAN_BASE + i];
      if (fold !== GUARD_GENUINE_FOLD) advanceSequencePhase(m);
    }
    if (mem8[PLAY_ACTIVE] === 0) {
      postCommand(m, 2, inactiveArg);
    } else {
      const argument = 9 + (player && mem8[ACTIVE_PLAYER] !== 0 ? 1 : 0);
      postCommand(m, 2, argument);
      if (armedBranch && mem8[ROUND_INTRO_PENDING] !== 0) postCommand(m, armedCmd, argument);
      else postCommand(m, 2, 2);
    }
    if (meter) drawKillMeter(m);
    if (reset) resetPlayfieldForLifeStart(m);
    if (substep) advanceSequenceSubStep(m);
  };
}

const TWINS = [
  ["no-op", () => {}, 7],
  ["skip-guard", twin({ guard: false }), 1],
  ["ignore-player", twin({ player: false }), 3],
  ["wrong-armed-cmd", twin({ armedCmd: 6 }), 3],
  ["armed-takes-default", twin({ armedBranch: false }), 3],
  ["wrong-inactive-arg", twin({ inactiveArg: 3 }), 1],
  ["skip-meter", twin({ meter: false }), 7],
  ["skip-reset", twin({ reset: false }), 7],
  ["skip-substep", twin({ substep: false }), 7],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at real dispatches: RAM identical outside the masked stack scratch", { skip }, () => {
  const entries = realEntries();
  assert.ok(entries.length > 0, "vacuous: the tapes never reached the routine");
  for (const e of entries) {
    const r = compare(candidate, e);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${r.escaped.addr == null ? "throw" : hex4(r.escaped.addr)}`);
    // ★ The mask is safe only if its floor sits above every data cell this routine writes.
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
  }
  // ★ The real entries cover the inactive, the armed and the unarmed arms between them.
  const arms = new Set(entries.map((e) => (e.mem8[PLAY_ACTIVE] === 0 ? "inactive" : e.mem8[ROUND_INTRO_PENDING] === 0 ? "unarmed" : "armed")));
  assert.deepEqual([...arms].sort(), ["armed", "inactive", "unarmed"], "the captured dispatches no longer span the three arms");
  console.log(`  EQUAL: ${entries.length} real dispatches identical; arms ${[...arms].sort().join("/")}`);
});

test("REACHABILITY: computed dispatch reaches it at life start, in play and attract", { skip }, () => {
  const run = (opts) => {
    const seen = { [TARGET]: 0, [HOT_CONTROL]: 0 };
    const wrap = (a) => (mm) => { seen[a]++; return TRANSLATED.get(a)(mm); };
    const m = makeMachine(new Map([TARGET, HOT_CONTROL].map((a) => [a, wrap(a)])), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
    return seen;
  };
  const coin = run({});
  const attract = run({ tape: [] });
  assert.ok(coin[HOT_CONTROL] > 0 && attract[HOT_CONTROL] > 0, "the control never fired: the taps are blind");
  assert.equal(coin[TARGET], COINSTART_DISPATCHES, "the coin-start dispatch count moved");
  assert.equal(attract[TARGET], ATTRACT_DISPATCHES, "the attract dispatch count moved");
  console.log(`  REACHABILITY: TARGET coin ${coin[TARGET]} / attract ${attract[TARGET]}, control ${coin[HOT_CONTROL]}`);
});

test("GUARD: the genuine image folds to the pass value, and the patched one does not", { skip }, () => {
  const fold = (m) => { let x = 0; for (let i = 0; i < GUARD_SPAN_BYTES; i++) x ^= m.mem8[GUARD_SPAN_BASE + i]; return x; };
  const all = new Map(scenarios());
  assert.equal(fold(all.get("p2-armed")), GUARD_GENUINE_FOLD, "the genuine image no longer folds to the pass value");
  const t = all.get("tampered-p2-armed");
  assert.notEqual(fold(t), GUARD_GENUINE_FOLD, "the tamper patch did not reach the folded span");
  // ★ Vacuity guard: the derail must move the outer phase, or the tamper scenario proves nothing.
  const a = t.clone();
  const before = a.mem8[SEQUENCE_PHASE];
  oracle(a);
  assert.notEqual(a.mem8[SEQUENCE_PHASE], before, "the oracle did not take the derail on the patched image");
});

test("PATHS: every crafted branch is equivalent, and the branches really differ", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && (r.escaped.addr == null ? "throw" : hex4(r.escaped.addr))}`);
    prints[label] = footprint(m).join(",");
  }
  assert.notEqual(prints["p2-armed"], prints["p2-armed-occupied"], "the free and occupied rings move the same cells");
  assert.notEqual(prints["p2-armed"], prints["tampered-p2-armed"], "the genuine and tampered images move the same cells");
  console.log(`  PATHS: ${scenarios().length} scenarios equivalent`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return undefined", { skip }, () => {
  for (const [label, m] of [...scenarios(), ...realEntries().map((e, i) => [`real${i}`, e])]) {
    const r = compare(candidate, m);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops a return address and the rewrite does not`);
    assert.equal(r.retOracle, undefined, `${label}: the oracle returned a value`);
    assert.equal(r.retCand, undefined, `${label}: the rewrite returned a value`);
  }
  console.log("  SP: +2 on every path; return values both undefined");
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of scenarios`, { skip }, () => {
    let caught = 0;
    for (const [, m] of scenarios()) if (compare(brokenTwin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${scenarios().length} scenarios`);
  });
}
