// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for continueWalkStep (ROM 0x1ceb) — the in-progress walk-step
 * continuation: decrement Mario's sub-step timer (MARIO_MOVE_STEP_TIMER, 0x620F), then
 * tail into the sprite-record copy.
 *
 * The routine WRITES MEMORY (the timer, then the four record bytes via
 * writeMarioSpriteRecord) and ends by tail-jumping into writeMarioSpriteRecord's `ret`,
 * so it is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never on a
 * register file (its live-out is memory-only; see the routine header), and every case runs
 * on a FRESH clone (a reused clone is only safe for a read-only leaf; this writes).
 *
 * The idiomatic routine calls its tail callee (writeMarioSpriteRecord 0x1da6) as a direct
 * JS function and never touches pc/SP itself. The oracle reaches it by a tail `jp` whose
 * only NET stack effect is the single `ret`, so the harness performs ONE m.ret() on the
 * candidate clone after the call to line pc + SP up with the oracle — the same pattern as
 * the writeMarioSpriteRecord (0x1da6) test.
 *
 *   1. EQUAL (real dispatches) — hook 0x1ceb in a real attract run (the 25m demo walks
 *      Mario, so advanceMarioWalkX's tail dispatches here each in-progress move frame) and clone at
 *      each true dispatch; oracle vs candidate agree on RAM + pc + SP for every one. One
 *      straight-line arm, so real captures ARE its full behavioural coverage, varying the
 *      live 0x620F value the decrement acts on.
 *   2. EQUAL (crafted timer values) — from a real seed, drive the timer at 0x00 (the
 *      0 -> 255 wrap — a hardcoded 0 or a wrong wrap is caught here), 0x01 and 0x05, each
 *      compared identically both sides and asserted decremented on the candidate.
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a wrong timer store (value XOR 0xff) — diverges on 0x620F.
 *      (b) a skipped sprite refresh — never copies the live fields into the record;
 *          diverges on 0x694C..0x694F.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1ceb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1ceb as oracle } from "../../translated/loc_1ceb.js";
import { continueWalkStep } from "../continueWalkStep.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_X, MARIO_MOVE_STEP_TIMER, MARIO_SPRITE_RECORD,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1ceb;
const FRAMES = 800; // first natural dispatch is ~frame 620
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 *  region (the oracle's tail `ret` pops from there; the idiomatic routine uses the JS
 *  call stack, so excluding it is the contract, not a fudge). */
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

/** Run the ORACLE on a fresh clone; its tail `ret` advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single net return with ONE m.ret()
 *  so pc + SP match the oracle's. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/** Hook 0x1ceb in a real attract run and clone the machine at up to K real dispatches. */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** A real captured state with 0x620F set to `timer` + a safe SP (the tail `ret` pops from
 *  STACK_SCRATCH, well clear of work RAM). */
function craft(seed, timer) {
  const e = seed.clone();
  e.mem.write8(MARIO_MOVE_STEP_TIMER, timer);
  e.regs.sp = 0x6bfe;
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** (a) wrong timer store — lands (value XOR 0xff), guaranteed to differ, then the correct
 *  tail, so only the timer store differs from the oracle. */
function brokenWrongTimer(m) {
  const { mem } = m;
  mem.write8(MARIO_MOVE_STEP_TIMER, (mem.read8(MARIO_MOVE_STEP_TIMER) - 1) ^ 0xff); // BUG
  return writeMarioSpriteRecord(m);
}

/** (b) skipped sprite refresh — decrements the timer but never copies the record. */
function brokenSkipRecord(m) {
  const { mem } = m;
  mem.write8(MARIO_MOVE_STEP_TIMER, mem.read8(MARIO_MOVE_STEP_TIMER) - 1);
  // BUG: no writeMarioSpriteRecord(m)
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): continueWalkStep == oracle on every captured 0x1ceb entry", () => {
  const caps = captureDispatches(256, FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x1ceb dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, continueWalkStep); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const timers = new Set(caps.map((c) => hx(c.mem.read8(MARIO_MOVE_STEP_TIMER))));
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(distinct 0x620F values: ${timers.size})`,
  );
});

// -- 2. EQUAL (crafted timer values) ------------------------------------------

test("EQUAL (crafted): timer 0x00 (0->255 wrap), 0x01 and 0x05 identical + decremented", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  for (const timer of [0x00, 0x01, 0x05]) {
    const e = craft(seed, timer);
    const diffs = contractDiffs(e, continueWalkStep);
    assert.equal(diffs.length, 0, `timer=${hx(timer)}: ${diffs.join("; ")}`);

    const c = runCandidate(e, continueWalkStep);
    assert.equal(
      c.mem.read8(MARIO_MOVE_STEP_TIMER), (timer - 1) & 0xff,
      `timer=${hx(timer)}: must decrement to ${hx((timer - 1) & 0xff)}`,
    );
  }
  console.log("  EQUAL/crafted: 0x00 wrap-to-255, 0x01->0x00, 0x05->0x04 identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong timer store and a skipped sprite refresh are CAUGHT", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need a real capture for the teeth check");
  const seed = caps[0];

  // (a) wrong timer store — caught on a plain timer value.
  const dTimer = contractDiffs(craft(seed, 0x05), brokenWrongTimer);
  assert.ok(dTimer.length > 0, "wrong timer store escaped — the gate is worthless");
  assert.ok(dTimer[0].startsWith(`RAM@0x${MARIO_MOVE_STEP_TIMER.toString(16)}`),
    `expected the timer address to be the first diff, got ${dTimer[0]}`);

  // (b) skipped sprite refresh — the mover's tail refreshes the record from live fields;
  //     skipping it strands whatever the record held. Force record byte +0 distinct from
  //     its live source (MARIO_X) so the correct refresh visibly changes it.
  const skipEntry = craft(seed, 0x05);
  skipEntry.mem.write8(MARIO_SPRITE_RECORD, skipEntry.mem.read8(MARIO_X) ^ 0xff);
  const dRecordCrafted = contractDiffs(skipEntry, brokenSkipRecord);
  assert.ok(dRecordCrafted.length > 0, "skipped sprite refresh escaped on the crafted entry — worthless");

  console.log(`  TEETH: wrong timer caught (${dTimer[0]}); skipped refresh caught (${dRecordCrafted[0]})`);
});
