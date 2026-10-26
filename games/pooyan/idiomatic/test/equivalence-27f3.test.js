// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnEnemyTargetOrAnimateLaunchFlipTile (ROM 0x27f3) — launch-state-machine state 1. With the
 * arrow at/above its gate (0x34) it decrements a flip countdown (0x892f); when that reaches zero
 * it reseeds it to 0x10, steps a shared phase byte (0x892e) and tail-blits one of two arrow tiles
 * (ROM 0x2d51 / 0x2d55) chosen by that byte's parity. Below the gate it scans the two enemy-target
 * records (0x8c90 / 0x8ca8) for a free one; a free record advances the launch state (0x8f30 := 2),
 * marks the record, queues display command 0x0a (queueSoundCommand0A), blits the alternate tile, may light a
 * HUD cell (0x8508), and seeds three record fields (0x8a99 / 0x8a9e / 0x8aa7).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine WRITES
 * work + video RAM, so each case uses a FRESH clone per side, compared on RAM (dumpState) minus
 * stack scratch below the entry SP. pc/SP/cycles are NOT compared. spawnEnemyTargetOrAnimateLaunchFlipTile is a dispatched handler (dispatchLaunchState state 1)
 * with NO consumed register live-out, so only RAM is compared. The oracle's `ex af,af'; add a,l` on
 * the HUD-off path touches only the shadow accumulator (no memory, unconsumed) and is dropped in the
 * rewrite, matching in RAM. The tail m.call(0x3325) / mid m.call(0x0f05) equal the idiomatic
 * blit2x2TileBlock / queueSoundCommand0A; the oracle's rets pop the excluded stack.
 *
 * Every case is CRAFTED (the handler runs under the launch state machine, not a plain dispatch of
 * 0x27f3): all input cells poked identically on both sides. Sound gates (game-active / play-mode)
 * are held closed on the write-set case so queueSoundCommand0A writes only the pending-byte cell (0x8d20).
 *
 * Jobs:
 *   1. EQUAL — flip (not-elapsed / elapse both parities / underflow) and slot (no-free, free-rec0
 *      HUD-on/off, free-rec1, HUD-via-playmode with the sound ring open) paths, plus the gate
 *      boundary: spawnEnemyTargetOrAnimateLaunchFlipTile == oracle in RAM (−stack).
 *   2. WRITE-SET — the full slot-success path (sound gate closed) writes within its documented
 *      footprint, and the 2x2 blit copies ROM 0x2d55.
 *   3. TEETH — an inverted arrow gate is CAUGHT; and a wrong launch-state byte is CAUGHT at 0x8f30.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-27f3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_27f3 as oracle } from "../../translated/loc_27f3.js";
import { spawnEnemyTargetOrAnimateLaunchFlipTile } from "../spawnEnemyTargetOrAnimateLaunchFlipTile.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

// Input / output cells
const ARROW_Y = 0x8ab4;
const LAUNCH_FLIP_COUNTDOWN = 0x892f;
const SHARED_PHASE_COUNTDOWN = 0x892e;
const REC0 = 0x8c90;
const REC1 = 0x8ca8;
const LAUNCH_STATE = 0x8f30;
const PLAY_MODE_LATCH = 0x8f50;
const LAUNCH_ARMED_FLAG = 0x8f3f;
const LAUNCH_HUD_TILE = 0x8508;
const GAME_ACTIVE_FLAG = 0x8806;
const CELL_8A99 = 0x8a99;
const CELL_8A86 = 0x8a86;
const CELL_8A9E = 0x8a9e;
const CELL_8AA7 = 0x8aa7;
const SOUND_RING_PENDING_BYTE = 0x8d20;
const LAUNCH_TILE_VRAM = 0x84a7;
const LAUNCH_TILE_SRC = 0x2d51;
const LAUNCH_TILE_SRC_ALT = 0x2d55;
const BLIT_CELLS = [LAUNCH_TILE_VRAM, LAUNCH_TILE_VRAM + 0x01, LAUNCH_TILE_VRAM + 0x21, LAUNCH_TILE_VRAM + 0x20];

const ARROW_Y_GATE = 0x34;
const DISPLAY_CMD_0A = 0x0a; // queueSoundCommand0A's command byte
const SEED_86 = 0x20; // crafted source coordinate at 0x8a86

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const DEFAULT = {
  arrowY: 0x40, flip: 0x05, shared: 0x00, rec0: 0x01, rec1: 0x01,
  launchState: 0x01, playMode: 0, armed: 0, gameActive: 0, seed86: SEED_86,
};

function craft(over = {}) {
  const s = { ...DEFAULT, ...over };
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // work RAM; the oracle's calls/rets only POP (read) STACK_SCRATCH
  m.mem.write8(ARROW_Y, s.arrowY & 0xff);
  m.mem.write8(LAUNCH_FLIP_COUNTDOWN, s.flip & 0xff);
  m.mem.write8(SHARED_PHASE_COUNTDOWN, s.shared & 0xff);
  m.mem.write8(REC0, s.rec0 & 0xff);
  m.mem.write8(REC1, s.rec1 & 0xff);
  m.mem.write8(LAUNCH_STATE, s.launchState & 0xff);
  m.mem.write8(PLAY_MODE_LATCH, s.playMode & 0xff);
  m.mem.write8(LAUNCH_ARMED_FLAG, s.armed & 0xff);
  m.mem.write8(GAME_ACTIVE_FLAG, s.gameActive & 0xff);
  m.mem.write8(CELL_8A86, s.seed86 & 0xff);
  return m;
}

const CASES = [
  ["flip: countdown not elapsed", { arrowY: 0x40, flip: 0x05 }],
  ["flip: elapse, parity odd -> src 0x2d51", { arrowY: 0x40, flip: 0x01, shared: 0x00 }],
  ["flip: elapse, parity even -> src 0x2d55", { arrowY: 0x40, flip: 0x01, shared: 0x01 }],
  ["flip: countdown 0 underflows to 0xff (not elapsed)", { arrowY: 0x40, flip: 0x00 }],
  ["flip: gate boundary arrowY == 0x34", { arrowY: 0x34, flip: 0x05 }],
  ["slot: no free record", { arrowY: 0x20, rec0: 0x01, rec1: 0x01 }],
  ["slot: free rec0, HUD lit (armed), sound gate closed", { arrowY: 0x20, rec0: 0x00, armed: 1 }],
  ["slot: free rec0, HUD off", { arrowY: 0x20, rec0: 0x00, armed: 0, playMode: 0 }],
  ["slot: rec0 busy, free rec1", { arrowY: 0x20, rec0: 0x01, rec1: 0x00, armed: 1 }],
  ["slot: free rec0, HUD via play-mode, sound ring OPEN", { arrowY: 0x20, rec0: 0x00, playMode: 1, gameActive: 0 }],
  ["slot: gate boundary arrowY == 0x33", { arrowY: 0x33, rec0: 0x01, rec1: 0x01 }],
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted flip + slot paths — spawnEnemyTargetOrAnimateLaunchFlipTile == oracle in RAM (−stack)", () => {
  for (const [label, over] of CASES) {
    const o = craft(over);
    const c = craft(over);
    oracle(o);
    spawnEnemyTargetOrAnimateLaunchFlipTile(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b} [${label}]`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: full slot-success writes stay within footprint; blit copies ROM 0x2d55", () => {
  const footprint = new Set([
    LAUNCH_STATE, REC0, LAUNCH_HUD_TILE, CELL_8A99, CELL_8A9E, CELL_8AA7, SOUND_RING_PENDING_BYTE, ...BLIT_CELLS,
  ]);
  const m = craft({ arrowY: 0x20, rec0: 0x00, armed: 1, playMode: 0, gameActive: 0 });
  // Sentinel the pure-output cells so each write is observable (REC0 stays 0 = the free slot).
  for (const cell of [LAUNCH_STATE, LAUNCH_HUD_TILE, CELL_8A99, CELL_8A9E, CELL_8AA7, SOUND_RING_PENDING_BYTE]) {
    m.mem.write8(cell, 0xee);
  }
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (!inDeadStack(addr)) changed.push(addr);
  }
  for (const addr of changed) assert.ok(footprint.has(addr), `oracle wrote outside the footprint at ${hx(addr)}`);
  for (const cell of [LAUNCH_STATE, REC0, LAUNCH_HUD_TILE, CELL_8A99, CELL_8A9E, CELL_8AA7, SOUND_RING_PENDING_BYTE]) {
    assert.ok(changed.includes(cell), `expected a write at ${hx(cell)}`);
  }
  assert.equal(m.mem.read8(LAUNCH_STATE), 0x02, "launch state must advance to 2");
  assert.equal(m.mem.read8(REC0), 0x02, "the free record is marked 2");
  assert.equal(m.mem.read8(LAUNCH_HUD_TILE), 0x10, "HUD tile lit to 0x10");
  assert.equal(m.mem.read8(CELL_8A99), 0x01, "0x8a99 seeded to 1");
  assert.equal(m.mem.read8(CELL_8A9E), (SEED_86 + 0x0c) & 0xff, "0x8a9e = source + 0x0c");
  assert.equal(m.mem.read8(CELL_8AA7), 0x10, "0x8aa7 seeded to 0x10");
  assert.equal(m.mem.read8(SOUND_RING_PENDING_BYTE), DISPLAY_CMD_0A, "queueSoundCommand0A stored command 0x0a");
  // The 2x2 blit copies ROM 0x2d55..0x2d58 into TL, TR (+1), BR (+0x21), BL (+0x20).
  assert.equal(m.mem.read8(BLIT_CELLS[0]), m.mem.read8(LAUNCH_TILE_SRC_ALT + 0), "blit TL");
  assert.equal(m.mem.read8(BLIT_CELLS[1]), m.mem.read8(LAUNCH_TILE_SRC_ALT + 1), "blit TR");
  assert.equal(m.mem.read8(BLIT_CELLS[2]), m.mem.read8(LAUNCH_TILE_SRC_ALT + 2), "blit BR");
  assert.equal(m.mem.read8(BLIT_CELLS[3]), m.mem.read8(LAUNCH_TILE_SRC_ALT + 3), "blit BL");
  console.log(`  WRITE-SET: ${changed.length} cells within footprint; blit copied 0x2d55`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: inverts the arrow gate, so an at/above-gate arrow wrongly takes the slot path. */
function brokenArrowGate(m) {
  const { mem8 } = m;
  if (mem8[ARROW_Y] < ARROW_Y_GATE) { // BUG: inverted (real routine animates at/above the gate)
    mem8[LAUNCH_FLIP_COUNTDOWN] = mem8[LAUNCH_FLIP_COUNTDOWN] - 1;
    return;
  }
  const free = [REC0, REC1].find((r) => mem8[r] === 0);
  if (free === undefined) return; // no free record on the teeth case -> no writes
  mem8[LAUNCH_STATE] = 0x02;
}

test("TEETH: an inverted arrow gate is CAUGHT (twin skips the flip decrement)", () => {
  const over = { arrowY: 0x40, flip: 0x05, rec0: 0x01, rec1: 0x01 };
  const o = craft(over);
  const c = craft(over);
  oracle(o);
  brokenArrowGate(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the inverted arrow gate — it is worthless");
  assert.equal(d.addr, LAUNCH_FLIP_COUNTDOWN, `expected the miss at ${hx(LAUNCH_FLIP_COUNTDOWN)}, got ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/gate: inverted gate caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong launch-state byte is CAUGHT at 0x8f30", () => {
  const over = { arrowY: 0x20, rec0: 0x00, armed: 1 };
  const o = craft(over);
  const c = craft(over);
  oracle(o);
  spawnEnemyTargetOrAnimateLaunchFlipTile(c);
  c.mem.write8(LAUNCH_STATE, 0x00); // BUG: state must have advanced to 2
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong launch-state byte");
  assert.equal(d.addr, LAUNCH_STATE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(LAUNCH_STATE)})`);
  console.log(`  TEETH/state: wrong launch-state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
