// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for eraseAlienShot -- load the sprite descriptor from its record cell (DISSOLVED into
// loadSpriteDescriptor), then erase that sprite's rows off the screen (DISSOLVED into eraseShiftedSprite, the
// tail delegate). Live-out is the cleared screen bytes (RAM) PLUS the advanced pointers HL, DE and the
// final A -- eraseShiftedSprite's contract. The oracle's `call 0x1a3b` return push and eraseShiftedSprite's internal
// save residue sit in dead stack scratch below the entry SP, which the diff excludes; the module keeps
// its walk in locals. Interrupts are disabled per clone so a handler cannot write RAM only on one side.
// Run: node --test games/invaders/idiomatic/test/equivalence-0675.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0675 as oracleBody } from "../../translated/loc_0675.js";
import { eraseAlienShot } from "../eraseAlienShot.js";
import { loadSpriteDescriptor } from "../loadSpriteDescriptor.js";
import { eraseShiftedSprite } from "../eraseShiftedSprite.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ALIEN_SHOT_SPRITE_PTR } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0675;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0675 dispatches -- eraseAlienShot == oracle in RAM (-stack) and HL/DE/A", () => {
  for (const cap of CAPS) {
    // The oracle's `call 0x1a3b` return push + eraseShiftedSprite's save residue sits just below the ENTRY SP;
    // exclude relative to that SP. The module drops the save/restore entirely.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); eraseAlienShot(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
    assert.equal(c.regs.de, o.regs.de, "DE live-out matches the oracle");
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seat a fresh Machine: a caller return on the stack, a 5-byte sprite descriptor at the record cell
// ALIEN_SHOT_SPRITE_PTR ([e,d,a,c,b]) and a source stream at the gfx pointer DE the descriptor names. HL0 = C:A folds
// to a video-RAM screen address (seatBlitPosition uses L=A's low 3 bits as the shift). Background 0xff so
// the erase (AND the shifted complement) has bits to clear.
const SPRITE = [0xaa, 0x3c, 0xff, 0x81, 0x18, 0x7e, 0x24, 0x99,
                0xc3, 0x5a, 0x0f, 0xf0, 0x33, 0xcc, 0x66, 0x55];
function seat(m, desc) {
  m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
  for (let i = 0; i < desc.length; i++) m.mem.write8((ALIEN_SHOT_SPRITE_PTR + i) & 0xffff, desc[i]);
  const de = ((desc[1] << 8) | desc[0]) & 0xffff, b = desc[4];
  for (let i = 0; i < b; i++) m.mem.write8((de + i) & 0xffff, SPRITE[i % SPRITE.length]);
  for (let a = 0x2400; a < 0x3000; a++) m.mem.write8(a, 0xff); // background to erase from
}

test("CRAFTED: the descriptor's sprite rows are erased off the screen; HL/DE/A track the oracle", () => {
  // desc = [e, d, a, c, b]: DE = d:e (src), HL0 = c:a (folds to screen), B = row count.
  const cases = [
    [0x00, 0x21, 0x00, 0x20, 0x04], // de=0x2100 hl0=0x2000 shift 0 b=4
    [0x40, 0x21, 0x03, 0x28, 0x08], // de=0x2140 hl0=0x2803 shift 3 b=8
    [0x80, 0x21, 0x05, 0x30, 0x10], // de=0x2180 hl0=0x3005 shift 5 b=16
  ];
  for (const desc of cases) {
    const o = new Machine(ROM); seat(o, desc);
    const c = new Machine(ROM); seat(c, desc);
    oracle(o); eraseAlienShot(c);
    const de = ((desc[1] << 8) | desc[0]) & 0xffff, b = desc[4];
    const label = `desc=${desc}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(c.regs.hl, o.regs.hl, `HL live-out ${label}`);
    assert.equal(c.regs.de, o.regs.de, `DE live-out ${label}`);
    assert.equal(c.regs.a, o.regs.a, `A live-out ${label}`);
    assert.equal(c.regs.de, (de + b) & 0xffff, `DE advanced by B: ${label}`);
  }
});

test("TEETH: a twin that reads the descriptor from the wrong cell diverges in the erased screen", () => {
  // Mutate eraseAlienShot's OWN logic: load the descriptor one byte before its record cell -- the whole point
  // of eraseAlienShot is that the descriptor lives AT ALIEN_SHOT_SPRITE_PTR. Wrong DE/B/HL0 => a different erase.
  function loc_0675_broken(m) {
    loadSpriteDescriptor(m, (ALIEN_SHOT_SPRITE_PTR - 1) & 0xffff); // BUG: wrong descriptor pointer
    return eraseShiftedSprite(m);
  }
  const desc = [0x00, 0x21, 0x00, 0x20, 0x04];
  const o = new Machine(ROM); seat(o, desc);
  const c = new Machine(ROM); seat(c, desc);
  oracle(o); loc_0675_broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a wrong descriptor pointer");
});
