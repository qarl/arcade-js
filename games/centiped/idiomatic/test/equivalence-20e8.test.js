// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for seedWaveState (ROM 0x20e8) -- fold $ef/$f0 into $40/$70, rejection-sample the POKEY
// RNG into $60 (value & 0xf8 in [0x10,0xf8], minus 4), pick $80 = 3-or-2 from $ab[$88], clear $50/$b8. A
// leaf: it omits the ROM ret and the seam completes it. Live-out is RAM only (every JSR return site
// overwrites A at once; the tail-jmp callers read no register back), so the arms compare RAM (-stack).
// The spin on $100a is clock-coupled in the oracle (m.step advances the RNG each iteration) but every real
// dispatch and the default crafted RNG (0xff -> masked 0xf8) satisfy the range on the FIRST read, so the
// clock-free rewrite reads the identical first value and breaks in lockstep.
// Run: node --test games/centiped/idiomatic/test/equivalence-20e8.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_20e8 as oracleRom } from "../../translated/loc_20e8.js";
import { seedWaveState } from "../seedWaveState.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { loc_ef, loc_f0, loc_40, loc_70, loc_60, loc_88, loc_ab, loc_80, HEAD_VELOCITY_SEED, loc_b8 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x20e8;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x20e8 dispatches -- seedWaveState == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); seedWaveState(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Fresh Machine: default POKEY RNG (pokeyC0 null) reads 0xff -> masked 0xf8, so the spin breaks on read 1
// on BOTH sides. Seed the difficulty params and the $ab[$88] selector byte.
function seed(m, { ef, f0, x88, abVal }) {
  m.mem.write8(loc_ef, ef);
  m.mem.write8(loc_f0, f0);
  m.mem.write8(loc_88, x88);
  m.mem.write8((loc_ab + x88) & 0xff, abVal);
}

test("CRAFTED: $40/$70 folded, $60 from RNG-4, $80 = 3-or-2, $50/$b8 cleared", () => {
  const cases = [
    { ef: 0x11, f0: 0x22, x88: 0x00, abVal: 0x06, want80: 0x03 }, // $ab[$88] == 6 -> 3 (bcs boundary)
    { ef: 0x11, f0: 0x22, x88: 0x00, abVal: 0x05, want80: 0x02 }, // $ab[$88] <  6 -> 2
    { ef: 0xff, f0: 0x00, x88: 0x03, abVal: 0x40, want80: 0x03 }, // nonzero index, high selector
  ];
  for (const tc of cases) {
    const o = new Machine(ROM); seed(o, tc);
    const c = new Machine(ROM); seed(c, tc);
    oracle(o); seedWaveState(c);
    const tag = `ef=0x${tc.ef.toString(16)} ab=0x${tc.abVal.toString(16)}`;
    assert.equal(ramDiff(o, c), null, `RAM matches: ${tag}`);
    assert.equal(c.mem.read8(loc_40), 0x1c ^ tc.ef, `$40 folded: ${tag}`);
    assert.equal(c.mem.read8(loc_70), 0xf8 ^ tc.f0, `$70 folded: ${tag}`);
    assert.equal(c.mem.read8(loc_60), 0xf8 - 4, `$60 = masked(0xf8)-4: ${tag}`); // default RNG 0xff
    assert.equal(c.mem.read8(loc_80), tc.want80, `$80 count: ${tag}`);
    assert.equal(c.mem.read8(HEAD_VELOCITY_SEED), 0x00, `$50 cleared: ${tag}`);
    assert.equal(c.mem.read8(loc_b8), 0x00, `$b8 cleared: ${tag}`);
  }
});

test("TEETH: a twin that stores the raw masked byte (not masked-4) into $60 diverges", () => {
  // Broken twin: identical to seedWaveState but omits the `- 4` on $60.
  function seedWaveState_broken(m) {
    const { mem8 } = m;
    mem8[loc_40] = 0x1c ^ mem8[loc_ef];
    mem8[loc_70] = 0xf8 ^ mem8[loc_f0];
    let masked;
    do { masked = m.mem.read8(0x100a) & 0xf8; } while (masked < 0x10);
    mem8[loc_60] = masked;            // BUG: dropped the -4
    const sel = mem8[(loc_ab + mem8[loc_88]) & 0xff];
    mem8[loc_80] = sel >= 0x06 ? 0x03 : 0x02;
    mem8[HEAD_VELOCITY_SEED] = 0x00; mem8[loc_b8] = 0x00;
  }
  const tc = { ef: 0x11, f0: 0x22, x88: 0x00, abVal: 0x06 };
  const o = new Machine(ROM); seed(o, tc);
  const c = new Machine(ROM); seed(c, tc);
  oracle(o); seedWaveState_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the dropped -4");
  assert.equal(d.addr, loc_60 & 0xffff, "first divergence is $60");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xff;
  m.push16(0xabcd); // a real caller-return word on the 6502 page-1 stack for the seam to consume
  const r = seamPlaceable(withOmittedRet, seedWaveState, TARGET, m);
  assert.equal(r.placeable, true, `seedWaveState must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
