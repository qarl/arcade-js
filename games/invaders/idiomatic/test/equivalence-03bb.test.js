// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for playerShotHandler (ROM 0x03bb) -- the player-shot object handler, reached by the object-
// table walker's computed dispatch (which pushes the record pointer for the handler to pop and discard).
// It skips a raster-half mismatch, then dispatches on the shot status byte at 0x2025: launch (type 1),
// step-in-flight with an erase / Y-advance / collision redraw (type 2), a per-frame retire animation and
// a shared reseed+saucer-key tally (type 3 / others), and an idle return (type 5). The arms compare RAM
// (-stack); playerShotHandler is memory-driven, so the walker discards its registers -- no register live-out.
//
// The attract boot dispatches it heavily across statuses 0/1/2/3 (both raster phases), so the CAPTURE arm
// exercises those on real states; the CRAFTED cases drive statuses 4/5, each type-3 sub-branch, and a
// forced collision that latches PLAYER_SHOT_HIT, with a small safely-placed descriptor so the shared
// erase/blit/collision callees run identically on both sides.
//
// NOT seam-placeable, and deliberately UNWIRED -- same class as alienShotSlot2Handler/alienShotSlot3Handler/saucerHandler: the walker
// leaves the record pointer on the stack, so a correct dispatch nets SP +4 with pc on the walker's
// continuation. Dispatchable only once the walker (walkObjectTable) is idiomatic and calls it directly.
// Run: node --test games/invaders/idiomatic/test/equivalence-03bb.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_03bb as oracleBody } from "../../translated/loc_03bb.js";
import { playerShotHandler } from "../playerShotHandler.js";
import { u8 } from "../../../../core/int.js";
import { loadPlayerShotDescriptor } from "../loadPlayerShotDescriptor.js";
import { eraseShiftedSprite } from "../eraseShiftedSprite.js";
import { drawSpriteWithCollision } from "../drawSpriteWithCollision.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, entryFloor, ramDiff as liveRamDiff } from "./_liveStack.js";
import {
  STACK_SCRATCH, PLAYER_SHOT_STATUS, PLAYER_SHOT_DESC, PLAYER_SHOT_RETIRE_TIMER, loc_2029, loc_202a, PLAYER_SHOT_ROW_COUNT, PLAYER_SHOT_Y_STEP,
  PLAYER_SHIP_X, COLLISION_FLAG, PLAYER_SHOT_HIT, DRAW_PHASE_FLAG, SAUCER_SCORE_KEY_PTR, SAUCER_DIR_SEQ_PTR, SAUCER_ACTIVE,
} from "../names.js";

const oracle = entered(oracleBody);
// The `pop h` at 0x03c1 consumes the walker's record word at [SP]; the oracle's later pushes reuse that dead cell.
const POPPED_ARG = 2;
const ramDiff = (o, c) => liveRamDiff(o, c, entryFloor(o, c) + POPPED_ARG);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x03bb;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 3000) : [];

test("CAPTURE: real 0x03bb dispatches -- playerShotHandler == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x03bb at least once");
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && ((a >= sp - 0x40 && a < sp + POPPED_ARG) || deadStackBelow(STACK_SCRATCH, sp + POPPED_ARG)(a)));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); playerShotHandler(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Craft a fresh machine at the walker's dispatch point: SP just below the record pointer the oracle
// pop-h's off the stack, with a caller-return word above it, interrupts off, and the draw-phase flag
// clear so a bit7-clear X byte matches the phase.
function craft(seed) {
  const m = new Machine(ROM);
  m.regs.sp = 0x23fe;
  m.mem.write16(0x23fe, 0x2024); // record pointer (rec+4) the oracle pops and discards
  m.mem.write16(0x2400, 0xabcd); // caller-return word
  m.io.setInte(false);
  m.mem.write8(DRAW_PHASE_FLAG, 0x00);
  seed(m);
  return m;
}

// A small player-shot descriptor: a 2-row sprite whose X folds to a safe high video-RAM address, with a
// ROM source by default. `src` overrides the source pointer (used to point at a seeded RAM sprite).
function descriptor(m, { y = 0x10, x = 0x50, rows = 0x02, src = 0x1b00 } = {}) {
  m.mem.write8(PLAYER_SHOT_DESC + 0, src & 0xff);
  m.mem.write8(PLAYER_SHOT_DESC + 1, (src >> 8) & 0xff);
  m.mem.write8(loc_2029, y);
  m.mem.write8(loc_202a, x); // X == coord high; bit7 clear matches the phase flag
  m.mem.write8(PLAYER_SHOT_ROW_COUNT, rows);
}

// Force a real collision: a seeded all-ones RAM sprite drawn over an all-ones video-RAM band, so the
// redraw at the advanced Y overlaps set pixels and latches COLLISION_FLAG (and thus PLAYER_SHOT_HIT).
function collideBand(m) {
  for (let a = 0x2100; a < 0x2110; a++) m.mem.write8(a, 0xff);
  for (let a = 0x2800; a < 0x2c00; a++) m.mem.write8(a, 0xff);
}

test("CRAFTED: each status branch leaves identical RAM (-stack)", () => {
  const cases = [
    { tag: "type 0 idle -> return", seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x00); } },
    { tag: "wrong raster half -> return", seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x02); descriptor(m, { x: 0x80 }); m.mem.write8(DRAW_PHASE_FLAG, 0x00); } },
    { tag: "type 1 launch", seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x01); m.mem.write8(PLAYER_SHIP_X, 0x20); descriptor(m); } },
    { tag: "type 2 in flight, no collision", seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x02); descriptor(m); m.mem.write8(PLAYER_SHOT_Y_STEP, 0x08); } },
    {
      tag: "type 2 in flight, collision -> PLAYER_SHOT_HIT",
      seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x02); descriptor(m, { src: 0x2100 }); m.mem.write8(PLAYER_SHOT_Y_STEP, 0x08); collideBand(m); },
    },
    {
      tag: "type 3 countdown hits 0 -> tally (doV bit0 set)",
      seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x03); m.mem.write8(PLAYER_SHOT_RETIRE_TIMER, 0x01); descriptor(m); m.mem.write8(SAUCER_ACTIVE, 0x00); m.mem.write16(SAUCER_SCORE_KEY_PTR, 0x1010); m.mem.write16(SAUCER_DIR_SEQ_PTR, 0x2100); m.mem.write8(0x2101, 0x01); },
    },
    {
      tag: "type 3 countdown hits key clamp (>=0x63 -> 0x54)",
      seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x03); m.mem.write8(PLAYER_SHOT_RETIRE_TIMER, 0x01); descriptor(m); m.mem.write8(SAUCER_ACTIVE, 0x00); m.mem.write16(SAUCER_SCORE_KEY_PTR, 0x0062); m.mem.write16(SAUCER_DIR_SEQ_PTR, 0x2100); m.mem.write8(0x2101, 0x01); },
    },
    {
      tag: "type 3 countdown hits animation frame -> reset + redraw",
      seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x03); m.mem.write8(PLAYER_SHOT_RETIRE_TIMER, 0x10); descriptor(m); },
    },
    { tag: "type 3 countdown mid-run -> return", seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x03); m.mem.write8(PLAYER_SHOT_RETIRE_TIMER, 0x05); descriptor(m); } },
    {
      tag: "type 4 -> tally (doV bit0 clear)",
      seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x04); descriptor(m); m.mem.write8(SAUCER_ACTIVE, 0x00); m.mem.write16(SAUCER_SCORE_KEY_PTR, 0x6210); m.mem.write16(SAUCER_DIR_SEQ_PTR, 0x2100); m.mem.write8(0x2101, 0x00); },
    },
    {
      tag: "type 4 tally, saucer active -> early return",
      seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x04); descriptor(m); m.mem.write8(SAUCER_ACTIVE, 0x01); m.mem.write16(SAUCER_SCORE_KEY_PTR, 0x1010); m.mem.write16(SAUCER_DIR_SEQ_PTR, 0x2100); },
    },
    { tag: "type 5 -> return", seed: (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x05); descriptor(m); } },
  ];
  for (const { tag, seed } of cases) {
    const o = craft(seed), c = craft(seed);
    oracle(o); playerShotHandler(c);
    assert.equal(ramDiff(o, c), null, tag);
  }
});

// TEETH: a broken inline twin of the in-flight (type 2) path that DROPS the collision -> PLAYER_SHOT_HIT
// latch. On a forced collision the oracle sets PLAYER_SHOT_HIT while the twin leaves it clear, so the RAM
// diff must catch it. The seed reaches the doQ path (phase matches, status 2), so the twin is invoked.
function playerShotHandler_droppedHit(m) {
  loadPlayerShotDescriptor(m);
  eraseShiftedSprite(m);
  const y = u8(m.mem8[PLAYER_SHOT_Y_STEP] + m.mem8[loc_2029]);
  m.mem8[loc_2029] = y;
  loadPlayerShotDescriptor(m);
  drawSpriteWithCollision(m, undefined, undefined, y);
  // BUG: dropped `if (m.mem8[COLLISION_FLAG]) m.mem8[PLAYER_SHOT_HIT] = m.mem8[COLLISION_FLAG];`
}

test("TEETH: a twin that drops the collision-hit latch diverges in RAM", () => {
  const seed = (m) => { m.mem.write8(PLAYER_SHOT_STATUS, 0x02); descriptor(m, { src: 0x2100 }); m.mem.write8(PLAYER_SHOT_Y_STEP, 0x08); collideBand(m); };
  const o = craft(seed), c = craft(seed);
  oracle(o); playerShotHandler_droppedHit(c);
  assert.equal(o.mem.read8(PLAYER_SHOT_HIT), 0x01, "the collision seed must latch PLAYER_SHOT_HIT in the oracle");
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a dropped collision-hit latch");
});
