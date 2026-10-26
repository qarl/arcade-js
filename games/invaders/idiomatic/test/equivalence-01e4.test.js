// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedWorkRamImage (ROM 0x01e4) -- force the byte count to 0xc0 then fall through into the
// boot-init entry (0x01e6/initWorkRam -> block-copy 0x1a32): copy 0xc0 bytes from the ROM template image
// WORKRAM_INIT_IMAGE into the work-RAM base ALIEN_DRAW_PENDING. The `mvi b,0xc0` seat + the loc_01e6/0x1a32
// chain are DISSOLVED into a direct blockCopy(m, WORKRAM_INIT_IMAGE, ALIEN_DRAW_PENDING, 0xc0) -- initWorkRam
// itself cannot be reused because it reads B from the caller (bootInit passes B=0x00 => 256), and the count
// must be forced. Live-out is memory only: the oracle advances DE/HL and zeroes B, but no caller (loc_02f8,
// advanceToNextRound, runAttractCycle, startGameFlow) reads them back -- each re-seats HL/DE or saves A/flags across the call. So
// each side runs on its own machine and the contract is RAM (dumpState, minus stack scratch below the entry SP -- the oracle's
// tail chain rets, popping one word).
// Run: node --test games/invaders/idiomatic/test/equivalence-01e4.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01e4 as oracleBody } from "../../translated/loc_01e4.js";
import { seedWorkRamImage } from "../seedWorkRamImage.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { WORKRAM_INIT_IMAGE, ALIEN_DRAW_PENDING } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x01e4;
const COUNT = 0xc0;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x01e4 dispatches -- seedWorkRamImage == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); seedWorkRamImage(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: exactly 0xc0 bytes copied (ROM template)->(work-RAM base), incoming B ignored", () => {
  // Seed a range of incoming B values: the routine forces the count to 0xc0 regardless.
  for (const b of [0x00, 0x05, 0xc0, 0xff]) {
    const o = new Machine(ROM); o.regs.b = b; o.regs.sp = 0x2400;
    const c = new Machine(ROM); c.regs.b = b; c.regs.sp = 0x2400;
    oracle(o); seedWorkRamImage(c);
    assert.equal(ramDiff(o, c), null, `incoming B=0x${b.toString(16)}`);
    for (const i of [0, 1, COUNT - 1]) {
      assert.equal(c.mem.read8(ALIEN_DRAW_PENDING + i), c.mem.read8(WORKRAM_INIT_IMAGE + i),
        `dst[${i}] == src[${i}] incoming B=0x${b.toString(16)}`);
    }
    // one past the fixed count must be untouched (proves the count is 0xc0, not more)
    assert.equal(c.mem.read8(ALIEN_DRAW_PENDING + COUNT), o.mem.read8(ALIEN_DRAW_PENDING + COUNT),
      `dst[0xc0] untouched incoming B=0x${b.toString(16)}`);
  }
});

test("TEETH: a module-mutating twin (off-by-one copied value) is caught in RAM", () => {
  // Mutate the block-copy value over the real forced-0xc0 range: each copied byte is value+1. value+1 always
  // differs mod 256, so byte 0 diverges regardless of ROM contents (a short-copy twin could pass spuriously
  // if the template tail matched work RAM). The forced count itself is positively controlled by CRAFTED.
  function loc_01e4_broken(m) {
    for (let i = 0; i < COUNT; i++) m.mem8[ALIEN_DRAW_PENDING + i] = (m.mem8[WORKRAM_INIT_IMAGE + i] + 1) & 0xff; // BUG: value+1
  }
  const o = new Machine(ROM); o.regs.b = 0xff; o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.regs.b = 0xff; c.regs.sp = 0x2400;
  oracle(o); loc_01e4_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte");
  assert.equal(d.addr, ALIEN_DRAW_PENDING & 0xffff);
});
