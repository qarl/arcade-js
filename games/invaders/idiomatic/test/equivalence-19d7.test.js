// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for clearGameActive (ROM 0x19d7) -- xra a (A:=0) then tail-jmp into the shared store
// storeGameActive, which writes A at GAME_ACTIVE. The 0x19d3 dispatch is DISSOLVED into a direct idiomatic call.
// Live-out is memory only. Run: node --test .../test/equivalence-19d7.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19d7 as oracleBody } from "../../translated/loc_19d7.js";
import { clearGameActive } from "../clearGameActive.js";
import { storeGameActive } from "../storeGameActive.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { GAME_ACTIVE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x19d7;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x19d7 dispatches -- clearGameActive == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); clearGameActive(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: GAME_ACTIVE cleared to 0 regardless of prior A", () => {
  for (const a of [0x00, 0x01, 0x7f, 0xff, 0xa5]) {
    const o = new Machine(ROM); o.regs.a = a; o.mem.write8(GAME_ACTIVE, 0xff);
    const c = new Machine(ROM); c.regs.a = a; c.mem.write8(GAME_ACTIVE, 0xff);
    oracle(o); clearGameActive(c);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)}`);
    assert.equal(c.mem.read8(GAME_ACTIVE), 0x00, `GAME_ACTIVE:=0 A=0x${a.toString(16)}`);
  }
});

test("TEETH: a broken twin (stores 1, not 0) is caught", () => {
  function loc_19d7_broken(m) { // BUG: marshals the wrong constant into the shared store
    storeGameActive(m, 1);
  }
  const o = new Machine(ROM); o.mem.write8(GAME_ACTIVE, 0xff);
  const c = new Machine(ROM); c.mem.write8(GAME_ACTIVE, 0xff);
  oracle(o); loc_19d7_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored constant");
  assert.equal(d.addr, GAME_ACTIVE & 0xffff);
});
