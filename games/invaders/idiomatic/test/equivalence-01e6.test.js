// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for initWorkRam (ROM 0x01e6) -- boot-init: seat DE=ROM template / HL=work-RAM base
// and delegate to the block-copy (0x1a32, lifted as blockCopy), copying the caller's B bytes. Live-out
// is memory only (the oracle advances DE/HL past the copy, but no caller reads them back -- every path
// re-seats HL/DE or reads A/flags), so each side runs on its own machine and the contract is RAM
// (dumpState, minus stack scratch below the entry SP). Run: node --test games/invaders/idiomatic/test/equivalence-01e6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01e6 as oracleBody } from "../../translated/loc_01e6.js";
import { initWorkRam } from "../initWorkRam.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { WORKRAM_INIT_IMAGE, ALIEN_DRAW_PENDING } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x01e6;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x01e6 dispatches -- initWorkRam == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); initWorkRam(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: B bytes copied (ROM template)->(work-RAM base) for several counts, incl. B=0 => 256", () => {
  for (const b of [1, 7, 0xc0, 0x00]) {
    const n = b === 0 ? 256 : b;
    const o = new Machine(ROM); o.regs.b = b; o.regs.sp = 0x2400;
    const c = new Machine(ROM); c.regs.b = b; c.regs.sp = 0x2400;
    oracle(o); initWorkRam(c);
    assert.equal(ramDiff(o, c), null, `B=0x${b.toString(16)}`);
    for (const i of [0, 1, n - 1]) {
      assert.equal(c.mem.read8(ALIEN_DRAW_PENDING + i), c.mem.read8(WORKRAM_INIT_IMAGE + i),
        `dst[${i}] == src[${i}] B=0x${b.toString(16)}`);
    }
  }
});

test("TEETH: a broken twin (off-by-one copied value) is caught", () => {
  // mutate the block-copy: each copied byte is value+1 (like the blockCopy tooth), on the real range.
  function loc_01e6_broken(m, b = m.regs.b) {
    const n = b === 0 ? 256 : b;
    for (let i = 0; i < n; i++) m.mem8[ALIEN_DRAW_PENDING + i] = (m.mem8[WORKRAM_INIT_IMAGE + i] + 1) & 0xff; // BUG: value+1
  }
  const b = 0xc0;
  const o = new Machine(ROM); o.regs.b = b; o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.regs.b = b; c.regs.sp = 0x2400;
  oracle(o); loc_01e6_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte");
  assert.equal(d.addr, ALIEN_DRAW_PENDING & 0xffff);
});
