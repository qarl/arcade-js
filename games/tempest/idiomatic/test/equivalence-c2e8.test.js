// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for resolveShapeTableIndex (ROM 0xc2e8-0xc30c) -- reduces the input A (>= 0x62 -> POKEY1 RANDOM
// $60ca & 0x5f), /16 into quotient X and remainder Y, looks Y up in table $bc7c, stores the byte to $0112,
// and returns A = (entry << 4) | 0x0f. Live-outs are RAM ($0112) plus registers A/X/Y, so the arms compare
// RAM (-stack) and A/X/Y. A leaf: it omits the ROM ret and the seam completes it.
//   POKEY coupling: the random read ($60ca) is clock-coupled, so the >= 0x62 branch is only deterministic
// with the poly frozen (clear SK_RESET). The CRAFTED arm therefore seeds A < 0x62 (no random read); the
// >= 0x62 branch is covered by CAPTURE on frozen clones.
// Run: node --test games/tempest/idiomatic/test/equivalence-c2e8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c2e8 } from "../../translated/loc_c2e8.js";
import { resolveShapeTableIndex } from "../resolveShapeTableIndex.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { TUBE_SHAPE_INDEX } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc2e8;
const oracle = atEntry(loc_c2e8);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Freeze the POKEY polys so both arms read the same $60ca on the >= 0x62 branch.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xc2e8 dispatches -- resolveShapeTableIndex == oracle in RAM (-stack) and A/X/Y (poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); resolveShapeTableIndex(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A (packed result) diverged");
    assert.equal(c.regs.x, o.regs.x, "X (quotient) diverged");
    assert.equal(c.regs.y, o.regs.y, "Y (remainder) diverged");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: A < 0x62 -- quotient/remainder split, table lookup, $0112 store, packed A all match", () => {
  for (const ain of [0x00, 0x0f, 0x10, 0x35, 0x59, 0x61]) {
    const o = new Machine(ROM, OPTS); o.regs.a = ain;
    const c = new Machine(ROM, OPTS); c.regs.a = ain;
    oracle(o); const r = resolveShapeTableIndex(c);
    assert.equal(ramDiff(o, c), null, `A_in=0x${ain.toString(16)}: RAM diverged`);
    assert.equal(c.regs.a, o.regs.a, `A_in=0x${ain.toString(16)}: A diverged`);
    assert.equal(c.regs.x, o.regs.x, `A_in=0x${ain.toString(16)}: X diverged`);
    assert.equal(c.regs.y, o.regs.y, `A_in=0x${ain.toString(16)}: Y diverged`);
    assert.equal(c.mem.read8(TUBE_SHAPE_INDEX), o.mem.read8(TUBE_SHAPE_INDEX), `A_in=0x${ain.toString(16)}: $0112 diverged`);
    assert.deepEqual(r, [o.regs.a, o.regs.x, o.regs.y], `A_in=0x${ain.toString(16)}: return tuple`);
  }
});

test("TEETH: a twin that stores the wrong $0112 byte diverges from the oracle", () => {
  const ain = 0x35; // non-default seed so the store is a specific non-zero table byte
  const o = new Machine(ROM, OPTS); o.regs.a = ain;
  const c = new Machine(ROM, OPTS); c.regs.a = ain;
  oracle(o);
  const broken = (m) => {
    const mem = m.mem8;
    const rem = (ain & 0xff) & 0x0f;
    const entry = mem[(0xbc7c + rem) & 0xffff];
    mem[TUBE_SHAPE_INDEX] = (entry + 1) & 0xff; // BUG: off-by-one on the stored byte
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong $0112 store");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.a = 0x10; // < 0x62 -> no POKEY read, fully deterministic
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, resolveShapeTableIndex, TARGET, m);
  assert.equal(r.placeable, true, `resolveShapeTableIndex must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
