// SPDX-License-Identifier: GPL-3.0-only
/**
 * awardScoreToPlayer — memory-equivalent to the frozen oracle at ROM 0x0C90.
 *
 * WHAT IT IS. Command-ring handler 4, the score-award: add the argument's award to the current
 * player's packed-decimal score, promote that score into the high score when it now beats it, and
 * repaint the scores it changed. Argument 0 takes a separate arm that only repaints the labels and,
 * one player only, blanks the second score. Every callee it reaches is already decompiled — the
 * empty exit, the two score painters, the high-score painter, the caption drawer and eraser and the
 * cursor step — so the rewrite calls all of them DIRECTLY and no `m.call` survives.
 *
 * ★ THE ORACLE PUSHES AND RETURNS AND THE REWRITE DOES LESS. Every transfer the oracle makes is an
 *   `m.call` over a `push16`; the dissolved calls push nothing, and the routine exits through a
 *   frozen `ret` the rewrite never takes. That leaves DEAD STACK SCRATCH below the entry seat and
 *   moves the accumulator, its flags, the byte pair BC and the stack pointer. The window is MEASURED
 *   off the oracle's own pushes over every arm and PINNED; every arm walks the whole dump and masks
 *   ONLY that window. Live-out is memory: the dispatcher reads only whether the handler returned
 *   normally, which it always does.
 *
 * GATE: strict unit-capture with one measured exclusion and every callee RUNNING, over the two real
 *   dispatches plus crafted entries for the arms the tape never reaches, plus teeth. Holes stated:
 *   1. EQUAL — both real dispatches identical across the dump outside the window and every register
 *      outside the declared ceiling.
 *   2. WINDOW — the oracle's deepest push over all arms, PINNED, so a change in its stack traffic
 *      turns this red rather than being absorbed by a wider mask.
 *   3. CRAFTED — the veto, the second player, the high-score promote and the two-player repaint,
 *      each forced by ONE poked cell identically on both sides, each shown to take its branch.
 *   4. BOUNDARY — the exclusion is exactly as wide as it declares: one byte below is caught, the
 *      seat is caught, one inside is masked.
 *   5. EXCLUDED — no register outside the ceiling moves, with a twin that scribbles one as control.
 *   6. DISSOLVED — the module's text: it imports and calls every decompiled callee directly, with
 *      no `m.call` surviving.
 *   7. TEETH — a twin for each way this could be wrong, each caught at a real cell.
 *
 * HOLE: the crafted arms force one cell for one dispatch, so they buy a real branch, not a realistic
 * session. HOLE: the stack pointer sits inside the excluded ceiling here, and no gate now owns it: the
 * whole-game gate idiomatic.test.js compares memory only, outside the stack window, under an engine
 * that leaves SP unused.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0c90.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { awardScoreToPlayer } from "../awardScoreToPlayer.js";
import { loc_0c90 as oracle } from "../../translated/loc_0c90.js";
import { paintPlayerOneScoreReadout } from "../paintPlayerOneScoreReadout.js";
import { paintPlayerTwoScoreReadout } from "../paintPlayerTwoScoreReadout.js";
import { paintHighScoreReadout } from "../paintHighScoreReadout.js";
import { u8, u16 } from "../../../../core/int.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const TARGET = 0x0c90;
const SCORING_ENABLED = 0xad30;
const PLAYER_COUNT = 0xad31;
const CURRENT_PLAYER = 0xad32;
const PLAYER1_SCORE = 0xad33;
const PLAYER2_SCORE = 0xad36;
const HIGH_SCORE_TOP = 0xa98d;
const AWARD_TABLE = 0x0d27;
const SCORE_BYTES = 3;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 10;

/** The ceiling on register divergence, and the whole of it, measured: the accumulator and its
 * flags, the register pairs the dissolved callees leave elsewhere than their frozen twins, and the
 * return the dissolved exit does not take. A ceiling, not a demand — a rewrite that moved fewer
 * still passes. */
const MOVED = ["a", "f", "b", "c", "h", "l", "sp"];

/** A register outside the ceiling, for the EXCLUDED control twin to scribble. */
const SPARE_REG = "d";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => {
  if (!d) return "identical";
  return d.addr == null ? `${d.reg}: oracle=${d.a} rewrite=${d.b}` : `${hex4(d.addr)}: oracle=${d.a} rewrite=${d.b}`;
};

// ── captures ────────────────────────────────────────────────────────────────────────────

let real = null;
function captureReal() {
  if (real) return real;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the run ran short");
  real = entries;
  return real;
}

/** The captured entry with a zero argument (the repaint arm), and one with a real award. */
const zeroArg = () => captureReal().find((e) => e.regs.a === 0);
const scoreArg = () => captureReal().find((e) => e.regs.a !== 0);

function craft(base, mut) {
  const c = base.clone();
  mut(c);
  return c;
}

/** The four arms the coin-and-play tape never reaches, each one cell away from a real entry. */
function craftedArms() {
  return {
    veto: craft(scoreArg(), (c) => { c.mem8[SCORING_ENABLED] = 0; }),
    player2: craft(scoreArg(), (c) => { c.mem8[CURRENT_PLAYER] = 1; }),
    promote: craft(scoreArg(), (c) => {
      c.mem8[HIGH_SCORE_TOP] = 0;
      c.mem8[HIGH_SCORE_TOP - 1] = 0;
      c.mem8[HIGH_SCORE_TOP - 2] = 0;
    }),
    twoPlayer: craft(zeroArg(), (c) => { c.mem8[PLAYER_COUNT] = 1; }),
  };
}

// ── diff plumbing ─────────────────────────────────────────────────────────────────────────

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The masked window, and nothing else: the bytes the oracle's own pushes reach below the seat. */
function inScratch(addr, sp) {
  return addr != null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/** Oracle vs candidate on clones of `machine`: the whole dump masked to the window, then every
 * register outside the ceiling. A candidate that raises counts as caught; the oracle is not
 * wrapped, so a raise from it is a harness fault and surfaces. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, reg: "raised", a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** How far below its seat the oracle's own pushes take the stack pointer, on one entry state. */
function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

/** How many bytes of the whole dump the oracle moves from this entry. */
function footprint(machine) {
  const before = machine.dumpState().slice();
  const after = machine.clone();
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

// ── teeth ───────────────────────────────────────────────────────────────────────────────
// Each is the module with one thing wrong, transferring the way the module transfers — direct
// calls to the decompiled callees — so a twin's divergence is never hidden behind the oracle's
// deeper stack traffic and must show at a real cell.

function addAward(m, award, scoreBase) {
  const { regs, mem8 } = m;
  let hl = u16(AWARD_TABLE + SCORE_BYTES * award);
  let de = scoreBase;
  regs.a = mem8[de]; regs.add(mem8[hl]); regs.daa(); mem8[de] = regs.a;
  de = u16(de + 1); hl = u16(hl + 1);
  regs.a = mem8[de]; regs.adc(mem8[hl]); regs.daa(); mem8[de] = regs.a;
  de = u16(de + 1); hl = u16(hl + 1);
  regs.a = mem8[de]; regs.adc(mem8[hl]); regs.daa(); mem8[de] = regs.a;
}

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: ignores the veto flag and awards anyway. */
function brokenNoVeto(m) {
  const { regs, mem8 } = m;
  if (regs.a === 0) return;
  addAward(m, regs.a, mem8[CURRENT_PLAYER] === 0 ? PLAYER1_SCORE : PLAYER2_SCORE);
  return paintPlayerOneScoreReadout(m);
}

/** BUG: always credits player one, whoever is playing. */
function brokenWrongPlayer(m) {
  const { regs, mem8 } = m;
  if (mem8[SCORING_ENABLED] === 0) return;
  if (regs.a === 0) return;
  addAward(m, regs.a, PLAYER1_SCORE);
  return paintPlayerOneScoreReadout(m);
}

/** BUG: credits the award selected by the wrong argument. */
function brokenWrongAward(m) {
  const { regs, mem8 } = m;
  if (mem8[SCORING_ENABLED] === 0) return;
  if (regs.a === 0) return;
  addAward(m, u8(regs.a + 1), mem8[CURRENT_PLAYER] === 0 ? PLAYER1_SCORE : PLAYER2_SCORE);
  return paintPlayerOneScoreReadout(m);
}

/** BUG: never promotes a new high score. */
function brokenNoPromote(m) {
  const { regs, mem8 } = m;
  if (mem8[SCORING_ENABLED] === 0) return;
  if (regs.a === 0) return;
  addAward(m, regs.a, mem8[CURRENT_PLAYER] === 0 ? PLAYER1_SCORE : PLAYER2_SCORE);
  if (mem8[CURRENT_PLAYER] !== 0) paintPlayerTwoScoreReadout(m);
  else paintPlayerOneScoreReadout(m);
  return;
}

/** BUG: awards but never repaints the score. */
function brokenNoRepaint(m) {
  const { regs, mem8 } = m;
  if (mem8[SCORING_ENABLED] === 0) return;
  if (regs.a === 0) return;
  addAward(m, regs.a, mem8[CURRENT_PLAYER] === 0 ? PLAYER1_SCORE : PLAYER2_SCORE);
  return;
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["no-veto", brokenNoVeto],
  ["wrong-player", brokenWrongPlayer],
  ["wrong-award", brokenWrongAward],
  ["no-promote", brokenNoPromote],
  ["no-repaint", brokenNoRepaint],
];

/** The BOUNDARY probe: the ORACLE itself, one byte flipped at `sp + offset`. Built on the oracle
 * so what the arm reports is a property of the MASK alone, not of any rewrite. */
function scribbler(offset) {
  return (m) => {
    const at = u16(m.regs.sp + offset);
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatches: identical outside the measured window", { skip }, () => {
  const entries = captureReal();
  assert.ok(entries.length > 0, "vacuous: the tape never reached the routine");
  assert.ok(zeroArg() && scoreArg(), "the tape did not exercise both the repaint arm and an award");
  for (const e of entries) {
    const d = unitDiff(awardScoreToPlayer, e);
    assert.equal(d, null, `a real dispatch diverged: ${show(d)}`);
  }
  console.log(`  EQUAL: ${entries.length} real dispatches, seat ${hex4(entries[0].regs.sp)}, ` +
    `arguments ${entries.map((e) => e.regs.a).join(", ")}`);
});

test("WINDOW: the oracle's deepest push over every arm, measured and pinned", { skip }, () => {
  const arms = { ...craftedArms(), ...Object.fromEntries(captureReal().map((e, i) => [`real${i}`, e])) };
  const depths = Object.fromEntries(Object.entries(arms).map(([k, mc]) => [k, oracleDepth(mc)]));
  const deepest = Math.max(...Object.values(depths));
  console.log(`  WINDOW (measured): deepest ${deepest} bytes — ` +
    Object.entries(depths).map(([k, d]) => `${k} ${d}`).join(", "));
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so every arm is now " +
    "masking the wrong bytes");
});

test("CRAFTED: the arms the tape never reaches, each forced by one cell", { skip }, () => {
  const arms = craftedArms();
  for (const [label, mc] of Object.entries(arms)) {
    const d = unitDiff(awardScoreToPlayer, mc);
    assert.equal(d, null, `the ${label} arm diverged: ${show(d)}`);
  }
  // Non-vacuity: each poke actually drove its branch, checked against the ROM's own writes.
  assert.equal(footprint(arms.veto), 0, "the veto arm still wrote — the flag did not gate it");
  assert.ok(footprint(scoreArg()) > 0, "the award arm wrote nothing, so the veto check is empty");

  const p2 = arms.player2.clone();
  const p2before = p2.clone();
  oracle(p2);
  assert.ok([0, 1, 2].some((i) => p2.mem8[PLAYER2_SCORE + i] !== p2before.mem8[PLAYER2_SCORE + i]),
    "the player-2 arm never touched the second player's score");

  const pr = arms.promote.clone();
  oracle(pr);
  assert.ok([0, 1, 2].some((i) => pr.mem8[HIGH_SCORE_TOP - i] !== 0),
    "the promote arm left the zeroed high score untouched, so no promotion happened");
  console.log("  CRAFTED: veto writes nothing, player-2 moves the second score, promote copies the " +
    "high score, two-player repaints both");
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const e = scoreArg();
  const sp = e.regs.sp;
  const below = unitDiff(scribbler(-SCRATCH_BYTES - 1), e);
  const seat = unitDiff(scribbler(0), e);
  const inside = unitDiff(scribbler(-1), e);
  console.log(`  BOUNDARY: ${hex4(sp - SCRATCH_BYTES - 1)} caught, ${hex4(sp)} caught, ` +
    `${hex4(sp - 1)} masked`);
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed, so the mask " +
    "is wider than it declares and a leaking stack pointer would walk out of sight");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed; live stack above the " +
    "window must still fail");
  assert.equal(inside, null, "a divergence INSIDE the window was caught, so the two above are the " +
    "instrument catching everything rather than the boundary being where it says");
});

/** Which registers a candidate parts company with the oracle on, over all arms. */
function movedOver(candidate) {
  const moved = new Set();
  const arms = [...captureReal(), ...Object.values(craftedArms())];
  for (const mc of arms) {
    const a = mc.clone();
    const b = mc.clone();
    oracle(a);
    try {
      candidate(b);
    } catch {
      continue;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(awardScoreToPlayer);
  const control = movedOver((m) => { awardScoreToPlayer(m); m.regs[SPARE_REG] = u8(m.regs[SPARE_REG] + 1); });
  // The absence is evidence only if the same measurement CAN report a register outside the ceiling.
  assert.ok(control.has(SPARE_REG) && !MOVED.includes(SPARE_REG),
    "the measurement misses a twin that scribbles a spare register, so a clean reading proves nothing");
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
  console.log(`  EXCLUDED (measured): moves ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}; ` +
    `ceiling ${MOVED.join(", ")}; control also moves ${SPARE_REG}`);
});

const DISSOLVED_CALLEES = [
  ["paintPlayerOneScoreReadout", "paintPlayerOneScoreReadout(m)"],
  ["paintPlayerTwoScoreReadout", "paintPlayerTwoScoreReadout(m)"],
  ["paintHighScoreReadout", "paintHighScoreReadout(m)"],
  ["drawTextRunByIndex", "drawTextRunByIndex(m"],
  ["eraseTextRunByIndex", "eraseTextRunByIndex(m"],
  ["advanceCharCursor", "advanceCharCursor(m"],
];

test("DISSOLVED: every decompiled callee is called directly and no m.call survives", () => {
  const module = readFileSync(new URL("../awardScoreToPlayer.js", import.meta.url), "utf8");
  for (const [name, callForm] of DISSOLVED_CALLEES) {
    assert.ok(module.includes(`from "./${name}.js"`), `the module does not import ${name}`);
    assert.ok(module.includes(callForm), `the module does not call ${name} directly`);
  }
  assert.ok(!module.includes("m.call("), "an m.call survived: every callee here is decompiled");
  console.log(`  DISSOLVED: ${DISSOLVED_CALLEES.length} callees called directly, no m.call left`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const arms = [...captureReal(), ...Object.values(craftedArms())];
    let caughtInRam = 0;
    let caughtAny = 0;
    for (const mc of arms) {
      const d = unitDiff(twin, mc);
      if (d) { caughtAny++; if (d.addr != null) caughtInRam++; }
    }
    console.log(`  TEETH/${label}: caught on ${caughtAny}/${arms.length} arms, ${caughtInRam} in memory`);
    assert.ok(caughtAny > 0, `every arm PASSED the ${label} twin — it has no teeth`);
    assert.ok(caughtInRam > 0, `the ${label} twin is caught only on a register, so nothing says a ` +
      "cell it should have written is wrong");
  });
}
