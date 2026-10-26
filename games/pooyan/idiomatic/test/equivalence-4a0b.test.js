// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintSpawnPhaseMarkerColumn (ROM 0x4a0b, Pooyan) — draw the round marker. Gated on
 * ROUND_COUNTER (0x8907) bit0: clear -> ret. Else it snapshots SPAWN_PHASE_COUNTER (0x8902) into
 * 0x8d43 and ROPE_DRAW_COUNT (0x8934); for count N>0 it paints N stacked pairs of a two-wide
 * marker down a video-RAM column from 0x86c3 (stride 0x20), saves the layout pointer to 0x8932,
 * and calls blitTile3x3Block (0x3307) for the glyph block; for count 0 it saves the alternate
 * pointer and blits the fixed glyph at 0x8682. Source glyph is ROM 0x2754.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES video + work RAM, so each case runs the
 * oracle on one FRESH clone and paintSpawnPhaseMarkerColumn on another, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). pc/SP are NOT compared; there is no register live-out (the blitter's advanced
 * HL/DE are dropped by 0x4a0b's ret and read by no caller). The oracle's `call 0x3307` resolves
 * through the translated registry `new Machine(ROM)` builds, so the gate cross-checks the idiomatic
 * blitTile3x3Block against translated loc_3307 on the crafted (0x8f0b=0) states.
 *
 * Jobs:
 *   1. EQUAL (crafted, both branches) — gate-clear (no writes), count 0, and counts 1/2/3 leave
 *      identical RAM(−stack); the two snapshot cells equal the count.
 *   2. WRITE-SET — a count-1 run writes only within video RAM + {0x8d43, 0x8934, 0x8932/0x8933}.
 *   3. TEETH — a wrong marker tile is caught at its cell.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-4a0b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4a0b as oracle } from "../../translated/loc_4a0b.js";
import { paintSpawnPhaseMarkerColumn } from "../paintSpawnPhaseMarkerColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROUND_COUNTER = 0x8907;
const SPAWN_PHASE_COUNTER = 0x8902;
const SPAWN_PHASE_SNAPSHOT = 0x8d43;
const ROPE_DRAW_COUNT = 0x8934;
const MARKER_LAYOUT_PTR = 0x8932; // 16-bit
const MARKER_TOP = 0x86c3; // count>0 paint start
const VRAM_LO = 0x8400;
const VRAM_HI = 0x8800;
const CONTROL_CELLS = new Set([SPAWN_PHASE_SNAPSHOT, ROPE_DRAW_COUNT, MARKER_LAYOUT_PTR, MARKER_LAYOUT_PTR + 1]);
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone: round-counter bit0 + spawn-phase count seeded, snapshot cells pre-dirtied, SP dead. */
function craft(gateOdd, count) {
  const m = BASE.clone();
  m.mem.write8(ROUND_COUNTER, gateOdd ? 0x03 : 0x02); // bit0 = feature on/off
  m.mem.write8(SPAWN_PHASE_COUNTER, count & 0xff);
  m.mem.write8(SPAWN_PHASE_SNAPSHOT, 0xee); // sentinel so the snapshot write is observable
  m.mem.write8(ROPE_DRAW_COUNT, 0xee);
  m.regs.sp = 0x8ffe;
  return m;
}

// [gateOdd, count, label]
const CASES = [
  [false, 0x03, "gate clear -> ret (no writes)"],
  [true, 0x00, "count 0 -> fixed glyph"],
  [true, 0x01, "count 1 -> one marker pair + glyph"],
  [true, 0x02, "count 2 -> two marker pairs + glyph"],
  [true, 0x03, "count 3 -> three marker pairs + glyph"],
];

// -- 1. EQUAL (crafted, both branches) ----------------------------------------

test("EQUAL: crafted gate/count — paintSpawnPhaseMarkerColumn == oracle in RAM(−stack)", () => {
  for (const [gateOdd, count, label] of CASES) {
    const o = craft(gateOdd, count);
    const c = craft(gateOdd, count);
    oracle(o);
    paintSpawnPhaseMarkerColumn(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} [${label}]: oracle=${d.a} mine=${d.b}`);
    if (gateOdd) {
      assert.equal(c.mem.read8(SPAWN_PHASE_SNAPSHOT), count, `snapshot cell wrong [${label}]`);
      assert.equal(c.mem.read8(ROPE_DRAW_COUNT), count, `rope-draw-count cell wrong [${label}]`);
    } else {
      // gate clear: the snapshot sentinel must be untouched (no writes at all)
      assert.equal(c.mem.read8(SPAWN_PHASE_SNAPSHOT), 0xee, "gate-clear path must not write");
    }
  }
  console.log(`  EQUAL: ${CASES.length} gate/count cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a count-1 run writes only video RAM + the three control cells", () => {
  const before = craft(true, 0x01);
  const after = craft(true, 0x01);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push(addr);
    }
  }
  for (const addr of changed) {
    const ok = CONTROL_CELLS.has(addr) || (addr >= VRAM_LO && addr < VRAM_HI);
    assert.ok(ok, `unexpected write at ${hx(addr)}`);
  }
  assert.ok(changed.includes(SPAWN_PHASE_SNAPSHOT), "snapshot cell should have changed");
  assert.ok(changed.includes(ROPE_DRAW_COUNT), "rope-draw-count cell should have changed");
  assert.ok(changed.includes(MARKER_LAYOUT_PTR), "layout pointer low byte should have changed");
  console.log(`  WRITE-SET: ${changed.length} writes, all in video RAM + control cells`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong marker tile is caught at its cell", () => {
  const o = craft(true, 0x01);
  const c = craft(true, 0x01);
  oracle(o);
  paintSpawnPhaseMarkerColumn(c);
  c.mem.write8(MARKER_TOP, (c.mem.read8(MARKER_TOP) ^ 0xff) & 0xff); // BUG: corrupt the top marker tile
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong marker tile — it is worthless");
  assert.equal(d.addr, MARKER_TOP, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong marker tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
