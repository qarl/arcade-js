// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for losePlayer1Life (ROM 0x12f2) — the P1 life-loss sub-state handler.
 *
 * 0x12f2 is a game-state-3 sub-state handler (dispatch index 0x0E), reached only in a
 * credited game the instant player 1 loses a life. Plain attract is game-state 1, so the
 * routine is NEVER dispatched there and cannot be captured live. It is therefore gated
 * with CRAFTED ENTRIES per doc-06: a real mid-attract machine (a valid, in-distribution
 * work-RAM image) is the base, and the death-handler's few input bytes are poked
 * IDENTICALLY on both sides to force each arm. Every case runs the frozen oracle on one
 * fresh clone and losePlayer1Life on another, then diffs RAM outside the dead stack —
 * a memory-writing routine demands a fresh clone per side.
 *
 *   1. CRAFTED — every arm, poked identically on both sides:
 *      (a) lives remain, 1-player  (LIVES>1, TWO_PLAYER_GAME=0) -> GAME_SUBSTATE 0x08.
 *      (b) lives remain, 2-player  (LIVES>1, TWO_PLAYER_GAME=1) -> GAME_SUBSTATE 0x17.
 *      (c) game over,    1-player  (LIVES=1, TWO_PLAYER_GAME=0, ATTRACT=0) -> loc_13ca
 *          full body, sub_1826 banner @0x76D4, one queued task, SUBSTATE_TIMER=0xC0,
 *          GAME_SUBSTATE=0x10.
 *      (d) game over,    2-player  (LIVES=1, TWO_PLAYER_GAME=1, ATTRACT=0) -> extra
 *          task queued first, banner @0x76D3.
 *      (e) game over, ATTRACT=1 — loc_13ca hits its rst-0x08 early abort, the rest of
 *          0x12f2 still runs (the abort returns into 0x12f2 either way).
 *      Each with a couple of score seedings so loc_13ca's format/rank runs on real data.
 *
 *   2. SANITY — asserts the oracle really took the arm each crafted case targets
 *      (LIVES decremented, the expected GAME_SUBSTATE, the P1_CONTEXT snapshot), so a
 *      green diff is against a MEANINGFUL oracle result, not two identical no-ops.
 *
 *   3. TEETH — three deliberately-broken twins the diff MUST catch:
 *      (a) wrong resume routing (ignores TWO_PLAYER_GAME) — caught on the 2P-resume arm.
 *      (b) skipped life decrement — caught at LIVES (and the saved context / branch).
 *      (c) wrong game-over sub-state (0x11) — caught at GAME_SUBSTATE on a game-over arm.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-12f2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_12f2 as oracle } from "../../translated/loc_12f2.js";
import { losePlayer1Life as candidate } from "../losePlayer1Life.js";
import { Machine } from "../../machine.js";
import {
  PLAY_INTRO,
  LIVES,
  P1_CONTEXT,
  TWO_PLAYER_GAME,
  P1_SCORE,
  ATTRACT,
  GAME_SUBSTATE,
  SUBSTATE_TIMER,
  STACK_SCRATCH,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run oracle and a candidate on two FRESH clones of `entry` and diff RAM ex-stack. */
function diffAgainstOracle(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

// -- crafted base -------------------------------------------------------------

/**
 * A real mid-attract machine, used as the base for every crafted entry: run plain
 * attract for a while, then clone. The clone neutralises the frame machinery
 * (nextNmi/nextBoundary = Infinity), so the routine runs in isolation. SP is set into
 * the dead stack region so the oracle's push/pop return-address traffic lands in
 * STACK_SCRATCH (excluded), matching how the routine is entered mid-frame.
 */
let CACHED_BASE = null;
function attractBase() {
  if (!CACHED_BASE) {
    const host = new Machine(ROM);
    host.runFrames(800);
    CACHED_BASE = host.clone();
  }
  return CACHED_BASE;
}

/**
 * Derive a crafted entry from the real base: clone it, drop SP into the stack scratch,
 * and poke the death-handler's input bytes. `opts` = { lives, twoPlayer, attract, score }.
 */
function craft({ lives, twoPlayer, attract, score }) {
  const w = attractBase().clone();
  w.regs.sp = 0x6bfe; // dead stack region -> oracle push/pop stays in STACK_SCRATCH
  w.mem.write8(LIVES, lives & 0xff);
  w.mem.write8(TWO_PLAYER_GAME, twoPlayer ? 1 : 0);
  if (attract !== undefined) w.mem.write8(ATTRACT, attract & 0xff);
  if (score !== undefined) {
    w.mem.write8(P1_SCORE, score[0]);
    w.mem.write8((P1_SCORE + 1) & 0xffff, score[1]);
    w.mem.write8((P1_SCORE + 2) & 0xffff, score[2]);
  }
  return w;
}

// A couple of score seedings so loc_13ca's BCD format / rank pass runs on real data.
const SCORES = [
  [0x00, 0x00, 0x00],
  [0x50, 0x43, 0x01],
  [0x99, 0x99, 0x99],
];

// -- 1. CRAFTED (every arm) ---------------------------------------------------

test("CRAFTED: every arm matches the oracle on RAM (ex-stack)", () => {
  const cases = [];
  for (const score of SCORES) {
    // (a) lives remain, 1-player.
    cases.push({ label: "resume-1P", e: craft({ lives: 3, twoPlayer: false, score }) });
    // (b) lives remain, 2-player.
    cases.push({ label: "resume-2P", e: craft({ lives: 3, twoPlayer: true, score }) });
    // (c) game over, 1-player, credited (ATTRACT=0 -> loc_13ca full body).
    cases.push({ label: "gameover-1P", e: craft({ lives: 1, twoPlayer: false, attract: 0, score }) });
    // (d) game over, 2-player, credited.
    cases.push({ label: "gameover-2P", e: craft({ lives: 1, twoPlayer: true, attract: 0, score }) });
    // (e) game over during attract (ATTRACT=1 -> loc_13ca early-abort sub-path).
    cases.push({ label: "gameover-attract", e: craft({ lives: 1, twoPlayer: false, attract: 1, score }) });
  }

  for (const { label, e } of cases) {
    const ram = diffAgainstOracle(e, candidate);
    assert.equal(ram, null, ram && `${label}: RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  CRAFTED: ${cases.length} crafted arms — identical RAM (ex-stack) to the oracle`);
});

// -- 2. SANITY (the oracle actually took the targeted arm) --------------------

test("SANITY: the oracle takes the expected arm for each crafted case", () => {
  // resume-1P: life 3 -> 2, GAME_SUBSTATE = 0x08, context saved with the decremented life.
  {
    const e = craft({ lives: 3, twoPlayer: false });
    const a = e.clone();
    oracle(a);
    assert.equal(a.mem.read8(LIVES), 2, "resume-1P: LIVES decremented to 2");
    assert.equal(a.mem.read8(GAME_SUBSTATE), 0x08, "resume-1P: GAME_SUBSTATE = 0x08");
    assert.equal(a.mem.read8(P1_CONTEXT), 2, "resume-1P: P1_CONTEXT[0] = the decremented life");
    assert.equal(a.mem.read8(PLAY_INTRO), 0, "PLAY_INTRO cleared");
    assert.equal(a.mem.read8((P1_CONTEXT + 4) & 0xffff), 0, "saved context carries the cleared PLAY_INTRO");
  }
  // resume-2P: GAME_SUBSTATE = 0x17.
  {
    const e = craft({ lives: 3, twoPlayer: true });
    const a = e.clone();
    oracle(a);
    assert.equal(a.mem.read8(GAME_SUBSTATE), 0x17, "resume-2P: GAME_SUBSTATE = 0x17");
  }
  // gameover-1P: life 1 -> 0, SUBSTATE_TIMER = 0xC0, GAME_SUBSTATE = 0x10, banner stamped @0x76D4.
  {
    const e = craft({ lives: 1, twoPlayer: false, attract: 0 });
    const a = e.clone();
    oracle(a);
    assert.equal(a.mem.read8(LIVES), 0, "gameover-1P: LIVES decremented to 0");
    assert.equal(a.mem.read8(SUBSTATE_TIMER), 0xc0, "gameover-1P: SUBSTATE_TIMER = 0xC0");
    assert.equal(a.mem.read8(GAME_SUBSTATE), 0x10, "gameover-1P: GAME_SUBSTATE = 0x10");
    assert.equal(a.mem.read8(0x76d4), 0x10, "gameover-1P: banner tile 0x10 stamped at 0x76D4");
  }
  console.log("  SANITY: oracle arm outcomes confirmed (decrement, resume/game-over sub-states, banner)");
});

// -- 3. TEETH -----------------------------------------------------------------

// Each twin is the correct candidate with ONE surgical change, so the diff lands on a
// single targeted byte (the exemplar's minimal-teeth style).

/** Twin A: wrong resume routing — feeds the 1-player sub-state (0x08) to a 2P resume. */
function brokenResumeRouting(m) {
  candidate(m); // everything correct, including 0x17 on the 2P resume arm...
  if (m.mem.read8(GAME_SUBSTATE) === 0x17) m.mem.write8(GAME_SUBSTATE, 0x08); // ...but wrongly 0x08
}

/** Twin B: off-by-one life — computes and saves the decrement but leaves LIVES one too
 *  high (a plausible "forgot to store the decrement back to LIVES"). */
function brokenLifeCount(m) {
  candidate(m); // LIVES correctly decremented...
  m.mem.write8(LIVES, (m.mem.read8(LIVES) + 1) & 0xff); // ...then bumped back up by one (the bug)
}

/** Twin C: game over sets the wrong sub-state (0x11 instead of 0x10). */
function brokenGameOverSubstate(m) {
  candidate(m); // everything correct...
  if (m.mem.read8(GAME_SUBSTATE) === 0x10) m.mem.write8(GAME_SUBSTATE, 0x11); // ...but 0x11 on game over
}

test("TEETH: resume-routing, life-count, and wrong-game-over-sub-state twins are all CAUGHT", () => {
  // (a) resume routing: caught on the 2P-resume arm at GAME_SUBSTATE.
  const resume2P = craft({ lives: 3, twoPlayer: true });
  const dA = diffAgainstOracle(resume2P, brokenResumeRouting);
  assert.notEqual(dA, null, "the diff FAILED to catch wrong resume routing — it is worthless");
  assert.equal(dA.addr, GAME_SUBSTATE, "resume-routing twin must diverge at GAME_SUBSTATE (0x600a)");
  assert.equal(dA.a, 0x17, "oracle sets 0x17 for 2-player resume");
  assert.equal(dA.b, 0x08, "broken twin wrongly set 0x08");

  // (b) off-by-one life: caught at LIVES on a resume arm (branch unchanged, so the diff
  //     pins to the life byte alone).
  const resume1P = craft({ lives: 3, twoPlayer: false });
  const dB = diffAgainstOracle(resume1P, brokenLifeCount);
  assert.notEqual(dB, null, "the diff FAILED to catch a wrong life count — it is worthless");
  assert.equal(dB.addr, LIVES, "life-count twin must diverge at LIVES (0x6228)");
  assert.equal(dB.a, 0x02, "oracle decremented LIVES 3 -> 2");
  assert.equal(dB.b, 0x03, "broken twin left LIVES at 3");

  // (c) wrong game-over sub-state: caught at GAME_SUBSTATE on the game-over arm.
  const gameover1P = craft({ lives: 1, twoPlayer: false, attract: 0 });
  const dC = diffAgainstOracle(gameover1P, brokenGameOverSubstate);
  assert.notEqual(dC, null, "the diff FAILED to catch a wrong game-over sub-state — it is worthless");
  assert.equal(dC.addr, GAME_SUBSTATE, "game-over-sub-state twin must diverge at GAME_SUBSTATE (0x600a)");
  assert.equal(dC.a, 0x10, "oracle sets game-over sub-state 0x10");
  assert.equal(dC.b, 0x11, "broken twin set 0x11");

  console.log(
    `  TEETH: resume-routing caught at ${hx(dA.addr)} (oracle=${hx(dA.a)} broken=${hx(dA.b)}); ` +
      `life-count caught at ${hx(dB.addr)}; game-over-sub-state caught at ${hx(dC.addr)}`,
  );
});
