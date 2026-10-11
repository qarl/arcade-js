// SPDX-License-Identifier: GPL-3.0-only
/**
 * runAllCollisionSweepsThisFrame — memory-equivalent to the frozen oracle at ROM 0x4E63.
 * GATE: unit-capture on the coin-start dispatch plus crafted armed / loaded-collision entries; RAM
 *   compared with the dead stack scratch below the seated SP masked out (the oracle nests calls, the
 *   rewrite does not), the SP re-seat and the return value checked, and teeth. Registers are NOT
 *   compared: the dissolved callees leave a different register residue and this routine's callers
 *   tail-jump into it, so none reads one back. HOLE: attract never reaches this address, so the
 *   armed branch and the collision hits are POKED, not observed in a natural run — which is how a
 *   missing DE/IY write-back in destroySlotsAndPlayerOnContact shipped: the unarmed branch threads
 *   that cursor straight into destroyEraObjectsAndPlayerOnContact, and no scenario exercised a kill
 *   that depended on it. The unarmed-target-loaded scenario and the skip-writeback twin close it. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-4e63.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { runAllCollisionSweepsThisFrame as candidate } from "../runAllCollisionSweepsThisFrame.js";
import { loc_4e63 as oracle } from "../../translated/loc_4e63.js";
import { stagePlayerShotSweepAgainstTargetsAndRun } from "../stagePlayerShotSweepAgainstTargetsAndRun.js";
import { destroyPlayerAndObjectsTouchingIt } from "../destroyPlayerAndObjectsTouchingIt.js";
import { destroySlotsAndPlayerOnContact } from "../destroySlotsAndPlayerOnContact.js";
import { destroyPlayerAndMotherShipOnContactByEra } from "../destroyPlayerAndMotherShipOnContactByEra.js";
import { destroyEraObjectsAndPlayerOnContact } from "../destroyEraObjectsAndPlayerOnContact.js";
import { markObjectsTouchingPlayer } from "../markObjectsTouchingPlayer.js";
import { MOTHER_SHIP_ARMED, PLAYER_STATE } from "../names.js";

const TARGET = 0x4e63;
const REF_FIRST = 0xaa10;
const REF_SECOND = 0xaa41;
const SECOND_AXIS_OFFSET = 49;
const LIVE = 0xff;

// Every write this routine's chain makes lands at or below here; the stack seats far above it.
const DATA_TOP = 0xadff;
const COINSTART_DISPATCHES = 152;

// The armed branch reseats the target sweep to 0xA8C0 and advances three records/entries, so its
// final mark sweep lands here — a slot no destroy-sweep on that path touches, so a loaded object is
// MARKED and the player survives to be measured against.
const ARMED_MARK_SLOT = 0xa8f0;
const ARMED_MARK_ENTRY = 0xaa2e;
// A slot the unarmed contact sweep reaches (b=7) but the ARMED sweep (b=5) stops two short of, so a
// live object here is taken by the unarmed branch alone — that is what gives the invert-branch twin
// its tooth — and it is a record the break-cursor-thread twin's corrupted cursor also misses.
const UNARMED_HIT_SLOT = 0xa8b0;
const UNARMED_HIT_ENTRY = 0xaa26;
// The FIRST slot destroyEraObjectsAndPlayerOnContact sweeps, reachable ONLY if the preceding
// destroySlotsAndPlayerOnContact handed its DE/IY cursor thread back. No destroy-sweep before it
// touches this slot, so a live object here is hit by destroyTargets alone — this is the real-game
// last-life collision at ROM frame 2086 — and any chain that drops the cursor thread misses it.
// Closes the hole that let the missing cursor write-back ship: the unarmed thread was never exercised.
const UNARMED_TARGET_SLOT = 0xa8c0;
const UNARMED_TARGET_ENTRY = 0xaa28;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs candidate on independent clones. The oracle's nested calls leave dead return addresses
 * in [low, seat), which the rewrite never writes; low is measured off the oracle's own pushes.
 * Anything outside that window has escaped.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => {
    push(v);
    if (a.regs.sp < low) low = a.regs.sp;
  };
  const retOracle = oracle(a);
  const retCand = cand(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** Cells the oracle moves from a state, ignoring the stack scratch — a path's footprint. */
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

// ── captured dispatches, and the crafted entries ──────────────────────────────────────────

let captured = null;
function capture() {
  if (captured) return captured;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the coin-start run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the coin-start run ran short");
  captured = entries;
  return captured;
}

const withPlayer = (want) => capture().find((e) => (e.mem8[PLAYER_STATE] === LIVE) === want);

/** Set one slot live and align its coordinates onto the player, so a sweep reaching it hits. */
function loadObject(m, slot, entry) {
  m.mem8[slot] = LIVE;
  m.mem8[entry] = m.mem8[REF_FIRST];
  m.mem8[(entry + SECOND_AXIS_OFFSET) & 0xffff] = m.mem8[REF_SECOND];
  return m;
}

function scenarios() {
  const armedLoaded = withPlayer(true).clone();
  armedLoaded.mem8[MOTHER_SHIP_ARMED] = 1;
  loadObject(armedLoaded, ARMED_MARK_SLOT, ARMED_MARK_ENTRY);
  const unarmedLoaded = withPlayer(true).clone();
  unarmedLoaded.mem8[MOTHER_SHIP_ARMED] = 0;
  loadObject(unarmedLoaded, UNARMED_HIT_SLOT, UNARMED_HIT_ENTRY);
  const unarmedTargetLoaded = withPlayer(true).clone();
  unarmedTargetLoaded.mem8[MOTHER_SHIP_ARMED] = 0;
  loadObject(unarmedTargetLoaded, UNARMED_TARGET_SLOT, UNARMED_TARGET_ENTRY);
  return [
    ["captured-live", withPlayer(true).clone()],
    ["captured-dead", withPlayer(false).clone()],
    ["armed-loaded", armedLoaded],
    ["unarmed-loaded", unarmedLoaded],
    ["unarmed-target-loaded", unarmedTargetLoaded],
  ];
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every option matches runAllCollisionSweepsThisFrame by default. */
function twin({ skipShots = false, invertBranch = false, skipMark = false, breakThread = false, skipWriteback = false }) {
  // Model "destroySlots drops its cursor thread" by restoring DE/IY to their pre-call values — the
  // exact defect that shipped, independent of whether the real routine writes them back.
  const destroySlots = (m) => {
    const de = m.regs.de, iy = m.regs.iy;
    destroySlotsAndPlayerOnContact(m);
    if (skipWriteback) { m.regs.de = de; m.regs.iy = iy; }
  };
  return (m) => {
    const { regs, mem8 } = m;
    if (!skipShots) stagePlayerShotSweepAgainstTargetsAndRun(m);
    regs.b = 4;
    regs.de = 0xa810;
    regs.iy = 0xaa12;
    regs.l = 5;
    regs.h = 11;
    destroyPlayerAndObjectsTouchingIt(m);
    const armed = mem8[MOTHER_SHIP_ARMED] !== 0;
    if (invertBranch ? !armed : armed) {
      regs.b = 5;
      regs.l = 7;
      regs.h = 15;
      if (breakThread) { regs.de = 0xa810; regs.iy = 0xaa12; }
      destroySlots(m);
      destroyPlayerAndMotherShipOnContactByEra(m);
      regs.b = 3;
      regs.de = 0xa8c0;
      regs.iy = 0xaa28;
      regs.l = 6;
      regs.h = 13;
      destroyEraObjectsAndPlayerOnContact(m);
      regs.b = 1;
      regs.l = 8;
      regs.h = 17;
      return skipMark ? undefined : markObjectsTouchingPlayer(m);
    }
    regs.b = 7;
    regs.l = 7;
    regs.h = 15;
    if (breakThread) { regs.de = 0xa810; regs.iy = 0xaa12; }
    destroySlots(m);
    regs.b = 3;
    regs.l = 6;
    regs.h = 13;
    destroyEraObjectsAndPlayerOnContact(m);
    regs.b = 1;
    regs.l = 8;
    regs.h = 17;
    return skipMark ? undefined : markObjectsTouchingPlayer(m);
  };
}

const TWINS = [
  ["no-op", () => {}, 5],
  ["skip-shots", twin({ skipShots: true }), 5],
  ["invert-branch", twin({ invertBranch: true }), 1],
  ["skip-mark", twin({ skipMark: true }), 1],
  ["break-cursor-thread", twin({ breakThread: true }), 2],
  // The bug that shipped: destroySlots dropped its DE/IY thread, so destroyTargets swept the wrong
  // slots. Caught only by unarmed-target-loaded, where destroySlots itself does not hit and the
  // kill depends on destroyTargets landing on the threaded slot.
  ["skip-writeback", twin({ skipWriteback: true }), 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: RAM identical outside the masked stack scratch", { skip }, () => {
  const entries = capture();
  assert.ok(entries.length > 0, "vacuous: the tape never reached the routine");
  for (const e of entries) {
    const r = compare(candidate, e);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
    // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached into game data`);
  }
  console.log(`  EQUAL: ${entries.length} coin-start dispatches identical`);
});

test("PATHS: every scenario is equivalent, and the two branches really differ", { skip }, () => {
  const prints = {};
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    prints[label] = footprint(m).join(",");
  }
  // ★ Vacuity guard: the armed and unarmed collisions must leave DIFFERENT cells, or the branch
  // choice is untested and this gate would pass a rewrite that ignored it.
  assert.notEqual(prints["armed-loaded"], prints["unarmed-loaded"],
    "the armed and unarmed loaded paths move the same cells");
  console.log(`  PATHS: 4 scenarios equivalent; armed-loaded ${prints["armed-loaded"]}`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops the tail return and the rewrite does not`);
    assert.equal(r.retOracle, r.retCand, `${label}: the return value diverged`);
  }
  console.log("  SP: +2 on every scenario; return values identical");
});

test("CORPUS: every coin-start dispatch and its armed twin replay; attract never reaches it", { skip }, () => {
  const entries = capture();
  let caught = 0;
  for (const e of entries) {
    if (compare(candidate, e).escaped) caught++;
    const armed = e.clone();
    armed.mem8[MOTHER_SHIP_ARMED] = 1;
    if (compare(candidate, armed).escaped) caught++;
  }
  assert.equal(entries.length, COINSTART_DISPATCHES, "the coin-start dispatch count moved");
  assert.equal(caught, 0, `the rewrite diverged on ${caught} dispatches`);
  let attract = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => { attract++; return oracle(mm); }]]), { tape: [] });
  m.runFrames(ENTRY_FRAMES);
  // ★ Attract reaching zero is a fact, not a dead tap: the SAME probe counted 152 under coin-start.
  assert.equal(attract, 0, "attract now reaches this address; capture plain entries for it");
  console.log(`  CORPUS: ${entries.length} dispatches + armed twins identical, attract ${attract}`);
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
