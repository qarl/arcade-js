// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1d58 — memory-equivalent to the frozen oracle at ROM 0x1d58.
 * GATE: crafted-entry. Two paths are exercised:
 *   - SEED path (SERVICE not held): we poke the four target cells to a sentinel (0xff) so every write is
 *     observable, then assert both sides land the seeded values (VRAM_WRITE_PTR=0x5000, 0x4008=0x20,
 *     0x401a=0, 0x4005=0).
 *   - SERVICE path (IN0 bit 6 held via io.in0): both sides must write nothing.
 * LIVE-OUT is RAM only; the return-stack window is masked by ramDiff. Teeth: on the seed path a no-op
 * twin, a wrong-value twin and a skip-one-clear twin must diverge; on the service path a gate-ignoring
 * twin (always seeds) must diverge.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { resetScreenFillState as cand } from "../resetScreenFillState.js";
import { loc_1d58 as oracle } from "../../translated/loc_1d58.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const IN0_SERVICE = 0x40;
const VRAM_WRITE_PTR = 0x400b; // + 0x400c (16-bit)
const CELL_4008 = 0x4008;
const NMI_SERVICE_MODE = 0x401a;
const CELL_4005 = 0x4005;
const VRAM_BASE = 0x5000;

// Poke every seed target to 0xff so each write is a visible change; SERVICE not held (io.in0 idle 0).
const seedEntry = () => craft((mem, mm) => {
  mm.push16(0x9999);
  mem[VRAM_WRITE_PTR] = 0xff; mem[VRAM_WRITE_PTR + 1] = 0xff;
  mem[CELL_4008] = 0xff; mem[NMI_SERVICE_MODE] = 0xff; mem[CELL_4005] = 0xff;
});

// SERVICE held (IN0 bit 6): the seed must be skipped. Same sentinels so a stray write would show.
const serviceEntry = () => craft((mem, mm) => {
  mm.push16(0x9999);
  mm.io.in0 = IN0_SERVICE;
  mem[VRAM_WRITE_PTR] = 0xff; mem[VRAM_WRITE_PTR + 1] = 0xff;
  mem[CELL_4008] = 0xff; mem[NMI_SERVICE_MODE] = 0xff; mem[CELL_4005] = 0xff;
});

const noOp = () => {};
const wrongValue = (m) => { m.mem8[VRAM_WRITE_PTR] = (VRAM_BASE & 0xff) ^ 0xff; };
const skipOneClear = (m) => { // seeds everything except clearing NMI_SERVICE_MODE
  m.mem16[VRAM_WRITE_PTR] = VRAM_BASE;
  m.mem8[CELL_4008] = 0x20; m.mem8[CELL_4005] = 0;
};
const ignoreGate = (m) => { // ignores SERVICE and seeds anyway
  m.mem16[VRAM_WRITE_PTR] = VRAM_BASE;
  m.mem8[CELL_4008] = 0x20; m.mem8[NMI_SERVICE_MODE] = 0; m.mem8[CELL_4005] = 0;
};

test("EQUAL (crafted): loc_1d58 == oracle seeds the display cells", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, seedEntry()), null, "loc_1d58 diverged on the seed path");
  const a = seedEntry(); oracle(a);
  assert.equal(a.mem8[VRAM_WRITE_PTR], VRAM_BASE & 0xff, "positive control: VRAM cursor low byte");
  assert.equal(a.mem8[VRAM_WRITE_PTR + 1], (VRAM_BASE >> 8) & 0xff, "positive control: VRAM cursor high byte");
  assert.equal(a.mem8[CELL_4008], 0x20, "positive control: 0x4008 seeded");
  assert.equal(a.mem8[NMI_SERVICE_MODE], 0, "positive control: NMI mode cleared");
  assert.equal(a.mem8[CELL_4005], 0, "positive control: 0x4005 cleared");
  console.log("  EQUAL: loc_1d58 == oracle (RAM), display cells seeded");
});

test("EQUAL (crafted): loc_1d58 == oracle skips on SERVICE held", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, serviceEntry()), null, "loc_1d58 diverged on the service path");
  const a = serviceEntry(); oracle(a);
  assert.equal(a.mem8[VRAM_WRITE_PTR], 0xff, "positive control: oracle really skipped the seed");
  assert.equal(a.mem8[NMI_SERVICE_MODE], 0xff, "positive control: NMI mode untouched on service");
  console.log("  EQUAL: loc_1d58 == oracle (RAM), SERVICE held -> no writes");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, seedEntry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongValue, seedEntry()), "the wrong-value twin escaped");
  assert.ok(ramDiff(oracle, skipOneClear, seedEntry()), "the skip-one-clear twin escaped");
  assert.ok(ramDiff(oracle, ignoreGate, serviceEntry()), "the gate-ignoring twin escaped");
  console.log("  TEETH: no-op, wrong-value, skip-one-clear, gate-ignoring all caught");
});
