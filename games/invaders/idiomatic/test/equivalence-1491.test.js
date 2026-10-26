// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSpriteWithCollision -- draw B sprite rows with collision detect: seat the shift offset
// (dissolved 0x1474 -> seatBlitPosition), clear the collision flag COLLISION_FLAG, then per row OR the
// hardware-shifted source byte (ports 0x04 out / 0x03 in) into two adjacent screen columns, setting
// COLLISION_FLAG on any overlap; step DE +1 and HL +0x20 per row. Live-out is memory (the drawn screen
// bytes + the collision flag) PLUS the advanced pointers HL, DE and the final A. The oracle push/pops
// (setup + per-row save + per-column AF), so the RAM diff excludes the dead stack below the entry SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-1491.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1491 as oracleBody } from "../../translated/loc_1491.js";
import { drawSpriteWithCollision } from "../drawSpriteWithCollision.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { COLLISION_FLAG } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1491;
const COLLISION = COLLISION_FLAG;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1491 dispatches -- drawSpriteWithCollision == oracle in RAM (-stack) and HL/DE/A", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawSpriteWithCollision(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE live-out matches the oracle");
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
    assert.equal(c.mem.read8(COLLISION), o.mem.read8(COLLISION), "collision flag matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: OR-draw into a clear field (no collision) vs a set field (collision)", () => {
  const SPRITE = [0xaa, 0x3c, 0xff, 0x81, 0x18, 0x7e, 0x24, 0x99];
  const seed = (m, hl, de, b, bg) => {
    m.regs.sp = 0x2400; m.regs.hl = hl; m.regs.de = de; m.regs.b = b;
    for (let i = 0; i < b; i++) m.mem.write8((de + i) & 0xffff, SPRITE[i % SPRITE.length]);
    for (let a = 0x2400; a < 0x3000; a++) m.mem.write8(a, bg);
    m.mem.write8(COLLISION, 0x7f); // pre-dirty so the routine's clear is proven
  };
  const cases = [
    { hl: 0x2003, de: 0x2100, b: 0x04, bg: 0x00, collide: 0 }, // clear field -> no overlap
    { hl: 0x2805, de: 0x2120, b: 0x08, bg: 0xff, collide: 1 }, // set field -> overlap sets the flag
    { hl: 0x3007, de: 0x2140, b: 0x02, bg: 0xff, collide: 1 },
  ];
  for (const { hl, de, b, bg, collide } of cases) {
    const o = new Machine(ROM); seed(o, hl, de, b, bg);
    const c = new Machine(ROM); seed(c, hl, de, b, bg);
    oracle(o); drawSpriteWithCollision(c);
    const label = `hl=0x${hl.toString(16)} de=0x${de.toString(16)} b=0x${b.toString(16)} bg=0x${bg.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.regs.hl, o.regs.hl, `HL live-out ${label}`);
    assert.equal(c.regs.de, o.regs.de, `DE live-out ${label}`);
    assert.equal(c.regs.a, o.regs.a, `A live-out ${label}`);
    assert.equal(c.mem.read8(COLLISION), collide, `collision flag ${label}`);
    assert.equal(c.mem.read8(COLLISION), o.mem.read8(COLLISION), `collision matches oracle ${label}`);
  }
});

test("TEETH: a module-mutating twin (never flags overlap) diverges in the collision flag", () => {
  // Broken twin of drawSpriteWithCollision that OR-draws correctly but skips the overlap test -- so the collision
  // flag stays clear when it should be set. Mutates the real logic, not a post-hoc overwrite.
  function loc_1491_broken(m, de = m.regs.de, b = m.regs.b) {
    const rows = b || 256;
    let dst = seatBlit(m);
    let src = de, a = 0;
    m.mem8[COLLISION] = 0;
    for (let r = 0; r < rows; r++) {
      const rowStart = dst;
      m.io.portOut(0x04, m.mem8[src]);
      a = m.io.portIn(0x03) | m.mem8[dst]; // BUG: overlap test dropped
      m.mem8[dst] = a;
      dst = (dst + 1) & 0xffff; src = (src + 1) & 0xffff;
      m.io.portOut(0x04, 0);
      a = m.io.portIn(0x03) | m.mem8[dst]; // BUG: overlap test dropped
      m.mem8[dst] = a;
      dst = (rowStart + 0x20) & 0xffff;
    }
    return [m.regs.hl = dst, m.regs.de = src, m.regs.a = a];
  }
  function seatBlit(m) {
    m.io.portOut(0x02, m.regs.l & 0x07);
    const shifted = m.regs.hl >> 3;
    return (m.regs.hl = ((((shifted >> 8) & 0x3f) | 0x20) << 8) | (shifted & 0xff));
  }
  const seed = (m) => {
    m.regs.sp = 0x2400; m.regs.hl = 0x2805; m.regs.de = 0x2120; m.regs.b = 0x08;
    for (let i = 0; i < 8; i++) m.mem.write8(0x2120 + i, [0xaa, 0x3c, 0xff, 0x81, 0x18, 0x7e, 0x24, 0x99][i]);
    for (let a = 0x2400; a < 0x3000; a++) m.mem.write8(a, 0xff); // overlap guaranteed
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); loc_1491_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped collision test");
  assert.equal(d.addr, COLLISION & 0xffff, "divergence is the collision flag");
});
