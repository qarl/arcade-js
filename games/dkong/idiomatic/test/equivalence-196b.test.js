// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearScreenAndSelectSubstate (ROM 0x196b) — arm 23 of the
 * in-game sub-state table (ROM 0x0702): wipe the whole display (call 0x0852), then
 * store GAME_SUBSTATE (0x600A) = (byte at 0x600E) + 0x12, a computed jump into a
 * later phase group.
 *
 * loc_196b WRITES memory (the clear footprint + a store to GAME_SUBSTATE) and READS
 * exactly ONE byte (0x600E). So it is validated by capture/clone/replay on a FRESH
 * clone per case — never reusing one machine, never the full register file, never
 * cycles. The compared contract is RAM minus the stack scratch below the entry SP + pc + SP; here pc/SP are
 * dropped (the idiomatic layer has no stack/PC bookkeeping) so the gate is RAM
 * (ex-stack). loc_196b touches no board io latch, so no io field is compared.
 *
 * 0x196b is UNREACHED in a plain attract run AND in a coin+start driven run (its
 * dispatch needs deep in-game progression to sub-state 23), so there is no real
 * dispatch to capture — exactly sub_0852's situation. It is gated by CRAFTED entries
 * built on a real in-game base (captured at ROM 0x0986, GAME_STATE==3). Because the
 * routine's behaviour is a total function of the single byte 0x600E, sweeping that
 * byte over ALL 256 values is EXHAUSTIVE over its input space:
 *
 *   1. CRAFTED (exhaustive over 0x600E) — for every value 0..255 of 0x600E, on a real
 *      in-game base with the clear footprint pre-painted to a sentinel (0xAA) on BOTH
 *      sides, run oracle vs candidate on two fresh clones and confirm identical RAM
 *      (ex-stack). Each arm also asserts the oracle's own outcome — GAME_SUBSTATE ==
 *      (v + 0x12) & 0xff — so no arm can pass vacuously; sampled arms assert the full
 *      clear (tilemap all 0x10, sprite buffer all 0x00) so the sentinel really was
 *      overwritten.
 *
 *   2. TEETH — three deliberately-broken twins MUST be caught: (a) a WRONG add offset
 *      (+0x11) — a RAM diff at GAME_SUBSTATE; (b) a SKIPPED clear — the sentinel
 *      survives inside the footprint (RAM diff there); (c) a ONE-CELL-SHORT tilemap
 *      fill — the sentinel survives at the last cell 0x77FF (RAM diff there), pinning
 *      the exact wipe extent.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-196b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_196b as oracle } from "../../translated/loc_196b.js";
import { loc_0986 as baseOracle } from "../../translated/loc_0986.js"; // only to advance the host to a real in-game base
import { clearScreenAndSelectSubstate as candidate } from "../clearScreenAndSelectSubstate.js";
// The teeth twins reuse the real idiomatic callee so only the injected defect differs.
import { clearTilemapAndSprites as clearTilemapAndSpritesLike } from "../clearTilemapAndSprites.js";
import { Machine } from "../../machine.js";
import { GAME_SUBSTATE, SPRITE_BUFFER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x196b;
const CAPTURE_AT = 0x0986; // a real in-game entry (arm 0 of the same table) for the base
const PHASE_SELECTOR = 0x600e; // the one input byte
const PHASE_GROUP_BASE = 0x12;

// The clear footprint the routine (via clearTilemapAndSprites, ROM 0x0852) wipes.
const TILEMAP_LO = 0x7400, TILEMAP_HI = 0x77ff, BLANK_TILE = 0x10;
const SPRITE_LO = SPRITE_BUFFER, SPRITE_HI = SPRITE_BUFFER + 0x180 - 1; // 0x6900-0x6a7f
const SENTINEL = 0xaa; // distinct from 0x10 and 0x00, so an un-cleared byte shows

const FRAMES = 160; // loc_0986 (CAPTURE_AT) dispatches once, ~frame 152

// Canonical coin+start tape (same as the 0x0986 gate): pulse the IN2 coin bit then
// start1 so the ROM's own credit/start logic starts a 1-player game and the state-3
// dispatcher reaches loc_0986 — a real in-game base to craft 0x196b entries from.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte (skipping the stack scratch below the entry SP) that differs, or null. */
function firstDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

const fmt = (d) => (d ? `RAM ${hx(d.addr)} oracle=${d.a} cand=${d.b}` : "identical");

/** Run the oracle and `cand` on two FRESH clones of `entry` and diff (ex-stack). */
function diffAgainstOracle(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  a.regs.sp = 0x6bfe; // valid work-RAM stack for the oracle's push16/call/ret
  oracle(a);
  cand(b);
  return firstDiffOutsideStack(a, b, 0x6bfe);
}

const inFootprint = (addr) =>
  (addr >= TILEMAP_LO && addr <= TILEMAP_HI) || (addr >= SPRITE_LO && addr <= SPRITE_HI);

// -- entry capture (a real in-game base) --------------------------------------

/**
 * Capture the machine at the instant loc_0986 is first entered (a real GAME_STATE==3
 * in-game state) and return that pristine clone as the base to craft 0x196b arms from.
 * loc_196b reads none of the surrounding state — only 0x600E — so any valid in-game
 * machine is a sound base; capturing a real one keeps the untouched RAM realistic.
 */
function captureBase() {
  let captured = null;
  // Snapshot the machine on first entry to 0x0986 (a real GAME_STATE==3 in-game state),
  // then delegate to the 0x0986 oracle so the host game proceeds to a clean stop. We
  // only need a realistic in-game base to craft 0x196b arms from.
  const snap = new Map([[CAPTURE_AT, (mm) => {
    if (captured === null) captured = mm.clone();
    return baseOracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(FRAMES);
  return captured;
}

const BASE = ROM_PRESENT ? captureBase() : null;

/** Clone the base, poke the selector byte, and paint the clear footprint to SENTINEL. */
function craftArm(v600e) {
  const w = BASE.clone();
  w.mem.write8(PHASE_SELECTOR, v600e & 0xff);
  for (let a = TILEMAP_LO; a <= TILEMAP_HI; a++) w.mem.write8(a, SENTINEL);
  for (let a = SPRITE_LO; a <= SPRITE_HI; a++) w.mem.write8(a, SENTINEL);
  return w;
}

// -- 1. CRAFTED (exhaustive over the single input byte 0x600E) -----------------

test("CRAFTED (exhaustive): all 256 values of 0x600E match the oracle in RAM (ex-stack)", () => {
  assert.ok(BASE, "loc_0986 never dispatched within the coin+start window — base capture broke");
  assert.equal(BASE.mem.read8(0x6005), 3, "base is a real in-game state (GAME_STATE==3)");

  let checked = 0;
  for (let v = 0; v < 256; v++) {
    const w = craftArm(v);

    // Candidate reproduces the oracle exactly (RAM ex-stack).
    const d = diffAgainstOracle(w, candidate);
    assert.equal(d, null, d && `0x600E=${hx(v)}: divergence ${fmt(d)}`);

    // Non-vacuous: the oracle actually stored (v + 0x12) & 0xff into GAME_SUBSTATE.
    const o = w.clone();
    o.regs.sp = 0x6bfe;
    oracle(o);
    assert.equal(
      o.mem.read8(GAME_SUBSTATE),
      (v + PHASE_GROUP_BASE) & 0xff,
      `0x600E=${hx(v)}: oracle GAME_SUBSTATE`,
    );

    // On a few sampled arms, confirm the sentinel really was fully overwritten.
    if (v === 0x00 || v === 0x05 || v === 0xee || v === 0xff) {
      for (let a = TILEMAP_LO; a <= TILEMAP_HI; a++) {
        assert.equal(o.mem.read8(a), BLANK_TILE, `tilemap not blanked at ${hx(a)} (0x600E=${hx(v)})`);
      }
      for (let a = SPRITE_LO; a <= SPRITE_HI; a++) {
        assert.equal(o.mem.read8(a), 0x00, `sprite buffer not zeroed at ${hx(a)} (0x600E=${hx(v)})`);
      }
    }
    checked++;
  }
  assert.equal(checked, 256, "must have swept all 256 selector values");
  console.log(`  CRAFTED/exhaustive: ${checked} selector values — RAM (ex-stack) identical; GAME_SUBSTATE=0x600E+0x12 pinned`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** Twin (a): WRONG add offset (+0x11) — a RAM diff at GAME_SUBSTATE. */
function brokenWrongOffset(m) {
  const { mem } = m;
  clearTilemapAndSpritesLike(m);
  mem.write8(GAME_SUBSTATE, (mem.read8(PHASE_SELECTOR) + 0x11) & 0xff); // BUG: base is 0x12
}

/** Twin (b): SKIPPED clear — the sentinel survives inside the footprint. */
function brokenNoClear(m) {
  const { mem } = m;
  // BUG: clearTilemapAndSprites call dropped.
  mem.write8(GAME_SUBSTATE, (mem.read8(PHASE_SELECTOR) + PHASE_GROUP_BASE) & 0xff);
}

/** Twin (c): ONE-CELL-SHORT tilemap fill — the sentinel survives at 0x77FF. */
function brokenShortFill(m) {
  const { mem } = m;
  for (let a = TILEMAP_LO; a < TILEMAP_HI; a++) mem.write8(a, BLANK_TILE); // BUG: stops one cell short
  for (let a = SPRITE_LO; a <= SPRITE_HI; a++) mem.write8(a, 0x00);
  mem.write8(GAME_SUBSTATE, (mem.read8(PHASE_SELECTOR) + PHASE_GROUP_BASE) & 0xff);
}

test("TEETH: wrong-offset, skipped-clear, and one-cell-short twins are all CAUGHT", () => {
  assert.ok(BASE, "need the captured base for the teeth");

  // (a) wrong offset — caught at GAME_SUBSTATE.
  const eOff = craftArm(0x05);
  const dOff = diffAgainstOracle(eOff, brokenWrongOffset);
  assert.notEqual(dOff, null, "the gate FAILED to catch a wrong add offset — it is worthless");
  assert.equal(dOff.addr, GAME_SUBSTATE, "wrong-offset must diverge at GAME_SUBSTATE (0x600A)");
  assert.equal(dOff.a, 0x17, "oracle stores 0x05 + 0x12 = 0x17");
  assert.equal(dOff.b, 0x16, "broken twin stores 0x05 + 0x11 = 0x16");

  // (b) skipped clear — the sentinel survives somewhere inside the footprint.
  const eClr = craftArm(0x05);
  const dClr = diffAgainstOracle(eClr, brokenNoClear);
  assert.notEqual(dClr, null, "the gate FAILED to catch a skipped clear — it is worthless");
  assert.ok(inFootprint(dClr.addr), `skipped-clear diff must land in the clear footprint, got ${hx(dClr.addr)}`);
  assert.equal(dClr.b, SENTINEL, "broken twin leaves the sentinel where the oracle cleared it");

  // (c) one-cell-short tilemap fill — the sentinel survives at the last cell 0x77FF.
  const eShort = craftArm(0x05);
  const dShort = diffAgainstOracle(eShort, brokenShortFill);
  assert.notEqual(dShort, null, "the gate FAILED to catch a one-cell-short fill — it is worthless");
  assert.equal(dShort.addr, TILEMAP_HI, "short-fill must diverge at the last tilemap cell (0x77FF)");
  assert.equal(dShort.a, BLANK_TILE, "oracle blanked the last cell to 0x10");
  assert.equal(dShort.b, SENTINEL, "broken twin left the last cell as the sentinel");

  console.log(
    `  TEETH: wrong-offset caught at ${hx(dOff.addr)} (${dOff.a}->${dOff.b}); ` +
      `skipped-clear caught at ${hx(dClr.addr)}; short-fill caught at ${hx(dShort.addr)}`,
  );
});
