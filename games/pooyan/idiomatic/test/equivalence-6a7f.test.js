// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runObjectsElseVerifyTilemapChecksum (ROM 0x6a7f, Pooyan) — "per-frame object driver + one-shot
 * tilemap integrity check".
 *
 * runObjectsElseVerifyTilemapChecksum has two arms. When the blink-phase byte (0x892b) is set it is a CALLER: it walks 18
 * enemy-actor records (0x8ae0, stride 0x18) through the already-decompiled per-object handler
 * dispatchDescendingObjectState. When the byte is clear, at wave index 2 and once per pass (latched at 0x8f56), it
 * checksums the playfield tilemap and TRAPS (throws) on a mismatch. This gate composes the
 * idiomatic runObjectsElseVerifyTilemapChecksum (which imports the idiomatic dispatchDescendingObjectState subtree) against the translated oracle
 * (which runs the same subtree through m.call), on fresh clones, in RAM (dumpState) minus
 * stack scratch below the entry SP — plus the throw decision for the integrity arm.
 *
 * Loop-arm determinism: an inactive record ((rec+1)=0) makes dispatchDescendingObjectState return at once, so zeroing
 * every record's +1 byte makes the loop a pure no-op. Activating all 18 (state 1 -> descendObjectThenAdvanceStateAtBottom, with
 * a live frame-hold so advanceObjectAnimationFrame just decrements, and a still-descending position) gives each record
 * a fixed two-cell write footprint; the 18-record spread at stride 0x18 is the loop bound witness.
 *
 * Integrity-arm construction: the walked-cell SET is value-independent, so `walkCells()` re-derives
 * the visited addresses; placing 0xb8 then 82 bytes of 0x80 at the first visited cells makes the
 * 16-bit sum land on the pass value. The ORACLE arbitrates the walk — if `walkCells()` were wrong,
 * the oracle would trap the "valid" tilemap and INTEGRITY-CLEAN would fail.
 *
 * LIVE-OUT: none (memory only) — the record cursor is local; runObjectsElseVerifyTilemapChecksum is the last call in its
 * per-frame group driver, which returns immediately, so no register is read back.
 *
 * Jobs:
 *   1. EQUAL — loop no-op (all inactive); loop full (all active); integrity gate-bails (wrong wave,
 *      latch held): oracle == module in RAM (−stack).
 *   2. INTEGRITY — valid tilemap: neither traps, latch set, RAM (−stack) equal. Corrupted (one byte
 *      +1): both trap, latch set before the trap, RAM (−stack) equal.
 *   3. WRITE-SET — loop-full changes the identical 36-cell record set; integrity-clean changes only
 *      the latch; gate-bails change nothing.
 *   4. TEETH — throw tightness (rets on valid, traps on +1); a wrong latch byte and a wrong record
 *      field are CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6a7f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6a7f as oracle } from "../../translated/loc_6a7f.js";
import { runObjectsElseVerifyTilemapChecksum } from "../runObjectsElseVerifyTilemapChecksum.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BLINK = 0x892b; // BLINK_PHASE — nonzero selects the record-loop arm
const WAVE = 0x892d; // WAVE_NUMBER — integrity arm runs only at wave index 2
const LATCH = 0x8f56; // TILE_SUM_ONCE_LATCH — once-per-pass gate, set to 1 by the check
const ENEMY = 0x8ae0; // ENEMY_ACTOR_TABLE — loop base
const TILE_LO = 0x8400;
const TILE_HI = 0x87ff;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function changedAddrs(m, run) {
  const before = m.dumpState();
  run(m);
  const after = m.dumpState();
  const out = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] === after[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    out.push(addr);
  }
  return out.sort((a, b) => a - b);
}

/** Re-derive the value-independent sequence of tilemap cells the checksum visits. */
function walkCells() {
  let hi = 0x84;
  let lo = 0x50;
  const cells = [];
  for (;;) {
    if (cells.length > 0x8000) throw new Error("walk did not terminate");
    cells.push((hi << 8) | lo);
    lo = (lo + 1) & 0xff;
    if ((lo & 0x1f) === 0x1b) { lo = (lo + 1) & 0xff; continue; }
    if ((lo & 0x1f) !== 0x1f) continue;
    const t = lo + 0x12;
    lo = t & 0xff;
    if (t <= 0xff) continue;
    hi = (hi + 1) & 0xff;
    if (hi < 0x88) continue;
    break;
  }
  return cells;
}

/** A loop-arm clone: blink phase set, 18 records either all active or all inactive. */
function craftLoop({ active }) {
  const m = BASE.clone();
  m.mem.write8(BLINK, 0x01);
  for (let i = 0; i < 18; i++) {
    const rec = ENEMY + i * 0x18;
    if (active) {
      m.mem.write8(rec + 1, 0x01); // active slot
      m.mem.write8(rec + 2, 0x01); // state 1 -> descendObjectThenAdvanceStateAtBottom
      m.mem.write8(rec + 0x0e, 0x05); // live frame-hold -> advanceObjectAnimationFrame decrements and returns
      m.mem.write8(rec + 5, 0x10); // position low
      m.mem.write8(rec + 6, 0x05); // position high stays nonzero -> still descending
      m.mem.write8(rec + 9, 0x01); // descent speed
    } else {
      m.mem.write8(rec + 1, 0x00); // inactive -> dispatchDescendingObjectState returns immediately
    }
  }
  m.regs.sp = 0x8ffe; // dead stack: oracle exx/rst/call framing touches excluded RAM only
  return m;
}

/** An integrity-arm clone: blink clear, wave/latch poked, tilemap zeroed then optionally made valid. */
function craftIntegrity({ wave = 0x02, latch = 0x00, build = "valid", perturb = false } = {}) {
  const m = BASE.clone();
  m.mem.write8(BLINK, 0x00);
  m.mem.write8(WAVE, wave);
  m.mem.write8(LATCH, latch);
  for (let a = TILE_LO; a <= TILE_HI; a++) m.mem.write8(a, 0x00);
  if (build === "valid") {
    const cells = walkCells();
    m.mem.write8(cells[0], 0xb8);
    for (let i = 1; i <= 82; i++) m.mem.write8(cells[i], 0x80);
    if (perturb) m.mem.write8(cells[0], 0xb9); // one byte off -> sum mismatch
  }
  m.regs.sp = 0x8ffe;
  return m;
}

// -- 0. walk sanity (pure arithmetic) -----------------------------------------

test("walk visits distinct cells and admits the pass-value construction", () => {
  const cells = walkCells();
  assert.equal(new Set(cells).size, cells.length, "visited cells must be distinct");
  assert.ok(cells.length >= 83, "construction needs at least 83 visited cells");
  console.log(`  WALK: ${cells.length} distinct cells ${hx(cells[0])}..${hx(cells[cells.length - 1])}`);
});

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: loop no-op / loop full / integrity gate-bails — runObjectsElseVerifyTilemapChecksum == oracle in RAM (−stack)", () => {
  const cases = [
    { name: "loop, all inactive (no-op)", m: () => craftLoop({ active: false }) },
    { name: "loop, all active", m: () => craftLoop({ active: true }) },
    { name: "integrity gate: wrong wave", m: () => craftIntegrity({ wave: 0x03 }) },
    { name: "integrity gate: latch held", m: () => craftIntegrity({ latch: 0x01 }) },
  ];
  for (const { name, m } of cases) {
    const o = m();
    const c = m();
    oracle(o);
    runObjectsElseVerifyTilemapChecksum(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} cases identical (RAM −stack)`);
});

test("EQUAL/loop: the full loop reaches the last record (count + stride witness)", () => {
  const c = craftLoop({ active: true });
  runObjectsElseVerifyTilemapChecksum(c);
  for (const i of [0, 17]) {
    const rec = ENEMY + i * 0x18;
    assert.equal(c.mem.read8(rec + 0x0e), 0x04, `record ${i} frame-hold must decrement`);
    assert.equal(c.mem.read8(rec + 5), 0x0f, `record ${i} position must step`);
  }
  console.log("  LOOP: records 0 and 17 both stepped -> 18 iterations at stride 0x18");
});

// -- 2. INTEGRITY -------------------------------------------------------------

test("INTEGRITY: a valid tilemap is accepted by both (oracle arbitrates the walk)", () => {
  const o = craftIntegrity({ build: "valid" });
  const c = craftIntegrity({ build: "valid" });
  assert.doesNotThrow(() => oracle(o), "oracle must accept the constructed valid tilemap");
  assert.doesNotThrow(() => runObjectsElseVerifyTilemapChecksum(c), "module must accept the constructed valid tilemap");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(LATCH), 0x01, "the one-shot latch must be set on the clean path");
  console.log("  INTEGRITY/clean: both accept; latch set; RAM −stack equal");
});

test("INTEGRITY: a one-byte-corrupted tilemap traps in both (same latch, same RAM)", () => {
  const o = craftIntegrity({ build: "valid", perturb: true });
  const c = craftIntegrity({ build: "valid", perturb: true });
  assert.throws(() => oracle(o), "oracle must trap a corrupted tilemap");
  assert.throws(() => runObjectsElseVerifyTilemapChecksum(c), "module must trap a corrupted tilemap");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(LATCH), 0x01, "the latch is written before the trap");
  console.log("  INTEGRITY/corrupt: both trap; latch set; RAM −stack equal");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: loop-full -> identical 36-cell record set; integrity-clean -> latch only; bails -> none", () => {
  const oLoop = changedAddrs(craftLoop({ active: true }), oracle);
  const cLoop = changedAddrs(craftLoop({ active: true }), runObjectsElseVerifyTilemapChecksum);
  assert.deepEqual(cLoop, oLoop, "loop module and oracle must change the identical cell set");
  assert.equal(oLoop.length, 36, `loop must touch 2 cells x 18 records, got ${oLoop.length}`);

  assert.deepEqual(changedAddrs(craftIntegrity({ build: "valid" }), oracle), [LATCH], "clean path writes only the latch");
  assert.deepEqual(changedAddrs(craftIntegrity({ wave: 0x03 }), oracle), [], "wrong-wave bail writes nothing");
  assert.deepEqual(changedAddrs(craftIntegrity({ latch: 0x01 }), oracle), [], "latch-held bail writes nothing");
  console.log(`  WRITE-SET: loop -> ${oLoop.length} cells; clean -> [latch]; bails -> 0`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the checksum decision is tight (rets on valid, traps on +1)", () => {
  assert.doesNotThrow(() => runObjectsElseVerifyTilemapChecksum(craftIntegrity({ build: "valid" })), "module must NOT trap a valid tilemap");
  assert.throws(() => runObjectsElseVerifyTilemapChecksum(craftIntegrity({ build: "valid", perturb: true })), "module must trap a +1 tilemap");
  console.log("  TEETH/decision: valid accepted, +1 corruption trapped");
});

test("TEETH: a wrong latch byte (clean path) is CAUGHT by the RAM diff", () => {
  const o = craftIntegrity({ build: "valid" });
  const c = craftIntegrity({ build: "valid" });
  oracle(o);
  runObjectsElseVerifyTilemapChecksum(c);
  c.mem.write8(LATCH, 0x02); // BUG: the latch must be 0x01
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong latch — it is worthless");
  assert.equal(d.addr, LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/latch: wrong latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong record field (loop path) is CAUGHT by the RAM diff", () => {
  const o = craftLoop({ active: true });
  const c = craftLoop({ active: true });
  oracle(o);
  runObjectsElseVerifyTilemapChecksum(c);
  const rec17 = ENEMY + 17 * 0x18;
  c.mem.write8(rec17 + 5, 0x00); // BUG: record 17 position must step to 0x0f
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record field — it is worthless");
  assert.equal(d.addr, rec17 + 5, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/loop: wrong record-17 field caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
