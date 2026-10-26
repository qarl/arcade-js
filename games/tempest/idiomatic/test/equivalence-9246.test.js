// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedSlotRandomTags (ROM 0x9246-0x926e) -- clears the tag table $0243..$0282, then for each
// active slot (X = [$03ab]-1..0) writes a 4-bit random to $0203,x and packs (x<<4 | random) into $0243,x,
// substituting 0x0f when that tag is zero. Live-out is memory only (A/X at RTS are incidental), so each side
// runs on a clone and the contract is RAM (dumpState, minus stack scratch below the entry SP). A leaf: the module omits the ROM
// ret and the seam completes it, so the arms compare RAM (-stack), NOT pc/SP.
//   POKEY coupling: the tag random comes from $60ca (POKEY1 RANDOM), which is clock-coupled (each read
// charges cycles the idiomatic layer doesn't). We freeze the polys (clear SK_RESET) so both arms read the
// SAME RANDOM byte on every load, making the tables deterministic on both the crafted and captured arms.
// Run: node --test games/tempest/idiomatic/test/equivalence-9246.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9246 } from "../../translated/loc_9246.js";
import { seedSlotRandomTags } from "../seedSlotRandomTags.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { OBJECT_INDEX_TABLE, OBJECT_RECORD_TABLE, FIRE_GATE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9246;
const oracle = atEntry(loc_9246);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Freeze the POKEY polys so the clock-coupled RANDOM index stays put across both arms.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x9246 dispatches -- seedSlotRandomTags == oracle in RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); seedSlotRandomTags(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: table cleared, then 4 active slots packed with (x<<4 | random)", () => {
  const seed = (m) => {
    freezePokey(m);
    m.mem.write8(FIRE_GATE, 0x04); // slots X = 3..0
    for (let i = 0; i < 0x40; i++) m.mem.write8((OBJECT_RECORD_TABLE + i) & 0xffff, 0xd0 + (i & 0x0f)); // dirty sentinels
    for (let i = 0; i < 0x04; i++) m.mem.write8((OBJECT_INDEX_TABLE + i) & 0xffff, 0xee);
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); seedSlotRandomTags(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after fill");
  const rand = c.mem.read8(0x60ca) & 0x0f; // frozen -> same byte the routine saw
  for (let x = 0; x < 4; x++) {
    assert.equal(c.mem.read8((OBJECT_INDEX_TABLE + x) & 0xffff), rand, `random slot ${x}`);
    const tag = ((x << 4) | rand) & 0xff;
    assert.equal(c.mem.read8((OBJECT_RECORD_TABLE + x) & 0xffff), tag === 0 ? 0x0f : tag, `tag slot ${x}`);
  }
  for (let x = 4; x < 0x40; x++) assert.equal(c.mem.read8((OBJECT_RECORD_TABLE + x) & 0xffff), 0x00, `cleared slot ${x}`);
});

test("TEETH: a twin that drops the index bits from the tag diverges from the oracle", () => {
  const seed = (m) => {
    freezePokey(m);
    m.mem.write8(FIRE_GATE, 0x04);
    for (let i = 0; i < 0x40; i++) m.mem.write8((OBJECT_RECORD_TABLE + i) & 0xffff, 0xd0 + (i & 0x0f));
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken9246 = (m) => {
    const mem = m.mem8;
    for (let x = 0x3f; x >= 0; x--) mem[(OBJECT_RECORD_TABLE + x) & 0xffff] = 0;
    for (let x = 3; x >= 0; x--) {
      const rand = mem[0x60ca] & 0x0f;
      mem[(OBJECT_INDEX_TABLE + x) & 0xffff] = rand;
      mem[(OBJECT_RECORD_TABLE + x) & 0xffff] = rand === 0 ? 0x0f : rand; // BUG: never packs x<<4 into the tag
    }
  };
  broken9246(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the missing index bits");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, seedSlotRandomTags, TARGET, m);
  assert.equal(r.placeable, true, `seedSlotRandomTags must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
