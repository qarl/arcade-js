// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for powerOnInit (ROM 0x01C3) — game state 0: the one-time
 * power-on initialization. Clears the screen, seeds the score slots + baseline
 * (ATTRACT/LEVEL/LIVES), unpacks the dip switches, raises flip-screen, advances
 * GAME_STATE to attract + selects the 25m board, and posts the three opening tasks.
 *
 * handler_01c3 is dispatched by the vblank NMI (perFrame, ROM 0x00CA) through the
 * GAME_STATE table — and GAME_STATE is 0 ONLY at reset, so it fires exactly once,
 * at boot, off a plain power-on. It WRITES memory through five decompiled callees
 * (clearPlayfieldAndSprites, drawLivesAndLevel, decodeDipSwitches, draw1UpLabel,
 * enqueueTask). So it is gated by MEMORY-equivalence against the frozen oracle
 * (RAM − the stack scratch below the entry SP), with a FRESH clone per case — never the full register
 * file, never cycles:
 *
 *   1. REALISM (real power-on dispatch) — boot a plain machine, hook 0x01C3, and
 *      clone the machine at the single real dispatch. Run the ORACLE on one clone
 *      and powerOnInit on another and prove game-visible RAM (everything outside the
 *      dead STACK_SCRATCH) is byte-identical. The real entry has an empty ring
 *      (tail 0xC0, slots 0xFF), so it exercises the plain no-wrap post arm. The
 *      idiomatic routine models no stack, so it must also leave SP and pc unchanged
 *      from entry (the oracle's calls + `ret` leave only push residue in STACK_SCRATCH).
 *
 *   2. CRAFTED (ring states boot never mints) — from the real entry, poke the task
 *      ring IDENTICALLY on both sides into arms the single boot dispatch never reaches:
 *        - FULL: occupy the tail slot (bit 7 clear) so every post is dropped and the
 *          tail is left untouched — only the baseline + screen state change.
 *        - WRAP: set TASK_TAIL near the top (0xFC) so the 6-byte batch wraps 0xFF→0xC0
 *          mid-batch, pinning enqueueTask's wrap math across the whole batch.
 *      Each compared oracle vs idiomatic on RAM − the stack scratch below the entry SP. (This routine is
 *      straight-line — no branches — so the one real entry already covers the whole
 *      control path; the crafts only broaden the shared enqueue primitive.)
 *
 *   3. TEETH — two deliberately-broken twins the diff MUST catch: (a) one that skips
 *      the GAME_STATE advance (a boot that never leaves state 0 — a hung machine),
 *      caught at 0x6005; (b) one that posts a wrong task argument, caught in the ring.
 *      A gate a real corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-01c3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01c3 as oracle } from "../../translated/loc_01c3.js";
import { powerOnInit } from "../powerOnInit.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { drawLivesAndLevel } from "../drawLivesAndLevel.js";
import { decodeDipSwitches } from "../decodeDipSwitches.js";
import { draw1UpLabel } from "../draw1UpLabel.js";
import { enqueueTask } from "../enqueueTask.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x01c3;

// Work-RAM addresses this test reads/asserts on (kept local, like the sibling tests).
const GAME_STATE = 0x6005;
const ATTRACT = 0x6007;
const GAME_SUBSTATE = 0x600a;
const BOARD = 0x6227;
const LIVES = 0x6228;
const LEVEL = 0x6229;
const P1_SCORE = 0x60b2;
const TASK_TAIL = 0x60b0;
const RING_LO0 = 0x60c0; // ring slot 0 (low byte 0xC0)

// The three opening messages this handler posts, in order, as [opcode, argument].
const OPENING_TASKS = [
  [0x03, 0x04],
  [0x02, 0x02],
  [0x02, 0x00],
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM (work + sprite + video). Returns the first game-visible
 * difference (outside the stack scratch below the entry SP — a real failure) or null, plus a count of bytes
 * that differed inside the dead stack scratch (the oracle's push/`ret` residue, which
 * the idiomatic routine does not model — expected, tolerated, excluded).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry state through the oracle and a candidate on independent FRESH
 *  clones (the routine writes RAM), and return the diff + both post-run machines. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Boot a plain machine and clone it at each real 0x01C3 dispatch (capped at K).
 * GAME_STATE is 0 only at reset, so this fires exactly once early in the boot. The
 * wrapper clones the entry, then runs the oracle so the host boot proceeds to a clean
 * stop; capturing is gated off afterwards so the isolated replays cannot pollute it.
 */
function captureBootDispatches(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// -- 1. REALISM (real power-on dispatch) --------------------------------------

test("REALISM: powerOnInit == oracle on the real power-on dispatch", () => {
  const caps = captureBootDispatches(4, 30);
  assert.equal(caps.length, 1, "expected exactly one real 0x01C3 dispatch during boot");
  const entry = caps[0];

  const { b, bad } = replay(entry, powerOnInit);
  assert.equal(
    bad,
    null,
    bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
  );

  // No stack modelling: SP and pc unchanged from the captured entry.
  const c = entry.clone();
  const sp0 = c.regs.sp, pc0 = c.pc;
  powerOnInit(c);
  assert.equal(c.regs.sp, sp0, "must leave SP unchanged (no stack modelling)");
  assert.equal(c.pc, pc0, "must leave pc unchanged (no ret modelling)");

  // EQUAL is not vacuous: it actually seeded the baseline, advanced the state, and
  // posted the three tasks.
  assert.equal(b.mem.read8(GAME_STATE), 0x01, "GAME_STATE must advance to attract (1)");
  assert.equal(b.mem.read8(BOARD), 0x01, "BOARD must be selected as 25m (1)");
  assert.equal(b.mem.read8(GAME_SUBSTATE), 0x00, "GAME_SUBSTATE must be cleared to 0");
  assert.equal(b.mem.read8(ATTRACT), 0x01, "ATTRACT must be set to 1");
  assert.equal(b.mem.read8(LEVEL), 0x01, "LEVEL must be set to 1");
  assert.equal(b.mem.read8(LIVES), 0x01, "LIVES must be set to 1");
  // Score template 00 37 00 | aa aa aa | 50 76 00 copied into P1/P2/HIGH slots.
  assert.equal(b.mem.read8(P1_SCORE + 1), 0x37, "P1 score middle byte seeded from template");
  assert.equal(b.mem.read8(P1_SCORE + 4), 0xaa, "P2 score seeded from template (AAAAAA)");
  assert.equal(b.mem.read8(P1_SCORE + 6), 0x50, "HIGH score low byte seeded from template");
  // Three tasks posted from an empty ring at tail 0xC0.
  assert.equal(b.mem.read8(TASK_TAIL), (entry.mem.read8(TASK_TAIL) + 6) & 0xff, "tail advanced by 6");
  const tail0 = entry.mem.read8(TASK_TAIL);
  OPENING_TASKS.forEach(([op, arg], k) => {
    assert.equal(b.mem.read8(0x6000 | ((tail0 + k * 2) & 0xff)), op, `task ${k} opcode`);
    assert.equal(b.mem.read8(0x6000 | ((tail0 + k * 2 + 1) & 0xff)), arg, `task ${k} argument`);
  });

  console.log(`  REALISM: 1 real power-on dispatch — game-visible RAM identical to the oracle`);
});

// -- 2. CRAFTED (ring states boot never mints) --------------------------------

test("CRAFTED: matches the oracle across FULL-ring (all posts dropped) and WRAP arms", () => {
  const caps = captureBootDispatches(1, 30);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // Clear the whole ring to the empty marker (0xFF) so each craft controls it exactly.
  const clearRing = (mm) => { for (let l = 0xc0; l <= 0xff; l++) mm.mem.write8(0x6000 | l, 0xff); };

  const crafts = [
    // FULL: tail points at an OCCUPIED slot (bit 7 clear) → every post is dropped, tail
    // untouched; only the baseline + screen state change.
    ["full-ring", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, 0xee); mm.mem.write8(0x60ee, 0x00); }],
    // WRAP: tail near the top so the 6-byte batch runs past 0xFF and wraps to 0xC0.
    ["wrap", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, 0xfc); }],
    // Clean ring from the base, for good measure (the plain write arm, isolated).
    ["clean-base", (mm) => { clearRing(mm); mm.mem.write8(TASK_TAIL, RING_LO0 & 0xff); }],
  ];

  for (const [label, poke] of crafts) {
    const a = entry.clone(); const b = entry.clone();
    poke(a); poke(b);
    oracle(a);
    powerOnInit(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(`  CRAFTED/${label}: game-visible RAM identical to the oracle`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Both twins reproduce powerOnInit EXACTLY (same decompiled callees, proven equal to
 * the oracle's callees) except for a single injected defect, so the diff isolates to
 * exactly that defect's address.
 */

/** Broken twin A: does everything EXCEPT advance GAME_STATE — a boot stuck in state 0. */
function brokenSkipAdvance(m) {
  const { regs, mem } = m;
  clearPlayfieldAndSprites(m);
  for (let i = 0; i < 9; i++) mem.write8(P1_SCORE + i, mem.read8(0x01ba + i));
  regs.a = 1;
  mem.write8(ATTRACT, regs.a);
  mem.write8(LEVEL, regs.a);
  mem.write8(LIVES, regs.a);
  drawLivesAndLevel(m);
  decodeDipSwitches(m);
  mem.write8(0x7d82, 1);
  // BUG: skip `ld (GAME_STATE),a`.
  mem.write8(BOARD, 1);
  mem.write8(GAME_SUBSTATE, 0);
  draw1UpLabel(m);
  for (const [op, arg] of OPENING_TASKS) { regs.d = op; regs.e = arg; enqueueTask(m); }
}

/** Broken twin B: posts a wrong argument on the first task ([0x03,0x05] not [0x03,0x04]),
 *  otherwise identical — caught in the ring at that task's argument byte. */
function brokenWrongTask(m) {
  const { regs, mem } = m;
  clearPlayfieldAndSprites(m);
  for (let i = 0; i < 9; i++) mem.write8(P1_SCORE + i, mem.read8(0x01ba + i));
  regs.a = 1;
  mem.write8(ATTRACT, regs.a);
  mem.write8(LEVEL, regs.a);
  mem.write8(LIVES, regs.a);
  drawLivesAndLevel(m);
  decodeDipSwitches(m);
  mem.write8(0x7d82, 1);
  mem.write8(GAME_STATE, 1);
  mem.write8(BOARD, 1);
  mem.write8(GAME_SUBSTATE, 0);
  draw1UpLabel(m);
  for (const [op, arg] of [[0x03, 0x05], [0x02, 0x02], [0x02, 0x00]]) { regs.d = op; regs.e = arg; enqueueTask(m); }
}

test("TEETH: the skip-advance twin is CAUGHT and names 0x6005", () => {
  const caps = captureBootDispatches(1, 30);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");
  const { bad } = replay(caps[0], brokenSkipAdvance);
  assert.notEqual(bad, null, "the gate FAILED to catch a skipped GAME_STATE advance — it is worthless");
  assert.equal(bad.addr, GAME_STATE, `expected the caught diff at ${hx(GAME_STATE)}, got ${hx(bad.addr)}`);
  console.log(`  TEETH/skip-advance: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH: the wrong-task-byte twin is CAUGHT in the ring", () => {
  const caps = captureBootDispatches(1, 30);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");
  const entry = caps[0];
  const argSlot = 0x6000 | ((entry.mem.read8(TASK_TAIL) + 1) & 0xff); // first task's argument byte
  const { bad } = replay(entry, brokenWrongTask);
  assert.notEqual(bad, null, "the gate FAILED to catch a wrong posted task byte — it is worthless");
  assert.equal(bad.addr, argSlot, `expected the caught diff at ${hx(argSlot)}, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-task: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});
