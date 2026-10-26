// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1344 (ROM 0x1344) — idx-15 in-game sub-state handler:
 * decrement the current player's LIVES, save the live context into player 2's slot,
 * then either select the next in-game sub-state (still playing) or run the player-2
 * game-over sequence (rank score, post render tasks, fill a tile block, arm timer).
 *
 * loc_1344 is entry 15 (0x0F) of the 0x0702 rst-0x28 sub-state table and is NOT
 * dispatched in attract (verified below: 0 dispatches over a 1200-frame window — it
 * is player-2's in-game life-loss sub-state, needing a two-player credited game to
 * reach). It WRITES MEMORY via its own stores and four callees, so it is validated by
 * MEMORY-equivalence against the frozen oracle over RAM (minus the stack scratch below the entry SP) + pc +
 * SP — never the full register file, never cycles — on a FRESH clone per case, using
 * CRAFTED entries (doc-06: a real attract-base machine + a surgical poke):
 *
 *   1. EQUAL (lives remaining) — LIVES set so the decrement stays non-zero, driving the
 *      "still playing" arm. Covers P1-alive (P1_CONTEXT[0] != 0 -> GAME_SUBSTATE 0x17),
 *      P1-out (P1_CONTEXT[0] == 0 -> 0x08), and the dec-underflow edge (LIVES 0 -> 0xFF,
 *      still non-zero). Non-vacuous: GAME_SUBSTATE takes the asserted value and the live
 *      block is copied into P2_CONTEXT.
 *
 *   2. EQUAL (game over) — LIVES == 1 so the decrement hits zero, driving the game-over
 *      arm through loc_13ca + two enqueueTask posts + fillTileBlock + the timer/sub-state
 *      stores. Both loc_13ca guard arms: ATTRACT set (its rst-0x08 skip) and ATTRACT clear
 *      (full score-rank body over a seeded P2_SCORE / zeroed sort region). The FULL oracle
 *      runs on both sides, so any wrong store, task, tile, or score digit surfaces as
 *      divergent RAM.
 *
 *   3. TEETH — two deliberately-broken twins, each a realistic loc_12f2-twin confusion,
 *      each MUST be caught: (a) wrong save slot (P1_CONTEXT, as loc_12f2 uses) — caught in
 *      the lives-remaining arm; (b) wrong game-over sub-state (0x10, as loc_12f2 uses,
 *      not 0x11) — caught in the game-over arm.
 *
 * The idiomatic routine models the Z80 `ret` as a plain JS return (no stack modelling),
 * so runCandidate performs ONE m.ret() after the call to line pc + SP up with the oracle.
 * The oracle nets exactly one caller-return pop on every exit: its four `call`s are each a
 * SP-neutral push16 + callee-ret pair, and its terminal `ret` is that single pop.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1344.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1344 as oracle } from "../../translated/loc_1344.js";
import { loc_1344 } from "../loc_1344.js";
import { silenceSound } from "../silenceSound.js";
import { loc_13ca } from "../loc_13ca.js";
import { enqueueTask } from "../enqueueTask.js";
import { fillTileBlock } from "../fillTileBlock.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1344;
const LIVES = 0x6228; //          live context block, byte 0
const PLAY_INTRO = 0x622c;
const P1_CONTEXT = 0x6040; //     player 1's context, byte 0 = P1 lives
const P2_CONTEXT = 0x6048; //     ldir destination
const GAME_SUBSTATE = 0x600a;
const SUBSTATE_TIMER = 0x6009;
const ATTRACT = 0x6007; //        loc_13ca's rst-0x08 guard reads bit 0
const P2_SCORE = 0x60b5;
const TILE_BLOCK = 0x76d3; //     fillTileBlock top-left
const RET_ADDR = 0x0710; //       a plausible caller return (after the 0x0702 dispatch)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns {addr,a,b} or null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// All non-stack RAM addresses that changed between two machines (for non-vacuity checks).
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it never touches pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only, so the
 *  register file is deliberately NOT compared. Returns human-readable mismatches. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. loc_1344 is never dispatched here (see REACHABILITY) — its entry
// is crafted by poking. No overrides -> the machine runs pure translated behaviour, so
// the oracle's m.call(0x011C/0x13CA/0x309F/0x1826) resolve to the translated callees.
function attractBase(frames = 200) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted idx-15 dispatch onto a clone of the base: a stack with a plausible
// caller return (so the terminal `ret` has a sane target), then the pokes that force an arm.
function craft(base, poke) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR); // the caller-return the terminal `ret` pops (lands in STACK_SCRATCH)
  if (poke) poke(m);
  return m;
}

// Clear the whole task ring to the empty marker so the game-over posts actually land.
const clearRing = (m) => { for (let l = 0xc0; l <= 0xff; l++) m.mem.write8(0x6000 | l, 0xff); };
// Distinctive sentinel across the two context save slots, so a wrong-slot save diverges.
const sentinelContexts = (m) => {
  for (let i = 0; i < 8; i++) { m.mem.write8(P1_CONTEXT + i, 0xa1); m.mem.write8(P2_CONTEXT + i, 0xb2); }
};

// -- 0. justification: not reached in attract ---------------------------------

test("REACHABILITY: 0x1344 is not dispatched in a plain attract window (justifies crafted entries)", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.equal(count, 0, "0x1344 unexpectedly dispatched in attract — capture it instead of crafting");
  console.log("  REACHABILITY: 0 natural 0x1344 dispatches in a 1200-frame attract window");
});

// -- 1. EQUAL (lives remaining) -----------------------------------------------

test("EQUAL (lives remaining): loc_1344 == oracle on the still-playing arm", () => {
  const base = attractBase();
  const cases = [
    // P1 still alive -> GAME_SUBSTATE 0x17.
    { name: "P1-alive", lives: 3, p1: 2, want: 0x17 },
    // P1 out of lives -> GAME_SUBSTATE 0x08.
    { name: "P1-out", lives: 3, p1: 0, want: 0x08 },
    // dec underflow: LIVES 0 -> 0xFF, still non-zero, still the playing arm.
    { name: "underflow", lives: 0, p1: 5, want: 0x17 },
  ];
  for (const { name, lives, p1, want } of cases) {
    const entry = craft(base, (m) => {
      sentinelContexts(m);
      m.mem.write8(LIVES, lives);
      m.mem.write8(P1_CONTEXT, p1);
    });
    const diffs = contractDiffs(entry, loc_1344);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuous, and the two visible effects are exactly as claimed:
    const o = runOracle(entry);
    assert.equal(o.mem.read8(GAME_SUBSTATE), want, `${name}: GAME_SUBSTATE should be ${hx(want)}`);
    assert.equal(o.mem.read8(LIVES), (lives - 1) & 0xff, `${name}: LIVES should be decremented`);
    // The live block (LIVES first, PLAY_INTRO zeroed) was copied into P2_CONTEXT.
    assert.equal(o.mem.read8(P2_CONTEXT), (lives - 1) & 0xff, `${name}: P2_CONTEXT[0] should hold decremented lives`);
    assert.equal(o.mem.read8(P2_CONTEXT + (PLAY_INTRO - LIVES)), 0, `${name}: copied PLAY_INTRO byte should be 0`);
  }
  console.log("  EQUAL/lives: P1-alive(0x17), P1-out(0x08), underflow — identical to the oracle, pc/SP aligned");
});

// -- 2. EQUAL (game over) -----------------------------------------------------

test("EQUAL (game over): LIVES hits zero — loc_1344 == oracle across both loc_13ca guard arms", () => {
  const base = attractBase();
  const cases = [
    // ATTRACT set: loc_13ca's rst-0x08 guard skips the score-rank body.
    { name: "attract-skip", attract: 0x01 },
    // ATTRACT clear: full loc_13ca body over a seeded score + zeroed sort region.
    { name: "full-body", attract: 0x00, seedScore: true },
  ];
  for (const { name, attract, seedScore } of cases) {
    const entry = craft(base, (m) => {
      clearRing(m);
      sentinelContexts(m);
      m.mem.write8(LIVES, 1); //     dec -> 0 -> game-over arm
      m.mem.write8(ATTRACT, attract);
      if (seedScore) {
        for (let a = 0x6100; a < 0x6200; a++) m.mem.write8(a, 0); // zero the sort staging
        m.mem.write8(P2_SCORE, 0x99);
        m.mem.write8(P2_SCORE + 1, 0x99);
        m.mem.write8(P2_SCORE + 2, 0x99);
      }
    });
    const diffs = contractDiffs(entry, loc_1344);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuous, and the game-over stores are as claimed.
    const o = runOracle(entry);
    assert.ok(changedAddrs(entry, o, entry.regs.sp).length > 0, `${name}: game-over arm wrote nothing — vacuous`);
    assert.equal(o.mem.read8(GAME_SUBSTATE), 0x11, `${name}: GAME_SUBSTATE should be 0x11`);
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0xc0, `${name}: SUBSTATE_TIMER should be 0xC0`);
    assert.equal(o.mem.read8(TILE_BLOCK), 0x10, `${name}: fillTileBlock should stamp tile 0x10 at 0x76D3`);
  }
  console.log("  EQUAL/game-over: attract-skip + full-body — identical to the oracle, pc/SP aligned");
});

// -- 3. TEETH -----------------------------------------------------------------

// Faithful reimplementations of loc_1344 that call the SAME idiomatic callees, each with
// ONE injected loc_12f2-twin confusion — so the diff proves it catches a real corruption.

/** Broken twin (a): save the live block to P1_CONTEXT (loc_12f2's slot) instead of P2. */
function brokenWrongSaveSlot(m) {
  const { regs, mem } = m;
  silenceSound(m);
  mem.write8(PLAY_INTRO, 0);
  const lives = (mem.read8(LIVES) - 1) & 0xff;
  mem.write8(LIVES, lives);
  for (let i = 0; i < 8; i++) mem.write8((P1_CONTEXT + i) & 0xffff, mem.read8((LIVES + i) & 0xffff)); // BUG
  if (lives !== 0) {
    mem.write8(GAME_SUBSTATE, mem.read8(P1_CONTEXT) !== 0 ? 0x17 : 0x08);
    return;
  }
  regs.a = 0x03; regs.hl = P2_SCORE; loc_13ca(m);
  regs.d = 0x03; regs.e = 0x03; enqueueTask(m);
  regs.d = 0x03; regs.e = 0x00; enqueueTask(m);
  regs.hl = TILE_BLOCK; fillTileBlock(m);
  mem.write8(SUBSTATE_TIMER, 0xc0);
  mem.write8(GAME_SUBSTATE, 0x11);
}

/** Broken twin (b): select game-over sub-state 0x10 (loc_12f2's constant) instead of 0x11. */
function brokenWrongSubstate(m) {
  const { regs, mem } = m;
  silenceSound(m);
  mem.write8(PLAY_INTRO, 0);
  const lives = (mem.read8(LIVES) - 1) & 0xff;
  mem.write8(LIVES, lives);
  for (let i = 0; i < 8; i++) mem.write8((P2_CONTEXT + i) & 0xffff, mem.read8((LIVES + i) & 0xffff));
  if (lives !== 0) {
    mem.write8(GAME_SUBSTATE, mem.read8(P1_CONTEXT) !== 0 ? 0x17 : 0x08);
    return;
  }
  regs.a = 0x03; regs.hl = P2_SCORE; loc_13ca(m);
  regs.d = 0x03; regs.e = 0x03; enqueueTask(m);
  regs.d = 0x03; regs.e = 0x00; enqueueTask(m);
  regs.hl = TILE_BLOCK; fillTileBlock(m);
  mem.write8(SUBSTATE_TIMER, 0xc0);
  mem.write8(GAME_SUBSTATE, 0x10); // BUG: should be 0x11
}

test("TEETH: the wrong-save-slot and wrong-substate twins are CAUGHT", () => {
  const base = attractBase();

  // (a) wrong save slot: lives-remaining arm with sentinel contexts so P2_CONTEXT (never
  //     written by the twin) diverges from the oracle's copy.
  const slotEntry = craft(base, (m) => { sentinelContexts(m); m.mem.write8(LIVES, 3); m.mem.write8(P1_CONTEXT, 2); });
  const slotDiffs = contractDiffs(slotEntry, brokenWrongSaveSlot);
  assert.ok(slotDiffs.length > 0, "the wrong-save-slot twin escaped — the gate is worthless");

  // (b) wrong sub-state: game-over arm, caught at GAME_SUBSTATE (0x11 vs 0x10).
  const subEntry = craft(base, (m) => { clearRing(m); m.mem.write8(LIVES, 1); m.mem.write8(ATTRACT, 0x01); });
  const subDiffs = contractDiffs(subEntry, brokenWrongSubstate);
  assert.ok(subDiffs.length > 0, "the wrong-substate twin escaped — the gate is worthless");
  assert.ok(
    subDiffs.some((d) => d.includes(hx(GAME_SUBSTATE))),
    `expected the wrong-substate twin caught at ${hx(GAME_SUBSTATE)}, got: ${subDiffs.join("; ")}`,
  );

  console.log(`  TEETH: wrong-save-slot caught (${slotDiffs[0]}); wrong-substate caught (${subDiffs[0]})`);
});
