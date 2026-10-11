// SPDX-License-Identifier: GPL-3.0-only
/**
 * startTwoPlayerGame — memory-equivalent to the frozen oracle at ROM 0x189E (the two-player game start).
 * GATE: real capture on a two-player tape, plus crafted entries. RAM compared with the dead stack
 *   scratch below the seated SP masked out (the oracle brackets its dissolved calls with pushes the
 *   rewrite does not), the SP re-seat and the return value checked, and teeth. Registers are not
 *   compared: the dissolved callees do not reproduce the register dance and both callers reach here
 *   by a tail jump, so no caller consumes one.
 * ACTIVE ARM: a disagreeing witness pair sends the oracle's 0x460E call into its acting arm, which
 *   steps the pointers LEFT OVER in IX and IY, nothing this routine or its caller computes. Every
 *   measured two-player dispatch arrived with 0xAB43 == 0xA67C == 0x7C and IX = 0x3010, in ROM;
 *   whether any genuine run makes the pair disagree is open (mechanisms.md). The rewrite carries no register, so it
 *   hands 0x460E no pointers and the arm refuses (NotImplemented); that arm's own gate,
 *   equivalence-460e, still compares it against the oracle with pointers supplied. The crafted
 *   active entry is therefore asserted as the oracle acting and the rewrite refusing, not as equal.
 *   Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-189e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { startTwoPlayerGame as candidate } from "../startTwoPlayerGame.js";
import { loc_189e as oracle } from "../../translated/loc_189e.js";
import { hideCaptionSprites } from "../hideCaptionSprites.js";
import { checkTamperGlyphCopyElseRunWreckFlash } from "../checkTamperGlyphCopyElseRunWreckFlash.js";
import { paintCreditCountPanel } from "../paintCreditCountPanel.js";
import { seatSequencePhase3AndResetSubStep } from "../seatSequencePhase3AndResetSubStep.js";
import { PLAYER_ONE_LIVES, PLAYER_TWO_LIVES, PLAY_ACTIVE } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";

const TARGET = 0x189e;
const IN0 = 0xc300;
const HOLD = 8;
const SECOND_PLAYER_FLAG = 0xad31;
const STARTING_LIVES = 0xa9c1;
const CREDIT = 0xa986;
const WATCHED = 0xa67c;
const MIRROR = 0xab43;
const WRITABLE_COUNTER = 0xa900;
const ALL_BITS = 255;

// Every write this routine and its callees make lands at or below here; the stack seats far above,
// so masking the scratch window can never hide a game-data divergence (asserted against low below).
const DATA_TOP = 0xadff;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// Two coins then the two-player start button (0x10). The default coin-start tape presses 0x08 —
// the one-player button — and never reaches this address, which the UNREACHED arm proves.
const TWO_PLAYER_TAPE = [
  { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
  { frame: COIN_FRAME + 60, port: IN0, bits: 0x01, dur: HOLD },
  { frame: START_FRAME, port: IN0, bits: 0x10, dur: HOLD },
];

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs candidate on independent clones. The oracle pushes a return address before each
 * dissolved call and a tail jump pops the caller's slot, so the diff excludes [low, seat) — low
 * measured by watching the oracle's own pushes. Anything outside that window has escaped.
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

/** Cells the oracle moves from a state, ignoring the stack scratch — a scenario's footprint. */
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

// ── the captured entry, and the crafted scenarios ────────────────────────────────────────

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]), { tape: TWO_PLAYER_TAPE });
    m.runFrames(ENTRY_FRAMES);
  }
  return entry;
}

function craft(mutate) {
  const m = entryState().clone();
  mutate(m);
  return m;
}

// The two-player-start arm no-ops at the natural entry (the watched pair agrees, and its counter
// pointer is leftover ROM); the active craft makes the pair disagree and points it at real RAM.
function makeActive(m) {
  m.mem8[MIRROR] = (m.mem8[WATCHED] + 1) & 0xff;
  m.regs.ix = WRITABLE_COUNTER;
}

const ROM_TOP = 0x5fff;

/** The scenarios the rewrite must match the oracle on: every one but the tampered active arm. */
const equalScenarios = () => scenarios().filter(([label]) => label !== "active-arm");
const activeArm = () => scenarios().find(([label]) => label === "active-arm")[1];

function scenarios() {
  return [
    ["captured", craft(() => {})],
    ["active-arm", craft(makeActive)],
    ["credit-round", craft((m) => { m.mem8[CREDIT] = 0x10; })],
    ["credit-underflow", craft((m) => { m.mem8[CREDIT] = 0x01; })],
    ["credit-nonbcd", craft((m) => { m.mem8[CREDIT] = 0x0d; })],
  ];
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** A correct reference deduction, so a twin diverges only in its ONE named knob and not in the
 * decimal correction the "raw2" twin is meant to be alone in dropping. */
function deductTwoBcd(value) {
  const d = u8(value - 2);
  let c = 0;
  if ((value & 0x0f) < 2 || (d & 0x0f) > 9) c += 6;
  if (value < 2 || d > 0x99) c += 0x60;
  return u8(d - c);
}

/** The rewrite with one deliberate defect each; every knob matches startTwoPlayerGame by default except the start arm: a twin calls checkTamperGlyphCopyElseRunWreckFlash with the entry's IX and IY (as the oracle's register dispatch does), where startTwoPlayerGame hands it null. So on the active-arm scenario a default twin acts as the oracle does, and the rewrite's refusal there is held by the ACTIVE ARM test, not by these twins. */
function twin({ credit = "two", p2flag = ALL_BITS, p2lives = true, arm = true }) {
  return (m) => {
    const { mem8 } = m;
    hideCaptionSprites(m);
    mem8[PLAY_ACTIVE] = ALL_BITS;
    mem8[SECOND_PLAYER_FLAG] = p2flag;
    mem8[PLAYER_ONE_LIVES] = mem8[STARTING_LIVES];
    if (p2lives) mem8[PLAYER_TWO_LIVES] = mem8[STARTING_LIVES];
    if (arm) checkTamperGlyphCopyElseRunWreckFlash(m);
    mem8[CREDIT] =
      credit === "one" ? u8(mem8[CREDIT] - 1)
        : credit === "raw2" ? u8(mem8[CREDIT] - 2)
          : deductTwoBcd(mem8[CREDIT]);
    paintCreditCountPanel(m);
    seatSequencePhase3AndResetSubStep(m);
  };
}

const TWINS = [
  ["no-op", () => {}, 5],
  ["deduct-one", twin({ credit: "one" }), 5],
  ["no-decimal-correct", twin({ credit: "raw2" }), 3],
  ["one-player-flag", twin({ p2flag: 0 }), 5],
  ["skip-p2-lives", twin({ p2lives: false }), 5],
  ["skip-start-arm", twin({ arm: false }), 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REAL DISPATCH: the two-player start replays identically, stack scratch masked", { skip }, () => {
  const r = compare(candidate, entryState());
  assert.notEqual(entry, null, "vacuous: the two-player tape never reached the routine");
  assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
  // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
  assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
  console.log(`  REAL: window [${hex4(r.low)},${hex4(r.seat)}) masked, spDiff ${r.spDiff}`);
});

test("UNREACHED: neither the coin-start tape nor attract dispatches this, with a live control",
  { skip }, () => {
    const count = (opts) => {
      let seen = 0;
      const m = makeMachine(new Map([[TARGET, (mm) => { seen++; return oracle(mm); }]]), opts);
      m.runFrames(ENTRY_FRAMES);
      assert.equal(m.stoppedBy, null, `run stopped early: ${m.stoppedBy}`);
      return seen;
    };
    const twoPlayer = count({ tape: TWO_PLAYER_TAPE });
    // The zeros are evidence ONLY because the same tap counted the routine under the two-player
    // tape; a tap that could never fire looks exactly like an address nothing reaches.
    assert.ok(twoPlayer > 0, "the tap counted nothing even under the two-player tape, so it is broken");
    assert.equal(count({}), 0, "the coin-start tape now dispatches this; capture a plain entry");
    assert.equal(count({ tape: [] }), 0, "attract now reaches this; add a corpus for it");
    console.log(`  UNREACHED: coin-start 0, attract 0, two-player ${twoPlayer}`);
  });

test("PATHS: every scenario but the active arm is equivalent, and the start arm really changes the footprint",
  { skip }, () => {
    const prints = {};
    for (const [label, m] of scenarios()) prints[label] = footprint(m).length;
    for (const [label, m] of equalScenarios()) {
      const r = compare(candidate, m);
      assert.equal(r.escaped, null, `${label} escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    }
    // ★ Vacuity guard: the active arm must move MORE cells than the captured no-op entry, or the
    // craft changed nothing and the arm would pass a rewrite that ignored checkTamperGlyphCopyElseRunWreckFlash entirely.
    assert.ok(prints["active-arm"] > prints["captured"], "the start arm moved no extra cells");
    console.log(`  PATHS: ${equalScenarios().length} scenarios equivalent; active arm moves ${prints["active-arm"]} cells`);
  });

test("ACTIVE ARM: the oracle steps leftover pointers; the rewrite, carrying none, refuses", { skip }, () => {
  // The pointers are leftovers: at the real dispatch IX points into ROM, not at anything the start sets.
  assert.ok(entryState().regs.ix <= ROM_TOP, `the real dispatch's IX ${hex4(entryState().regs.ix)} is not a ROM leftover`);
  assert.equal(entryState().mem8[MIRROR], entryState().mem8[WATCHED], "the genuine two-player dispatch arrived with the witness pair disagreeing -- the acting arm is reachable on a good ROM");
  const a = activeArm().clone();
  oracle(a);
  assert.ok(footprint(activeArm()).length > footprint(craft(() => {})).length, "the oracle's acting arm moved nothing extra");
  assert.throws(() => candidate(activeArm().clone()), NotImplemented, "the rewrite ran the acting arm without pointers");
  console.log(`  ACTIVE ARM: real IX ${hex4(entryState().regs.ix)} (ROM); oracle acts, rewrite refuses`);
});

test("BCD: every credit value deducts two under the oracle's decimal correction", { skip }, () => {
  for (let v = 0; v <= 0xff; v++) {
    const m = craft((mm) => { mm.mem8[CREDIT] = v; });
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, `credit ${hex4(v)} escaped at ${r.escaped && hex4(r.escaped.addr)}`);
  }
  // Vacuity: the deducted cell must actually differ across values, or the sweep proves nothing.
  const round = craft((m) => { m.mem8[CREDIT] = 0x10; });
  const under = craft((m) => { m.mem8[CREDIT] = 0x01; });
  const after = (m) => { const c = m.clone(); oracle(c); return c.mem8[CREDIT]; };
  assert.notEqual(after(round), after(under), "the credit cell reads the same for 0x10 and 0x01");
  console.log(`  BCD: 256 credit values identical; 0x10->${hex4(after(round))} 0x01->${hex4(after(under))}`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const [label, m] of equalScenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.spDiff, 2, `${label}: the oracle pops the tail-jump slot and the rewrite does not`);
    assert.equal(r.retOracle, r.retCand, `${label}: the return value diverged`);
  }
  console.log("  SP: +2 on every scenario but the active arm; return values identical");
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
