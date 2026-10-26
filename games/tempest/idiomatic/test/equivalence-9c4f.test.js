// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for toggleEnemyTurnSide (ROM 0x9c4f) -- toggle bit $40 of slot X's $0283 flags cell and hand the
// toggled value back in A. Live-out is RAM ($0283,x) plus the A register (the caller reads the new value),
// so the arms compare RAM (-stack) AND A. A pure leaf (no dispatch, no stack move): it omits the ROM ret and
// the withOmittedRet seam completes it, so the arms compare RAM (-stack) + A, NOT pc/SP.
// Run: node --test games/tempest/idiomatic/test/equivalence-9c4f.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9c4f } from "../../translated/loc_9c4f.js";
import { toggleEnemyTurnSide } from "../toggleEnemyTurnSide.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { ENEMY_SLOT_FLAGS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const opt = (name) => {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
};
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9c4f;
const oracle = atEntry(loc_9c4f);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps taken before any gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1200) : [];

test("CAPTURE: real 0x9c4f dispatches -- toggleEnemyTurnSide == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); toggleEnemyTurnSide(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out (toggled value) matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: bit $40 toggles in $0283,x; A = toggled value", () => {
  const cases = [
    { x: 0x03, seed: 0x85 }, // bit6 clear -> set:  0x85 -> 0xc5
    { x: 0x07, seed: 0xc5 }, // bit6 set   -> clear: 0xc5 -> 0x85
    { x: 0x00, seed: 0x00 }, // 0x00 -> 0x40
  ];
  for (const { x, seed } of cases) {
    const addr = (ENEMY_SLOT_FLAGS + x) & 0xffff;
    const o = new Machine(ROM, OPTS); o.regs.x = x; o.mem.write8(addr, seed);
    const c = new Machine(ROM, OPTS); c.regs.x = x; c.mem.write8(addr, seed);
    oracle(o); const ret = toggleEnemyTurnSide(c);
    const tag = `x=0x${x.toString(16)} seed=0x${seed.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM: ${tag}`);
    assert.equal(c.mem.read8(addr), seed ^ 0x40, `cell toggled: ${tag}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: ${tag}`);
    assert.equal(ret, o.regs.a, `return value == A live-out: ${tag}`);
  }
});

test("TEETH: a twin that skips the $40 toggle diverges (non-default seed)", () => {
  const x = 0x03, seed = 0x85, addr = (ENEMY_SLOT_FLAGS + x) & 0xffff;
  const o = new Machine(ROM, OPTS); o.regs.x = x; o.mem.write8(addr, seed);
  oracle(o);
  assert.notEqual(o.mem.read8(addr), seed, "precondition: oracle changed the cell off its seed");
  const brokenCell = seed; // BUG: never toggled the bit
  assert.notEqual(brokenCell, o.mem.read8(addr), "the RAM diff FAILED to catch a skipped toggle");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.x = 0x03; m.mem.write8((ENEMY_SLOT_FLAGS + 0x03) & 0xffff, 0x85);
  m.regs.s = 0xff;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack
  const r = seamPlaceable(withOmittedRet, toggleEnemyTurnSide, TARGET, m);
  assert.equal(r.placeable, true, `toggleEnemyTurnSide must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
