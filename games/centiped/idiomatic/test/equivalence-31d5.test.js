// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for transposeScreenBitmap (ROM 0x31d5) -- rewrites the whole tile map ($0400-$07BF)
// as a monochrome bit image rotated through a $0100 scratch column buffer. Live-out is memory only
// (video RAM + the scratch buffer + the $8b/$8d/$8e/$32/$33 bookkeeping), so every arm checks the RAM
// diff (minus stack). A leaf: it omits the ROM ret and the seam completes it.
// Run: node --test games/centiped/idiomatic/test/equivalence-31d5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_31d5 as oracleRom } from "../../translated/loc_31d5.js";
import { transposeScreenBitmap } from "../transposeScreenBitmap.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { TILEMAP_PTR_LO, TILEMAP_PTR_HI, loc_8b, loc_8d, loc_8e, loc_ef, loc_0100 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x31d5;
const VRAM_LO = 0x0400, VRAM_HI = 0x07c0; // 0x0400-0x07BF is video RAM
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps taken before any boot-gap throw */ }
  return caps;
}
// 0x31d5 is a round/attract transition run from loc_23da/loc_2741 -- gameplay states the attract boot
// does not reach (0 dispatches through 2000 frames). The CRAFTED screens below carry the check.
const CAPS = ROM_PRESENT ? captureDispatches(8, 2000) : [];

// Fill the whole tile map (and the scratch page) with a deterministic pattern that straddles the 0x38
// threshold in the low 6 bits, so both output branches (blank tile / solid tile) fire.
function seedScreen(m, k) {
  for (let a = VRAM_LO; a < VRAM_HI; a++) m.mem.write8(a, ((a * (k * 7 + 3)) ^ (k * 0x2b)) & 0xff);
  for (let a = 0x0100; a < 0x0200; a++) m.mem.write8(a, ((a * 5) ^ (k * 0x13)) & 0xff);
  m.mem.write8(loc_ef, (k * 0x33) & 0xff);
}

test("CAPTURE: real 0x31d5 dispatches -- transposeScreenBitmap == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); transposeScreenBitmap(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: seeded tile maps transpose identically to the oracle (RAM -stack)", () => {
  for (let k = 0; k < 6; k++) {
    const o = new Machine(ROM); seedScreen(o, k);
    const c = new Machine(ROM); seedScreen(c, k);
    // positive control: capture the seed so we can prove the routine actually rewrote the screen.
    const before = [];
    for (let a = VRAM_LO; a < VRAM_HI; a++) before.push(o.mem8[a]);
    oracle(o); transposeScreenBitmap(c);
    assert.equal(ramDiff(o, c), null, `screen k=${k}`);
    let changed = 0;
    for (let a = VRAM_LO, i = 0; a < VRAM_HI; a++, i++) if (o.mem8[a] !== before[i]) changed++;
    assert.ok(changed > 0, `positive control: the routine must rewrite video RAM (k=${k})`);
    // it terminates having paged the pointer up to $0700 and Y to 0xc0.
    assert.equal(o.mem8[TILEMAP_PTR_HI], 0x07, `pointer paged to 0x07 (k=${k})`);
    assert.equal(c.mem8[TILEMAP_PTR_HI], 0x07, `idiomatic paged to 0x07 (k=${k})`);
  }
});

test("TEETH: an off-by-one threshold twin (>= 0x39) diverges in the RAM diff", () => {
  // A faithful copy of the transform with ONE bug: the pack threshold is 0x39, not 0x38.
  const brokenTranspose = (m) => {
    m.mem8[TILEMAP_PTR_LO] = 0x00; m.mem8[TILEMAP_PTR_HI] = 0x04; m.mem8[loc_8d] = 0x00;
    let y = 0x00;
    for (;;) {
      m.mem8[loc_8b] = 0x00; m.mem8[loc_8e] = y; let carry = false;
      for (let x = 8; x > 0; x--) {
        const tile = m.mem8[(m.mem16[TILEMAP_PTR_LO] + y) & 0xffff] & 0x3f;
        carry = tile >= 0x39; // BUG: should be >= 0x38
        const v = m.mem8[loc_8b];
        m.mem8[loc_8b] = ((v << 1) | (carry ? 1 : 0)) & 0xff;
        carry = (v & 0x80) !== 0; y = (y + 1) & 0xff;
      }
      const sx = m.mem8[loc_8d];
      const prev = m.mem8[(loc_0100 + sx) & 0xffff];
      m.mem8[loc_8d] = (m.mem8[loc_8d] + 1) & 0xff;
      m.mem8[(loc_0100 + sx) & 0xffff] = m.mem8[loc_8b];
      m.mem8[loc_8b] = prev; y = m.mem8[loc_8e];
      for (let x = 8; x > 0; x--) {
        const v = m.mem8[loc_8b];
        m.mem8[loc_8b] = ((v << 1) | (carry ? 1 : 0)) & 0xff;
        carry = (v & 0x80) !== 0;
        m.mem8[(m.mem16[TILEMAP_PTR_LO] + y) & 0xffff] = carry ? (0x3f ^ m.mem8[loc_ef]) & 0xff : 0x00;
        y = (y + 1) & 0xff;
      }
      if (y === 0x00) m.mem8[TILEMAP_PTR_HI] = (m.mem8[TILEMAP_PTR_HI] + 1) & 0xff;
      if (y !== 0xc0) continue;
      if (m.mem8[TILEMAP_PTR_HI] !== 0x07) continue;
      return;
    }
  };
  // Seed a screen that contains a tile whose low 6 bits are exactly 0x38 (the bug flips it).
  const mk = () => { const m = new Machine(ROM); for (let a = VRAM_LO; a < VRAM_HI; a++) m.mem.write8(a, 0x38); m.mem.write8(loc_ef, 0x00); return m; };
  const o = mk(), b = mk();
  oracle(o); brokenTranspose(b);
  assert.notEqual(ramDiff(o, b), null, "the RAM diff FAILED to catch the off-by-one threshold");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0xcd); m.mem.write8(0x01fd, 0xab); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, transposeScreenBitmap, TARGET, m);
  assert.equal(r.placeable, true, `transposeScreenBitmap must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
