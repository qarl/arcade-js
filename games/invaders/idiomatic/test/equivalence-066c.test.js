// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawAlienShotWithCollision -- point the cursor at the shot object's 5-byte descriptor cell
// (DISSOLVED into loadSpriteDescriptor: DE/A/C/B and HL=C:A), then tail-delegate the sprite blit
// (DISSOLVED into drawSpriteWithCollision): seat the shift offset, clear the collision flag, and OR the hardware-shifted
// source down two adjacent screen columns per row, setting the flag on any overlap. Live-out is memory
// (the drawn screen bytes + the collision flag) PLUS the advanced pointers HL, DE and the final A. The
// oracle push/pops (the internal call return + per-row/per-column saves), so the RAM diff excludes the
// dead stack below the entry SP. Interrupts disabled on each clone.
// Run: node --test games/invaders/idiomatic/test/equivalence-066c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_066c as oracleBody } from "../../translated/loc_066c.js";
import { drawAlienShotWithCollision } from "../drawAlienShotWithCollision.js";
import { loadSpriteDescriptor } from "../loadSpriteDescriptor.js";
import { drawSpriteWithCollision } from "../drawSpriteWithCollision.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { COLLISION_FLAG, ALIEN_SHOT_SPRITE_PTR } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x066c;
const DESC = ALIEN_SHOT_SPRITE_PTR;      // the shot descriptor base HL is pointed at
const COLLISION = COLLISION_FLAG; // the collision flag drawSpriteWithCollision maintains

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x066c dispatches -- drawAlienShotWithCollision == oracle in RAM (-stack) and HL/DE/A", () => {
  for (const cap of CAPS) {
    // The oracle's internal call return push + drawSpriteWithCollision's per-row/column saves sit just below the ENTRY
    // SP, which at a real dispatch is not the STACK_SCRATCH window -- exclude relative to that SP.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawAlienShotWithCollision(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE live-out matches the oracle");
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
    assert.equal(c.mem.read8(COLLISION), o.mem.read8(COLLISION), "collision flag matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return on the stack, a 5-byte descriptor [e,d,a,c,b] at DESC (so
// DE=d:e is the gfx source, HL0=c:a the pre-seat coordinate, B the row count), a source byte stream at
// DE, and a uniform background across video RAM. hl0=0x2003 -> seatBlitPosition -> screen 0x2400.
const SPRITE = [0xaa, 0x3c, 0xff, 0x81, 0x18, 0x7e, 0x24, 0x99];
function seat(m, hl0, de, b, bg) {
  m.regs.sp = 0x2400; m.io.setInte(false);
  m.mem.write8(DESC + 0, de & 0xff);          // e -> DE low
  m.mem.write8(DESC + 1, (de >> 8) & 0xff);   // d -> DE high
  m.mem.write8(DESC + 2, hl0 & 0xff);         // a -> HL0 low (also L: shift offset = a&7)
  m.mem.write8(DESC + 3, (hl0 >> 8) & 0xff);  // c -> HL0 high
  m.mem.write8(DESC + 4, b);                  // b -> row count
  for (let i = 0; i < b; i++) m.mem.write8((de + i) & 0xffff, SPRITE[i % SPRITE.length]);
  for (let a = 0x2400; a < 0x3000; a++) m.mem.write8(a, bg);
  m.mem.write8(COLLISION, 0x7f); // pre-dirty so the routine's clear is proven
}

test("CRAFTED: descriptor -> blit into a clear field (no collision) vs a set field (collision)", () => {
  const cases = [
    { hl0: 0x2003, de: 0x2100, b: 0x04, bg: 0x00, collide: 0 }, // clear field -> no overlap
    { hl0: 0x2805, de: 0x2120, b: 0x08, bg: 0xff, collide: 1 }, // set field -> overlap sets the flag
    { hl0: 0x3007, de: 0x2140, b: 0x02, bg: 0xff, collide: 1 },
  ];
  for (const { hl0, de, b, bg, collide } of cases) {
    const o = new Machine(ROM); seat(o, hl0, de, b, bg);
    const c = new Machine(ROM); seat(c, hl0, de, b, bg);
    oracle(o); drawAlienShotWithCollision(c);
    const label = `hl0=0x${hl0.toString(16)} de=0x${de.toString(16)} b=0x${b.toString(16)} bg=0x${bg.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.regs.hl, o.regs.hl, `HL live-out ${label}`);
    assert.equal(c.regs.de, o.regs.de, `DE live-out ${label}`);
    assert.equal(c.regs.a, o.regs.a, `A live-out ${label}`);
    assert.equal(c.mem.read8(COLLISION), collide, `collision flag ${label}`);
    assert.equal(c.mem.read8(COLLISION), o.mem.read8(COLLISION), `collision matches oracle ${label}`);
  }
});

test("TEETH: a module reading the descriptor from the wrong cell diverges in RAM", () => {
  // Broken twin: point the cursor one byte off, so the whole descriptor (DE/HL0/B) shifts and the blit
  // lands wrong. Mutates drawAlienShotWithCollision's one job -- seating the descriptor pointer at DESC exactly.
  function loc_066c_broken(m) {
    loadSpriteDescriptor(m, DESC + 1); // BUG: off-by-one descriptor cursor
    return drawSpriteWithCollision(m);
  }
  const o = new Machine(ROM); seat(o, 0x2003, 0x2100, 0x04, 0x00);
  const c = new Machine(ROM); seat(c, 0x2003, 0x2100, 0x04, 0x00);
  oracle(o); loc_066c_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a mis-seated descriptor cursor -- it is worthless");
});
