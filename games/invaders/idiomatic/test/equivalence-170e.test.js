// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for selectAlienShotRate (ROM 0x170e) -- read the key at [recordPtr+1], scan the 4-entry threshold
// table (ALIEN_SHOT_RATE_THRESHOLDS) for the first entry >= key, and store the parallel table's byte (ALIEN_SHOT_RATE_TABLE) to loc_20cf.
// Live-out is memory only. Dissolves the 0x09ca record-pointer call. Run: node --test <thisfile>

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_170e as oracleBody } from "../../translated/loc_170e.js";
import { selectAlienShotRate } from "../selectAlienShotRate.js";
import { currentPlayerRecordPtr } from "../currentPlayerRecordPtr.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE, PLAYER1_OBJ_DESC, ALIEN_SHOT_RATE_TABLE, ALIEN_SHOT_RATE_THRESHOLDS, loc_20cf } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x170e;

// A module-mutating broken twin: never scan -- always take the first table entry.
function brokenLoc_170e(m) {
  const key = m.mem8[currentPlayerRecordPtr(m) + 1]; // eslint-disable-line no-unused-vars
  m.mem8[loc_20cf] = m.mem8[ALIEN_SHOT_RATE_TABLE]; // BUG: index 0, ignoring the threshold scan
}

// Independent oracle for the resolved rate, read straight from the (ROM) tables in the machine.
function expectedRate(m, key) {
  let i = 0;
  while (i < 4 && m.mem.read8(ALIEN_SHOT_RATE_THRESHOLDS + i) < key) i++;
  return m.mem.read8(ALIEN_SHOT_RATE_TABLE + i);
}

// Player-1 selected -> key lives at PLAYER1_OBJ_DESC+1.
function seedKey(m, key) {
  m.regs.sp = 0x2400; // valid stack: the oracle's dissolved 0x09ca call pushes a return word (lands in STACK_SCRATCH)
  m.mem.write8(ACTIVE_PLAYER_PAGE, 0x01);
  m.mem.write8(PLAYER1_OBJ_DESC + 1, key);
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x170e dispatches -- selectAlienShotRate == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); selectAlienShotRate(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: loc_20cf = the first threshold >= key, else the default", () => {
  for (const key of [0x00, 0x02, 0x03, 0x10, 0x11, 0x20, 0x21, 0x30, 0x31, 0xff]) {
    const o = seedKey(new Machine(ROM), key);
    const c = seedKey(new Machine(ROM), key);
    oracle(o); selectAlienShotRate(c);
    assert.equal(ramDiff(o, c), null, `key=0x${key.toString(16)}`);
    assert.equal(c.mem.read8(loc_20cf), expectedRate(c, key), `resolved rate key=0x${key.toString(16)}`);
  }
});

test("TEETH: a twin that skips the scan diverges at loc_20cf", () => {
  const o = seedKey(new Machine(ROM), 0xff); // scans to the default; index 0 differs
  const c = seedKey(new Machine(ROM), 0xff);
  oracle(o); brokenLoc_170e(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch the skipped threshold scan");
  assert.equal(d.addr, loc_20cf & 0xffff);
});
