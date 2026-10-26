// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearScreen (ROM 0x1a5c) -- "zero video RAM 0x2400..0x3fff". Live-out is memory
// only: the caller (redrawScorePanel) reseats HL/A before reading them, so RAM (dumpState, minus stack scratch below the entry SP)
// is the whole contract. Interrupts are disabled on each clone so the oracle's per-instruction tick
// (this loop spans several frames of cycles) cannot fire a handler that writes RAM only on its side.
// Run: node --test games/invaders/idiomatic/test/equivalence-1a5c.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a5c as oracleBody } from "../../translated/loc_1a5c.js";
import { clearScreen } from "../clearScreen.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { VIDEO_RAM_BASE, VIDEO_RAM_END } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1a5c;
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1a5c dispatches -- clearScreen == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); clearScreen(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: the whole 0x2400..0x3fff span is zeroed; the byte below the base is untouched", () => {
  const seed = (m) => {
    m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
    for (let a = VIDEO_RAM_BASE; a < VIDEO_RAM_END; a++) m.mem.write8(a, 0xff); // dirty the whole target span
    m.mem.write8(0x2000, 0x11); // sentinel below the base -- must survive
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); clearScreen(c);

  assert.equal(ramDiff(o, c), null, "oracle and module leave identical RAM (-stack)");
  assert.equal(c.mem.read8(VIDEO_RAM_BASE), 0x00, "base of the span is zeroed");
  assert.equal(c.mem.read8(0x2c00), 0x00, "interior of the span is zeroed");
  assert.equal(c.mem.read8(VIDEO_RAM_END - 1), 0x00, "top of the span is zeroed");
  assert.equal(c.mem.read8(0x2000), 0x11, "the byte below the base is NOT cleared (loop starts at the base)");
});

test("TEETH: a span that stops one byte short is caught by the RAM diff", () => {
  const brokenClear = (m) => { for (let a = VIDEO_RAM_BASE; a < VIDEO_RAM_END - 1; a++) m.mem8[a] = 0x00; }; // BUG: misses the last byte
  const seed = (m) => {
    m.regs.sp = 0x2400; m.push16(CALLER_RET); m.io.setInte(false);
    for (let a = VIDEO_RAM_BASE; a < VIDEO_RAM_END; a++) m.mem.write8(a, 0xff);
  };
  const o = new Machine(ROM); seed(o);
  const c = new Machine(ROM); seed(c);
  oracle(o); brokenClear(c);

  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch an unzeroed byte -- it is worthless");
  assert.equal(d.addr, (VIDEO_RAM_END - 1) & 0xffff, "teeth caught the byte the broken span left dirty");
});
