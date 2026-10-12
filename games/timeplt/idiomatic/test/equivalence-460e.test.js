// SPDX-License-Identifier: GPL-3.0-only
/**
 * checkTamperGlyphCopyElseRunAwardLabelStep — memory-equivalent to the frozen oracle at ROM 0x460E.
 * GATE: crafted-entry. Neither tape dispatches this address (it is the two-player-start path), so a
 *   real attract machine is captured for realistic RAM and the branch cells are poked identically on
 *   both sides. RAM is compared with the dead stack scratch below the seat masked out (the oracle
 *   pops its caller's return through the dissolved tail, the rewrite does not); SP drift is asserted
 *   and registers are not compared, since the caller overwrites HL and reads no register back.
 *   Run: node --test games/timeplt/idiomatic/test/equivalence-460e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { checkTamperGlyphCopyElseRunAwardLabelStep as candidate } from "../checkTamperGlyphCopyElseRunAwardLabelStep.js";
import { loc_460e as oracle } from "../../translated/loc_460e.js";
import { requestMotherShipAwardSound } from "../requestMotherShipAwardSound.js";
import { postCommand } from "../postCommand.js";

const TARGET = 0x460e;
const CONTROL = 0x0038;
const WATCHED = 0xa67c;
const MIRROR = 0xab43;
const SOUND_TRIGGER = 0xa800;
const PLAY_ACTIVE = 0xad30;
const COUNTER = 0xa860;
const SLOT = 0xaa00;
const RING = 0xac00;
const WRITE_CURSOR = 0xa9b2;
const DATA_TOP = 0xadff;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── base capture and crafted branch entries ─────────────────────────────────────────────────

let base = null;
function baseState() {
  if (base === null) {
    const real = TRANSLATED.get(CONTROL);
    const m = makeMachine(new Map([[CONTROL, (mm) => {
      if (base === null) base = mm.clone();
      return real(mm);
    }]]), { tape: [] });
    m.runFrames(ENTRY_FRAMES);
  }
  return base;
}

function craft(mutate) {
  const m = baseState().clone();
  m.regs.ix = COUNTER;
  m.regs.iy = SLOT;
  // A free ring cell so the queued command actually lands rather than being dropped.
  m.mem8[WRITE_CURSOR] = 0;
  m.mem8[RING] = 0xff;
  m.mem8[RING + 1] = 0xff;
  mutate(m);
  return m;
}

/** The no-op arm, and the write arm with the sound gate armed both ways. */
function scenarios() {
  return [
    ["equal", craft((m) => { m.mem8[WATCHED] = 0x5a; m.mem8[MIRROR] = 0x5a; })],
    ["differ-sound", craft((m) => {
      m.mem8[WATCHED] = 0x11; m.mem8[MIRROR] = 0x22;
      m.mem8[SOUND_TRIGGER] = 0xff; m.mem8[PLAY_ACTIVE] = 0xff;
    })],
    ["differ-nosound", craft((m) => {
      m.mem8[WATCHED] = 0x11; m.mem8[MIRROR] = 0x22;
      m.mem8[SOUND_TRIGGER] = 0x00; m.mem8[PLAY_ACTIVE] = 0xff;
    })],
  ];
}

/**
 * Oracle vs candidate on independent clones. The oracle nests calls and pops its caller's slot
 * through the dissolved tail, so the diff excludes [low, seat) — low measured by watching the
 * oracle's pushes. Anything outside that window has escaped.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  cand(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp };
}

/** Cells at or below the data ceiling the oracle moves from a state — a branch's footprint. */
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

// ── the twins ───────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; matches checkTamperGlyphCopyElseRunAwardLabelStep by default. */
function twin(o) {
  return (m) => {
    const { mem8, regs } = m;
    const differ = mem8[MIRROR] !== mem8[WATCHED];
    if (o.noop || !(o.invert ? !differ : differ)) return;
    if (!o.skipCounter) mem8[regs.ix] = mem8[regs.ix] - 1;
    mem8[(regs.iy + 1) & 0xffff] = o.wrongVert ? 0xff : 0xfe;
    mem8[(regs.iy + 3) & 0xffff] = 0xfd;
    if (!o.skipGlyphs) {
      mem8[(regs.iy + 0x30) & 0xffff] = 0x6c;
      mem8[(regs.iy + 0x32) & 0xffff] = 0x6c;
    }
    if (!o.noSound && mem8[SOUND_TRIGGER] === 0xff) requestMotherShipAwardSound(m);
    return postCommand(m, 0x04, 0x0d);
  };
}

const TWINS = [
  ["no-op", twin({ noop: true }), 2],
  ["skip-counter", twin({ skipCounter: true }), 2],
  ["skip-glyphs", twin({ skipGlyphs: true }), 2],
  ["wrong-vertical", twin({ wrongVert: true }), 2],
  ["invert-gate", twin({ invert: true }), 3],
  ["no-sound", twin({ noSound: true }), 1],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither tape dispatches this address, with a live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["attract", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [CONTROL]: 0 };
    const real = TRANSLATED.get(CONTROL);
    const m = makeMachine(new Map([
      [TARGET, (mm) => { seen[TARGET]++; return oracle(mm); }],
      [CONTROL, (mm) => { seen[CONTROL]++; return real(mm); }],
    ]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // ★ The zero is evidence ONLY because the same run counted a control that DOES fire.
    assert.ok(seen[CONTROL] > 0, `${label}: the control never fired, so the zero means nothing`);
    assert.equal(seen[TARGET], 0, `${label} now dispatches this address; capture plain entries`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} ${seen[TARGET]}, control ${hex4(CONTROL)} ${seen[CONTROL]}`);
  }
});

test("CRAFTED: every branch is memory-equivalent outside the masked stack scratch", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops a return slot and the rewrite does not`);
    // ★ The mask is safe only if its floor sits above every data cell.
    assert.ok(r.low > DATA_TOP, `${label}: the stack window ${hex4(r.low)} reached into game data`);
  }
  console.log(`  CRAFTED: ${scenarios().length} scenarios equivalent, spDiff +2`);
});

test("PATHS: the branches move different cells, so the arms are not vacuous", { skip }, () => {
  const prints = Object.fromEntries(scenarios().map(([l, m]) => [l, footprint(m)]));
  assert.equal(prints["equal"].length, 0, "the agree path wrote something");
  assert.ok(prints["differ-nosound"].length > 0, "the write path wrote nothing");
  assert.ok(prints["differ-sound"].length > prints["differ-nosound"].length,
    "the sound branch adds no cells, so the sound arm proves nothing");
  console.log(`  PATHS: equal 0, differ ${prints["differ-nosound"].length}, differ+sound ${prints["differ-sound"].length} cells`);
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count`, { skip }, () => {
    let caught = 0;
    for (const [, m] of scenarios()) if (compare(brokenTwin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${scenarios().length} scenarios`);
  });
}
