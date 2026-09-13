// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_de1b (ROM 0xde1b-0xdf08) -- the EAROM state-machine step over $01c6..$01cf
// and the $6000/$6040/$6050 port block. Contract: RAM (dumpState, minus STACK_SCRATCH) PLUS the exit X/Y,
// which the idiomatic form returns as [x, y] and the frozen oracle leaves in regs.x/regs.y at RTS -- a
// load-bearing register live-out (loc_c891 forwards them to the sound call loc_ccfa). A leaf: the module
// omits the ROM ret and the seam completes it, so RAM arms compare RAM (-stack), NOT pc/SP.
// The routine's $6000-block reads/writes are the EAROM (deterministic, cloned) -- not POKEY random.
// Run: node --test games/tempest/idiomatic/test/equivalence-de1b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_de1b as oracle } from "../../translated/loc_de1b.js";
import { loc_de1b } from "../loc_de1b.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_1c7, loc_1ca, loc_1cc } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xde1b;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xde1b dispatches -- loc_de1b == oracle in RAM (-stack) and in exit [x, y]", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o);
    const [rx, ry] = loc_de1b(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(rx, o.regs.x, "X live-out matches oracle exit X");
    assert.equal(ry, o.regs.y, "Y live-out matches oracle exit Y");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed that skips the fresh-row rebuild (mode byte nonzero) and drives the carry
// arm: ASL of 0x80 sets carry, so the entry stores and the mode byte becomes 0x40.
const seed = (m) => {
  m.regs.x = 0x37; m.regs.y = 0x99; // distinct entry X/Y so the carry/live-out is exercised
  m.mem.write8(loc_1ca, 0x80); // mode byte nonzero -> ASL sets carry
  m.mem.write8(loc_1cc, 0x00); // cursor 0 keeps the port write inside the EAROM window
};

test("CRAFTED: carry arm retires the mode byte $01ca to 0x40, exit [x, y] matches oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const [rx, ry] = loc_de1b(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the step");
  assert.equal(c.mem.read8(loc_1ca), 0x40, "$01ca folded to 0x40");
  assert.equal(rx, o.regs.x, "X live-out matches oracle exit X");
  assert.equal(ry, o.regs.y, "Y live-out matches oracle exit Y (0x0e on the carry arm)");
});

test("CRAFTED: early-return arm (mode byte clear, no fresh row) exits [entryX, 0]", () => {
  const early = (m) => { m.regs.x = 0x37; m.regs.y = 0x99; m.mem.write8(loc_1ca, 0x00); m.mem.write8(loc_1c7, 0x00); };
  const o = new Machine(ROM, OPTS); early(o);
  const c = new Machine(ROM, OPTS); early(c);
  oracle(o);
  const [rx, ry] = loc_de1b(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the early-return path");
  assert.equal(rx, o.regs.x, "X live-out = entry X (never loaded on this path)");
  assert.equal(rx, 0x37, "X carried through from entry");
  assert.equal(ry, o.regs.y, "Y live-out matches oracle exit Y");
  assert.equal(ry, 0x00, "Y is cleared to 0 on the common block (LDY #0)");
});

test("TEETH (RAM): a twin that leaves the mode byte untouched diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const brokenDe1b = (m) => {
    const mem = m.mem8;
    mem[(0x6000) & 0xffff] = 0x00; // does the port write but BUG: never folds $01ca to 0x40
  };
  brokenDe1b(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the skipped mode-byte store");
});

test("TEETH (register): a twin that skips the Y=0 clear returns the wrong exit Y", () => {
  // RAM-correct but register-wrong: it clears $6040 correctly yet returns the stale carried Y instead of 0.
  const early = (m) => { m.regs.x = 0x37; m.regs.y = 0x99; m.mem.write8(loc_1ca, 0x00); m.mem.write8(loc_1c7, 0x00); };
  const o = new Machine(ROM, OPTS); early(o);
  const c = new Machine(ROM, OPTS); early(c);
  oracle(o);
  const brokenDe1b = (m, x = m.regs.x, y = m.regs.y) => {
    m.mem8[0x6040] = 0;      // RAM stays correct
    if (m.mem8[0x01ca] === 0) return [x, y]; // BUG: never did y = 0, so returns entry Y (0x99), not 0
    return [x, y];
  };
  const [, ry] = brokenDe1b(c);
  assert.equal(ramDiff(o, c), null, "RAM stays equal -- the defect is register-only");
  assert.notEqual(ry, o.regs.y, "the register live-out arm FAILED to catch the wrong exit Y");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seed(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, loc_de1b, TARGET, m);
  assert.equal(r.placeable, true, `loc_de1b must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
