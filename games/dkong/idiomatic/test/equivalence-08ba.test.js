// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for enterCreditScreen (ROM 0x08BA) — the credited-state sub-state-0
 * setup handler (accept the credit, compose the "PUSH START" screen, advance to the
 * wait-for-start sub-state, fall through into the start-button read).
 *
 * loc_08BA dispatches only while a game is CREDITED (game-state 2), which a plain
 * attract run never reaches, so this test DRIVES the machine: it inserts a coin on the
 * input tape (IN2 bit7) and captures the routine's real dispatch. Because 0x08BA itself
 * advances GAME_SUBSTATE off 0, it fires ONCE per credit episode (thereafter the
 * sub-state-1 handler loc_08F8 runs), so one real dispatch is captured — the natural
 * composition path. It WRITES MEMORY (ATTRACT, GAME_SUBSTATE, the task ring, the
 * tilemap/sprite buffer, and draw-frame VRAM) and its oracle ends by falling through
 * loc_08D5 whose `ret` returns for both, so it is gated on MEMORY-EQUIVALENCE — RAM
 * (−STACK_SCRATCH) + pc + SP — never the full register file, never cycles. LIVE-OUT is
 * memory-only: the sole consumer of the return, dispatchCreditedSubstate (0x08B2),
 * discards it. Every case runs on FRESH clones (the routine writes memory and its
 * callees kick the watchdog; nothing may be reused).
 *
 *   1. EQUAL (real driven dispatch) — insert one coin and capture the true 0x08BA
 *      entry on the first credited frame. The ORACLE and enterCreditScreen run on
 *      separate clones and must agree on RAM + pc + SP.
 *
 *   2. EQUAL (crafted callee arms) — the arms the single real dispatch does not force,
 *      poked IDENTICALLY on both sides from a real seed: readStartButtonSelector's draw
 *      frame ((FRAME&7)==0) for CREDITS==1 and CREDITS==2 (a different prompt string ->
 *      different VRAM), a skip frame, and enqueueTask's ring-WRAP (tail near 0xFE, ring
 *      free) and full-ring DROP (tail slot occupied) arms. Each must stay identical.
 *
 *   3. TEETH — two deliberately-broken twins the memory gate MUST catch:
 *      (a) no-advance: omits the GAME_SUBSTATE (0x600A) `inc` — caught at 0x600A.
 *      (b) wrong-task: posts arg 0x0D instead of 0x0C for the credit-screen text —
 *          caught in the task-ring byte the post writes (checked on a clean-ring seed
 *          so the post is guaranteed to land).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-08ba.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08ba as oracle } from "../../translated/loc_08ba.js";
import { enterCreditScreen } from "../enterCreditScreen.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { enqueueTask } from "../enqueueTask.js";
import { enqueueTaskBatch } from "../enqueueTaskBatch.js";
import { readStartButtonSelector } from "../readStartButtonSelector.js";
import { ATTRACT, GAME_SUBSTATE, CREDITS, FRAME, TASK_TAIL, TASK_RING, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x08ba;
const IN2 = 0x7d00;
const RING_LO = TASK_RING & 0xff; // 0xC0 — low byte of the first ring slot
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region the standard gate excludes. The oracle's push16/m.call/m.ret
 * (and the harness's terminal m.ret) touch only bytes at or below the entry SP, all
 * inside STACK_SCRATCH on the real NMI stack.
 */
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

/**
 * Run the ORACLE on a fresh clone. The oracle's internal calls (0x0874/0x309F/0x0965)
 * are stack-balanced by their manifest handlers and the tail call into loc_08D5 ends
 * in the one `ret` that pops loc_08BA's caller-return, so pc/SP advance by one pop.
 */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model the routine's own single caller-return
 * `ret` with one m.ret() so pc + SP line up with the oracle. The idiomatic routine
 * replaces the Z80 stack with the JS call stack, so it never touches pc/SP itself.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over RAM − the stack scratch below the entry SP, pc, and SP (memory-only live-out). */
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

// -- capture (driven: insert a coin to reach the credit screen) ----------------

/**
 * Insert `coins` coins on the input tape (each a 6-frame IN2-bit7 hold, MAME's coin
 * hold, spaced 40 frames), hook 0x08BA, and clone the machine at up to K real
 * dispatches. 0x08BA advances the sub-state off itself, so it fires once per credit
 * episode. The wrapper snapshots the entry state then runs the oracle so the host game
 * proceeds undisturbed.
 */
function captureDriven(K, maxFrames, coins) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.inputTape = [];
  for (let i = 0; i < coins; i++) host.inputTape.push({ port: IN2, bits: 0x80, frame: 150 + i * 40, dur: 6 });
  host.runFrames(maxFrames);
  return caps;
}

// -- teeth twins --------------------------------------------------------------

/** Broken twin: omits the GAME_SUBSTATE (0x600A) advance — sub-state never leaves 0. */
function teethNoAdvance(m) {
  const { regs, mem } = m;
  clearPlayfieldAndSprites(m);
  mem.write8(ATTRACT, 0);
  regs.de = 0x030c;
  enqueueTask(m);
  // BUG: the `inc (0x600a)` sub-state advance is missing.
  enqueueTaskBatch(m);
  mem.write8(0x7d86, 0);
  mem.write8(0x7d87, 0);
  readStartButtonSelector(m);
}

/** Broken twin: posts arg 0x0D instead of 0x0C for the credit-screen text task. */
function teethWrongTask(m) {
  const { regs, mem } = m;
  clearPlayfieldAndSprites(m);
  mem.write8(ATTRACT, 0);
  regs.de = 0x030d; // BUG: arg should be 0x0C, not 0x0D
  enqueueTask(m);
  mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 1) & 0xff);
  enqueueTaskBatch(m);
  mem.write8(0x7d86, 0);
  mem.write8(0x7d87, 0);
  readStartButtonSelector(m);
}

// -- 1. EQUAL (real driven dispatch) ------------------------------------------

test("EQUAL (real driven): enterCreditScreen == oracle on the real 0x08BA dispatch", () => {
  const caps = captureDriven(8, 1200, 1);
  assert.ok(caps.length >= 1, "expected at least one real 0x08BA dispatch after inserting a coin");

  for (const cap of caps) {
    assert.equal(cap.mem.read8(GAME_SUBSTATE), 0x00, "0x08BA should fire while GAME_SUBSTATE == 0 (its arm)");
    const diffs = contractDiffs(cap, enterCreditScreen); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${caps.length} real 0x08BA dispatch(es) identical (RAM + pc + SP)`);
});

// -- 2. EQUAL (crafted callee arms) -------------------------------------------

test("EQUAL (crafted): the callee arms the single real dispatch does not force stay identical", () => {
  const caps = captureDriven(1, 1200, 1);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // A real captured credited state, with the one variable each arm needs poked
  // (identically on both sides — contractDiffs clones the returned entry twice).
  const craft = (mutate) => {
    const e = seed.clone();
    e.regs.sp = 0x6bfe; // a clean work-RAM stack; the terminal ret pops inside STACK_SCRATCH
    mutate(e);
    return e;
  };

  const freeRing = (e) => { for (let i = 0; i < 0x40; i++) e.mem.write8((TASK_RING + i) & 0xffff, 0xff); };

  const cases = [
    { name: "draw frame, CREDITS=1 (prompt 0x09)", e: craft((e) => { e.mem.write8(CREDITS, 0x01); e.mem.write8(FRAME, 0x00); }) },
    { name: "draw frame, CREDITS=2 (prompt 0x0A -> different VRAM)", e: craft((e) => { e.mem.write8(CREDITS, 0x02); e.mem.write8(FRAME, 0x00); }) },
    { name: "skip frame ((FRAME&7)!=0)", e: craft((e) => { e.mem.write8(FRAME, 0x01); }) },
    { name: "enqueueTask WRAP (tail 0xFC, ring free)", e: craft((e) => { freeRing(e); e.mem.write8(TASK_TAIL, 0xfc); }) },
    { name: "enqueueTask full-ring DROP (tail slot occupied)", e: craft((e) => { e.mem.write8(TASK_TAIL, RING_LO); e.mem.write8(TASK_RING, 0x00); }) },
  ];
  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, enterCreditScreen);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} callee arms (draw/skip/credit-string/ring-wrap/ring-drop) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the no-advance and wrong-task twins are CAUGHT", () => {
  const caps = captureDriven(8, 1200, 1);
  assert.ok(caps.length >= 1, "need a real capture for the teeth twins");

  // (a) no-advance: caught at 0x600A on any real entry (GAME_SUBSTATE == 0 -> the
  // oracle's `inc` makes it 1; the twin leaves 0).
  let caughtNoAdvance = 0;
  let noAdvanceDiff = "";
  for (const cap of caps) {
    const diffs = contractDiffs(cap, teethNoAdvance);
    if (diffs.some((d) => d.startsWith(`RAM@0x${GAME_SUBSTATE.toString(16)}`))) { caughtNoAdvance++; noAdvanceDiff = diffs.join("; "); }
  }
  assert.ok(caughtNoAdvance >= 1, "the no-advance twin escaped the memory gate — 0x600A diff not detected");

  // (b) wrong-task: caught in the ring byte the credit-screen post writes. Use a
  // crafted clean-ring seed so the post is guaranteed to land (a full ring would drop
  // it on both, hiding the difference).
  const clean = caps[0].clone();
  clean.regs.sp = 0x6bfe;
  for (let i = 0; i < 0x40; i++) clean.mem.write8((TASK_RING + i) & 0xffff, 0xff); // free the ring
  clean.mem.write8(TASK_TAIL, RING_LO); // post lands at the first slot
  const wrongTaskDiffs = contractDiffs(clean, teethWrongTask);
  assert.ok(
    wrongTaskDiffs.some((d) => d.startsWith("RAM@")),
    `the wrong-task twin was not caught (diffs: ${wrongTaskDiffs.join("; ") || "none"})`,
  );

  console.log(
    `  TEETH: no-advance caught on ${caughtNoAdvance}/${caps.length} real dispatch(es) (${noAdvanceDiff}); ` +
      `wrong-task caught on the clean-ring seed (${wrongTaskDiffs.join("; ")})`,
  );
});
