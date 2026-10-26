// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_059b (ROM 0x059B) — the score-RESET task. It selects one of the
 * three on-screen score counters from the task payload, ZEROES its 3 bytes, then repaints
 * it (now 000000) by handing off to drawScoreTask (0x05C6):
 *   • payload 0 -> player 1's counter (P1_SCORE) up column 0x7781,
 *   • payload 1 (or any other value below 3) -> player 2's counter (P2_SCORE) up 0x7521,
 *   • payload 2 -> the high score (HIGH_SCORE) up its fixed column 0x7641,
 *   • payload 3 and up -> the un-lifted recursive-clear arm at ROM 0x05BD, which BOTH
 *     sides surface as a fault.
 *
 * loc_059b is the clear-first twin of drawScoreTask. The oracle preserves the payload
 * across the clear with a balanced push/pop, then tail-jumps into the renderer chain,
 * whose final `ret` pops the task's caller-return — the ONE net stack change on every
 * render path; that push/pop and the renderer's per-digit push16/pop touch only bytes
 * inside STACK_SCRATCH, excluded by the contract. The idiomatic routine models no stack
 * (a plain JS return + a direct drawScoreTask call), so the harness performs one m.ret()
 * on the candidate clone AFTER the call to line pc + SP up with the oracle. So it is gated
 * on MEMORY-EQUIVALENCE — RAM − the stack scratch below the entry SP + pc + SP — not a returned scalar, and every
 * case runs on a FRESH clone. LIVE-OUT is memory-only (the task returns to the main loop,
 * which reloads its registers), so the register file is not compared.
 *
 * GROUNDING — loc_059b is the score RESET, not the per-frame redraw, so it NEVER dispatches
 * in attract; it fires when a credited game starts. The canonical coin+start tape drives
 * exactly one real dispatch (payload 0 -> P1_SCORE, at game start), which grounds the
 * player-1 arm; crafted entries then pin what the tape does not vary:
 *   1. EQUAL (real)    — the real captured game-start dispatch reproduced exactly, and the
 *                        player-1 counter left zeroed.
 *   2. EQUAL (crafted) — the player-2 arm (payload 1) and the high-score arm (payload 2),
 *                        seeded from real attract RAM with three distinct counters, identical
 *                        on both sides; each case proves the SELECTED counter was zeroed, the
 *                        OTHER two left intact, and the selected column repainted to 0.
 *   3. FAULT           — payload 3 AND a higher payload (0x80) throw on both sides (proving
 *                        the arm is payload>=3, not just ==3), writing no non-stack RAM.
 *   4. TEETH           — two twins the gate MUST catch: (a) SWAPS the player-1/player-2 clear
 *                        target, so the wrong counter is zeroed; (b) lands a NONZERO byte in
 *                        the clear, so the counter is not fully reset.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-059b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_059b as oracle } from "../../translated/loc_059b.js";
import { resetScoreCounter as candidate } from "../resetScoreCounter.js";
import { drawScoreTask } from "../drawScoreTask.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, P1_SCORE, P2_SCORE, HIGH_SCORE } from "../names.js";
import { NotImplemented } from "../../../../boards/dkong/io.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x059b; // the score-RESET task
const COLUMN_P1 = 0x7781; // player-1 score column base (selector zero)
const COLUMN_P2 = 0x7521; // player-2 score column base (nonzero selector)
const COLUMN_HS = 0x7641; // high-score fixed column base
const SAFE_SP = 0x6bfe; // inside STACK_SCRATCH: the payload push/pop, the renderer's
                        // pushes/pops, and the final caller-return `ret` all land here
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80) then
// IN2 start1 (0x04) so the ROM's own credit/start logic begins a game — which enqueues
// the score-RESET task. runFrames applies this at each frame boundary.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1
];

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Every non-stack RAM address that changed between two machines (for the no-write fault check). */
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

/** Run the ORACLE on a fresh clone. Its renderer chain performs the final `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP
 * match the oracle's — the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it never touches pc/SP itself; the harness supplies the caller-return pop.
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
  let c;
  try {
    c = runCandidate(entry, fn);
  } catch (e) {
    // A candidate that FAULTS where the oracle succeeds is definitively not equivalent.
    return [`candidate threw: ${e.message}`];
  }
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// -- capture / base -----------------------------------------------------------

/**
 * Drive the coin+start tape and clone the machine at up to K real 0x059B dispatches. The
 * wrapper snapshots the entry state, then runs the oracle so the host game proceeds.
 */
function captureTargetStates(K, maxFrames) {
  const caps = [];
  const ov = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: ov });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  return caps;
}

// A real, self-consistent machine (boot + a stretch of attract) to seed crafted entries
// with realistic RAM. clone() neutralises the frame machinery (nextNmi/nextBoundary = Inf).
function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

// Lay down distinct, differing-nibble packed-BCD bytes at all three counters so a
// mis-targeted clear (wrong counter zeroed, or one left intact) is observable in work RAM.
function seedScores(m) {
  m.mem.write8(P1_SCORE + 0, 0xf0); m.mem.write8(P1_SCORE + 1, 0x2a); m.mem.write8(P1_SCORE + 2, 0x91);
  m.mem.write8(P2_SCORE + 0, 0xf0); m.mem.write8(P2_SCORE + 1, 0x2a); m.mem.write8(P2_SCORE + 2, 0x52);
  m.mem.write8(HIGH_SCORE + 0, 0xf0); m.mem.write8(HIGH_SCORE + 1, 0x2a); m.mem.write8(HIGH_SCORE + 2, 0x73);
}

// The counter this payload resets, the column it repaints, and the two counters it must
// leave untouched.
function selected(payload) {
  if (payload === 0) return { base: P1_SCORE, column: COLUMN_P1, others: [P2_SCORE, HIGH_SCORE] };
  if (payload === 2) return { base: HIGH_SCORE, column: COLUMN_HS, others: [P1_SCORE, P2_SCORE] };
  return { base: P2_SCORE, column: COLUMN_P2, others: [P1_SCORE, HIGH_SCORE] }; // payload 1 / other
}

// A crafted 0x059B entry: real attract RAM, a safe stack in STACK_SCRATCH, seeded counters,
// and the chosen payload in the selector register.
function craft(base, payload) {
  const e = base.clone();
  e.regs.sp = SAFE_SP;
  e.regs.a = payload;
  seedScores(e);
  return e;
}

// -- broken twins -------------------------------------------------------------

/**
 * Broken twin (a): SWAPS the player-1/player-2 clear target — payload 0 zeroes player 2's
 * counter (and repaints player 1's, still seeded) and vice versa. Caught in work RAM: the
 * wrong counter is zeroed and the right one is left intact.
 */
function brokenSwapClear(m) {
  const { regs, mem } = m;
  const payload = regs.a;
  if (payload >= 3) throw new NotImplemented("twin: 0x05BD arm");
  const base = payload === 0 ? P2_SCORE : payload === 2 ? HIGH_SCORE : P1_SCORE; // BUG: P1/P2 swapped
  mem.write8(base, 0);
  mem.write8(base + 1, 0);
  mem.write8(base + 2, 0);
  drawScoreTask(m);
}

/**
 * Broken twin (b): lands a NONZERO byte in the first cell of the clear, so the counter is
 * not fully reset. Caught at the selected counter's base cell.
 */
function brokenClearValue(m) {
  const { regs, mem } = m;
  const payload = regs.a;
  if (payload >= 3) throw new NotImplemented("twin: 0x05BD arm");
  const base = payload === 0 ? P1_SCORE : payload === 2 ? HIGH_SCORE : P2_SCORE;
  mem.write8(base, 0x99); // BUG: not cleared
  mem.write8(base + 1, 0);
  mem.write8(base + 2, 0);
  drawScoreTask(m);
}

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: 0x059B is dispatched once at game start (never in attract)", () => {
  // Attract alone never raises it.
  let attractHits = 0;
  const attractOv = new Map([[TARGET, (mm) => { attractHits++; return oracle(mm); }]]);
  const attractHost = new Machine(ROM, { overrides: attractOv });
  attractHost.runFrames(600);
  assert.equal(attractHits, 0, "0x059B should NOT dispatch in attract — it is the score RESET, not the redraw");

  // The coin+start tape starts a game, which enqueues the reset.
  const caps = captureTargetStates(8, 170);
  assert.ok(caps.length >= 1, "coin+start tape should dispatch 0x059B once at game start");
  const payloads = caps.map((c) => c.regs.a & 0xff);
  console.log(`  REACHABILITY: 0 attract dispatches; ${caps.length} game-start dispatch(es) (payloads ${payloads.map(hx).join(", ")})`);
});

// -- 2. EQUAL (real) ----------------------------------------------------------

test("EQUAL (real): loc_059b == oracle on the real game-start dispatch", () => {
  const caps = captureTargetStates(8, 170);
  assert.ok(caps.length >= 1, "expected >=1 real 0x059B dispatch from the coin+start tape — grounding assumption broke");

  for (const entry of caps) {
    const payload = entry.regs.a & 0xff;
    const diffs = contractDiffs(entry, candidate);
    assert.equal(diffs.length, 0, `payload=${hx(payload)}: ${diffs.join("; ")}`);

    // The selected counter really was zeroed (non-vacuity: real work happened).
    if (payload < 3) {
      const { base } = selected(payload);
      const after = runOracle(entry);
      assert.equal(after.mem.read8(base), 0, `payload ${hx(payload)}: counter base not zeroed`);
      assert.equal(after.mem.read8(base + 1), 0, `payload ${hx(payload)}: counter mid not zeroed`);
      assert.equal(after.mem.read8(base + 2), 0, `payload ${hx(payload)}: counter top not zeroed`);
    }
  }
  console.log(`  EQUAL/real: ${caps.length} real game-start dispatch(es) identical to the oracle`);
});

// -- 3. EQUAL (crafted, all reset arms) ---------------------------------------

test("EQUAL (crafted): every reset arm matches the oracle and zeroes exactly the selected counter", () => {
  const base = attractBase();

  for (const payload of [0x00, 0x01, 0x02]) {
    const entry = craft(base, payload);
    const diffs = contractDiffs(entry, candidate);
    assert.equal(diffs.length, 0, `payload ${hx(payload)}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    const { base: b, column, others } = selected(payload);
    // Selected counter fully zeroed...
    assert.equal(after.mem.read8(b), 0, `payload ${hx(payload)}: counter base not zeroed`);
    assert.equal(after.mem.read8(b + 1), 0, `payload ${hx(payload)}: counter mid not zeroed`);
    assert.equal(after.mem.read8(b + 2), 0, `payload ${hx(payload)}: counter top not zeroed`);
    // ...the other two counters left intact...
    for (const o of others) {
      assert.notEqual(after.mem.read8(o + 2), 0, `payload ${hx(payload)}: an unselected counter (${hx(o)}) was disturbed`);
    }
    // ...and the selected column repainted from the cleared counter (top digit 0).
    assert.equal(after.mem.read8(column), 0, `payload ${hx(payload)}: column ${hx(column)} base cell did not show the reset digit`);
  }
  console.log("  EQUAL/crafted: 3 arms (P1, P2, high score) identical — selected counter zeroed, others intact, column reset");
});

// -- 4. FAULT (payload >= 3) --------------------------------------------------

test("FAULT (payload>=3): both the oracle and loc_059b throw, writing no non-stack RAM", () => {
  const base = attractBase();

  for (const payload of [0x03, 0x80]) {
    const entry = craft(base, payload);

    const oc = entry.clone();
    assert.throws(() => oracle(oc), NotImplemented, `the oracle should fault on payload ${hx(payload)} (0x05BD arm)`);
    assert.deepEqual(changedAddrs(entry, oc, entry.regs.sp), [], `the oracle wrote non-stack RAM before faulting on payload ${hx(payload)}`);

    const cc = entry.clone();
    assert.throws(() => candidate(cc), NotImplemented, `loc_059b should fault on payload ${hx(payload)} (0x05BD arm)`);
    assert.deepEqual(changedAddrs(entry, cc, entry.regs.sp), [], `loc_059b wrote non-stack RAM before faulting on payload ${hx(payload)}`);
  }
  console.log("  FAULT: payloads 0x03 and 0x80 throw NotImplemented on both sides (proves payload>=3) with no non-stack RAM written");
});

// -- 5. TEETH -----------------------------------------------------------------

test("TEETH: the swapped-clear twin and the nonzero-clear twin are CAUGHT", () => {
  const base = attractBase();

  // (a) swapped clear: on the player-1 entry the oracle zeroes P1 while the twin zeroes P2
  //     (and vice versa) — caught in work RAM on both.
  const p1 = craft(base, 0x00);
  const p2 = craft(base, 0x01);
  assert.equal(contractDiffs(p1, candidate).length, 0, "correct routine diverged on the payload-0 setup");
  assert.equal(contractDiffs(p2, candidate).length, 0, "correct routine diverged on the payload-1 setup");
  const swapP1 = contractDiffs(p1, brokenSwapClear);
  const swapP2 = contractDiffs(p2, brokenSwapClear);
  assert.ok(swapP1.length > 0, "the swapped-clear twin escaped on the player-1 entry — the clear target is unguarded");
  assert.ok(swapP2.length > 0, "the swapped-clear twin escaped on the player-2 entry — the clear target is unguarded");

  // (b) nonzero clear: the base cell keeps 0x99 instead of 0 — caught at the counter base.
  const cv = craft(base, 0x00);
  assert.equal(contractDiffs(cv, candidate).length, 0, "correct routine diverged on the clear-value setup");
  const cvDiffs = contractDiffs(cv, brokenClearValue);
  assert.ok(cvDiffs.length > 0, "the nonzero-clear twin escaped — the clear value is unchecked");
  assert.ok(cvDiffs[0].startsWith(`RAM@${hx(P1_SCORE)}`), `expected the clear-value diff at ${hx(P1_SCORE)}, got ${cvDiffs[0]}`);

  console.log(`  TEETH: swapped-clear caught (P1: ${swapP1[0]} | P2: ${swapP2[0]}); nonzero-clear caught (${cvDiffs[0]})`);
});
