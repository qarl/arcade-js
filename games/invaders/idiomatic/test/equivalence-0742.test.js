// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for resolveSpriteScreenAddr (ROM 0x0742) -- point HL at the sprite record loc_2087, load its 5-byte
// descriptor (loadSpriteDescriptor), then fold the resulting pointer into a screen address
// (coordToScreenAddr). Live-out is REGISTERS HL/DE/B/C (A is dead: every consumer -- drawSpriteColumn,
// 0x08f1, 0x14cb -- overwrites A before reading it, and the oracle's coordToScreenAddr leaves A = the
// screen high byte while the module leaves the descriptor byte). The oracle push/pops (the leaf's
// `push b` residue) below the entry SP, so the RAM diff excludes that window; the module drops it.
// Run: node --test games/invaders/idiomatic/test/equivalence-0742.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0742 as oracleBody } from "../../translated/loc_0742.js";
import { resolveSpriteScreenAddr } from "../resolveSpriteScreenAddr.js";
import { loadSpriteDescriptor } from "../loadSpriteDescriptor.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { loc_2087 } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0742;
const CALLER_RET = 0xabcd;

// Live-out data registers (A is dead, SP/PC excluded).
const OUT = ["hl", "de", "b", "c"];
const regOutDiff = (o, c) => {
  for (const k of OUT) if (o.regs[k] !== c.regs[k]) return { reg: k, o: o.regs[k], c: c.regs[k] };
  return null;
};

// The surviving output: descriptor bytes [e,d,a,c,b] -> HL := coordToScreenAddr(C:A).
const expectFrom = (bytes) => {
  const [e, d, a, c, b] = bytes;
  const packed = (c << 8) | a;
  const shifted = packed >> 3;
  const high = ((shifted >> 8) & 0x3f) | 0x20;
  return { hl: ((high << 8) | (shifted & 0xff)) & 0xffff, de: ((d << 8) | e) & 0xffff, b, c };
};

function seedDescriptor(m, bytes) {
  for (let i = 0; i < bytes.length; i++) m.mem.write8(loc_2087 + i, bytes[i]);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0742 dispatches -- resolveSpriteScreenAddr == oracle in RAM (-stack) and HL/DE/B/C", () => {
  for (const cap of CAPS) {
    // The oracle's `push b` residue (in coordToScreenAddr) sits just below the ENTRY SP; exclude
    // relative to that SP (SI's attract loop walks SP widely). The module drops the push.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); resolveSpriteScreenAddr(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(regOutDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: descriptor at loc_2087 -> DE/B/C and HL = screen addr of C:A", () => {
  for (const bytes of [
    [0x11, 0x22, 0x33, 0x44, 0x55],
    [0x00, 0x00, 0x00, 0x00, 0x00],
    [0xff, 0x7f, 0x80, 0x1f, 0xfe],
    [0xa5, 0x5a, 0xc3, 0x3c, 0x99],
  ]) {
    const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
    const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
    seedDescriptor(o, bytes); seedDescriptor(c, bytes);
    oracle(o); resolveSpriteScreenAddr(c);
    assert.equal(ramDiff(o, c), null, `bytes=${bytes}`);
    assert.equal(regOutDiff(o, c), null, `bytes=${bytes}`);
    const exp = expectFrom(bytes);
    assert.equal(c.regs.hl, exp.hl, `HL bytes=${bytes}`);
    assert.equal(c.regs.de, exp.de, `DE bytes=${bytes}`);
    assert.equal(c.regs.b, exp.b, `B bytes=${bytes}`);
    assert.equal(c.regs.c, exp.c, `C bytes=${bytes}`);
    assert.ok(c.regs.hl >= 0x2000 && c.regs.hl <= 0x3fff, `HL lands in video RAM bytes=${bytes}`);
  }
});

test("TEETH: a broken twin that skips the screen-address fold is caught", () => {
  // Real-logic mutation: return the raw C:A pointer without folding it into a screen address.
  const loc_0742_broken = (m) => loadSpriteDescriptor(m, loc_2087)[0];
  const bytes = [0x11, 0x22, 0x33, 0x44, 0x55];
  const o = new Machine(ROM); o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
  const c = new Machine(ROM); c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
  seedDescriptor(o, bytes); seedDescriptor(c, bytes);
  oracle(o); loc_0742_broken(c);
  const d = regOutDiff(o, c);
  assert.notEqual(d, null, "the register contract FAILED to catch the un-folded HL");
  assert.equal(d.reg, "hl");
});
