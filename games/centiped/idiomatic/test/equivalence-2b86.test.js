// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2b86 (ROM 0x2b86-0x2b91) -- the second entry into loc_2b79's range: just the
// $43-mask gate tail, GATE loc_42 = 0x28 only when (loc_43 & 0xaf) != 0. Live-out is memory only (A/flags at
// RTS are incidental), so each side runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/centiped/idiomatic/test/equivalence-2b86.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b86 as oracleRom } from "../../translated/loc_2b79.js";
import { loc_2b86 } from "../loc_2b79.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { loc_42, loc_43 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

const SENTINEL42 = 0x99;
function seeded(c43) {
  const m = new Machine(ROM);
  m.regs.s = 0x30;
  m.mem.write8(loc_43, c43);
  m.mem.write8(loc_42, SENTINEL42);
  return m;
}

test("CRAFTED: gate loc_42 = 0x28 iff (loc_43 & 0xaf) != 0", () => {
  const cases = [
    { c43: 0x77, gate: true },  // 0x77 & 0xaf = 0x27 -> set
    { c43: 0x22, gate: true },  // 0x22 & 0xaf = 0x22 -> set
    { c43: 0x50, gate: false }, // 0x50 & 0xaf = 0x00 -> skip (proves the mask, not "nonzero 43")
    { c43: 0x10, gate: false }, // 0x10 & 0xaf = 0x00 -> skip
    { c43: 0x00, gate: false }, // skip
  ];
  for (const { c43, gate } of cases) {
    const o = seeded(c43), c = seeded(c43);
    oracle(o); loc_2b86(c);
    assert.equal(ramDiff(o, c), null, `c43=0x${c43.toString(16)}`);
    assert.equal(c.mem.read8(loc_42), gate ? 0x28 : SENTINEL42, `gate c43=0x${c43.toString(16)}`);
  }
});

test("TEETH: a twin that always arms loc_42 diverges on the masked-off arm", () => {
  const c43 = 0x50; // & 0xaf == 0 -> must NOT arm
  const o = seeded(c43), c = seeded(c43);
  oracle(o);
  loc_2b86(c);
  c.mem.write8(loc_42, 0x28); // BUG: armed even though (0x50 & 0xaf) == 0
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch an over-armed gate");
});
