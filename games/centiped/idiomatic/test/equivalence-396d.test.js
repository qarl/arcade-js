// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for accumulateTrackballAndReturnFromIrq (the 0x396d interrupt tail). Its diffed output
// is work RAM: the two per-axis accumulators ($b9/$ba,X) and their previous-sample cells ($bd,X), plus the
// $d5 diagnostic counter on the service branch. Its latch writes ($1404-$1407 palette, $1c00, $1800) land
// outside dumpState. SP is RETIRED: the idiomatic tail is fired as a direct call, so it restores no register
// frame and does not RTI -- it leaves SP INERT (never moves), deliberately diverging from the oracle, which
// still pulls+RTIs. So the arms assert SP is inert, not that it matches the oracle. CAPTURE replays every
// real dispatch; a crafted arm drives the service-pressed counter branch; TEETH proves the RAM diff and the
// SP-inert invariant have teeth.
// Run: node --test games/centiped/idiomatic/test/equivalence-396d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_396d as oracleRom } from "../../translated/loc_396d.js";
import { accumulateTrackballAndReturnFromIrq } from "../accumulateTrackballAndReturnFromIrq.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { loc_d5, loc_bd, TRACKBALL_LAST_DELTA, loc_b9, loc_c5 } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x396d;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(128, 4000) : [];

test("CAPTURE: real 0x396d dispatches == accumulateTrackballAndReturnFromIrq in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); accumulateTrackballAndReturnFromIrq(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.s, cap.regs.s, "SP inert -- the rewrite never touches the stack");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed a fresh machine on the service-pressed branch (IN0 bit5 clear -> the $d5 counter / palette ramp,
// which never calls the spine). vblank (bit6) is held stable across the handler so the two IN0 reads agree.
function seedService(m, s) {
  m.io.inputAssert = { 0: 0x20 };
  if (s.vblank) { m.cycles = 23700; m.io.vblank = 1; }
  m.io.trackX = s.trackX ?? 0;
  m.io.signX = s.signX ?? 0;
  m.mem8[loc_d5] = s.d5 ?? 0;
  for (let i = 0; i < 3; i++) {
    m.mem8[(loc_bd + i * 2) & 0xff] = (s.prev ?? [0, 0, 0])[i] ?? 0;
    m.mem8[(TRACKBALL_LAST_DELTA + i * 2) & 0xff] = (s.last ?? [0, 0, 0])[i] ?? 0;
    m.mem8[(loc_b9 + i * 2) & 0xff] = (s.acc ?? [0, 0, 0])[i] ?? 0;
    m.mem8[(loc_c5 + i) & 0xff] = (s.c5 ?? [0, 0, 0])[i] ?? 0;
  }
}

test("CRAFTED: the service-pressed counter / accumulate branch == oracle in RAM", () => {
  const cases = [
    { tag: "counter inc, vblank clear", d5: 0x03, trackX: 0x05, signX: 0x00 },
    { tag: "counter reset, vblank set", vblank: true, d5: 0x03, trackX: 0x0a, signX: 0x80 },
    { tag: "d5 negative -> skip counter", d5: 0x88, trackX: 0x07 },
    { tag: "delta hysteresis flip", d5: 0x00, trackX: 0x09, signX: 0x80, prev: [0x02, 0, 0x03], last: [0x80, 0, 0x01], acc: [0x10, 0, 0x20] },
    { tag: "zero delta path", d5: 0x01, trackX: 0x00, signX: 0x00, prev: [0x00, 0, 0x00], last: [0x05, 0, 0x05] },
  ];
  for (const s of cases) {
    const o = new Machine(ROM); seedService(o, s);
    const c = new Machine(ROM); seedService(c, s);
    const entrySP = c.regs.s;
    oracle(o); accumulateTrackballAndReturnFromIrq(c);
    assert.equal(ramDiff(o, c), null, s.tag);
    assert.equal(c.regs.s, entrySP, `SP inert: ${s.tag}`);
  }
});

test("TEETH: a skipped accumulator write is caught by the RAM diff", () => {
  const cap = CAPS[0].clone();
  const o = cap.clone(), c = cap.clone();
  oracle(o); accumulateTrackballAndReturnFromIrq(c);
  assert.equal(ramDiff(o, c), null, "precondition: the rewrite matches");
  const broken = (m) => { accumulateTrackballAndReturnFromIrq(m); m.mem8[loc_b9] = (m.mem8[loc_b9] + 1) & 0xff; };
  const c2 = cap.clone();
  broken(c2);
  const d = ramDiff(o, c2);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a one-off in the accumulator");
  assert.equal(d.addr, loc_b9 & 0xffff);
});

test("TEETH(SP): the rewrite is SP-inert; a stray stack touch is caught", () => {
  const cap = CAPS[0].clone();
  const entrySP = cap.regs.s;
  const c = cap.clone();
  accumulateTrackballAndReturnFromIrq(c);
  assert.equal(c.regs.s, entrySP, "precondition: the rewrite leaves SP inert (fired as a direct call)");
  const leaky = (m) => { m.push8(0x00); return accumulateTrackballAndReturnFromIrq(m); };
  const c2 = cap.clone();
  leaky(c2);
  assert.notEqual(c2.regs.s, entrySP, "the SP-inert tooth FAILED to catch a stray push");
});
