// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for blockCopy (ROM 0x1a32) -- block-copy of B bytes from (DE) to (HL), both
// advancing. Live-out is memory only (every caller overwrites HL/DE/B/A and none reads a flag), so
// each side runs on its own machine and the contract is RAM (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/invaders/idiomatic/test/equivalence-1a32.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a32 as oracleBody } from "../../translated/loc_1a32.js";
import { blockCopy } from "../blockCopy.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1a32;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1a32 dispatches -- blockCopy == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); blockCopy(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed a known source pattern in BOTH machines, run oracle vs module, diff RAM and assert the copy.
function seedPattern(m, addr, n) {
  for (let i = 0; i < n; i++) m.mem.write8(addr + i, (i * 7 + 3) & 0xff);
}

test("CRAFTED: B bytes copied (DE)->(HL) for several counts, incl. B=0 => 256", () => {
  const SRC = 0x2280, DST = 0x2100; // both in work RAM, non-overlapping for n up to 256
  for (const b of [1, 7, 0x10, 0x40, 0x00]) {
    const n = b === 0 ? 256 : b;
    const o = new Machine(ROM); const c = new Machine(ROM);
    seedPattern(o, SRC, n); seedPattern(c, SRC, n);
    o.regs.de = SRC; o.regs.hl = DST; o.regs.b = b;
    c.regs.de = SRC; c.regs.hl = DST; c.regs.b = b;
    oracle(o); blockCopy(c);
    assert.equal(ramDiff(o, c), null, `B=0x${b.toString(16)}`);
    for (let i = 0; i < n; i++) {
      assert.equal(c.mem.read8(DST + i), (i * 7 + 3) & 0xff, `dst[${i}] B=0x${b.toString(16)}`);
    }
  }
});

test("CRAFTED: overlapping forward copy stays faithful (read-then-write interleave)", () => {
  const SRC = 0x2104, DST = 0x2100, b = 0x10; // dst < src, regions overlap
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedPattern(o, SRC, b); seedPattern(c, SRC, b);
  o.regs.de = SRC; o.regs.hl = DST; o.regs.b = b;
  c.regs.de = SRC; c.regs.hl = DST; c.regs.b = b;
  oracle(o); blockCopy(c);
  assert.equal(ramDiff(o, c), null, "overlapping copy diverged from oracle");
});

test("TEETH: a broken twin (off-by-one copied value) is caught", () => {
  function loc_1a32_broken(m, de = m.regs.de, hl = m.regs.hl, b = m.regs.b) {
    const n = b === 0 ? 256 : b;
    for (let i = 0; i < n; i++) m.mem8[hl + i] = (m.mem8[de + i] + 1) & 0xff; // BUG: value+1
  }
  const SRC = 0x2280, DST = 0x2100, b = 0x08;
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedPattern(o, SRC, b); seedPattern(c, SRC, b);
  o.regs.de = SRC; o.regs.hl = DST; o.regs.b = b;
  c.regs.de = SRC; c.regs.hl = DST; c.regs.b = b;
  oracle(o); loc_1a32_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte");
  assert.equal(d.addr, DST & 0xffff);
});
