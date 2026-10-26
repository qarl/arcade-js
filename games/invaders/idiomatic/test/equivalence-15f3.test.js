// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for countLiveAliens (ROM 0x15f3) -- count non-zero cells across the active player's 0x37-byte
// alien field into ALIEN_COUNT, and set LAST_ALIEN_FLAG when the count is exactly 1. Live-out is memory only.
// Run: node --test games/invaders/idiomatic/test/equivalence-15f3.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_15f3 as oracleBody } from "../../translated/loc_15f3.js";
import { countLiveAliens } from "../countLiveAliens.js";
import { activePlayerPageBase } from "../activePlayerPageBase.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE, ALIEN_COUNT, LAST_ALIEN_FLAG } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x15f3;

// A module-mutating broken twin: count the EMPTY cells instead of the live ones.
function brokenLoc_15f3(m) {
  const base = activePlayerPageBase(m);
  let count = 0;
  for (let i = 0; i < 0x37; i++) if (m.mem8[base + i] === 0) count++; // BUG
  m.mem8[ALIEN_COUNT] = count;
  if (count === 1) m.mem8[LAST_ALIEN_FLAG] = 0x01;
}

function seedField(mm, pageHi, cells) {
  mm.regs.sp = 0x2400; // valid stack: the oracle's `call 0x1611` pushes a return word (lands in STACK_SCRATCH)
  mm.mem.write8(ACTIVE_PLAYER_PAGE, pageHi);
  const base = pageHi << 8;
  for (let i = 0; i < 0x37; i++) mm.mem.write8(base + i, cells[i] ?? 0);
  return mm;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x15f3 dispatches -- countLiveAliens == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); countLiveAliens(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: ALIEN_COUNT = number of live cells; LAST_ALIEN_FLAG set only at exactly one survivor", () => {
  const cases = [
    { name: "empty", cells: [], count: 0 },
    { name: "one survivor", cells: (() => { const a = new Array(0x37).fill(0); a[10] = 0x42; return a; })(), count: 1 },
    { name: "five", cells: (() => { const a = new Array(0x37).fill(0); for (const i of [0, 9, 18, 27, 54]) a[i] = 0x01; return a; })(), count: 5 },
    { name: "full field", cells: new Array(0x37).fill(0x01), count: 0x37 },
  ];
  for (const { name, cells, count } of cases) {
    const o = seedField(new Machine(ROM), 0x21, cells);
    const c = seedField(new Machine(ROM), 0x21, cells);
    oracle(o); countLiveAliens(c);
    assert.equal(ramDiff(o, c), null, name);
    assert.equal(c.mem.read8(ALIEN_COUNT), count, `count ${name}`);
    assert.equal(c.mem.read8(LAST_ALIEN_FLAG), count === 1 ? 0x01 : 0x00, `lone-survivor flag ${name}`);
  }
});

test("TEETH: a mis-counting twin diverges at ALIEN_COUNT", () => {
  const cells = (() => { const a = new Array(0x37).fill(0); for (const i of [0, 9, 18, 27, 54]) a[i] = 0x01; return a; })();
  const o = seedField(new Machine(ROM), 0x21, cells);
  const c = seedField(new Machine(ROM), 0x21, cells);
  oracle(o); brokenLoc_15f3(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-counting twin");
  assert.equal(d.addr, ALIEN_COUNT & 0xffff);
});
