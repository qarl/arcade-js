// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for awardTenPoints (ROM 0x467b) — the +10 score-award entry:
 * it plays the score sound (command 16) and hands a packed-decimal +10 to the shared
 * score adder, which bumps the active player's two-byte score and repaints the digits.
 *
 * WHY CRAFTED-ENTRY. The attract demo never awards +10 — 0x467b is never dispatched or
 * m.call'd across a 1400-frame attract run (its +20 sibling and other sources drive the
 * demo's scoring). unitEquivalence, which captures the machine at a real dispatch of the
 * target, therefore cannot reach it; test 0 pins that down. So the gate instead captures
 * real attract states (at the per-frame service) and runs 0x467b's entry from them, with
 * the active-player mode byte poked identically on both sides to reach each path — the
 * doc's crafted-entry technique for an arm attract never runs.
 *
 * THE CONTRACT is memory-equivalence, not the full register file: RAM outside the dead
 * stack scratch, ALONE. The declared live-out is memory-only — the packed-decimal score
 * bytes, the repainted digit cells, and the queued sound command — so pc, SP, and the
 * value registers and flags the oracle leaves behind are excluded. The dissolve replaced
 * the oracle's m.call(0x4689) tail-jump with a direct addScore(m, 0x0010) call, so the
 * idiomatic award leaves pc at its entry value and SP below the oracle's; that is the
 * routine's dead ABI, not its live-out, and is not compared.
 *
 * THE STACK SCRATCH. The oracle's own return-address push plus the sound routine's two
 * register saves leave six dead bytes just below the entry stack pointer that the
 * stack-lean idiomatic path does not reproduce. Both sides then run the identical shared
 * adder, so that six-byte window [entrySP-6, entrySP) is the only benign difference — it
 * is excluded, and every real write (score, digits, sound ring) lands well above it.
 *
 * Six checks:
 *   0. UNREACHED — unitEquivalence cannot capture 0x467b in attract (never entered),
 *      which is exactly why the gate is crafted-entry rather than real-dispatch.
 *   1. IDENTITY — the crafted-entry harness reports EQUAL when both arms are the oracle,
 *      proving it can report equal (a gate that never does is worthless in the other
 *      direction).
 *   2. EQUAL (active-player add path) — with the mode byte forced active (1, then 2),
 *      idiomatic == oracle over the contract; the score gains packed-decimal 10 and the
 *      sound ring slot holds command 16 (pending).
 *   3. EQUAL (inactive skip path) — with the mode byte forced inactive (0, then 3),
 *      idiomatic == oracle; the score is untouched but the sound is still queued.
 *   4. TEETH (wrong sound / wrong increment) — a twin that queues the wrong sound
 *      command, and one that adds +20 instead of +10, are both CAUGHT.
 *   5. TEETH (dropped add) — a twin that plays the sound but never adds to the score is
 *      CAUGHT at the score byte.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-467b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_467b as oracle } from "../../translated/loc_467b.js";
import { loc_0066 as nmiOracle } from "../../translated/loc_0066.js";
import { awardTenPoints } from "../awardTenPoints.js";
import { requestSound16 } from "../requestSound16.js";
import { enqueueSoundCommand } from "../enqueueSoundCommand.js";
import { makeMachineFactory } from "../../machine.js";
import { unitEquivalence, deadStackBelow } from "../../../../core/equivalence.js";
import { SOUND_HEAD, SOUND_RING, GAME_STATE } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x467b;
const NMI = 0x0066;
const SCORE_LOW = 0x8031; // low byte of the two-byte packed-decimal score (not yet named in names.js)
const COMMAND = 16; // the sound command this entry queues (requestSound16 / ROM 0x4c8f)
const PENDING = COMMAND | 0x80; // 0x90 — the byte the ring slot must end up holding (command + pending bit)
const STACK_SCRATCH = 6; // dead bytes below entry SP: the oracle's own push (2) + the sound save (4)
const CAP_FRAMES = 1400;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- capture ------------------------------------------------------------------

/** Sample realistic attract machine states at the per-frame service (single run — no NMI-timing skew). */
function captureAttractStates(K, maxFrames) {
  const caps = [];
  let ticks = 0;
  const snapshot = new Map([[NMI, (mm) => {
    ticks += 1;
    if (ticks % 97 === 0 && caps.length < K) caps.push(mm.clone());
    return nmiOracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return caps;
}

// -- the memory-equivalence contract ------------------------------------------

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack scratch just
 * below the entry stack pointer (the oracle's return-address push + the sound routine's
 * register saves, which the stack-lean idiomatic path does not reproduce). Null otherwise.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Compare a candidate against the oracle over the memory contract (RAM outside the dead
 * stack scratch) for one entry. pc, SP and the value registers are NOT compared — the
 * dissolved award adds the score with a direct addScore(m, 0x0010) call instead of the
 * oracle's m.call(0x4689) tail-jump, so it leaves pc at its entry value and SP two below
 * the oracle's; those are the routine's dead ABI, not its live-out. Returns { diffs, ram }.
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return { diffs, ram };
}

// -- broken twins -------------------------------------------------------------

/** BUG: queues the WRONG sound command (17, a real neighbouring stub's payload). */
function twinWrongSound(m) {
  enqueueSoundCommand(m, 17);
  m.regs.bc = 0x0010;
  return m.call(0x4689);
}

/** BUG: adds +20 (packed decimal 0x0020) instead of +10. */
function twinWrongIncrement(m) {
  requestSound16(m);
  m.regs.bc = 0x0020;
  return m.call(0x4689);
}

/** BUG: plays the sound but never adds to the score (the adder is skipped entirely). */
function twinDroppedAdd(m) {
  requestSound16(m);
}

// -- 0. UNREACHED: 0x467b never dispatches in attract -------------------------

test("UNREACHED: unitEquivalence cannot capture 0x467b in attract (so the gate is crafted-entry)", () => {
  assert.throws(
    () => unitEquivalence(makeMachine, TARGET, oracle, awardTenPoints, { maxFrames: CAP_FRAMES }),
    /never entered/,
    "expected 0x467b to be never dispatched/m.call'd in attract — if it now is, prefer a real-dispatch gate",
  );
  console.log("  UNREACHED: 0x467b never entered in a 1400-frame attract run — crafted-entry gate it is");
});

// -- 1. IDENTITY: the crafted-entry harness reports EQUAL for identical arms ----

test("IDENTITY: crafted-entry harness reports EQUAL when both arms are the oracle", () => {
  const caps = captureAttractStates(6, CAP_FRAMES);
  assert.ok(caps.length >= 3, `expected several captured attract states, got ${caps.length}`);
  for (const cap of caps) {
    const { diffs } = contractDiffs(cap, oracle); // oracle vs oracle
    assert.equal(diffs.length, 0, "identity must be EQUAL: " + diffs.join("; "));
  }
  console.log(`  IDENTITY: oracle vs oracle EQUAL over ${caps.length} captured attract states`);
});

// -- 2. EQUAL: active-player add path ------------------------------------------

test("EQUAL (active-player add path): awardTenPoints == oracle; score gains 10; sound 16 queued", () => {
  const caps = captureAttractStates(14, CAP_FRAMES);
  assert.ok(caps.length >= 4, `expected several captured attract states, got ${caps.length}`);

  for (const active of [1, 2]) {
    for (const cap of caps) {
      const entry = cap.clone();
      entry.mem.write8(GAME_STATE, active); // force an active player so the add lands
      const head = entry.mem.read8(SOUND_HEAD);
      const before = entry.mem.read8(SCORE_LOW);

      const { diffs } = contractDiffs(entry, awardTenPoints);
      assert.equal(diffs.length, 0, `mode ${active}: ${diffs.join("; ")}`);

      // Positive: the score's low byte advanced (the +10 landed) and the sound is queued.
      const c = entry.clone();
      awardTenPoints(c);
      assert.notEqual(c.mem.read8(SCORE_LOW), before, `mode ${active}: the +10 did not land on the score`);
      assert.equal(
        c.mem.read8(SOUND_RING + head),
        PENDING,
        `mode ${active}: ring slot ${head} not filled with the pending sound command 16`,
      );
    }
  }
  console.log(`  EQUAL/add: modes 1 & 2 over ${caps.length} states — identical RAM; score +10; sound 16 pending`);
});

// -- 3. EQUAL: inactive skip path ----------------------------------------------

test("EQUAL (inactive skip path): awardTenPoints == oracle; score untouched; sound still queued", () => {
  const caps = captureAttractStates(14, CAP_FRAMES);
  assert.ok(caps.length >= 4, `expected several captured attract states, got ${caps.length}`);

  for (const inactive of [0, 3]) {
    for (const cap of caps) {
      const entry = cap.clone();
      entry.mem.write8(GAME_STATE, inactive); // no active player -> the adder skips the add
      const head = entry.mem.read8(SOUND_HEAD);
      const before = entry.mem.read8(SCORE_LOW);

      const { diffs } = contractDiffs(entry, awardTenPoints);
      assert.equal(diffs.length, 0, `mode ${inactive}: ${diffs.join("; ")}`);

      const c = entry.clone();
      awardTenPoints(c);
      assert.equal(c.mem.read8(SCORE_LOW), before, `mode ${inactive}: the score must be untouched on the skip path`);
      assert.equal(
        c.mem.read8(SOUND_RING + head),
        PENDING,
        `mode ${inactive}: the sound is queued even when the score is skipped`,
      );
    }
  }
  console.log(`  EQUAL/skip: modes 0 & 3 over ${caps.length} states — identical RAM; score untouched; sound 16 pending`);
});

// -- 4. TEETH: wrong sound / wrong increment -----------------------------------

test("TEETH (wrong sound / wrong increment): both twins are CAUGHT", () => {
  const caps = captureAttractStates(6, CAP_FRAMES);
  assert.ok(caps.length >= 1, "need a capture to seed the teeth check");
  const seed = caps[0].clone();
  seed.mem.write8(GAME_STATE, 1); // active player so the score path is exercised
  const head = seed.mem.read8(SOUND_HEAD);

  const soundRes = contractDiffs(seed, twinWrongSound);
  assert.ok(soundRes.diffs.length > 0, "the gate FAILED to catch the wrong-sound twin — it proves nothing");
  assert.equal(
    soundRes.ram && soundRes.ram.addr,
    SOUND_RING + head,
    `wrong-sound twin caught at ${soundRes.ram ? hx(soundRes.ram.addr) : "(none)"} (expected ${hx(SOUND_RING + head)})`,
  );

  const incRes = contractDiffs(seed, twinWrongIncrement);
  assert.ok(incRes.diffs.length > 0, "the gate FAILED to catch the wrong-increment twin — it proves nothing");
  assert.equal(
    incRes.ram && incRes.ram.addr,
    SCORE_LOW,
    `wrong-increment twin caught at ${incRes.ram ? hx(incRes.ram.addr) : "(none)"} (expected ${hx(SCORE_LOW)})`,
  );

  console.log(`  TEETH: wrong-sound caught at ${hx(soundRes.ram.addr)}; wrong-increment caught at ${hx(incRes.ram.addr)}`);
});

// -- 5. TEETH: dropped add -----------------------------------------------------

test("TEETH (dropped add): a twin that never adds to the score is CAUGHT at the score byte", () => {
  const caps = captureAttractStates(6, CAP_FRAMES);
  assert.ok(caps.length >= 1, "need a capture to seed the teeth check");
  const seed = caps[0].clone();
  seed.mem.write8(GAME_STATE, 1); // active player so the oracle really adds

  const res = contractDiffs(seed, twinDroppedAdd);
  assert.ok(res.diffs.length > 0, "the gate FAILED to catch the dropped-add twin — it proves nothing");
  assert.equal(
    res.ram && res.ram.addr,
    SCORE_LOW,
    `dropped-add twin caught at ${res.ram ? hx(res.ram.addr) : "(none)"} (expected ${hx(SCORE_LOW)})`,
  );
  console.log(`  TEETH: dropped-add twin caught at ${hx(res.ram.addr)} (oracle=${res.ram.a} broken=${res.ram.b})`);
});
