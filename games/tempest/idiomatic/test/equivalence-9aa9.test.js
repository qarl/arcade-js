// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for the loc_9aa9 mid-entry (ROM 0x9aa9) -- it folds two held bytes together with OR to
// form the low pointer value ($9b03 | $016d), presets the index to 1, and runs the shared setup entered one
// step later ($2c<-the ORed value, $9afd[1]->$2d, 1->$2b, A<-$29). Neither the incoming A nor Y is read.
// Live-out is RAM (dumpState minus STACK_SCRATCH) plus A. The mid-entry is not a separate export in the
// frozen translated module, so the oracle is composed from its preset (OR + index 1) feeding the frozen
// translated setup routine loc_9af1.
// Run: node --test games/tempest/idiomatic/test/equivalence-9aa9.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_9af1 as oracleSetup } from "../../translated/loc_9aee.js";
import { loc_9aa9 } from "../loc_9a9d.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, loc_29, loc_2b, loc_2c, loc_2d, loc_16d, loc_9afd, loc_9b03 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x9aa9;
// The mid-entry: fold the two held bytes with OR, preset the index to 1, then run the frozen setup.
const oracle = (m) => { m.regs.a = m.mem.read8(loc_9b03) | m.mem.read8(loc_16d); m.regs.y = 0x01; return oracleSetup(m); };
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

test("CAPTURE: real 0x9aa9 dispatches -- loc_9aa9 == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_9aa9(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, a29, held) {
  m.regs.a = 0x00; m.regs.y = 0x77; // incoming A/Y are dead -- the entry sets its own value/index
  m.mem.write8(loc_16d, held); // the second held byte the low pointer ORs in
  m.mem.write8(loc_29, a29);
  m.mem.write8(loc_2c, 0xa1); m.mem.write8(loc_2b, 0xa2); m.mem.write8(loc_2d, 0xa3); // dirty sentinels
}

test("CRAFTED: OR marshalling and index-1 setup -- RAM and A equal, both operands feed $2c", () => {
  const rom9b03 = new Machine(ROM, OPTS).mem.read8(loc_9b03);
  for (const held of [0x00, 0xff]) {
    const o = new Machine(ROM, OPTS); seed(o, 0x42, held);
    const c = new Machine(ROM, OPTS); seed(c, 0x42, held);
    oracle(o); loc_9aa9(c);
    assert.equal(ramDiff(o, c), null, `RAM equal after setup (held=${held})`);
    assert.equal(c.regs.a, o.regs.a, `A live-out matches (held=${held})`);
    assert.equal(c.mem.read8(loc_2b), 0x01, `$2b holds the index (held=${held})`);
    assert.equal(c.mem.read8(loc_2c), (rom9b03 | held) & 0xff, `$2c = held-byte OR held-byte (held=${held})`);
    assert.equal(c.regs.a, 0x42, `A reloaded from $29 (held=${held})`);
  }
});

test("MUTATION: a twin that drops the OR of the second held byte diverges in RAM", () => {
  const rom9b03 = new Machine(ROM, OPTS).mem.read8(loc_9b03);
  const extra = (~rom9b03) & 0xff; // a bit the ROM low byte lacks, so the OR is observable
  assert.notEqual(extra, 0, "positive control: the ROM low byte must have a spare bit for the OR to show");
  const o = new Machine(ROM, OPTS); seed(o, 0x42, extra);
  const c = new Machine(ROM, OPTS); seed(c, 0x42, extra);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    mem8[loc_2c] = mem8[loc_9b03]; // BUG: drops the | of the second held byte
    mem8[loc_2d] = mem8[u16(loc_9afd + 0x01)];
    mem8[loc_2b] = 0x01;
    m.regs.a = mem8[loc_29];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the dropped OR");
});
