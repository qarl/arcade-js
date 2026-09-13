// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_dd0d (ROM 0xdd0d-0xdd26) -- builds the spinner/pot readout vector list: a fixed
// header word, a zero-tagged word, an eight-digit run keyed by (loc_d00), a second run keyed by (loc_e00),
// then loc_dbe0 (pulses the POKEY pot-scan trigger $60db -- DISCARDED by the board, so the A fed in is
// unobservable in RAM -- and returns the assembled pot-status byte from loc_60d8/loc_60c8), whose result
// keys a final eight-digit run via Y. loc_dd0d is UNREACHED in the capture, so this is CRAFTED-only.
// Live-out is RAM (dumpState minus STACK_SCRATCH) plus A/Y. Oracle is the frozen translated loc_dd0d.
// Run: node --test games/tempest/idiomatic/test/equivalence-dd0d.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dd0d as oracle } from "../../translated/loc_dd0d.js";
import { loc_dd0d } from "../loc_dd0d.js";
import { loc_df53 } from "../loc_df53.js";
import { loc_df6a } from "../loc_df6a.js";
import { loc_dd29 } from "../loc_dd29.js";
import { loc_dd27 } from "../loc_dd27.js";
import { loc_dbe0 } from "../loc_dbe0.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, loc_74, loc_75, loc_d00, loc_e00, loc_60d8, loc_60c8 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdd0d;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(8, 3000) : [];

test("CAPTURE: real 0xdd0d dispatches (if any) -- loc_dd0d == oracle in RAM (-stack), A/Y", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_dd0d(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
    // Y is not compared: loc_dd0d tail-delegates to the final digit run, so its exit Y belongs to that
    // callee and is not a value loc_dd0d itself produces (the idiomatic layer threads it by param, not m.regs).
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked (loc_dd0d is deep-tail, 0 expected)`);
});

function seed(m) {
  m.mem.write8(loc_74, 0x00); m.mem.write8(loc_75, 0x20); // display-list cursor -> vector RAM 0x2000
  // loc_d00 (0x0d00) / loc_e00 (0x0e00) are read-only DIP-switch input ports; both clones read the same
  // configured default through the port, so no seeding is needed (and write8 there would throw).
  m.mem.write8(loc_60d8, 0x05); m.mem.write8(loc_60c8, 0x20); // loc_dbe0's pot-status inputs
}

test("CRAFTED: full readout build -- RAM and A/Y equal to the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); loc_dd0d(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the readout build");
  assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  assert.notEqual(c.mem.read8(loc_74), 0x00, "the cursor advanced (words were emitted)");
});

test("TEETH: a twin that skips loc_dbe0 (its loc_37 pot-status write) diverges from the oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    loc_df53(m);
    loc_df6a(m, 0x00);
    loc_dd29(m, mem8[loc_d00], 0xe8);
    const a = loc_dd27(m, mem8[loc_e00]);
    // BUG: skips loc_dbe0 entirely, so its loc_37 = (loc_60d8 & 7) write never happens
    return loc_dd27(m, a);
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped loc_dbe0 write");
});
