// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for beginWalkStep (ROM 0x1cc2) — the shared "begin a new walk
 * step" tail: store the walk sprite code, ring the footstep on alternate steps, re-arm
 * the sub-step timer, then tail into the sprite-record copy.
 *
 * The routine WRITES MEMORY (MARIO_SPRITE_CODE, MARIO_MOVE_STEP_TIMER, SND_TRIGGER[0] on
 * the footstep phase, and the four record bytes via writeMarioSpriteRecord) and ends by
 * tail-jumping into writeMarioSpriteRecord's `ret`, so it is gated on MEMORY-equivalence —
 * RAM (minus the stack scratch below the entry SP) + pc + SP — never on a register file (its live-out is
 * memory-only; see the routine header), and every case runs on a FRESH clone (a reused
 * clone is only safe for a read-only leaf; this writes).
 *
 * The idiomatic routine calls its two callees (triggerWalkSound 0x1d8f, and the tail
 * writeMarioSpriteRecord 0x1da6) as direct JS functions and never touches pc/SP itself.
 * The oracle reaches them by `call`/`jp` whose only NET stack effect is the single tail
 * `ret` (the conditional footstep call pushes and pops symmetrically), so the harness
 * performs ONE m.ret() on the candidate clone after the call to line pc + SP up with the
 * oracle — exactly the writeMarioSpriteRecord (0x1da6) pattern.
 *
 *   1. EQUAL (real dispatches) — hook 0x1cc2 in a real attract run (the 25m demo walks
 *      Mario, so the walk stepper reaches its new-step tail here) and clone at each true
 *      dispatch; oracle vs candidate agree on RAM + pc + SP for every one. Both arms occur
 *      naturally (footstep when the walk-cycle low bit is set, silent otherwise).
 *   2. EQUAL (crafted, both arms) — from a real seed, force the footstep arm (sprite code
 *      low bit 1) and the silent arm (low bit 0), each with SND_TRIGGER[0] / the timer /
 *      the record pre-set to sentinels, and confirm identical + the concrete effects
 *      (sprite-code store, footstep routing, timer reload).
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) inverted footstep phase — rings on the silent step, silent on the footstep
 *          step; diverges on SND_TRIGGER[0].
 *      (b) dropped timer reload — never re-arms MARIO_MOVE_STEP_TIMER; diverges on 0x620F.
 *      (c) skipped sprite refresh — never copies the live fields into the record;
 *          diverges on 0x694C..0x694F.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1cc2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1cc2 as oracle } from "../../translated/loc_1cc2.js";
import { beginWalkStep } from "../beginWalkStep.js";
import { triggerWalkSound } from "../triggerWalkSound.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_SPRITE_CODE, MARIO_MOVE_STEP_TIMER, SND_TRIGGER,
  MARIO_X, MARIO_Y, MARIO_SPRITE_ATTR, MARIO_SPRITE_RECORD,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1cc2;
const FRAMES = 1000; // first natural dispatch is ~frame 634; window spans both arms
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 *  region (the oracle's pushes/pops and its tail `ret` all land there; the idiomatic
 *  routine uses the JS call stack, so excluding it is the contract, not a fudge). */
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

/** Run the ORACLE on a fresh clone; its callees + tail `ret` advance pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single net return with ONE m.ret()
 *  so pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the
 *  JS call stack and never touches pc/SP; the harness supplies the one net tail return). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO
 *  registers — the live-out is memory-only. Returns human-readable mismatches. */
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

/** Hook 0x1cc2 in a real attract run and clone the machine at up to K real dispatches.
 *  The wrapper snapshots the entry state, then runs the oracle so the host proceeds. */
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

/** A real captured state with chosen bytes poked + a safe SP (its tail `ret` pops from
 *  STACK_SCRATCH, well clear of work RAM). `a` is the sprite-code byte the walk arm hands
 *  over; its low bit selects the footstep arm. */
function craft(seed, { a, snd, timer, record, x, code, attr, y }) {
  const e = seed.clone();
  if (a !== undefined) e.regs.a = a;
  if (snd !== undefined) e.mem.write8(SND_TRIGGER, snd);
  if (timer !== undefined) e.mem.write8(MARIO_MOVE_STEP_TIMER, timer);
  if (x !== undefined) e.mem.write8(MARIO_X, x);
  if (code !== undefined) e.mem.write8(MARIO_SPRITE_CODE, code);
  if (attr !== undefined) e.mem.write8(MARIO_SPRITE_ATTR, attr);
  if (y !== undefined) e.mem.write8(MARIO_Y, y);
  if (record !== undefined) for (let i = 0; i < 4; i++) e.mem.write8(MARIO_SPRITE_RECORD + i, record);
  e.regs.sp = 0x6bfe;
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** (a) footstep on the WRONG phase — rings on the silent step, silent on the footstep
 *  step. Everything else verbatim. */
function brokenInvertedFootstep(m) {
  const { regs, mem } = m;
  const spriteCode = regs.a;
  mem.write8(MARIO_SPRITE_CODE, spriteCode);
  if ((spriteCode & 1) === 0) triggerWalkSound(m); // BUG: inverted phase
  mem.write8(MARIO_MOVE_STEP_TIMER, 2);
  return writeMarioSpriteRecord(m);
}

/** (b) dropped timer reload — never re-arms MARIO_MOVE_STEP_TIMER. */
function brokenDropTimerReload(m) {
  const { regs, mem } = m;
  const spriteCode = regs.a;
  mem.write8(MARIO_SPRITE_CODE, spriteCode);
  if ((spriteCode & 1) === 1) triggerWalkSound(m);
  // BUG: no MARIO_MOVE_STEP_TIMER write
  return writeMarioSpriteRecord(m);
}

/** (c) skipped sprite refresh — never copies the live fields into the record. */
function brokenSkipRecord(m) {
  const { regs, mem } = m;
  const spriteCode = regs.a;
  mem.write8(MARIO_SPRITE_CODE, spriteCode);
  if ((spriteCode & 1) === 1) triggerWalkSound(m);
  mem.write8(MARIO_MOVE_STEP_TIMER, 2);
  // BUG: no writeMarioSpriteRecord(m)
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): beginWalkStep == oracle on every captured 0x1cc2 entry", () => {
  const caps = captureDispatches(256, FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x1cc2 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, beginWalkStep); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const footstep = caps.filter((c) => (c.regs.a & 1) === 1).length;
  const silent = caps.length - footstep;
  assert.ok(footstep >= 1 && silent >= 1, `both arms must occur (footstep ${footstep}, silent ${silent})`);
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(footstep arm ${footstep}, silent arm ${silent})`,
  );
});

// -- 2. EQUAL (crafted, both arms) --------------------------------------------

test("EQUAL (crafted): both arms identical + concrete effects (sprite code, footstep, timer)", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [
    { name: "footstep arm (low bit 1)", a: 0x81, snd: 0xaa, sound: true },
    { name: "silent arm (low bit 0)", a: 0x80, snd: 0xaa, sound: false },
  ];
  for (const { name, a, snd, sound } of cases) {
    const e = craft(seed, { a, snd, timer: 0xaa });
    const diffs = contractDiffs(e, beginWalkStep);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Concrete behaviour on the candidate: sprite-code store, footstep routing, reload.
    const c = runCandidate(e, beginWalkStep);
    assert.equal(c.mem.read8(MARIO_SPRITE_CODE), a, `${name}: stores the sprite-code byte`);
    assert.equal(c.mem.read8(MARIO_MOVE_STEP_TIMER), 2, `${name}: reloads MARIO_MOVE_STEP_TIMER = 2`);
    assert.equal(c.mem.read8(SND_TRIGGER), sound ? 3 : 0xaa, `${name}: footstep routing (SND_TRIGGER[0])`);
  }
  console.log("  EQUAL/crafted: footstep + silent arms identical; sprite-code/timer/footstep pinned");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: inverted footstep, dropped timer reload, and skipped sprite refresh are CAUGHT", () => {
  const caps = captureDispatches(1, FRAMES);
  assert.ok(caps.length >= 1, "need a real capture for the teeth check");
  const seed = caps[0];

  // (a) inverted footstep — caught on BOTH arms with SND_TRIGGER[0] pre-dirtied to 0xAA.
  for (const [arm, a] of [["footstep", 0x81], ["silent", 0x80]]) {
    const e = craft(seed, { a, snd: 0xaa });
    const d = contractDiffs(e, brokenInvertedFootstep);
    assert.ok(d.length > 0, `inverted footstep escaped on the ${arm} arm — the gate is worthless`);
  }

  // (b) dropped timer reload — caught with MARIO_MOVE_STEP_TIMER pre-dirtied to 0xAA.
  const dTimer = contractDiffs(craft(seed, { a: 0x80, timer: 0xaa }), brokenDropTimerReload);
  assert.ok(dTimer.length > 0, "dropped timer reload escaped — the gate is worthless");

  // (c) skipped sprite refresh — caught with the record pre-set to 0xEE and the live
  //     source fields distinct, so the correct refresh visibly changes the record.
  const dRecord = contractDiffs(
    craft(seed, { a: 0x80, record: 0xee, x: 0x11, code: 0x22, attr: 0x33, y: 0x44 }),
    brokenSkipRecord,
  );
  assert.ok(dRecord.length > 0, "skipped sprite refresh escaped — the gate is worthless");

  console.log(
    `  TEETH: inverted footstep caught on both arms; dropped timer caught (${dTimer[0]}); ` +
      `skipped refresh caught (${dRecord[0]})`,
  );
});
