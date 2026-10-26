// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stampReleasedBarrelKind (ROM 0x2CF6) — the setup head of the 0x2C-cluster renderer
 * chain. It stamps three fields of the object record (the caller's IX / RENDER_OBJ_PTR):
 * sprite-code (+0x07), sprite-attr (+0x08) and mode (+0x15), with one of two presets chosen by
 * bit 7 of BARREL_CLAIM_MODE — CLEAR writes the default triple (0x15, 0x0B, 0x00), SET writes
 * the alternate triple (0x19, 0x0C, 0x01) — then FALLS THROUGH into advanceBarrelRelease, the frame-gated
 * string/sprite renderer.
 *
 * CONTEXT, GROUNDED (live MAME 0.288 on the real dkong ROM, understanding pass 12, scratchpad/pass12-grounding.md):
 * this chain is ORDINARY 25m BARREL PLAY, not a cutscene. All 46 observed dispatches fell at gameplay substates
 * (17 in a credited in-board 25m game, 29 in the attract 25m demo) and ZERO at substate 7, the opening Kong-climb
 * cutscene; board 1 only; IX was always an OBJ_ARRAY_67 barrel-record base, one per slot claim by the barrel-release
 * routine (board 1, ROM 0x2CB8), 46 claims paired 1:1 with 46 dispatches. The two presets are two BARREL KINDS: the
 * bit-7-SET (attr 0x0C) kind DROPS with its X pinned at 59, the bit-7-CLEAR (attr 0x0B) kind ROLLS along the
 * girders. Grounding deliberately did NOT establish which NAMED Donkey Kong object either kind is, so neither is
 * named here.
 *
 * stampReleasedBarrelKind WRITES MEMORY (the record fields, and — through the fall-through — everything
 * advanceBarrelRelease's chain touches), so it is gated on memory-equivalence, not a returned scalar,
 * and every case runs on FRESH clones. The contract is RAM (minus the stack scratch below the entry SP) + pc + SP;
 * the live-out is memory-only.
 *
 * STACK: stampReleasedBarrelKind pushes nothing of its own — the transition into advanceBarrelRelease is a fall-through /
 * jump — so the whole stampReleasedBarrelKind -> advanceBarrelRelease -> ... chain nets exactly ONE caller-return pop
 * (advanceBarrelRelease's chain `ret`s once on stampReleasedBarrelKind's behalf). The idiomatic routine models that as a
 * plain JS return, so the harness performs one m.ret() on the candidate AFTER the call to
 * line pc + SP up with the oracle. On the deeper table-load path the oracle's dissolved
 * `call 0x004e` bracket churns the dead STACK_SCRATCH region; the idiomatic chain calls
 * directly and touches no stack, so those bytes differ and are excluded by the contract.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x2CF6 in a real attract run and clone the
 *      machine at each true dispatch. Run the ORACLE on one clone and stampReleasedBarrelKind on another;
 *      confirm identical RAM (minus the stack scratch below the entry SP) + pc + SP. Both preset arms occur
 *      naturally (bit-7 clear and bit-7 set).
 *
 *   2. EQUAL (crafted) — from a real attract base, poke IX, the BARREL_CLAIM_MODE byte and the
 *      downstream renderer's control bytes identically on both sides to force each arm and
 *      drive advanceBarrelRelease through both its clean gate-return path and its deeper table-load path
 *      (which churns STACK_SCRATCH). Non-vacuity: the selected preset really landed in the
 *      record on both sides.
 *
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) wrong-parity-bit — selects the preset from bit 0 of BARREL_CLAIM_MODE instead of bit 7, so on
 *          a byte where the two bits disagree it stamps the wrong triple (diverges at +0x07).
 *      (b) drop-fall-through — does the (correct) preset writes but returns WITHOUT falling
 *          into advanceBarrelRelease, so the renderer's frame-gate decrement at 0x62AF is missing.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2cf6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2cf6 as oracle } from "../../translated/loc_2cf6.js";
import { stampReleasedBarrelKind } from "../stampReleasedBarrelKind.js";
import { advanceBarrelRelease } from "../advanceBarrelRelease.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, RENDER_STR_PTR, RENDER_OBJ_PTR, RENDER_DST_PTR, BARREL_CLAIM_MODE, OBJ_SPRITE_CODE, OBJ_SPRITE_ATTR } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2cf6;
const FRAME_GATE = 0x62af;    // advanceBarrelRelease's per-tick down-counter (unnamed)
const ANIM_COUNTER = 0x638f;  // advanceBarrelRelease's animation sub-counter (unnamed)
const RET_ADDR = 0x2ce5;      // a plausible caller-return site (any valid addr; both sides pop it)

// Field offsets stamped in the renderer object record (caller-provided base).
const F_MODE = 0x15; // mode field (no names.js name)
const PRESET_DEFAULT = { [OBJ_SPRITE_CODE]: 0x15, [OBJ_SPRITE_ATTR]: 0x0b, [F_MODE]: 0x00 }; // bit 7 clear
const PRESET_ALT = { [OBJ_SPRITE_CODE]: 0x19, [OBJ_SPRITE_ATTR]: 0x0c, [F_MODE]: 0x01 };     // bit 7 set

// Crafted object regions (writable work RAM, disjoint so the readbacks are unambiguous).
const OBJ = 0x6120;   // stampReleasedBarrelKind's IX: the record it presets
const R_OBJ = 0x6140; // advanceBarrelRelease's own record (RENDER_OBJ_PTR) on the table-load path
const SRC = 0x6100;   // RENDER_STR_PTR target: a non-terminator char + a data byte
const DST = 0x6a80;   // RENDER_DST_PTR: destination sprite record
const SRC_CH = 0x41;  // a non-terminator character
const SRC_DATA = 0x9a;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs, skipping the stack scratch below the entry SP. */
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

/** Run the ORACLE on a fresh clone. Its chain performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single terminal `ret` with one m.ret() so pc + SP match the
 *  oracle's (the idiomatic chain replaces the Z80 stack with the JS call stack, so it does not touch pc/SP itself). */
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

/** Which preset arm the state will take (mirrors the routine's own bit-7 test). */
const classify = (mm) => (mm.mem.read8(BARREL_CLAIM_MODE) & 0x80 ? "alt" : "default");

// -- capture ------------------------------------------------------------------

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

// A real, self-consistent machine, cloned so the frame machinery is neutralised
// (clone() sets nextNmi/nextBoundary = Infinity) — the crafted entries are seeded from it.
function attractBase(frames = 220) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/**
 * Stamp a crafted 0x2CF6 dispatch onto a clone of the base: a stack with a plausible caller
 * return, IX at the preset record, the BARREL_CLAIM_MODE byte, and the downstream renderer's
 * control bytes plus a clean non-terminator render source (so the fall-through into advanceBarrelRelease
 * runs deterministically without reloading the sprite block from a terminator).
 */
function craft(base, { parity, gate = 0x05, counter = 0x00 }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.ix = OBJ;
  m.mem.write8(BARREL_CLAIM_MODE, parity);
  m.mem.write8(FRAME_GATE, gate);
  m.mem.write8(ANIM_COUNTER, counter);
  m.mem.write16(RENDER_STR_PTR, SRC);
  m.mem.write16(RENDER_OBJ_PTR, R_OBJ);
  m.mem.write16(RENDER_DST_PTR, DST);
  m.mem.write8(SRC, SRC_CH);
  m.mem.write8(SRC + 1, SRC_DATA);
  return m;
}

const expectedPreset = (parity) => (parity & 0x80 ? PRESET_ALT : PRESET_DEFAULT);

// -- broken twins -------------------------------------------------------------

/** Twin (a): selects the preset from bit 0 of BARREL_CLAIM_MODE instead of bit 7. */
function brokenWrongParityBit(m) {
  const { regs, mem } = m;
  const obj = regs.ix;
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x01) === 0) { // BUG: 0x01, not 0x80
    mem.write8((obj + OBJ_SPRITE_CODE) & 0xffff, 0x15);
    mem.write8((obj + OBJ_SPRITE_ATTR) & 0xffff, 0x0b);
    mem.write8((obj + F_MODE) & 0xffff, 0x00);
  } else {
    mem.write8((obj + OBJ_SPRITE_CODE) & 0xffff, 0x19);
    mem.write8((obj + OBJ_SPRITE_ATTR) & 0xffff, 0x0c);
    mem.write8((obj + F_MODE) & 0xffff, 0x01);
  }
  return advanceBarrelRelease(m);
}

/** Twin (b): correct presets but returns WITHOUT falling into advanceBarrelRelease. */
function brokenDropFallThrough(m) {
  const { regs, mem } = m;
  const obj = regs.ix;
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x80) === 0) {
    mem.write8((obj + OBJ_SPRITE_CODE) & 0xffff, 0x15);
    mem.write8((obj + OBJ_SPRITE_ATTR) & 0xffff, 0x0b);
    mem.write8((obj + F_MODE) & 0xffff, 0x00);
  } else {
    mem.write8((obj + OBJ_SPRITE_CODE) & 0xffff, 0x19);
    mem.write8((obj + OBJ_SPRITE_ATTR) & 0xffff, 0x0c);
    mem.write8((obj + F_MODE) & 0xffff, 0x01);
  }
  // BUG: missing `return advanceBarrelRelease(m);`
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2CF6 is dispatched during attract, both preset arms", () => {
  let count = 0;
  const arms = { default: 0, alt: 0 };
  const snap = new Map([[TARGET, (mm) => { count++; arms[classify(mm)]++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(4000);
  assert.ok(count > 0, "0x2CF6 should be dispatched — the 25m barrel renderer chain's setup head");
  assert.ok(arms.default > 0 && arms.alt > 0, `both arms should occur naturally, got ${JSON.stringify(arms)}`);
  console.log(`  REACHABILITY: ${count} natural 0x2CF6 dispatches in 4000 frames; arms ${JSON.stringify(arms)}`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): stampReleasedBarrelKind == oracle on every captured 0x2CF6 entry", () => {
  const caps = captureDispatches(400, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2CF6 dispatch during attract");
  const seen = {};
  for (const cap of caps) {
    const diffs = contractDiffs(cap, stampReleasedBarrelKind); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    const p = classify(cap);
    seen[p] = (seen[p] || 0) + 1;
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle; arms ${JSON.stringify(seen)}`);
});

// -- 2. EQUAL (crafted: both arms x downstream paths) -------------------------

test("EQUAL (crafted): both preset arms, over the gate-return and table-load renderer paths", () => {
  const base = attractBase();

  const cases = [
    // bit 7 clear -> default preset; advanceBarrelRelease clean gate-return (gate > 1)
    { name: "default / gate-return", opts: { parity: 0x00, gate: 0x05 } },
    // bit 7 set -> alt preset; advanceBarrelRelease clean gate-return
    { name: "alt / gate-return", opts: { parity: 0x80, gate: 0x05 } },
    // bit 7 set (+ bit 0 set) -> alt preset; advanceBarrelRelease acting frame, sub-counter zero
    { name: "alt / counter-zero render", opts: { parity: 0x81, gate: 0x01, counter: 0x00 } },
    // bit 7 clear (bit 0 clear) -> default preset; advanceBarrelRelease acting frame, TABLE LOAD
    // (exercises the dissolved call-0x004e bracket => STACK_SCRATCH churn, excluded)
    { name: "default / table-load", opts: { parity: 0x40, gate: 0x01, counter: 0x03 } },
  ];

  for (const { name, opts } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, stampReleasedBarrelKind);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuity: the selected preset really landed in the record on BOTH sides.
    const want = expectedPreset(opts.parity);
    const o = runOracle(entry);
    const c = runCandidate(entry, stampReleasedBarrelKind);
    for (const off of [OBJ_SPRITE_CODE, OBJ_SPRITE_ATTR, F_MODE]) {
      assert.equal(o.mem.read8(OBJ + off), want[off], `${name}: oracle record +${off}`);
      assert.equal(c.mem.read8(OBJ + off), want[off], `${name}: stampReleasedBarrelKind record +${off}`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} cases identical to the oracle; presets asserted on both sides`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-parity-bit twin and the drop-fall-through twin are CAUGHT", () => {
  const base = attractBase();

  // (a) wrong-parity-bit: BARREL_CLAIM_MODE = 0x80 has bit 7 SET (correct = alt preset 0x19) but bit 0
  // CLEAR, so the twin writes the default preset 0x15 -> diverges at the sprite-code field.
  const bitEntry = craft(base, { parity: 0x80, gate: 0x05 });
  const bitDiffs = contractDiffs(bitEntry, brokenWrongParityBit);
  assert.ok(bitDiffs.length > 0, "the wrong-parity-bit twin escaped — the RAM check is worthless");
  assert.ok(
    bitDiffs[0].startsWith(`RAM@${hx(OBJ + OBJ_SPRITE_CODE)}`),
    `expected the diff at the sprite-code field ${hx(OBJ + OBJ_SPRITE_CODE)}, got ${bitDiffs[0]}`,
  );

  // (b) drop-fall-through: presets are correct, but advanceBarrelRelease never runs, so its frame-gate
  // decrement at 0x62AF is missing -> diverges there (and nowhere lower, since presets match).
  const ftEntry = craft(base, { parity: 0x80, gate: 0x05 });
  const ftDiffs = contractDiffs(ftEntry, brokenDropFallThrough);
  assert.ok(ftDiffs.length > 0, "the drop-fall-through twin escaped — the fall-through is unproven");
  assert.ok(
    ftDiffs[0].startsWith(`RAM@${hx(FRAME_GATE)}`),
    `expected the diff at the frame gate ${hx(FRAME_GATE)}, got ${ftDiffs[0]}`,
  );

  console.log(`  TEETH: wrong-parity-bit caught (${bitDiffs[0]}); drop-fall-through caught (${ftDiffs[0]})`);
});
