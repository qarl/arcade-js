// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for activePlayerPageBase (ROM 0x1611) -- "HL := mem[0x2067] << 8". No input register (the
// page byte lives in RAM); no memory is written, so the contract is the HL live-out (plus a RAM sanity
// diff, minus stack scratch below the entry SP). Each side runs on a fresh clone.
// Run: node --test games/invaders/idiomatic/test/equivalence-1611.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1611 as oracleBody } from "../../translated/loc_1611.js";
import { activePlayerPageBase } from "../activePlayerPageBase.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x1611;

// A broken twin of activePlayerPageBase: drops the high-byte shift, so HL is wrong for any non-zero page byte.
function loc_1611_broken(m) {
  return (m.regs.hl = m.mem.read8(0x2067)); // BUG: forgot << 8
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x1611 dispatches -- activePlayerPageBase == oracle in RAM and HL live-out", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); activePlayerPageBase(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl); // HL is the live-out
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: HL := page-byte << 8 for several page bytes", () => {
  for (const v of [0x00, 0x01, 0x20, 0x7f, 0xa5, 0xff]) {
    const o = new Machine(ROM); o.mem8[ACTIVE_PLAYER_PAGE] = v;
    const c = new Machine(ROM); c.mem8[ACTIVE_PLAYER_PAGE] = v;
    oracle(o); activePlayerPageBase(c);
    assert.equal(ramDiff(o, c), null, `page=0x${v.toString(16)}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL match page=0x${v.toString(16)}`);
    assert.equal(c.regs.hl, v << 8, `HL value page=0x${v.toString(16)}`);
  }
});

test("TEETH: a wrong HL is caught", () => {
  const o = new Machine(ROM); o.mem8[ACTIVE_PLAYER_PAGE] = 0xa5;
  const c = new Machine(ROM); c.mem8[ACTIVE_PLAYER_PAGE] = 0xa5;
  oracle(o);
  loc_1611_broken(c); // BUG: HL missing the << 8
  assert.notEqual(c.regs.hl, o.regs.hl, "the check FAILED to catch a wrong HL");
});
