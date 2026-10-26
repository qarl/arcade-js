// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceBoardStepWhenSpritesCleared (ROM 0x1757) — the
 * board-advance "arm the next arm once the sprites are gone" step.
 *
 * The routine WRITES MEMORY (via its two sprite passes, and — on the clear arm —
 * SUBSTATE_TIMER 0x6009 and the 0x6388 sequence selector) and has TWO exit arms
 * (clear -> advance via its own `ret`; not-clear -> abort via allSlotsClear's
 * caller-skip). It is gated on MEMORY-EQUIVALENCE — RAM (minus the stack scratch below the entry SP) + pc +
 * SP — against the frozen oracle, and every case runs on a FRESH clone (a reused
 * clone is only safe for a read-only leaf). LIVE-OUT is MEMORY-ONLY: the successor
 * (dispatchBoardClearedInterlude's rst-0x28 tail, a plain `ret`) reads no register or flag, so the
 * oracle's residual A/HL/F are dead ABI and are NOT compared. Both oracle exit arms
 * land at SP+2 / pc = word@SP; the candidate reaches the same via the JS call stack
 * plus one harness-supplied closing `ret`.
 *
 * Its three callees are already-decompiled idiomatic primitives the routine calls
 * directly; the oracle reaches the same behaviour through the translated table, so any
 * diff is this routine's own glue — the sprite passes' ORDER and the pointer advance.
 *
 * REACHABILITY: 0x1757 is NOT reached in attract — a real run dispatches it ZERO
 * times (measured 0 / 2000 frames; its board-advance caller never runs in attract).
 * So there are no real captures of 0x1757 to replay. This is a CRAFTED-ENTRY gate:
 * seed from REAL captured RAM — hooked at the sibling 0x003d, which fires during
 * board setup with the 0x6908 sprite-object block populated — then drive both arms.
 *
 *   1. EQUAL (clear arm) — all ten X bytes zeroed so the block scans clear; confirms
 *      the advance side (SUBSTATE_TIMER = 0x40, 0x6388 incremented), over both animate
 *      phases (fire and no-fire).
 *   2. EQUAL (not-clear arm) — a record left occupied so the scan aborts; confirms the
 *      caller-skip side (no advance), over both animate phases.
 *   3. EQUAL (phase sweep, all 256) — over one clear entry, sweep the 0x62AF phase
 *      counter across every value so animateSpriteObjectBlock's 1-in-8 body runs and
 *      does not (and its RNG stir + block edits) all match the oracle.
 *   4. EQUAL (real captured seeds, unmodified) — real board-setup states run as-is
 *      (their X bytes are naturally nonzero, so they exercise the not-clear arm on
 *      real data).
 *   5. TEETH (wrong timer value) — a twin arming 0x6009 = 0x41 MUST be caught on a
 *      clear entry.
 *   6. TEETH (skipped selector increment) — a twin that omits the 0x6388 `inc` MUST
 *      be caught on a clear entry.
 *   7. TEETH (dropped pointer-advance) — a twin that omits `inc hl / inc de` and scans
 *      allSlotsClear(0x6907, 3) MUST be caught: on a crafted clear entry with a nonzero
 *      byte on the wrong stride, its decision flips to not-clear and it fails to advance.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1757.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1757 as oracle } from "../../translated/loc_1757.js";
import { advanceBoardStepWhenSpritesCleared } from "../advanceBoardStepWhenSpritesCleared.js";
import { animateSpriteObjectBlock } from "../animateSpriteObjectBlock.js";
import { cullSpriteObjectsAtTop } from "../cullSpriteObjectsAtTop.js";
import { allSlotsClear } from "../allSlotsClear.js";
import { Machine } from "../../machine.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK, SUBSTATE_TIMER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const SEED_TARGET = 0x003d; // sibling hooked during board setup to obtain live block RAM
const SEQUENCE_SELECTOR = 0x6388; // board-advance sequence index
const PHASE_COUNTER = 0x62af; // animateSpriteObjectBlock's private 1-in-8 counter
const RECORD_COUNT = 10;
const recX = (i) => SPRITE_OBJ_BLOCK + i * 4; // +0 X
const recY = (i) => SPRITE_OBJ_BLOCK + i * 4 + 3; // +3 Y
const SAFE_SP = 0x6bfe; // stack pointer in STACK_SCRATCH so both sides' `ret` pop harmless bytes
const PHASE_NOFIRE = 0x00; // (0+1)&7 != 0 -> animate returns early
const PHASE_FIRE = 0x07; // (7+1)&7 == 0 -> animate runs its full body

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead
 *  stack region the oracle's pushes/`ret` churn — excluded by the standard gate). */
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

/** Run the ORACLE on a fresh clone. It threads its own push16/call/ret (or takes
 *  allSlotsClear's caller-skip), so pc/SP advance to the grandparent return itself. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its return with ONE m.ret() so pc + SP
 *  match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 *  stack, so it never touches pc/SP itself — the harness supplies the return). Both
 *  oracle arms exit at SP+2 / pc = word@SP, so a single ret models either arm. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the memory-only + pc/SP contract: RAM −
 *  STACK_SCRATCH, pc, SP. Live-out is memory-only, so registers are NOT compared
 *  (the oracle's residual A/HL/F are dead ABI). */
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

// -- capture (seed only) ------------------------------------------------------

/** Hook the sibling 0x003d in a real attract run and clone the machine at up to K real
 *  dispatches — board setup fires it with the 0x6908 sprite-object block populated, so
 *  these clones carry realistic RAM in the exact region 0x1757 edits. 0x1757 itself is
 *  never dispatched, so we only need live states to seed crafted entries from.
 *
 *  CRITICAL: 0x003d (addStrided) is itself a callee deep inside sub_1757's subtree
 *  (sub_306f -> loc_0038 -> 0x003d), and clone() re-installs the constructor's
 *  overrides. If the seed carried the capture hook, the oracle's own m.call(0x003d)
 *  during replay would hit the inert hook and the add-loop would silently not run. So
 *  each seed is stripped to the PURE ORACLE registry (assets.overrides cleared, so its
 *  clones rebuild clean) before it is returned — the seed is just real board RAM. */
function pureSeed(mm) {
  const s = mm.clone();
  s.assets = { ...s.assets, overrides: undefined }; // future clones use the pure oracle table
  s.routines = new Map(ORACLE_ROUTINES); // and so does the seed itself
  return s;
}
function captureSeeds(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[SEED_TARGET, (mm) => {
    if (caps.length < K) caps.push(pureSeed(mm));
    // do not run the sibling — we only want the entry RAM.
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  try { host.runFrames(maxFrames); } catch { /* attract may reach an untranslated stub */ }
  return caps;
}

/**
 * Craft an entry from a real seed: a safe stack pointer, the ten record X/Y bytes set
 * from xOf/yOf, the phase counter set, and SUBSTATE_TIMER + selector pre-set to
 * sentinels so the clear-arm writes are observable byte changes.
 */
function craft(seed, { xOf, yOf, phase, timerSentinel = 0x11, selSentinel = 0x22 } = {}) {
  const e = seed.clone();
  e.regs.sp = SAFE_SP;
  for (let i = 0; i < RECORD_COUNT; i++) {
    if (xOf) e.mem.write8(recX(i), xOf(i) & 0xff);
    if (yOf) e.mem.write8(recY(i), yOf(i) & 0xff);
  }
  if (phase != null) e.mem.write8(PHASE_COUNTER, phase & 0xff);
  e.mem.write8(SUBSTATE_TIMER, timerSentinel);
  e.mem.write8(SEQUENCE_SELECTOR, selSentinel);
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** Broken twin: arms SUBSTATE_TIMER = 0x41 instead of 0x40 on the clear arm. */
function brokenTimerValue(m) {
  const { regs, mem, mem8 } = m;
  animateSpriteObjectBlock(m);
  cullSpriteObjectsAtTop(m);
  regs.hl = (regs.hl + 1) & 0xffff;
  regs.de = (regs.de + 1) & 0xffff;
  if (!allSlotsClear(mem8, regs.hl, regs.de)) return;
  mem.write8(SUBSTATE_TIMER, 0x41); // BUG: should be 0x40
  mem.write8(SEQUENCE_SELECTOR, (mem.read8(SEQUENCE_SELECTOR) + 1) & 0xff);
}

/** Broken twin: forgets to advance the 0x6388 sequence selector on the clear arm. */
function brokenNoSelectorIncrement(m) {
  const { regs, mem, mem8 } = m;
  animateSpriteObjectBlock(m);
  cullSpriteObjectsAtTop(m);
  regs.hl = (regs.hl + 1) & 0xffff;
  regs.de = (regs.de + 1) & 0xffff;
  if (!allSlotsClear(mem8, regs.hl, regs.de)) return;
  mem.write8(SUBSTATE_TIMER, 0x40);
  // BUG: the `inc (0x6388)` is missing
}

/** Broken twin: drops the inc hl / inc de, so it scans allSlotsClear(0x6907, 3) — the
 *  cull's raw pointer/stride — instead of the block scan (0x6908, 4). */
function brokenNoPointerAdvance(m) {
  const { regs, mem, mem8 } = m;
  animateSpriteObjectBlock(m);
  cullSpriteObjectsAtTop(m); // leaves HL = 0x6907, DE = 3
  // BUG: inc hl / inc de omitted
  if (!allSlotsClear(mem8, regs.hl, regs.de)) return;
  mem.write8(SUBSTATE_TIMER, 0x40);
  mem.write8(SEQUENCE_SELECTOR, (mem.read8(SEQUENCE_SELECTOR) + 1) & 0xff);
}

// -- 1. EQUAL (clear arm) -----------------------------------------------------

test("EQUAL (clear arm): all-X-zero block advances (SUBSTATE_TIMER + selector), both phases", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need one real 0x003d capture to seed crafted entries with real RAM");
  const seed = seeds[0];

  for (const phase of [PHASE_NOFIRE, PHASE_FIRE]) {
    const e = craft(seed, { xOf: () => 0x00, yOf: () => 0xff, phase });
    // sanity: the oracle really takes the advance arm here
    const o = runOracle(e);
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0x40, `phase ${hx(phase)}: oracle should arm the timer on the clear arm`);
    assert.equal(o.mem.read8(SEQUENCE_SELECTOR), 0x23, `phase ${hx(phase)}: oracle should inc the selector (0x22 -> 0x23)`);
    const diffs = contractDiffs(e, advanceBoardStepWhenSpritesCleared);
    assert.equal(diffs.length, 0, `phase ${hx(phase)}: ${diffs.join("; ")}`);
  }
  console.log("  EQUAL/clear: advance arm identical (RAM+pc+SP) at both animate phases");
});

// -- 2. EQUAL (not-clear arm) -------------------------------------------------

test("EQUAL (not-clear arm): an occupied slot aborts (caller-skip, no advance), both phases", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const seed = seeds[0];

  for (const phase of [PHASE_NOFIRE, PHASE_FIRE]) {
    // record 0 occupied and high (Y stays >= 0x19 even after a -4 scroll) so it is never culled
    const e = craft(seed, { xOf: (i) => (i === 0 ? 0x55 : 0x00), yOf: () => 0xff, phase });
    const o = runOracle(e);
    assert.equal(o.mem.read8(SUBSTATE_TIMER), 0x11, `phase ${hx(phase)}: oracle must NOT arm the timer on the abort arm`);
    assert.equal(o.mem.read8(SEQUENCE_SELECTOR), 0x22, `phase ${hx(phase)}: oracle must NOT advance the selector on the abort arm`);
    const diffs = contractDiffs(e, advanceBoardStepWhenSpritesCleared);
    assert.equal(diffs.length, 0, `phase ${hx(phase)}: ${diffs.join("; ")}`);
  }
  console.log("  EQUAL/not-clear: abort arm identical (RAM+pc+SP) at both animate phases");
});

// -- 3. EQUAL (phase sweep, all 256) ------------------------------------------

test("EQUAL (phase sweep): all 256 phase-counter values match the oracle (animate fire + no-fire)", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const seed = seeds[0];

  let fire = 0, noFire = 0;
  for (let phase = 0; phase < 256; phase++) {
    if (((phase + 1) & 0x07) === 0) fire++; else noFire++;
    const e = craft(seed, { xOf: () => 0x00, yOf: () => 0xff, phase });
    const diffs = contractDiffs(e, advanceBoardStepWhenSpritesCleared);
    assert.equal(diffs.length, 0, `phase ${hx(phase)}: ${diffs.join("; ")}`);
  }
  assert.equal(fire, 32, "expected 32 fire phases");
  assert.equal(noFire, 224, "expected 224 no-fire phases");
  console.log(`  EQUAL/phase: 256 phase values identical — ${fire} fire, ${noFire} no-fire`);
});

// -- 4. EQUAL (real captured seeds, unmodified) -------------------------------

test("EQUAL (real seeds): unmodified board-setup states match the oracle", () => {
  const seeds = captureSeeds(6, 1500);
  assert.ok(seeds.length >= 1, "expected at least one real 0x003d capture");
  for (const seed of seeds) {
    const e = seed.clone();
    e.regs.sp = SAFE_SP; // safe stack for the oracle's ret; block left as captured
    const diffs = contractDiffs(e, advanceBoardStepWhenSpritesCleared);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${seeds.length} distinct captured board-setup states identical to the oracle`);
});

// -- 5. TEETH (wrong timer value) ---------------------------------------------

test("TEETH: the wrong-timer twin (0x6009 = 0x41, not 0x40) is CAUGHT on a clear entry", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const e = craft(seeds[0], { xOf: () => 0x00, yOf: () => 0xff, phase: PHASE_NOFIRE });
  const diffs = contractDiffs(e, brokenTimerValue);
  assert.ok(diffs.length > 0, "the wrong-timer twin escaped detection — SUBSTATE_TIMER is untested");
  assert.ok(diffs.some((d) => d.includes("0x6009")), `expected a 0x6009 diff, got: ${diffs.join("; ")}`);
  assert.equal(contractDiffs(craft(seeds[0], { xOf: () => 0x00, yOf: () => 0xff, phase: PHASE_NOFIRE }),
    advanceBoardStepWhenSpritesCleared).length, 0, "the real routine must pass the same clear entry");
  console.log(`  TEETH/timer: wrong-timer twin caught (${diffs.find((d) => d.includes("0x6009"))})`);
});

// -- 6. TEETH (skipped selector increment) ------------------------------------

test("TEETH: the no-selector-increment twin (0x6388 left unchanged) is CAUGHT on a clear entry", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  const e = craft(seeds[0], { xOf: () => 0x00, yOf: () => 0xff, phase: PHASE_NOFIRE });
  const diffs = contractDiffs(e, brokenNoSelectorIncrement);
  assert.ok(diffs.length > 0, "the no-increment twin escaped detection — the 0x6388 advance is untested");
  assert.ok(diffs.some((d) => d.includes("0x6388")), `expected a 0x6388 diff, got: ${diffs.join("; ")}`);
  console.log(`  TEETH/selector: no-increment twin caught (${diffs.find((d) => d.includes("0x6388"))})`);
});

// -- 7. TEETH (dropped pointer-advance) ---------------------------------------

test("TEETH: the dropped-pointer-advance twin (scans 0x6907/3, not 0x6908/4) is CAUGHT", () => {
  const seeds = captureSeeds(1, 1500);
  assert.ok(seeds.length >= 1, "need a real capture");
  // Clear entry (all X = 0 -> real routine advances), but a nonzero byte on the wrong
  // stride (0x690a = record 0's attr) so the twin's 0x6907/3 scan reads it and aborts.
  const e = craft(seeds[0], { xOf: () => 0x00, yOf: () => 0xff, phase: PHASE_NOFIRE });
  e.mem.write8(0x690a, 0xaa); // attr byte the real 0x6908/4 scan never reads
  const diffs = contractDiffs(e, brokenNoPointerAdvance);
  assert.ok(diffs.length > 0, "the dropped-pointer-advance twin escaped detection — the inc hl/de glue is untested");
  // The real routine still advances on this same entry (proving the extra byte is inert to it).
  const good = contractDiffs(
    (() => { const g = seeds[0].clone(); g.regs.sp = SAFE_SP;
      for (let i = 0; i < RECORD_COUNT; i++) { g.mem.write8(recX(i), 0x00); g.mem.write8(recY(i), 0xff); }
      g.mem.write8(PHASE_COUNTER, PHASE_NOFIRE); g.mem.write8(SUBSTATE_TIMER, 0x11);
      g.mem.write8(SEQUENCE_SELECTOR, 0x22); g.mem.write8(0x690a, 0xaa); return g; })(),
    advanceBoardStepWhenSpritesCleared);
  assert.equal(good.length, 0, `the real routine must pass this entry: ${good.join("; ")}`);
  console.log(`  TEETH/pointer: dropped inc-hl/de twin caught (${diffs[0]})`);
});
