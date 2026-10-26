// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepAlienShot (ROM 0x0563) -- the alien-shot object handler. When the shot is live
// (bit 7 of the status byte OBJECT_WORK_BUFFER) it advances one step (draw-phase gate, blowup animation, descend,
// redraw with collision, retire across the shield/ground bands); when idle it decides whether to launch
// a new shot (task-flag / rate-timer gated, firing column via the cursor list or a Y-scale). The callers
// (alienShotSlot2Handler / alienShotSlot4Handler) re-read MEMORY after the call, so the live-out is MEMORY-ONLY: the arms compare
// RAM (-stack), NOT registers. stepAlienShot is a leaf (omits the ROM ret; the seam completes it).
// Run: node --test games/invaders/idiomatic/test/equivalence-0563.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0563 as oracleBody } from "../../translated/loc_0563.js";
import { stepAlienShot } from "../stepAlienShot.js";
import { objectMatchesDrawPhase } from "../objectMatchesDrawPhase.js";
import { stepAlienShotBlowup } from "../stepAlienShotBlowup.js";
import { eraseAlienShot } from "../eraseAlienShot.js";
import { drawAlienShotWithCollision } from "../drawAlienShotWithCollision.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { u8 } from "../../../../core/int.js";
import {
  ACTIVE_PLAYER_PAGE, DRAW_PHASE_FLAG,
  OBJECT_WORK_BUFFER, TASK_FLAGS, SHIP_READY_FLAG, ALIEN_SHOT_RATE_GATE0, ALIEN_SHOT_RATE_GATE_1, loc_2074, loc_2075, ALIEN_SHOT_COLUMN_CURSOR,
  PLAYER_SHIP_X, loc_2009, loc_200a, loc_20cf, ALIEN_SHOT_COORD, loc_207c, ALIEN_SHOT_STEP, ALIEN_SHOT_SPRITE_FRAME_CEILING,
  ALIEN_SHOT_SPRITE_PTR, ALIEN_SHOT_ROW_COUNT, COLLISION_FLAG, loc_2015, GAME_OBJECT_TABLE,
} from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0563;

// Seed a fresh machine: SP at the stack top (so the oracle's nested m.call pushes land in the dead
// scratch the diff excludes), interrupts off, and a small bounded shot descriptor so the draw helpers
// blit a handful of rows into video RAM.
function base(m) {
  m.regs.sp = 0x2400;
  m.io.setInte(false);
  m.mem.write8(ALIEN_SHOT_ROW_COUNT, 6); // bound the descriptor draw to a handful of rows
  m.mem.write8(0x2079, 0x00);            // descriptor E (screen-addr low)
  m.mem.write8(0x207a, 0x28);            // descriptor D (gfx-ptr low)
}

function make(seed) {
  const m = new Machine(ROM);
  base(m);
  seed(m);
  return m;
}

// Seed the active descend at low-byte Y `y`. To reach the collision-band sub-tree an isolated shot must
// actually collide: seat ALIEN_SHOT_COORD at a video-RAM address whose low byte becomes `y` after a NONZERO +step
// move, so eraseAlienShot clears the OLD position and drawAlienShotWithCollision redraws over seeded pixels
// at the NEW one and latches COLLISION_FLAG. A zero step leaves COLLISION_FLAG 0 (the redraw lands on the
// just-erased footprint) -- that is the collision==0 return path. The mem16 write also sets loc_207c (the
// draw-phase byte) to the high byte 0x2a, whose bit7 is clear and so matches DRAW_PHASE_FLAG 0x00.
function activeDescend(y, collide) {
  return (m) => {
    m.mem.write8(OBJECT_WORK_BUFFER, 0x80); m.mem.write8(DRAW_PHASE_FLAG, 0x00);
    const step = collide ? 0x08 : 0x00;
    m.mem.write16(ALIEN_SHOT_COORD, (0x2a00 | y) - step);
    m.mem.write8(ALIEN_SHOT_STEP, step); m.mem.write8(ALIEN_SHOT_SPRITE_FRAME_CEILING, 0x40);
    m.mem.write8(ALIEN_SHOT_SPRITE_PTR, 0x10); m.mem.write8(loc_2015, 0x77);
    if (collide) for (let a = 0x2400; a <= 0x3fff; a++) m.mem.write8(a, 0xff);
  };
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
// The attract boot dispatches 0x0563 only on its SPAWN path (no live shot descends in attract), so the
// CAPTURE arm exercises the spawn branch on real states while the active-descend branch and the
// collision-band sub-tree are driven by the CRAFTED cases below (real oracle vs idiomatic, seeded per branch).
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0563 dispatches -- stepAlienShot == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x40 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); stepAlienShot(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: each branch of the handler leaves identical RAM (-stack)", () => {
  const cases = [
    // --- ACTIVE-SHOT branch (status bit 7 set) ---
    {
      tag: "active: draw-phase mismatch -> return (no writes)",
      seed: (m) => { m.mem.write8(OBJECT_WORK_BUFFER, 0x80); m.mem.write8(DRAW_PHASE_FLAG, 0x80); m.mem.write8(loc_207c, 0x00); },
    },
    {
      tag: "active: blowup bit set -> stepAlienShotBlowup (tail)",
      seed: (m) => {
        m.mem.write8(OBJECT_WORK_BUFFER, 0x81); m.mem.write8(DRAW_PHASE_FLAG, 0x00); m.mem.write8(loc_207c, 0x00);
        m.mem.write8(ALIEN_SHOT_ROW_COUNT, 6);
      },
    },
    // land threshold 0x15 and the collision-band sub-tree, each at its exact boundary so a +/-1 shift of
    // any bound diverges. y<0x15 lands (set bit0, no collision read); y==0x15 with no collision returns
    // WITHOUT bit0; [0x15,0x1e) and >=0x27 with collision set bit0; [0x1e,0x27) with collision writes
    // loc_2015=0. The collision cases really collide (activeDescend moves the shot over seeded video RAM).
    { tag: "active: y=0x14 < 0x15 -> land, set bit0, no collision read", seed: activeDescend(0x14, false) },
    { tag: "active: y=0x15 boundary, collision==0 -> return WITHOUT bit0", seed: activeDescend(0x15, false) },
    { tag: "active: y=0x1d in [0x15,0x1e) with collision -> set bit0, no band write", seed: activeDescend(0x1d, true) },
    { tag: "active: y=0x1e band-lo boundary with collision -> loc_2015=0", seed: activeDescend(0x1e, true) },
    { tag: "active: y=0x26 band-hi boundary with collision -> loc_2015=0", seed: activeDescend(0x26, true) },
    { tag: "active: y=0x27 >= 0x27 with collision -> set bit0, no band write", seed: activeDescend(0x27, true) },
    {
      tag: "active: sprite-ptr wrap (a >= ALIEN_SHOT_SPRITE_FRAME_CEILING -> a-0x0c)",
      seed: (m) => {
        m.mem.write8(OBJECT_WORK_BUFFER, 0x80); m.mem.write8(DRAW_PHASE_FLAG, 0x00); m.mem.write8(loc_207c, 0x00);
        m.mem.write8(ALIEN_SHOT_COORD, 0x00); m.mem.write8(ALIEN_SHOT_STEP, 0x00);
        m.mem.write8(ALIEN_SHOT_SPRITE_PTR, 0x30); m.mem.write8(ALIEN_SHOT_SPRITE_FRAME_CEILING, 0x10);
      },
    },
    // --- SPAWN branch (status bit 7 clear) ---
    {
      tag: "spawn: TASK_FLAGS == 4 -> activate",
      seed: (m) => { m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 4); m.mem.write8(loc_2074, 9); },
    },
    {
      tag: "spawn: SHIP_READY_FLAG == 0 -> return before any write",
      seed: (m) => { m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 0); m.mem.write8(SHIP_READY_FLAG, 0); },
    },
    {
      tag: "spawn: t70 gate (rate >= gate0) -> return after clearing loc_2074",
      seed: (m) => {
        m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 0); m.mem.write8(SHIP_READY_FLAG, 1);
        m.mem.write8(loc_2074, 5); m.mem.write8(ALIEN_SHOT_RATE_GATE0, 1); m.mem.write8(loc_20cf, 1);
      },
    },
    {
      tag: "spawn: t71 gate (t70==0, rate >= gate1) -> return",
      seed: (m) => {
        m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 0); m.mem.write8(SHIP_READY_FLAG, 1);
        m.mem.write8(loc_2074, 5); m.mem.write8(ALIEN_SHOT_RATE_GATE0, 0); m.mem.write8(ALIEN_SHOT_RATE_GATE_1, 2); m.mem.write8(loc_20cf, 3);
      },
    },
    {
      tag: "spawn via cursor (loc_2075 != 0), scan HIT -> seat descriptor + activate",
      seed: (m) => {
        m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 0); m.mem.write8(SHIP_READY_FLAG, 1);
        m.mem.write8(ALIEN_SHOT_RATE_GATE0, 0); m.mem.write8(ALIEN_SHOT_RATE_GATE_1, 0); m.mem.write8(loc_2075, 1);
        m.mem.write16(ALIEN_SHOT_COLUMN_CURSOR, GAME_OBJECT_TABLE); m.mem.write8(GAME_OBJECT_TABLE, 0x0c); // column = 12
        m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21); m.mem.write8(0x210b, 1);                    // slot (0x0c-1) live -> HIT
        m.mem.write8(loc_2009, 0x10); m.mem.write8(loc_200a, 0x20);
      },
    },
    {
      tag: "spawn via cursor (loc_2075 != 0), scan MISS -> return",
      seed: (m) => {
        m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 0); m.mem.write8(SHIP_READY_FLAG, 1);
        m.mem.write8(ALIEN_SHOT_RATE_GATE0, 0); m.mem.write8(ALIEN_SHOT_RATE_GATE_1, 0); m.mem.write8(loc_2075, 1);
        m.mem.write16(ALIEN_SHOT_COLUMN_CURSOR, GAME_OBJECT_TABLE); m.mem.write8(GAME_OBJECT_TABLE, 0x01); // column = 1, low start
        m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21);                                            // all slots empty -> MISS
      },
    },
    {
      tag: "spawn via scaleYToBlock (loc_2075 == 0) -> column from Y-scale, scan",
      seed: (m) => {
        m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 0); m.mem.write8(SHIP_READY_FLAG, 1);
        m.mem.write8(ALIEN_SHOT_RATE_GATE0, 0); m.mem.write8(ALIEN_SHOT_RATE_GATE_1, 0); m.mem.write8(loc_2075, 0);
        m.mem.write8(PLAYER_SHIP_X, 0x10); m.mem.write8(loc_200a, 0x30); m.mem.write8(loc_2009, 0x10);
        m.mem.write8(ACTIVE_PLAYER_PAGE, 0x21);
      },
    },
  ];
  for (const { tag, seed } of cases) {
    const o = make(seed);
    const c = make(seed);
    oracle(o); stepAlienShot(c);
    assert.equal(ramDiff(o, c), null, tag);
  }
});

// TEETH run a BROKEN inline copy of the module's logic (not a bare constant) and assert the RAM-diff
// check catches the corruption -- a mutant whose only change is one wrong operation must diverge.
test("TEETH: a twin that activates the wrong status bit diverges in RAM", () => {
  // Real activate path, one broken op: sets bit 6 instead of the live bit 7.
  function stepAlienShot_wrongActivateBit(m) {
    if (m.mem8[OBJECT_WORK_BUFFER] & 0x80) return;                 // (seed keeps us on the spawn path)
    if (m.mem8[TASK_FLAGS] === 4) {
      m.mem8[OBJECT_WORK_BUFFER] |= 0x40;                          // BUG: should be 0x80
      m.mem8[loc_2074] = m.mem8[loc_2074] + 1;
      return;
    }
  }
  const seed = (m) => { m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 4); m.mem.write8(loc_2074, 9); };
  const o = make(seed); const c = make(seed);
  oracle(o); stepAlienShot_wrongActivateBit(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a wrong activation bit");
});

test("TEETH: a twin that skips clearing loc_2074 diverges in RAM", () => {
  // Real spawn-gating path, one broken op: drops the `loc_2074 = 0` write before the rate gate returns.
  function stepAlienShot_droppedClear(m) {
    if (m.mem8[OBJECT_WORK_BUFFER] & 0x80) return;
    if (m.mem8[TASK_FLAGS] === 4) { m.mem8[OBJECT_WORK_BUFFER] |= 0x80; m.mem8[loc_2074] = m.mem8[loc_2074] + 1; return; }
    if (m.mem8[SHIP_READY_FLAG] === 0) return;
    // BUG: dropped `m.mem8[loc_2074] = 0;`
    const rate = m.mem8[loc_20cf];
    const gate0 = m.mem8[ALIEN_SHOT_RATE_GATE0];
    if (gate0 !== 0 && rate >= gate0) return;
  }
  const seed = (m) => {
    m.mem.write8(OBJECT_WORK_BUFFER, 0x00); m.mem.write8(TASK_FLAGS, 0); m.mem.write8(SHIP_READY_FLAG, 1);
    m.mem.write8(loc_2074, 5); m.mem.write8(ALIEN_SHOT_RATE_GATE0, 1); m.mem.write8(loc_20cf, 1);
  };
  const o = make(seed); const c = make(seed);
  oracle(o); stepAlienShot_droppedClear(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a dropped loc_2074 clear");
});

test("TEETH: a twin with the wrong collision-band upper bound diverges in RAM", () => {
  // Real active-shot tail, one broken op: band-hi 0x27 -> 0x26, so at y=0x26 the loc_2015=0 band write is
  // skipped. Only reachable because activeDescend forces a real collision at the band boundary.
  function stepAlienShot_wrongBandHi(m) {
    if ((m.mem8[OBJECT_WORK_BUFFER] & 0x80) === 0) return;
    if (!objectMatchesDrawPhase(m, loc_207c)) return;
    if (m.mem8[OBJECT_WORK_BUFFER] & 0x01) return stepAlienShotBlowup(m);
    m.mem8[loc_2074] = m.mem8[loc_2074] + 1;
    eraseAlienShot(m);
    let s = u8(m.mem8[ALIEN_SHOT_SPRITE_PTR] + 3);
    if (s >= m.mem8[ALIEN_SHOT_SPRITE_FRAME_CEILING]) s = u8(s - 12);
    m.mem8[ALIEN_SHOT_SPRITE_PTR] = s;
    m.mem8[ALIEN_SHOT_COORD] = m.mem8[ALIEN_SHOT_COORD] + m.mem8[ALIEN_SHOT_STEP];
    drawAlienShotWithCollision(m);
    const y = m.mem8[ALIEN_SHOT_COORD];
    if (y >= 0x15) {
      if (m.mem8[COLLISION_FLAG] === 0) return;
      if (y >= 0x1e && y < 0x26) m.mem8[loc_2015] = 0; // BUG: upper bound should be 0x27
    }
    m.mem8[OBJECT_WORK_BUFFER] |= 0x01;
  }
  const seed = activeDescend(0x26, true);
  const o = make(seed); const c = make(seed);
  oracle(o); stepAlienShot_wrongBandHi(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a wrong collision-band upper bound");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  // Seed the spawn early-return path (SHIP_READY_FLAG == 0): stepAlienShot does no stack work, so the seam completes
  // its ret (SP unmoved). stepAlienShot dissolves every call, so no path is a +2 tail-dispatch.
  const m = make((mm) => { mm.mem.write8(OBJECT_WORK_BUFFER, 0x00); mm.mem.write8(TASK_FLAGS, 0); mm.mem.write8(SHIP_READY_FLAG, 0); });
  m.mem.write16(0x2400, 0xabcd); // a real caller-return word for the seam to consume
  const r = seamPlaceable(withOmittedRet, stepAlienShot, TARGET, m);
  assert.equal(r.placeable, true, `stepAlienShot must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
