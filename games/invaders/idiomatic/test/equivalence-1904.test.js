// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for markAllAliensAliveP2 -- seat the second alien array's base and delegate a mark-all-alive fill
// (dissolved into markAllAliensAlive). Input: none (the base is a constant); live-out: memory only (every
// caller overwrites HL before a read), so each side runs on a fresh clone and the contract is RAM
// (dumpState, minus stack scratch below the entry SP). Interrupts are disabled so the oracle's per-instruction tick cannot
// fire a handler that writes RAM only on its side.
// Run: node --test games/invaders/idiomatic/test/equivalence-1904.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1904 as oracleBody } from "../../translated/loc_1904.js";
import { markAllAliensAliveP2 } from "../markAllAliensAliveP2.js";
import { markAllAliensAlive } from "../markAllAliensAlive.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ALIEN_FIELD_P2 } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1904;
const FILL_LEN = 0x37;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1904 dispatches -- markAllAliensAliveP2 == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); markAllAliensAliveP2(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: 0x37 bytes of 0x01 are filled from the second array base; neighbours survive", () => {
  const o = new Machine(ROM); o.io.setInte(false);
  const c = new Machine(ROM); c.io.setInte(false);
  for (let a = 0x21f0; a <= 0x2250; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
  oracle(o); markAllAliensAliveP2(c);

  assert.equal(ramDiff(o, c), null, "module fills identically to the oracle");
  for (let i = 0; i < FILL_LEN; i++) {
    assert.equal(c.mem.read8((ALIEN_FIELD_P2 + i) & 0xffff), 0x01, `byte ${i} of the fill`);
  }
  assert.equal(c.mem.read8((ALIEN_FIELD_P2 - 1) & 0xffff), 0xaa, "the byte before the base is untouched");
  assert.equal(c.mem.read8((ALIEN_FIELD_P2 + FILL_LEN) & 0xffff), 0xaa, "the byte past the fill is untouched");
});

// A module-mutating twin: it seeds the FIRST array base instead of the second, so the fill lands 0x100
// bytes too low.
function loc_1904_broken(m) {
  markAllAliensAlive(m, 0x2100); // BUG: wrong base (should be the second array at 0x2200)
}

test("TEETH: a twin that fills the wrong array base is caught by the diff", () => {
  const o = new Machine(ROM); o.io.setInte(false);
  const c = new Machine(ROM); c.io.setInte(false);
  for (let a = 0x2100; a <= 0x2250; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
  oracle(o); loc_1904_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the diff FAILED to catch a fill at the wrong base");
  assert.equal(d.addr, 0x2100, "first divergence is the wrongly-filled first array");
});
