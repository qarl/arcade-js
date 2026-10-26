// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepAlienShotBlowup -- the alien-shot cadence counter. Three arms: (a) at the reload point
// (counter hits 3) erase the current shot (DISSOLVED into eraseAlienShot), re-seat the shot descriptor
// pointer + its two step timers, then redraw (DISSOLVED into drawAlienShotWithCollision, tail-jump); (b)
// at zero just erase (tail-jump); (c) otherwise idle (rnz). Live-out is MEMORY only: the caller (alienShotSlot4Handler)
// reloads A/HL/DE before reading them, so every register the routine leaves is dead -- the contract is RAM
// (the drawn/erased screen bytes, the collision flag, the counter and the re-seeded cells). The oracle
// push/pops the inner call return plus the sprite routines' per-row saves below the entry SP; the RAM diff
// excludes that dead-stack window (the module keeps its stack untouched).
// Run: node --test games/invaders/idiomatic/test/equivalence-0644.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0644 as oracleBody } from "../../translated/loc_0644.js";
import { stepAlienShotBlowup } from "../stepAlienShotBlowup.js";
import { eraseAlienShot } from "../eraseAlienShot.js";
import { drawAlienShotWithCollision } from "../drawAlienShotWithCollision.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, entryFloor } from "./_liveStack.js";
import { COLLISION_FLAG } from "../names.js";
import { u8 } from "../../../../core/int.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0644;
const CALLER_RET = 0xabcd;
const COUNTER = 0x2078, SHOT_PTR = 0x2079, TIMER_C = 0x207c, TIMER_B = 0x207b, ROWS = 0x207d;
// The ==3 arm runs two sprite routines sequentially below the entry SP; exclude a generous window below it.
const DEAD_STACK = { lo: 0x23c0, hi: 0x2400 };
const ramDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off),
  deadStackBelow(DEAD_STACK, entryFloor(ma, mb)));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0644 dispatches -- stepAlienShotBlowup == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp; // the sprite arms push two routines' saves below the ENTRY SP
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x20 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); stepAlienShotBlowup(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return, the counter, a 5-byte shot descriptor at SHOT_PTR whose coord
// folds into the framebuffer, and a nonzero video background so the erase/draw have an observable effect.
function seat(m, counter) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  m.mem.write8(COUNTER, counter);
  m.mem.write8(SHOT_PTR + 0, 0x00);  // e -> DE low
  m.mem.write8(SHOT_PTR + 1, 0x20);  // d -> DE high (gfx source 0x2000, work RAM)
  m.mem.write8(SHOT_PTR + 2, 0x08);  // a -> HL0 low
  m.mem.write8(SHOT_PTR + 3, 0x28);  // c -> HL0 high (coord 0x2808 -> screen 0x2501)
  m.mem.write8(SHOT_PTR + 4, 0x06);  // b -> 6 rows
  for (let a = 0x2400; a < 0x3000; a++) m.mem.write8(a, 0xff);
  m.mem.write8(COLLISION_FLAG, 0x7f); // pre-dirty so a collision-clear is proven
}

test("CRAFTED: reload arm (==3) re-seeds + redraws; zero arm erases; idle arm just decrements", () => {
  // (a) counter 0x04 -> 3: erase, re-seed, redraw
  {
    const o = new Machine(ROM); seat(o, 0x04);
    const c = new Machine(ROM); seat(c, 0x04);
    oracle(o); stepAlienShotBlowup(c);
    assert.equal(ramDiff(o, c), null, "reload arm RAM");
    assert.equal(c.mem.read8(COUNTER), 0x03, "counter decremented to 3");
    assert.equal(c.mem.read16(SHOT_PTR), 0x1cdc, "shot descriptor pointer re-seeded to 0x1cdc");
    assert.equal(c.mem.read8(TIMER_C), 0x28 - 2, "step timer C decremented twice");
    assert.equal(c.mem.read8(TIMER_B), (0x08 - 2) & 0xff, "step timer B decremented twice");
    assert.equal(c.mem.read8(ROWS), 0x06, "row count re-seeded to 6");
    assert.equal(c.mem.read8(COLLISION_FLAG), o.mem.read8(COLLISION_FLAG), "collision flag matches oracle");
  }
  // (b) counter 0x01 -> 0: erase only
  {
    const o = new Machine(ROM); seat(o, 0x01);
    const c = new Machine(ROM); seat(c, 0x01);
    oracle(o); stepAlienShotBlowup(c);
    assert.equal(ramDiff(o, c), null, "zero arm RAM");
    assert.equal(c.mem.read8(COUNTER), 0x00, "counter decremented to 0");
    assert.equal(c.mem.read16(SHOT_PTR), 0x2000, "descriptor pointer untouched (no re-seed)");
  }
  // (c) counter 0x05 -> 4: idle
  {
    const o = new Machine(ROM); seat(o, 0x05);
    const c = new Machine(ROM); seat(c, 0x05);
    oracle(o); stepAlienShotBlowup(c);
    assert.equal(ramDiff(o, c), null, "idle arm RAM");
    assert.equal(c.mem.read8(COUNTER), 0x04, "counter decremented to 4");
    assert.equal(c.mem.read16(SHOT_PTR), 0x2000, "descriptor pointer untouched");
  }
});

test("TEETH: a twin that re-seeds the wrong row count blits a short sprite and is caught", () => {
  // Mutate stepAlienShotBlowup's own reload logic: re-seed 4 rows instead of 6, so the redraw is two rows short.
  function loc_0644_broken(m) {
    const next = u8(m.mem8[COUNTER] - 1);
    m.mem8[COUNTER] = next;
    if (next !== 0x03) { if (next !== 0) return; return eraseAlienShot(m); }
    eraseAlienShot(m);
    m.mem16[SHOT_PTR] = 0x1cdc;
    m.mem8[TIMER_C] = m.mem8[TIMER_C] - 2;
    m.mem8[TIMER_B] = m.mem8[TIMER_B] - 2;
    m.mem8[ROWS] = 0x04; // BUG: 4 rows, not 6
    return drawAlienShotWithCollision(m);
  }
  const o = new Machine(ROM); seat(o, 0x04);
  const c = new Machine(ROM); seat(c, 0x04);
  oracle(o); loc_0644_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a short re-seeded row count");
});
