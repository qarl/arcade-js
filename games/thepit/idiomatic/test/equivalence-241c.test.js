// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for erodeMountain (ROM 0x241c) — one frame-gated step of a
 * vertical tile-column animation, called every frame from the main loop.
 *
 * The routine's whole effect is memory: a step timer (0x8067), the tilemap write
 * cursor (0x8065), the tilemap cells it patches, the spawn phase (0x807b) and actor
 * height (0x810d / 0x811e) on the finalise arm, and the sound ring when it cues a
 * sound. Its declared live-out is MEMORY-ONLY, so the gate compares RAM + pc + SP,
 * not the value registers the oracle leaves behind (the honest-signature contract).
 *
 * ONE WRINKLE — the oracle reaches its sound cues through a Z80 `call`/tail-jump,
 * which parks a return address and the enqueue's two saved register pairs on the
 * stack (The Pit's stack is real diffed work RAM at 0x83ff down). That is up to six
 * dead bytes just below the entry stack pointer that the stack-free idiomatic JS does
 * not reproduce — classic dead stack scratch, overwritten before anything reads it —
 * so the RAM diff excludes exactly the [SP-8, SP) window and compares everything else
 * byte-for-byte. The idiomatic routine returns as a plain JS call, so the contract
 * does one m.ret() on the candidate after the run to line pc + SP up with the oracle
 * (which rets internally through its callee).
 *
 * COVERAGE. Attract dispatches 0x241c ~2400× / 3000 frames, exercising both early-exit
 * gates and the fill (tile 0x24/0x33), bump (0x2c-0x2f) and wall (0x30) step arms with
 * real states. The arms attract never presents — the 0xae fix-up, the 0x32 tile, the
 * loc_247a below-cell sub-arms, and the trigger-cell spawn finalise (swept over spawn
 * phase and actor height) — are covered by crafted entries: a real captured step state
 * with a surgical poke, applied identically on both sides.
 *
 * Checks:
 *   0. HARNESS — capture real 0x241c dispatches and confirm the oracle run of a step
 *      entry is deterministic (oracle vs oracle -> identical whole state).
 *   1. EQUAL (real dispatches) — erodeMountain == oracle over RAM (outside the stack scratch)
 *      + pc + SP across every captured dispatch, tallied by step arm.
 *   2. EQUAL (crafted arms) — every classify/finalise arm attract does not reach.
 *   3. TEETH (dropped timer store) — a twin that forgets to store the decremented timer
 *      on the countdown path is CAUGHT at the timer byte.
 *   4. TEETH (corrupted finalise) — a twin that writes the wrong spawn-phase value on
 *      the trigger cell is CAUGHT at the spawn-phase byte.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-241c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_241c as oracle } from "../../translated/loc_241c.js";
import { erodeMountain as idiomatic } from "../erodeMountain.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { PLAY_PHASE_COUNTER, BOARD_END_PHASE, ENEMY3_Y } from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x241c;
const STEP_TIMER = 0x8067; // per-step frame countdown
const WRITE_CURSOR = 0x8065; // 16-bit tilemap write pointer
const TRIGGER_CELL = 0x92a4; // finalise cell (the cursor lands here after one +32 step)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is
// async, so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/** Which arm a dispatch takes, read from the entry state (matches the routine's gates). */
function classify(mm) {
  const { mem } = mm;
  if (mem.read8(PLAY_PHASE_COUNTER) < 10) return "fcEarly";
  if (((mem.read8(STEP_TIMER) - 1) & 0xff) !== 0) return "timer";
  const cursor = mem.read16(WRITE_CURSOR) & 0xffff;
  return "STEP:" + hx(mem.read8(cursor));
}

/**
 * Hook 0x241c during attract and clone the machine at each dispatch. Keeps every STEP
 * entry (the interesting arms) and caps the two early-exit classes so the set stays
 * bounded. The wrapper snapshots then runs the oracle so attract proceeds undisturbed.
 */
function captureDispatches(maxFrames) {
  const entries = [];
  const counts = {};
  const CAP = 40; // per early-exit class
  const snapshot = new Map([[TARGET, (mm) => {
    const cls = classify(mm);
    counts[cls] = (counts[cls] || 0) + 1;
    if (cls.startsWith("STEP") || counts[cls] <= CAP) entries.push({ m: mm.clone(), cls });
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return { entries, counts };
}

/**
 * First differing RAM byte between two machines, EXCLUDING the up-to-six dead
 * stack-scratch bytes the oracle's call/enqueue parks just below the entry stack
 * pointer (the stack-free idiomatic JS does not reproduce them). Null when identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 8, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Compare a candidate against the oracle over the memory-equivalence contract for one
 * entry: RAM (outside the stack scratch) + pc + SP. Value registers are the declared-
 * dead live-out and excluded. The oracle rets internally; the candidate models its
 * return with one m.ret() so pc + SP line up. Returns { diffs, ram }.
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret();

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

/** A clone of `seed` with pokes applied, ready to hand to contractDiffs. */
function crafted(seed, poke) {
  const e = seed.clone();
  poke(e);
  return e;
}

/** Set up the trigger-cell finalise: put the cursor one row above 0x92a4 with an empty
 *  tile (routes straight to the fill), and stage the spawn phase / actor height. */
function finaliseSeed(mc, phase, actorY) {
  mc.mem.write16(WRITE_CURSOR, (TRIGGER_CELL - 32) & 0xffff); // +32 -> the trigger cell
  mc.mem.write8((TRIGGER_CELL - 32) & 0xffff, 0x24); // empty tile at the cursor
  mc.mem.write8(BOARD_END_PHASE, phase);
  if (actorY !== null) mc.mem.write8(ENEMY3_Y, actorY);
}

// One shared capture, reused across the checks below.
const CAP = ROM_PRESENT ? captureDispatches(1600) : { entries: [], counts: {} };
const stepEntry = CAP.entries.find((e) => e.cls.startsWith("STEP"));

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: real 0x241c dispatches are captured and the oracle step run is deterministic", () => {
  assert.ok(CAP.entries.length > 0, "expected 0x241c to be dispatched during attract");
  assert.ok(stepEntry, "expected at least one STEP dispatch (both gates open) in attract");

  const a = stepEntry.m.clone();
  oracle(a);
  const b = stepEntry.m.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  console.log(
    `  HARNESS: captured ${CAP.entries.length} dispatches ${JSON.stringify(CAP.counts)}; ` +
      `oracle step run deterministic (entry SP=${hx(stepEntry.m.regs.sp)})`,
  );
});

// -- 1. EQUAL on every captured real dispatch --------------------------------

test("EQUAL (real dispatches): erodeMountain == oracle over RAM + pc + SP", () => {
  const seen = {};
  for (const { m, cls } of CAP.entries) {
    const { diffs } = contractDiffs(m, idiomatic);
    assert.equal(diffs.length, 0, `${cls}: ${diffs.join("; ")}`);
    seen[cls] = (seen[cls] || 0) + 1;
  }
  const steps = Object.keys(seen).filter((k) => k.startsWith("STEP"));
  assert.ok(steps.length >= 3, `expected several step arms, saw ${JSON.stringify(steps)}`);
  console.log(`  EQUAL/real: ${CAP.entries.length} dispatches identical; arms ${JSON.stringify(seen)}`);
});

// -- 2. EQUAL across crafted arms attract never reaches ----------------------

test("EQUAL (crafted arms): every classify/finalise arm attract does not present", () => {
  assert.ok(stepEntry, "need a captured STEP entry to craft the arms from");
  const seed = stepEntry.m;

  const cases = [
    ["0xae fix-up above cursor", (mc) => {
      const cur = mc.mem.read16(WRITE_CURSOR) & 0xffff;
      mc.mem.write8((cur - 32) & 0xffff, 0xae);
    }],
    ["tile 0x32 -> fill", (mc) => {
      mc.mem.write8(mc.mem.read16(WRITE_CURSOR) & 0xffff, 0x32);
    }],
    ["wall 0x30, left not empty -> window shift", (mc) => {
      const cur = mc.mem.read16(WRITE_CURSOR) & 0xffff;
      mc.mem.write8(cur, 0x30);
      mc.mem.write8((cur - 1) & 0xffff, 0x33);
    }],
    ["wall 0x30, left empty, cell below open -> fill", (mc) => {
      const cur = mc.mem.read16(WRITE_CURSOR) & 0xffff;
      mc.mem.write8(cur, 0x30);
      mc.mem.write8((cur - 1) & 0xffff, 0x24);
      mc.mem.write8((cur + 32) & 0xffff, 0x24);
    }],
    ["wall 0x30, left empty, first below solid second open -> fill", (mc) => {
      const cur = mc.mem.read16(WRITE_CURSOR) & 0xffff;
      mc.mem.write8(cur, 0x30);
      mc.mem.write8((cur - 1) & 0xffff, 0x24);
      mc.mem.write8((cur + 32) & 0xffff, 0x33);
      mc.mem.write8((cur + 64) & 0xffff, 0x24);
    }],
    ["wall 0x30, left empty, column closed -> cap + reseed", (mc) => {
      const cur = mc.mem.read16(WRITE_CURSOR) & 0xffff;
      mc.mem.write8(cur, 0x30);
      mc.mem.write8((cur - 1) & 0xffff, 0x24);
      mc.mem.write8((cur + 32) & 0xffff, 0x33);
      mc.mem.write8((cur + 64) & 0xffff, 0x33);
    }],
    ["finalise, spawn phase 0", (mc) => finaliseSeed(mc, 0, null)],
    ["finalise, spawn phase 1, actor high enough", (mc) => finaliseSeed(mc, 1, 0x20)],
    ["finalise, spawn phase 1, actor too low", (mc) => finaliseSeed(mc, 1, 0x10)],
    ["finalise, spawn phase 2 (no-op)", (mc) => finaliseSeed(mc, 2, null)],
  ];

  for (const [name, poke] of cases) {
    const { diffs } = contractDiffs(crafted(seed, poke), idiomatic);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms identical (fix-up, 0x32, wall sub-arms, finalise sweep)`);
});

// -- 3. TEETH: a dropped timer store on the countdown path -------------------

/** Twin that forgets to store the decremented timer on the countdown path. */
function twinDropTimerStore(m) {
  const { mem } = m;
  if (mem.read8(PLAY_PHASE_COUNTER) < 10) return;
  if (mem.read8(STEP_TIMER) !== 1) return; // BUG: should store STEP_TIMER - 1 and return
  idiomatic(m); // the step frame is untouched, so only the countdown path breaks
}

test("TEETH (dropped timer store): a twin that skips the countdown store is CAUGHT", () => {
  assert.ok(stepEntry, "need a captured entry to seed the teeth check");
  const e = crafted(stepEntry.m, (mc) => mc.mem.write8(STEP_TIMER, 5)); // force the countdown path

  const { diffs, ram } = contractDiffs(e, twinDropTimerStore);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the dropped timer store — it proves nothing");
  assert.equal(ram && ram.addr, STEP_TIMER, `teeth caught ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(STEP_TIMER)})`);
  console.log(`  TEETH/timer: dropped store caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

// -- 4. TEETH: a corrupted finalise ------------------------------------------

/** Twin that writes the wrong spawn-phase value on the finalise arm. */
function twinCorruptFinalise(m) {
  idiomatic(m);
  m.mem.write8(BOARD_END_PHASE, 99); // BUG: finalise must mark the phase reached (== 2)
}

test("TEETH (corrupted finalise): a twin that writes the wrong spawn phase is CAUGHT", () => {
  assert.ok(stepEntry, "need a captured entry to seed the teeth check");
  const e = crafted(stepEntry.m, (mc) => finaliseSeed(mc, 0, null)); // route to the trigger cell

  const { diffs, ram } = contractDiffs(e, twinCorruptFinalise);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the corrupted finalise — it proves nothing");
  assert.equal(ram && ram.addr, BOARD_END_PHASE, `teeth caught ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(BOARD_END_PHASE)})`);
  console.log(`  TEETH/finalise: wrong spawn phase caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
