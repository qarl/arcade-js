// SPDX-License-Identifier: GPL-3.0-only
/**
 * advancePlayerAnimationStrip vs the frozen oracle at ROM 0x2010. The coin-start tape reaches this address
 * directly, so real captured dispatches drive the REAL arm, and crafted entries force each decision
 * branch. The frogger standard applies: this is a pure painter — its sole caller
 * (dispatchPlayerFrameByState) tail-returns and reads none of the registers it leaves, and that
 * caller's own gate (equivalence-1edf) already compares memory alone — so RAM is the whole contract.
 * The oracle's dissolved calls (0x5679/0x56d2/0x0018) push return words the rewrite never models,
 * and the terminal `ret` pops one, so the stack window [low, seat) is masked off the oracle's own
 * pushes; nothing else is pinned, because there are no genuine register live-outs.
 * The two first-frame divert arms enter loc_1f2e, the copyright-glyph TAMPER trap, now dissolved to
 * a throw: the real dispatches never divert (proven in REAL — the sample cells hold their genuine
 * value), so on a genuine ROM the candidate never traps; the forced-divert scenarios are moved out
 * of the equivalence set into a TRAPS test that asserts the candidate throws when the divert is
 * artificially fired. Run: node --test games/timeplt/idiomatic/test/equivalence-2010.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { advancePlayerAnimationStrip as candidate } from "../advancePlayerAnimationStrip.js";
import { loc_2010 as oracle } from "../../translated/loc_2010.js";
import { loc_1f2e } from "../loc_1f2e.js";
import { requestLateEraProgressSound } from "../requestLateEraProgressSound.js";
import { requestDestructionSoundBurst } from "../requestDestructionSoundBurst.js";
import { offsetAddress } from "../offsetAddress.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";

const TARGET = 0x2010;
const CAP = 60;

const PHASE = 0x00;
const FIRST_FRAME = 0xb4;
const LEVEL_CELL = 0xad04;
const STATE_HI = 0xabfe;
const STATE_LO = 0xabff;
const RUNNING = 0xa5;

// Every data write lands at or below here; the seat sits far above it (measured floor above 0xae00),
// so masking the scratch window can never hide a real byte. Enforced inside unitDiff.
const DATA_TOP = 0xadff;
const SCRIBBLE_CELL = 0xa5af; // a compared (non-stack) cell the teeth flip to prove the RAM measurement bites

/** The frogger standard: RAM (masked over the frozen side's stack scratch) is the contract, and only
 *  genuine named register live-outs are pinned beside it. This painter has none — the sole caller
 *  (dispatchPlayerFrameByState, ROM 0x1edf) tail-returns and reads no register it leaves, and its own
 *  gate (equivalence-1edf) already compares memory alone — so the set is empty. */
const GENUINE_LIVE_OUTS = [];

const FRAME_ARMS = [
  [0xb3, 0x1f76], [0xab, 0x1f94], [0xa3, 0x1fb2], [0x9b, 0x1fd0],
  [0x93, 0x1fd0], [0x8b, 0x1fb2], [0x83, 0x1fee],
];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d ? `${d.addr == null ? "registers" : hex4(d.addr)}: oracle=${d.a} candidate=${d.b}` : "identical";

// ── real dispatches ─────────────────────────────────────────────────────────────────────────────

let capturedCache = null;
function captured() {
  if (capturedCache) return capturedCache;
  const entries = [];
  let collecting = true;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (collecting && entries.length < CAP) entries.push(mm.clone());
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the run ran short");
  capturedCache = entries;
  return entries;
}

// ── the masked comparison (frogger standard) ─────────────────────────────────────────────────────

// Oracle vs candidate on independent clones. The frozen side pushes below its seat and pops a return
// the rewrite never models, so [low, seat) is masked with low watched off the oracle's own pushes;
// then RAM outside that window must match byte-for-byte, and only genuine register live-outs are
// pinned (none here). Returns a diff descriptor, or null when equivalent.
function unitDiff(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  try { cand(b); } catch (e) { return { addr: null, a: "returned", b: String(e).slice(0, 40) }; }
  if (low <= DATA_TOP) throw new Error(`the stack window ${hex4(low)} reached into game data`);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue; // stack scratch the rewrite never models
    return { addr, a: da[i], b: db[i] };
  }
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  return null;
}

// Bytes the oracle moves from a state — the scenario's footprint.
function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

// ── crafted scenarios: one per decision branch ────────────────────────────────────────────────

function craft(head, hi, lo, level) {
  const c = captured()[0].clone();
  c.mem8[(c.regs.ix + PHASE) & 0xffff] = head;
  c.mem8[STATE_HI] = hi;
  c.mem8[STATE_LO] = lo;
  c.mem8[LEVEL_CELL] = level;
  return c;
}

// [label, machine]. Head < the cap takes the near branch; >= it takes the first-frame branch, whose
// two state cells then draw or draw again. The DRAW/CUE scenarios never divert, so they stay in the
// equivalence set below. The two DIVERT arms (forced by a non-genuine tamper-sample cell) enter
// loc_1f2e — the copyright-glyph trap, now dissolved to a throw — so they are held separately in
// divertScen() and asserted to TRAP, not to equal the oracle. On a genuine ROM neither arm is ever
// reached (the REAL test proves the sample cells hold their genuine value), so this split does not
// weaken the real-play contract.
let scenCache = null;
function scen() {
  if (scenCache) return scenCache;
  scenCache = [
    ["A-draw", craft(0xa4, RUNNING, 0x10, 0x00)],
    ["A-nodraw", craft(0xb2, RUNNING, 0x10, 0x00)],
    ["B-drawA", craft(0xf0, RUNNING, 0x05, 0x03)],
    ["B-drawB", craft(0xf0, RUNNING, 0x10, 0x03)],
    ["B-cue", craft(0xf0, RUNNING, 0x05, 0x05)],
  ];
  return scenCache;
}

// The two forced-divert scenarios: a non-genuine glyph (STATE_HI != RUNNING) or colour
// (STATE_LO outside {0x05,0x10}) fires the tamper divert into the dissolved loc_1f2e trap.
let divertCache = null;
function divertScen() {
  if (divertCache) return divertCache;
  divertCache = [
    ["B-tailHi", craft(0xf0, 0x00, 0x10, 0x03)],
    ["B-tailLo", craft(0xf0, RUNNING, 0x07, 0x03)],
  ];
  return divertCache;
}

// ── broken twins: the body re-derived, each with one defect ──────────────────────────────────────

function makeBody(o = {}) {
  return function body(m) {
    if (o.noOp) return;
    const { regs, mem, mem8 } = m;
    regs.a = mem8[regs.ix & 0xffff];
    regs.cp(FIRST_FRAME);
    if (!regs.fC) {
      if (!o.skipClamp) mem8[regs.ix & 0xffff] = FIRST_FRAME;
      mem8[(regs.iy + 1) & 0xffff] = 0xff;
      regs.a = mem8[LEVEL_CELL];
      regs.cp(0x02);
      if (!regs.fC) requestLateEraProgressSound(m);
      requestDestructionSoundBurst(m);
      regs.a = mem8[STATE_HI];
      regs.cp(RUNNING);
      if (regs.fNZ) return o.divertReturn ? undefined : loc_1f2e(m);
      regs.de = STATE_LO;
      regs.a = mem8[regs.de];
      regs.cp(0x05);
      if (regs.fNZ) {
        regs.cp(0x10);
        if (regs.fNZ) return o.divertReturn ? undefined : loc_1f2e(m);
      }
    }
    regs.decMem8(mem, regs.ix & 0xffff);
    regs.a = mem8[regs.ix & 0xffff];
    let base = null;
    for (const [f, t] of FRAME_ARMS) { regs.cp(f); if (regs.fZ) { base = t; break; } }
    if (base === null) return;
    regs.de = base;
    regs.hl = 0xa5af;
    regs.b = 0xc1;
    regs.a = mem8[LEVEL_CELL];
    regs.add(regs.b);
    regs.c = o.wrongColour ? (regs.a + 1) & 0xff : regs.a;
    regs.exx();
    regs.a = mem8[0x337a];
    regs.b = regs.a;
    do {
      regs.exx();
      regs.a = mem8[0x4902];
      regs.b = regs.a;
      do {
        regs.a = mem8[regs.de];
        mem8[regs.hl] = regs.a;
        regs.h = regs.res(2, regs.h);
        mem8[regs.hl] = regs.c;
        regs.h = regs.set(2, regs.h);
        regs.hl = (regs.hl + 1) & 0xffff;
        regs.de = (regs.de + 1) & 0xffff;
      } while (regs.djnz() !== 0);
      regs.a = 0x1b;
      offsetAddress(m);
      regs.exx();
    } while (regs.djnz() !== 0);
  };
}

// [label, twin, the non-divert scenario labels it must be caught on]. The divert scenarios live in
// divertScen() and are covered by the TRAPS test, so they are not twin targets here.
const TWINS = [
  ["no-op", makeBody({ noOp: true }), ["A-draw", "A-nodraw", "B-drawA", "B-drawB", "B-cue"]],
  ["skip-clamp", makeBody({ skipClamp: true }), ["B-drawA", "B-drawB", "B-cue"]],
  ["wrong-colour", makeBody({ wrongColour: true }), ["A-draw", "B-drawA", "B-drawB", "B-cue"]],
];

// ── scratch-not-pinned controls: a register-only twin passes by design; RAM still bites ──────────
const scribbleData = (mm) => { candidate(mm); mm.mem8[SCRIBBLE_CELL] ^= 0xff; };
const scribbleScratchReg = (mm) => { candidate(mm); mm.regs.b = (mm.regs.b + 1) & 0xff; };

// ── the gate ────────────────────────────────────────────────────────────────────────────────────

test("REAL: every captured dispatch replays identically, and some write", { skip }, () => {
  const entries = captured();
  assert.ok(entries.length > 0, "vacuous: the coin-start tape no longer reaches this address");
  for (const e of entries) {
    const d = unitDiff(candidate, e);
    assert.equal(d, null, () => `escaped: ${show(d)}`);
  }
  const wrote = entries.filter((e) => footprint(e) > 0).length;
  assert.ok(wrote > 0, "no captured dispatch makes the oracle write, so this arm would pass a no-op");
  console.log(`  REAL: ${entries.length} dispatches identical, ${wrote} of them write`);
});

test("BRANCHES: every crafted decision branch replays, and the branches really differ", { skip }, () => {
  for (const [label, c] of scen()) {
    const d = unitDiff(candidate, c);
    assert.equal(d, null, `${label}: ${show(d)}`);
  }
  // ★ Vacuity guard: a draw moves the strip, a no-draw moves only the stepped phase — so a rewrite
  // that confused them could not pass all five.
  const foot = Object.fromEntries(scen().map(([n, c]) => [n, footprint(c)]));
  assert.equal(foot["A-nodraw"], 1, "the no-draw branch moved more than the stepped phase");
  assert.ok(foot["B-drawA"] > foot["A-nodraw"] && foot["B-drawB"] > foot["A-nodraw"],
    "a draw branch moved no more than the no-draw one");
  console.log(`  BRANCHES: ${scen().length} identical; footprints ${Object.entries(foot).map(([n, v]) => `${n}=${v}`).join(" ")}`);
});

test("TRAPS: forcing the tamper divert traps on entry; a non-trapping twin is caught", { skip }, () => {
  // These states are never reached on a genuine ROM (REAL proves the sample cells hold their genuine
  // value); forced here, the divert into the dissolved loc_1f2e must trap.
  for (const [label, c] of divertScen()) {
    assert.throws(() => candidate(c.clone()), NotImplemented, `${label}: the tamper divert did not trap`);
  }
  // Teeth: a twin that RETURNS on the divert instead of trapping escapes the throw-on-entry assertion.
  const neverTraps = makeBody({ divertReturn: true });
  for (const [label, c] of divertScen()) {
    assert.throws(
      () => assert.throws(() => neverTraps(c.clone()), NotImplemented),
      `${label}: the non-trapping twin escaped the trap assertion`,
    );
  }
  console.log(`  TRAPS: ${divertScen().length} forced diverts trap on entry; non-trapping twin caught`);
});

test("SCRATCH NOT PINNED: a register-only twin passes; a RAM scribble is caught", { skip }, () => {
  // No genuine register live-outs, so a twin that only scribbles a scratch register after the routine
  // is DELIBERATELY not flagged — and the same measurement must still catch a scribbled RAM cell, or
  // the clean read on the register twin would be worthless.
  const states = [captured()[0], ...scen().map(([, c]) => c)];
  for (const s of states) {
    assert.equal(unitDiff(scribbleScratchReg, s), null,
      "a scratch-register scribble was flagged, but this painter has no genuine register live-outs to pin");
    const d = unitDiff(scribbleData, s);
    assert.notEqual(d, null, "the RAM measurement missed a scribbled cell, so it has no teeth");
    assert.notEqual(d.addr, null, "the RAM scribble must be caught on a cell, not a register");
  }
  console.log(`  SCRATCH NOT PINNED: register twin ignored; RAM twin caught on all ${states.length}`);
});

test("TWIN BASE: the re-derived body with no defect is itself clean", { skip }, () => {
  for (const [label, c] of scen()) {
    assert.equal(unitDiff(makeBody({}), c), null, `${label}: the defect-free twin base diverged`);
  }
  console.log(`  TWIN BASE: clean on all ${scen().length} scenarios`);
});

for (const [label, twin, targets] of TWINS) {
  test(`TEETH: the ${label} twin is caught on exactly its branches`, { skip }, () => {
    const on = scen().filter(([, c]) => unitDiff(twin, c) !== null).map(([n]) => n);
    assert.ok(on.length > 0, `the ${label} twin is not caught at all`);
    assert.deepEqual(on.sort(), [...targets].sort(), `the ${label} twin's caught scenarios moved`);
    // every catch must land on a memory cell, so a register ceiling is not doing the biting
    for (const [, c] of scen().filter(([n]) => targets.includes(n))) {
      assert.notEqual(unitDiff(twin, c).addr, null, `the ${label} twin was caught on a register, not a cell`);
    }
    console.log(`  TEETH/${label}: caught on ${on.length}/${scen().length} — ${on.join(", ")}`);
  });
}
