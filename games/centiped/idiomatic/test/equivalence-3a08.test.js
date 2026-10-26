// SPDX-License-Identifier: GPL-3.0-only
// Equivalence for foldHighScoreChecksum (ROM 0x3a08) -- XOR-fold 0x0178..0x01b4 into HIGH_SCORE_CHECKSUM and return
// the old^new delta. Live-out is RAM (HIGH_SCORE_CHECKSUM, the fresh fold) AND registers A (the delta, with N/Z so
// the caller's BNE/BEQ read it) and Y (the OLD checksum, which loc_3d57 stores back). We compare RAM plus
// A/Y and the Z/N flags -- not firstRegDiff, which would false-fail on S.
// Run: node --test games/centiped/idiomatic/test/equivalence-3a08.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3a08 as oracleRom } from "../../translated/loc_3a08.js";
import { foldHighScoreChecksum } from "../foldHighScoreChecksum.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { HIGH_SCORE_TABLE, HIGH_SCORE_CHECKSUM } from "../names.js";
import { stampEntry, deadStackAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x3a08;
const TABLE_LEN = 0x3d; // 0x0178..0x01b4 inclusive == 61 bytes folded
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Live-out registers + flags (A/Y data, Z/N from the delta). S/P-byte excluded.
const regOutDiff = (o, c) => {
  for (const k of ["a", "y"]) if (o.regs[k] !== c.regs[k]) return { reg: k, o: o.regs[k], c: c.regs[k] };
  if (o.regs.fZ !== c.regs.fZ) return { reg: "fZ", o: o.regs.fZ, c: c.regs.fZ };
  if (o.regs.fN !== c.regs.fN) return { reg: "fN", o: o.regs.fN, c: c.regs.fN };
  return null;
};

const foldOf = (bytes) => bytes.reduce((acc, b) => acc ^ b, 0xff) & 0xff;

function seedTable(m, oldChecksum, bytes) {
  for (let i = 0; i < TABLE_LEN; i++) m.mem.write8(HIGH_SCORE_TABLE + i, bytes[i]);
  m.mem.write8(HIGH_SCORE_CHECKSUM, oldChecksum);
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x3a08 dispatches -- foldHighScoreChecksum == oracle in RAM + live-out A/Y/Z", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); foldHighScoreChecksum(c);
    assert.equal(ramDiff(o, c), null);      // the fold stored at HIGH_SCORE_CHECKSUM
    assert.equal(regOutDiff(o, c), null);   // delta in A (+ N/Z), old checksum in Y
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: fold, publish, delta for several tables (incl. a delta==0 case)", () => {
  const mk = (fn) => Array.from({ length: TABLE_LEN }, (_, i) => fn(i) & 0xff);
  const scenarios = [
    { old: 0x00, bytes: mk(() => 0x00) },   // fold=0xff, delta=0xff
    { old: 0x5a, bytes: mk((i) => i) },     // varied
    { old: 0xff, bytes: mk(() => 0xa5) },   // varied high
  ];
  // A delta==0 case: choose old == fold so the Z flag must be set.
  const zeroBytes = mk((i) => (i * 7) & 0xff);
  scenarios.push({ old: foldOf(zeroBytes), bytes: zeroBytes });

  for (const { old, bytes } of scenarios) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    seedTable(o, old, bytes); seedTable(c, old, bytes);
    oracle(o); foldHighScoreChecksum(c);
    const fold = foldOf(bytes);
    const delta = (old ^ fold) & 0xff;
    const label = `old=0x${old.toString(16)} fold=0x${fold.toString(16)}`;
    assert.equal(ramDiff(o, c), null, label);
    assert.equal(regOutDiff(o, c), null, label);
    assert.equal(c.mem.read8(HIGH_SCORE_CHECKSUM), fold, `HIGH_SCORE_CHECKSUM fold ${label}`);
    assert.equal(c.regs.a, delta, `A delta ${label}`);
    assert.equal(c.regs.y, old, `Y old checksum ${label}`);
    assert.equal(c.regs.fZ, delta === 0, `fZ ${label}`);
  }
});

test("TEETH: a broken twin (wrong seed) is caught by the RAM + register contract", () => {
  // Broken: seeds the accumulator 0x00 instead of 0xff -- a different fold at HIGH_SCORE_CHECKSUM and a different delta.
  function loc_3a08_broken(m) {
    const { mem8 } = m;
    let acc = 0x00; // BUG: seed should be 0xff
    for (let i = 0x3c; i >= 0; i--) acc = (acc ^ mem8[HIGH_SCORE_TABLE + i]) & 0xff;
    const oldChecksum = mem8[HIGH_SCORE_CHECKSUM];
    mem8[HIGH_SCORE_CHECKSUM] = acc;
    const delta = (oldChecksum ^ acc) & 0xff;
    m.regs.y = oldChecksum;
    m.regs.fZ = delta === 0;
    m.regs.fN = (delta & 0x80) !== 0;
    return (m.regs.a = delta);
  }
  const bytes = Array.from({ length: TABLE_LEN }, (_, i) => (i + 1) & 0xff);
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedTable(o, 0x33, bytes); seedTable(c, 0x33, bytes);
  oracle(o); loc_3a08_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong fold seed");
  assert.equal(d.addr, HIGH_SCORE_CHECKSUM & 0xffff);
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM);
  m.regs.s = 0xfd;
  m.mem.write16(0x01fe, 0x3f38); // a real caller-return word for the seam to consume
  const r = seamPlaceable(withOmittedRet, foldHighScoreChecksum, TARGET, m);
  assert.equal(r.placeable, true, `foldHighScoreChecksum must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
