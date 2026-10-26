// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceBarrelRelease (ROM 0x2D15) — the frame-gated step of the 0x2C-cluster
 * string/sprite renderer. A down-counter at FRAME_GATE (0x62AF) is decremented every
 * entry and the routine returns until it underflows; on the acting frame it reloads the
 * gate, then either renders the next character (tail into loc_2d51), or selects a 40-byte
 * record from the ROM animation table at 0x3932 (bit0 of BARREL_CLAIM_MODE 0x6382 picks the
 * record index = sub-counter or sub-counter−1), copies it via loadSpriteObjectBlock,
 * steps the sub-counter at ANIM_COUNTER (0x638F), and tail-jumps into loc_2d51 or (on the
 * sub-counter underflow, parity bit set) loc_2d83.
 *
 * advanceBarrelRelease WRITES MEMORY (its own gate/sub-counter cells and, through the callees, the
 * sprite-object block and the rendered record), so it is gated on memory-equivalence, not
 * a returned scalar, and every case runs on FRESH clones. The contract is RAM (minus
 * STACK_SCRATCH) + pc + SP — the live-out is memory-only.
 *
 * STACK: every path nets exactly ONE caller-return pop — the frame-gate path `ret`s; the
 * others tail-jump into a callee whose chain `ret`s once on advanceBarrelRelease's behalf. The
 * idiomatic routine models that as a JS return, so the harness performs one m.ret() on the
 * candidate AFTER the call to line pc + SP up with the oracle. On the table-load paths the
 * oracle's dissolved `call 0x004e` bracket (push16 + the callee's ret) churns the dead
 * STACK_SCRATCH region; the idiomatic chain calls directly and touches no stack, so those
 * bytes differ and are excluded by the memory-equivalence contract.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x2D15 in a real attract run and clone the
 *      machine at each true dispatch. Run the ORACLE on one clone and advanceBarrelRelease on another;
 *      confirm identical RAM (minus the stack scratch below the entry SP) + pc + SP. All five paths occur
 *      naturally (gate-return, sub-counter-zero, both table-load parity arms, and the
 *      sub-counter-underflow branch into loc_2d83 / loc_2d51).
 *
 *   2. EQUAL (crafted) — from a real attract base, poke the three control bytes (and a
 *      clean non-terminator render source) identically on both sides to force each path
 *      deterministically, and assert the observable effects (gate reload to 0x18 / 0x01,
 *      sub-counter step, the correct 40-byte record loaded into the sprite-object block).
 *
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) skip-gate-reload — omits the `(0x62AF) = 0x18` reload on the acting frame.
 *      (b) drop-record-adjust — always uses the sub-counter as the record index (never the
 *          −1 when the parity bit is clear), loading the wrong table record.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2d15.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d15 as oracle } from "../../translated/loc_2d15.js";
import { advanceBarrelRelease } from "../advanceBarrelRelease.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { loc_2d51 } from "../loc_2d51.js";
import { loc_2d83 } from "../loc_2d83.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, RENDER_STR_PTR, RENDER_OBJ_PTR, RENDER_DST_PTR, SPRITE_OBJ_BLOCK, BARREL_CLAIM_MODE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2d15;
const FRAME_GATE = 0x62af;    // per-tick down-counter (unnamed in names.js)
const ANIM_COUNTER = 0x638f;  // animation sub-counter (unnamed)
const ANIM_TABLE = 0x3932;    // ROM base of the 40-byte-per-record table
const RECORD_STRIDE = 40;
const RET_ADDR = 0x2cf9;      // a plausible caller-return site (any valid addr; both sides pop it)

// Crafted render source: writable RAM holding a NON-terminator char, so the downstream
// render takes the clean emit path (never activateReleasedBarrel, which would reload the sprite block).
const SRC = 0x6100;   // RENDER_STR_PTR target: char at SRC, data byte at SRC+1
const OBJ = 0x6120;   // RENDER_OBJ_PTR: object record read by stepBarrelAlongReleasePath
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

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so pc +
 * SP match the oracle's (the idiomatic chain replaces the Z80 stack with the JS call stack,
 * so it does not touch pc/SP itself).
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
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// Classify which path a pre-dispatch state will take (mirrors the routine's own logic).
function classify(mm) {
  const gate = (mm.mem.read8(FRAME_GATE) - 1) & 0xff;
  if (gate !== 0) return "gate-return";
  const counter = mm.mem.read8(ANIM_COUNTER);
  if (counter === 0) return "counter0";
  const bit0 = mm.mem.read8(BARREL_CLAIM_MODE) & 1;
  const stepped = (counter - 1) & 0xff;
  if (stepped !== 0) return "load->2d51";
  return bit0 ? "load->2d83" : "load-underflow->2d51";
}

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
// (nextNmi/nextBoundary = Infinity) — the crafted entries are seeded from it.
function attractBase(frames = 220) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/**
 * Stamp a crafted 0x2D15 dispatch onto a clone of the base: a stack with a plausible
 * caller return, the three control bytes, and a clean non-terminator render source (so the
 * downstream tail renders deterministically without reloading the sprite block).
 */
function craft(base, { gate = 0x01, counter, parity }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write8(FRAME_GATE, gate);
  m.mem.write8(ANIM_COUNTER, counter);
  m.mem.write8(BARREL_CLAIM_MODE, parity);
  m.mem.write16(RENDER_STR_PTR, SRC);
  m.mem.write16(RENDER_OBJ_PTR, OBJ);
  m.mem.write16(RENDER_DST_PTR, DST);
  m.mem.write8(SRC, SRC_CH);
  m.mem.write8(SRC + 1, SRC_DATA);
  return m;
}

// The 40-byte record loadSpriteObjectBlock would copy for a given index (read from ROM).
function expectedRecord(base, index) {
  const src = (ANIM_TABLE + ((index * RECORD_STRIDE) & 0xff)) & 0xffff;
  const out = [];
  for (let i = 0; i < RECORD_STRIDE; i++) out.push(base.mem.read8((src + i) & 0xffff));
  return out;
}

// -- broken twins -------------------------------------------------------------

/** Twin (a): omits the acting-frame gate reload `(0x62AF) = 0x18`. */
function brokenSkipGateReload(m) {
  const { regs, mem } = m;
  const gate = (mem.read8(FRAME_GATE) - 1) & 0xff;
  mem.write8(FRAME_GATE, gate);
  if (gate !== 0) return;
  // BUG: missing mem.write8(FRAME_GATE, 0x18)
  const counter = mem.read8(ANIM_COUNTER);
  if (counter === 0) return loc_2d51(m);
  let index = counter;
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x01) === 0) index = (index - 1) & 0xff;
  regs.hl = (ANIM_TABLE + ((index * RECORD_STRIDE) & 0xff)) & 0xffff;
  loadSpriteObjectBlock(m);
  const stepped = (mem.read8(ANIM_COUNTER) - 1) & 0xff;
  mem.write8(ANIM_COUNTER, stepped);
  if (stepped !== 0) return loc_2d51(m);
  mem.write8(FRAME_GATE, 0x01);
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x01) !== 0) return loc_2d83(m);
  return loc_2d51(m);
}

/** Twin (b): never subtracts one from the record index (drops the ±1 parity adjust). */
function brokenDropRecordAdjust(m) {
  const { regs, mem } = m;
  const gate = (mem.read8(FRAME_GATE) - 1) & 0xff;
  mem.write8(FRAME_GATE, gate);
  if (gate !== 0) return;
  mem.write8(FRAME_GATE, 0x18);
  const counter = mem.read8(ANIM_COUNTER);
  if (counter === 0) return loc_2d51(m);
  const index = counter; // BUG: no `if (bit0 clear) index -= 1`
  regs.hl = (ANIM_TABLE + ((index * RECORD_STRIDE) & 0xff)) & 0xffff;
  loadSpriteObjectBlock(m);
  const stepped = (mem.read8(ANIM_COUNTER) - 1) & 0xff;
  mem.write8(ANIM_COUNTER, stepped);
  if (stepped !== 0) return loc_2d51(m);
  mem.write8(FRAME_GATE, 0x01);
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x01) !== 0) return loc_2d83(m);
  return loc_2d51(m);
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2D15 is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.ok(count > 0, "0x2D15 should be dispatched — the 25m barrel renderer chain ticks through it");
  console.log(`  REACHABILITY: ${count} natural 0x2D15 dispatches in 3000 frames`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): advanceBarrelRelease == oracle on every captured 0x2D15 entry", () => {
  const caps = captureDispatches(400, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2D15 dispatch during attract");
  const seen = {};
  for (const cap of caps) {
    const diffs = contractDiffs(cap, advanceBarrelRelease); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    const p = classify(cap);
    seen[p] = (seen[p] || 0) + 1;
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle; paths ${JSON.stringify(seen)}`);
});

// -- 2. EQUAL (crafted: every path) -------------------------------------------

test("EQUAL (crafted): the frame-gate / counter-zero / table-load / branch paths all match", () => {
  const base = attractBase();

  const cases = [
    // frame gate not this frame's turn -> return after a single decrement
    { name: "gate-return", opts: { gate: 0x05, counter: 0x03, parity: 0x01 } },
    // acting frame, sub-counter zero -> tail loc_2d51 (no table load)
    { name: "counter-zero -> 2d51", opts: { gate: 0x01, counter: 0x00, parity: 0x01 } },
    // acting frame, table load, parity bit SET (index = counter), sub-counter still > 0
    { name: "load parity-set -> 2d51", opts: { gate: 0x01, counter: 0x03, parity: 0x01 } },
    // acting frame, table load, parity bit CLEAR (index = counter-1), sub-counter still > 0
    { name: "load parity-clear -> 2d51", opts: { gate: 0x01, counter: 0x03, parity: 0x00 } },
    // acting frame, sub-counter underflows, parity SET -> tail loc_2d83
    { name: "underflow parity-set -> 2d83", opts: { gate: 0x01, counter: 0x01, parity: 0x01 } },
    // acting frame, sub-counter underflows, parity CLEAR -> tail loc_2d51
    { name: "underflow parity-clear -> 2d51", opts: { gate: 0x01, counter: 0x01, parity: 0x00 } },
  ];

  for (const { name, opts } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, advanceBarrelRelease);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    const path = classify(entry);
    if (path === "gate-return") {
      assert.equal(after.mem.read8(FRAME_GATE), (opts.gate - 1) & 0xff, `${name}: gate not decremented`);
    } else if (path === "counter0") {
      assert.equal(after.mem.read8(FRAME_GATE), 0x18, `${name}: gate not reloaded to 0x18`);
    } else {
      // A table-load path ran: the correct record is in the sprite-object block, the
      // sub-counter stepped down, and the gate is 0x18 (still stepping) or 0x01 (underflow).
      const index = (opts.parity & 1) ? opts.counter : ((opts.counter - 1) & 0xff);
      const rec = expectedRecord(base, index);
      for (let i = 0; i < RECORD_STRIDE; i++) {
        assert.equal(after.mem.read8((SPRITE_OBJ_BLOCK + i) & 0xffff), rec[i], `${name}: sprite block byte +${i}`);
      }
      assert.equal(after.mem.read8(ANIM_COUNTER), (opts.counter - 1) & 0xff, `${name}: sub-counter not stepped`);
      const underflow = ((opts.counter - 1) & 0xff) === 0;
      assert.equal(after.mem.read8(FRAME_GATE), underflow ? 0x01 : 0x18, `${name}: gate value`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} paths identical to the oracle; record load + gate/sub-counter effects asserted`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the skip-gate-reload twin and the drop-record-adjust twin are CAUGHT", () => {
  const base = attractBase();

  // (a) skip-gate-reload: on a table-load (non-underflow) frame the correct gate is 0x18,
  // the twin leaves it at the decremented 0.
  const gateEntry = craft(base, { gate: 0x01, counter: 0x03, parity: 0x01 });
  const gateDiffs = contractDiffs(gateEntry, brokenSkipGateReload);
  assert.ok(gateDiffs.length > 0, "the skip-gate-reload twin escaped — the gate is worthless");
  assert.ok(gateDiffs[0].startsWith(`RAM@${hx(FRAME_GATE)}`), `expected the diff at ${hx(FRAME_GATE)}, got ${gateDiffs[0]}`);

  // (b) drop-record-adjust: on a parity-CLEAR load frame the correct index is counter-1;
  // the twin uses counter, loading a different 40-byte record into the sprite block.
  const adjEntry = craft(base, { gate: 0x01, counter: 0x03, parity: 0x00 });
  // sanity: the two records actually differ, so the twin is observable.
  assert.notDeepEqual(expectedRecord(base, 3), expectedRecord(base, 2), "records for index 3 vs 2 must differ");
  const adjDiffs = contractDiffs(adjEntry, brokenDropRecordAdjust);
  assert.ok(adjDiffs.length > 0, "the drop-record-adjust twin escaped — the gate is worthless");

  console.log(`  TEETH: skip-gate-reload caught (${gateDiffs[0]}); drop-record-adjust caught (${adjDiffs[0]})`);
});
