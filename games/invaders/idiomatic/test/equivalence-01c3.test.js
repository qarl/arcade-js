// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for markAllAliensAlive (ROM 0x01c3) -- HL-relative fill: writes 0x01 to 0x37 bytes from HL
// up, then ret. Input register HL, live-out memory only (HL and B are clobbered by every caller before
// a read), so each side runs on a fresh clone and the contract is RAM (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/invaders/idiomatic/test/equivalence-01c3.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01c3 as oracleBody } from "../../translated/loc_01c3.js";
import { markAllAliensAlive } from "../markAllAliensAlive.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x01c3;
const FILL_LEN = 0x37;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x01c3 dispatches -- markAllAliensAlive == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); markAllAliensAlive(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: 0x37 bytes of 0x01 are filled from HL for several bases", () => {
  for (const hl of [0x2100, 0x2200, 0x2040]) {
    const o = new Machine(ROM); o.regs.hl = hl;
    const c = new Machine(ROM); c.regs.hl = hl;
    oracle(o); markAllAliensAlive(c);
    assert.equal(ramDiff(o, c), null, `HL=0x${hl.toString(16)}`);
    for (let i = 0; i < FILL_LEN; i++) {
      assert.equal(c.mem.read8((hl + i) & 0xffff), 0x01, `byte ${i} at HL=0x${hl.toString(16)}`);
    }
    assert.equal(c.mem.read8((hl + FILL_LEN) & 0xffff), o.mem.read8((hl + FILL_LEN) & 0xffff),
      "the byte past the fill is untouched");
  }
});

test("TEETH: a wrong filled byte is caught", () => {
  const o = new Machine(ROM); o.regs.hl = 0x2100;
  const c = new Machine(ROM); c.regs.hl = 0x2100;
  oracle(o);
  markAllAliensAlive(c); c.mem.write8(0x2110, 0x02); // BUG: one byte wrong inside the fill
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong filled byte");
  assert.equal(d.addr, 0x2110);
});
