// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceAttractAnimationAndRepaint (ROM 0x0a28, Pooyan) — the 4-phase attract-animation
 * step. It reseeds the frame countdown, bumps the phase counter, looks this phase's 2x2 tile
 * source out of the frame-word table, and stamps it into the block's top and bottom halves.
 *
 * SEATING: TAIL-CALL. The oracle has no ret of its own — it falls through into the paint helper,
 * whose plain ret is advanceAttractAnimationAndRepaint's effective seating (net SP 0 -> WIRE). The module dissolves the
 * paint helper to a direct idiomatic call and the pure ROM frame-word lookup to an inline
 * little-endian read (no RAM effect, registers not read back), so it makes no marshalled call.
 * The oracle drives both through the routines map. LIVE-OUT is memory only, so the register file
 * is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP (SP parked there so the
 * oracle's pushes drop out of the diff).
 *
 * Jobs:
 *   1. EQUAL — for each of the four phases the phase counter selects, oracle == module in RAM.
 *   2. TEETH — a twin that skips the bottom paint diverges inside the bottom block; two phases
 *      produce observably different RAM (the phase input is load-bearing).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0a28.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a28 as oracle } from "../../translated/loc_0a28.js";
import { advanceAttractAnimationAndRepaint } from "../advanceAttractAnimationAndRepaint.js";
import { paintTileBlock2x2 } from "../paintTileBlock2x2.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FRAME_COUNTER = 0x8d41; // ANIM_FRAME_COUNTER, reseeded to 0x0a
const PHASE_COUNTER = 0x8d40; // ACTIVE_ENEMY_COUNT, low 2 bits = anim phase
const TABLE = 0x26f6; // ANIM_FRAME_WORD_TABLE
const TOP = 0x866a; // ANIM_TILE_BLOCK_TOP
const BOTTOM = 0x86aa; // ANIM_TILE_BLOCK_BOTTOM
const SP0 = 0x8fe0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const blockCells = (dst) => new Set([dst, dst + 1, dst + 0x20, dst + 0x21]);

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craftPhase(n) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.hl = FRAME_COUNTER; // caller seats HL: oracle does `ld (hl),0x0a; dec l` -> 0x8d40
  m.mem.write8(PHASE_COUNTER, n); // pre-bump value -> phase = n & 3
  return m;
}

/** A broken step that omits the bottom paint — the teeth twin. */
function runNoBottom(m) {
  const { mem8 } = m;
  mem8[FRAME_COUNTER] = 0x0a;
  const counter = mem8[PHASE_COUNTER];
  mem8[PHASE_COUNTER] = counter + 1;
  const phase = counter & 0x03;
  const entry = TABLE + phase * 2;
  const src = mem8[entry] | (mem8[entry + 1] << 8);
  paintTileBlock2x2(m, TOP, src);
}

// -- 1. EQUAL -----------------------------------------------------------------

for (let n = 0; n < 4; n++) {
  test(`EQUAL: phase ${n} — module == oracle in RAM (−stack)`, () => {
    const o = craftPhase(n);
    const c = craftPhase(n);
    oracle(o);
    advanceAttractAnimationAndRepaint(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `phase ${n}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL phase ${n}: RAM identical`);
  });
}

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: a twin that skips the bottom paint diverges inside the bottom block", () => {
  const o = craftPhase(1);
  const twin = craftPhase(1);
  oracle(o);
  runNoBottom(twin);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "skipping the bottom paint was NOT caught — worthless");
  assert.ok(blockCells(BOTTOM).has(d.addr), `teeth caught wrong address ${hx(d.addr ?? 0)} (expected a bottom-block cell)`);
  console.log(`  TEETH no-bottom-paint: caught at ${hx(d.addr)}`);
});

test("TEETH: distinct phases produce distinct RAM (the phase input is load-bearing)", () => {
  const a = craftPhase(0);
  const b = craftPhase(2);
  oracle(a);
  oracle(b);
  const d = ramDiffMinusStack(a, b);
  assert.notEqual(d, null, "phase 0 and phase 2 produced identical RAM — the phase does nothing");
  console.log(`  TEETH phase-sensitivity: phases 0 vs 2 differ at ${hx(d.addr)}`);
});
