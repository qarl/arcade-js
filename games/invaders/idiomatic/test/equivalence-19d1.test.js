// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for setGameActive (ROM 0x19d1) -- A:=1 then fall through into the shared store storeGameActive,
// which writes A at GAME_ACTIVE. The 0x19d3 call is DISSOLVED into a direct idiomatic call. Live-out is
// memory only (callers overwrite A / delegate immediately). Run: node --test .../test/equivalence-19d1.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_19d1 as oracleBody } from "../../translated/loc_19d1.js";
import { setGameActive } from "../setGameActive.js";
import { storeGameActive } from "../storeGameActive.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { GAME_ACTIVE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x19d1;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x19d1 dispatches -- setGameActive == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); setGameActive(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: GAME_ACTIVE set to 1 regardless of prior A", () => {
  for (const a of [0x00, 0x01, 0x7f, 0xff, 0xa5]) {
    const o = new Machine(ROM); o.regs.a = a; o.mem.write8(GAME_ACTIVE, 0xcc);
    const c = new Machine(ROM); c.regs.a = a; c.mem.write8(GAME_ACTIVE, 0xcc);
    oracle(o); setGameActive(c);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)}`);
    assert.equal(c.mem.read8(GAME_ACTIVE), 0x01, `GAME_ACTIVE:=1 A=0x${a.toString(16)}`);
  }
});

test("TEETH: a broken twin (stores 0, not 1) is caught", () => {
  function loc_19d1_broken(m) { // BUG: marshals the wrong constant into the shared store
    storeGameActive(m, 0);
  }
  const o = new Machine(ROM); o.mem.write8(GAME_ACTIVE, 0xcc);
  const c = new Machine(ROM); c.mem.write8(GAME_ACTIVE, 0xcc);
  oracle(o); loc_19d1_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stored constant");
  assert.equal(d.addr, GAME_ACTIVE & 0xffff);
});
