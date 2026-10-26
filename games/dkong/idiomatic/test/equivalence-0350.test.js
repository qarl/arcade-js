// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for awardBonusLifeAtThreshold (ROM 0x0350) — grant the
 * once-per-player bonus life when the running score first reaches the operator-set
 * threshold, then repaint the lives/level HUD.
 *
 * sub_0350 is CALLED EVERY FRAME by the main loop, but the score never crosses the
 * bonus threshold during attract, so real captured dispatches only ever exercise
 * the "below threshold, no award" path (BONUS_LIFE_AWARDED stays 0). The award path
 * — set the latch, bump LIVES, and TAIL into drawLivesAndLevel (0x06B8) — is reached
 * only with CRAFTED entries (a real attract-base machine + a surgical poke of the
 * score / threshold / player / latch, identically on both sides).
 *
 * The oracle's tail is `jp 0x06b8` with nothing pushed, so 0x06B8's own `ret`
 * returns on sub_0350's behalf; the two early exits (`ret nz` already-awarded,
 * `ret c` below-threshold) each `ret` too. So the oracle nets exactly ONE
 * caller-return pop on EVERY path, and only READS the stack (popped bytes live in
 * STACK_SCRATCH, excluded by the memory-equivalence contract). The idiomatic
 * routine models no stack (a plain JS return + a direct drawLivesAndLevel call), so
 * runCandidate performs ONE m.ret() after it to line pc + SP up with the oracle.
 *
 *   1. EQUAL (captured) — hook 0x0350 in a real boot/attract run, clone at each
 *      dispatch, and confirm awardBonusLifeAtThreshold == oracle over the real
 *      no-award path (RAM − the stack scratch below the entry SP, pc, SP), and that the path is genuinely
 *      the no-award one (LIVES untouched).
 *
 *   2. EQUAL (crafted) — poke the score / threshold / player / latch identically on
 *      both sides to reach: the award path for P1 and P2 (both HUD arms — ATTRACT
 *      set skips the paint, ATTRACT clear paints it), the threshold BOUNDARY
 *      (score == threshold awards, proving `>=` not `>`), the already-awarded
 *      early-out, and a below-threshold no-award. Ignored score nibbles carry noise
 *      to pin the nibble masks. Reserve (LIVES-1) is kept 0..6 so the HUD marker
 *      fill stays in mapped video RAM.
 *
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) wrong life increment (LIVES + 2) — caught on an award case at 0x6228.
 *      (b) dropped nibble-swap (compares the un-rotated byte) — caught where the
 *          swap flips the award decision (score 0x51 vs the un-swapped 0x15).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0350.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0350 as oracle } from "../../translated/loc_0350.js";
import { awardBonusLifeAtThreshold } from "../awardBonusLifeAtThreshold.js";
import { drawLivesAndLevel } from "../drawLivesAndLevel.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  ATTRACT,
  BONUS_LIFE_AWARDED,
  CURRENT_PLAYER,
  P1_SCORE,
  P2_SCORE,
  DIP_BONUS_LIFE,
  LIVES,
  LEVEL,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0350;
const RET_ADDR = 0x02cd;    // the main-loop site right after `call 0x0350`
const HUD_FURNITURE = 0x7503; // a HUD cell drawLivesAndLevel always paints when it runs

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// All non-stack RAM addresses that changed between two machines (for the
// no-write non-vacuity check on the early-out / no-award paths).
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret()
 * so pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with
 * the JS call stack, so it does not touch pc/SP itself).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
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
// realistic values. The award body is never reached here; it is crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Encode a score-in-thousands value V into the current player's two upper score
// bytes: the thousands digit (V's low nibble) into the high nibble of the middle
// byte, the ten-thousands digit (V's high nibble) into the low nibble of the top
// byte. With `noise`, the two IGNORED nibbles are set to 0xF to pin the masks.
function putScoreThousands(m, player, V, noise = false) {
  const base = player === 0 ? P1_SCORE : P2_SCORE;
  const noiseLo = noise ? 0x0f : 0x00; // ignored low nibble of the middle byte
  const noiseHi = noise ? 0xf0 : 0x00; // ignored high nibble of the top byte
  m.mem.write8(base + 1, ((V & 0x0f) << 4) | noiseLo);
  m.mem.write8(base + 2, noiseHi | ((V >> 4) & 0x0f));
}

// Stamp a crafted 0x0350 dispatch onto a clone of the base: a stack with a plausible
// caller return (so the terminal `ret` has a sane target), then the flags the routine
// reads. Score is written last so `noise` lands in the right slots.
function craft(base, { attract = 0x01, player = 0, awarded = 0, threshold, lives, level = 0x01, score, noise = false }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(ATTRACT, attract);
  m.mem.write8(CURRENT_PLAYER, player);
  m.mem.write8(BONUS_LIFE_AWARDED, awarded);
  m.mem.write8(DIP_BONUS_LIFE, threshold);
  m.mem.write8(LIVES, lives);
  m.mem.write8(LEVEL, level);
  putScoreThousands(m, player, score, noise);
  return m;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x0350 is dispatched during boot/attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1200);
  assert.ok(count > 0, "0x0350 should be dispatched — the main loop calls it every pass");
  console.log(`  REACHABILITY: ${count} natural 0x0350 dispatches in 1200 frames`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------
//
// The attract demo racks up score and DOES award bonus lives (and early boot runs
// the routine before the DIP threshold is decoded), so real captured dispatches
// span BOTH the award and the no-award/early-out arms. Every one must match the
// oracle; the crafted arms below then broaden coverage to the specific edges.

test("EQUAL (captured): awardBonusLifeAtThreshold == oracle on every real dispatch", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 64) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(600);
  assert.ok(caps.length >= 1, "expected at least one real 0x0350 dispatch during boot/attract");

  let sawAward = 0, sawNoAward = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, awardBonusLifeAtThreshold);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    // Classify the arm the oracle took (bumped LIVES => award) for reporting.
    if (runOracle(entry).mem.read8(LIVES) !== entry.mem.read8(LIVES)) sawAward++; else sawNoAward++;
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches identical to the oracle (${sawAward} award, ${sawNoAward} no-award)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): the award/early-out/boundary arms all match the oracle", () => {
  const base = attractBase();

  const cases = [
    // below threshold -> no award, both players
    { name: "P1 below-threshold", opts: { player: 0, threshold: 0x15, score: 0x10, lives: 3 }, award: false },
    { name: "P2 below-threshold", opts: { player: 1, threshold: 0x20, score: 0x05, lives: 3 }, award: false },
    // exactly at threshold -> AWARD (proves `>=`), HUD-skip arm (ATTRACT set)
    { name: "P1 boundary award (HUD skip)", opts: { player: 0, attract: 0x01, threshold: 0x15, score: 0x15, lives: 3 }, award: true },
    // above threshold -> AWARD, HUD-draw arm (ATTRACT clear), P1
    { name: "P1 award (HUD draw)", opts: { player: 0, attract: 0x00, threshold: 0x15, score: 0x50, lives: 2, level: 0x11 }, award: true, draw: true },
    // above threshold -> AWARD, HUD-draw arm, P2, level at the clamp edge
    { name: "P2 award (HUD draw)", opts: { player: 1, attract: 0x00, threshold: 0x20, score: 0x99, lives: 5, level: 0x63 }, award: true, draw: true },
    // ignored score nibbles carry noise -> masks must drop them (still awards at 0x15)
    { name: "P1 award with nibble noise", opts: { player: 0, attract: 0x01, threshold: 0x15, score: 0x15, lives: 4, noise: true }, award: true },
    // already awarded -> early-out even though the score is way over
    { name: "already-awarded early-out", opts: { player: 0, awarded: 0x01, threshold: 0x10, score: 0x99, lives: 3 }, award: false },
    // threshold one above the score -> no award
    { name: "just-under no award", opts: { player: 0, threshold: 0x15, score: 0x14, lives: 3 }, award: false },
  ];

  for (const { name, opts, award, draw } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, awardBonusLifeAtThreshold);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    if (award) {
      // The award body ran: latch set, LIVES bumped by one.
      assert.equal(after.mem.read8(BONUS_LIFE_AWARDED), 1, `${name}: latch not set`);
      assert.equal(after.mem.read8(LIVES), (opts.lives + 1) & 0xff, `${name}: LIVES not bumped by one`);
      if (draw) {
        // The tail reached drawLivesAndLevel and painted the HUD (guard proceeded).
        assert.equal(after.mem.read8(HUD_FURNITURE), 0x1c, `${name}: HUD not painted — the tail did not reach drawLivesAndLevel`);
      }
    } else {
      // No award: nothing non-stack was written.
      assert.deepEqual(changedAddrs(entry, after, entry.regs.sp), [], `${name}: no-award path wrote non-stack RAM`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (award P1/P2, boundary, both HUD arms, noise, early-out, no-award) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): bumps LIVES by two instead of one. */
function brokenIncrement(m) {
  const { regs, mem } = m;
  if (mem.read8(BONUS_LIFE_AWARDED) !== 0) return;
  const b = (mem.read8(CURRENT_PLAYER) === 0 ? P1_SCORE : P2_SCORE) + 1;
  const V = ((mem.read8(b + 1) & 0x0f) << 4) | ((mem.read8(b) & 0xf0) >> 4);
  if (V < mem.read8(DIP_BONUS_LIFE)) return;
  mem.write8(BONUS_LIFE_AWARDED, 1);
  mem.write8(LIVES, mem.read8(LIVES) + 2); // BUG: +2
  regs.a = 1;
  drawLivesAndLevel(m);
}

/** Broken twin (b): compares the un-rotated byte (drops the nibble swap). */
function brokenNoSwap(m) {
  const { regs, mem } = m;
  if (mem.read8(BONUS_LIFE_AWARDED) !== 0) return;
  const b = (mem.read8(CURRENT_PLAYER) === 0 ? P1_SCORE : P2_SCORE) + 1;
  const V = (mem.read8(b) & 0xf0) | (mem.read8(b + 1) & 0x0f); // BUG: no swap
  if (V < mem.read8(DIP_BONUS_LIFE)) return;
  mem.write8(BONUS_LIFE_AWARDED, 1);
  mem.write8(LIVES, mem.read8(LIVES) + 1);
  regs.a = 1;
  drawLivesAndLevel(m);
}

test("TEETH: the wrong-increment twin and the dropped-nibble-swap twin are CAUGHT", () => {
  const base = attractBase();

  // (a) wrong increment: an award case (HUD-skip arm) — correct LIVES+1 vs twin LIVES+2.
  const inc = craft(base, { player: 0, attract: 0x01, threshold: 0x15, score: 0x50, lives: 3 });
  const incDiffs = contractDiffs(inc, brokenIncrement);
  assert.ok(incDiffs.length > 0, "the wrong-increment twin escaped — the gate is worthless");
  assert.ok(incDiffs[0].startsWith(`RAM@${hx(LIVES)}`), `expected the increment diff at ${hx(LIVES)}, got ${incDiffs[0]}`);

  // (b) dropped nibble-swap: score bytes give 0x51 swapped / 0x15 un-swapped; threshold
  // 0x20 makes the correct routine award and the twin not.
  const swp = base.clone();
  swp.regs.sp = 0x6c00;
  swp.push16(RET_ADDR);
  swp.mem.write8(ATTRACT, 0x01);
  swp.mem.write8(CURRENT_PLAYER, 0x00);
  swp.mem.write8(BONUS_LIFE_AWARDED, 0x00);
  swp.mem.write8(DIP_BONUS_LIFE, 0x20);
  swp.mem.write8(LIVES, 0x03);
  swp.mem.write8(P1_SCORE + 1, 0x10); // thousands digit 1  -> low nibble after swap
  swp.mem.write8(P1_SCORE + 2, 0x05); // ten-thousands digit 5 -> high nibble after swap
  // sanity: the correct routine awards here, so the twin's no-award diverges.
  assert.equal(runOracle(swp).mem.read8(BONUS_LIFE_AWARDED), 1, "swap case should award for the correct routine");
  const swpDiffs = contractDiffs(swp, brokenNoSwap);
  assert.ok(swpDiffs.length > 0, "the dropped-nibble-swap twin escaped — the gate is worthless");

  console.log(`  TEETH: wrong-increment caught (${incDiffs[0]}); dropped-nibble-swap caught (${swpDiffs[0]})`);
});
