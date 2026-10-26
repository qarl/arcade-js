// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for decodeOptionSwitches -- slices $0e00 into three table lookups ($0156/$0158/$00ac/$00ad),
// stashes $0e00 to $000a, writes $0009 = $0d00 ^ 2, then folds $00ad through assemblePotStatusByte and stores its
// return to $016a. The arms assert regs.a AND RAM (-stack), and the CAPTURE arm also the exit [X, Y] the port
// returns (its last X and Y indexes); the oracle's jsr push16 scratch lands in the excluded window when SP is high.
// Run: node --test games/tempest/idiomatic/test/equivalence-d6bb.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d6bb as oracle } from "../../translated/loc_d6bb.js";
import { decodeOptionSwitches } from "../decodeOptionSwitches.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, DSW2_SNAPSHOT, DSW1_SNAPSHOT, loc_ac, loc_ad, BONUS_LIFE_INTERVAL, DSW_BONUS_CONFIG, DSW_DIFFICULTY, DSW1_COINAGE, DSW2_OPTIONS } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xd6bb;
const inDeadStack = (a) => a != null && a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0xd6bb dispatches -- decodeOptionSwitches == oracle in RAM (-stack) and regs.a", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); { c.regs.x ^= 0xff; c.regs.y ^= 0xff; // m.regs poisoned: this routine takes no entry X/Y, so its exit must not depend on them
      assert.deepEqual(decodeOptionSwitches(c), [o.regs.x, o.regs.y], "returned exit [X, Y] = the oracle's"); }
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "regs.a live-out");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: three lookups + toggled copy + folded return all match the oracle", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.io.dsw2 = 0xba; // $0e00 DSW2 is a read-only port -- seed via io, not a RAM write. (>>3)&7=7, (>>6)&3=2, &6=2
    m.io.dsw1 = 0x55; // $0d00 DSW1, likewise read-only
    // assemblePotStatusByte reads $60d8/$60c8 which decode to POKEY reg 8 = ALLPOT (0 here), so the fold returns 0.
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); decodeOptionSwitches(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after run");
  assert.equal(c.regs.a, o.regs.a, "regs.a live-out equal");
  assert.equal(c.mem.read8(DSW2_SNAPSHOT), 0xba, "$000a <- $0e00");
  assert.equal(c.mem.read8(DSW1_SNAPSHOT), 0x55 ^ 0x02, "$0009 = $0d00 ^ 2");
  for (const cell of [BONUS_LIFE_INTERVAL, DSW_BONUS_CONFIG, loc_ac, loc_ad, DSW_DIFFICULTY])
    assert.equal(c.mem.read8(cell), o.mem.read8(cell), `cell ${cell.toString(16)} matches oracle`);
});

test("TEETH: a twin that skips the $0158 lookup and the folded $016a store diverges", () => {
  const seed = (m) => {
    m.regs.s = 0xfb;
    m.io.dsw2 = 0x4d; // $0e00 -> (>>3)&7=1, (>>6)&3=1, &6=4: $0156<-tbl[1]=0x01, $0158<-tbl[1]=0x04, $00ac/$00ad nonzero
    m.io.dsw1 = 0x31; // $0d00
  };
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const mem = m.mem8;
    const a0 = mem[DSW2_OPTIONS];
    mem[DSW2_SNAPSHOT] = a0;
    mem[DSW1_SNAPSHOT] = mem[DSW1_COINAGE] ^ 0x02;
    // BUG: never writes the $0156/$0158 lookups, $00ac/$00ad, or the folded $016a -- all REAL role writes
    // the oracle makes nonzero for this seed ($0158<-0x04, $00ac<-0xa9, ...), so the RAM diff MUST catch it.
    // ($016a folds to 0 here, so it is not relied on -- $0158/$0156/$00ac carry the divergence.)
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped role writes");
});

test("SP-TOOTH: the omitted-ret caller is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, decodeOptionSwitches, TARGET, m);
  assert.equal(r.placeable, true, `decodeOptionSwitches must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret caller placeable");
});
