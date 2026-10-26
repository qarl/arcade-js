// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSprite8x8 (ROM 0x08ff) -- resolve sprite index A to its 8-byte source at
// 0x1e00+8*A, latch the shift count to port 6, then tail-blit 8 columns (dissolved into drawSpriteColumn).
// Inputs A (sprite id), HL (destination). Live-out: the blitted cells (RAM) AND HL (advanced by 0x20*8).
// The oracle push/pops HL through the stack scratch below the entry SP; the module drops the save/restore,
// so CAPTURE excludes relative to that SP and CRAFTED excludes STACK_SCRATCH below the entry SP.
// Run: node --test games/invaders/idiomatic/test/equivalence-08ff.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08ff as oracleBody } from "../../translated/loc_08ff.js";
import { drawSprite8x8 } from "../drawSprite8x8.js";
import { drawSpriteColumn } from "../drawSpriteColumn.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SPRITE_BITMAP_TABLE } from "../names.js";
import { u16 } from "../../../../core/int.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x08ff;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x08ff dispatches -- drawSprite8x8 == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    const sp = cap.regs.sp; // the oracle's push-h residue sits just below the entry SP
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); drawSprite8x8(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: sprite A blits down 8 columns from 0x1e00+8*A; HL advances by 0x100", () => {
  const cases = [
    { a: 0x00, hl: 0x2400 },
    { a: 0x05, hl: 0x2500 },
    { a: 0x0a, hl: 0x2a00 },
    { a: 0x1f, hl: 0x2600 },
  ];
  for (const { a, hl } of cases) {
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.regs.a = a; o.regs.hl = hl;
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.regs.a = a; c.regs.hl = hl;
    oracle(o); drawSprite8x8(c);
    const tag = `A=0x${a.toString(16)} HL=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    assert.equal(c.regs.hl, u16(hl + 0x20 * 8), `HL advanced by 0x100: ${tag}`);
    // the first blitted column holds the sprite's first source byte
    assert.equal(c.mem.read8(hl), c.mem.read8(u16(SPRITE_BITMAP_TABLE + 8 * a)), `first column blitted: ${tag}`);
  }
});

test("TEETH: a short column count (7, not 8) mis-lands HL and is caught", () => {
  const a = 0x0a, hl = 0x2500;
  const brokenTwin = (m, aa = m.regs.a, hh = m.regs.hl) => {
    const src = u16(SPRITE_BITMAP_TABLE + 8 * aa);
    m.io.portOut(0x06, aa);
    return drawSpriteColumn(m, hh, src, 7); // BUG: 7 columns instead of 8
  };
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.regs.a = a; o.regs.hl = hl;
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.regs.a = a; c.regs.hl = hl;
  oracle(o); brokenTwin(c);
  assert.notEqual(c.regs.hl, o.regs.hl, "the live-out check FAILED to catch a short column count");
});
