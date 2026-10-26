// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSignedVelocityNudge (ROM 0xa69b) -- signed random step: magnitude = POKEY2 RANDOM ($60da) & 7,
// sign from the incoming A's bit 0 (set bit 0 -> two's-complement). It writes NO memory, so the live-out is
// register A; RAM (dumpState, minus stack scratch below the entry SP) stays identical and A is compared directly.
//   POKEY coupling: RANDOM ($60da) is clock-coupled (the read charges cycles the idiomatic doesn't), so the
// two arms can only agree when the POKEY poly is frozen. We freeze it (clear SK_RESET on both chips ->
// _advance early-returns -> poly index constant) so oracle and idiomatic read the SAME RANDOM byte. On a
// fresh machine skctl is already 0 (frozen at index 0 -> $60da = 0xff, magnitude 7), so the crafted arm is
// deterministic; freezing the captured mid-game clones makes the CAPTURE arm deterministic too.
// Run: node --test games/tempest/idiomatic/test/equivalence-a69b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_a69b } from "../../translated/loc_a69b.js";
import { drawSignedVelocityNudge } from "../drawSignedVelocityNudge.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const opt = (name) => existsSync(new URL(name, ROM_DIR)) ? new Uint8Array(readFileSync(new URL(name, ROM_DIR))) : undefined;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xa69b;
const oracle = atEntry(loc_a69b);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Freeze the POKEY polys: clearing SK_RESET (0x03) makes _advance early-return, so the RANDOM index no
// longer moves with the cycle count -> both arms read the same $60da byte.
const freezePokey = (m) => { for (const p of m.io.pokeys) p.skctl &= ~0x03; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xa69b dispatches -- drawSignedVelocityNudge == oracle in A and RAM (-stack, poly frozen)", () => {
  for (const cap of CAPS) {
    const o = freezePokey(cap.clone()), c = freezePokey(cap.clone());
    oracle(o); drawSignedVelocityNudge(c);
    assert.equal(o.regs.a, c.regs.a, "register A (the signed step) diverged");
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: positive branch (bit0=0) and negated branch (bit0=1) == oracle in A", () => {
  // Fresh machine: skctl=0 -> polys frozen at index 0 -> $60da = 0xff -> magnitude 7 on both arms.
  for (const ain of [0x00, 0x10, 0xfe, 0x01, 0x11, 0xff]) {
    const o = new Machine(ROM, OPTS); o.regs.a = ain;
    const c = new Machine(ROM, OPTS); c.regs.a = ain;
    oracle(o); drawSignedVelocityNudge(c);
    assert.equal(c.regs.a, o.regs.a, `A_in=0x${ain.toString(16)}: signed step diverged`);
    assert.equal(ramDiff(o, c), null, `A_in=0x${ain.toString(16)}: RAM (should be untouched) diverged`);
  }
});

test("TEETH: a twin that never negates diverges from the oracle when bit0=1", () => {
  const ain = 0x01; // bit 0 set -> oracle negates the magnitude
  const o = new Machine(ROM, OPTS); o.regs.a = ain;
  oracle(o);
  const mag = new Machine(ROM, OPTS).mem.read8(0x60da) & 0x07; // the frozen magnitude both arms see
  assert.notEqual(mag, 0, "precondition: the frozen RANDOM magnitude is non-zero so negation actually bites");
  const brokenPositive = mag; // BUG: skip the two's-complement, hand back the raw positive magnitude
  assert.notEqual(brokenPositive, o.regs.a, "the A compare FAILED to catch a skipped negation");
});
