// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for copyWorkBufferToRecord (ROM 0x055b) -- block-copy 0x0b bytes from the OBJECT_WORK_BUFFER strip buffer
// into (HL) (tail-jump into blockCopy). Reached by `jnz 0x055b` from alienShotSlot2Handler/alienShotSlot3Handler/alienShotSlot4Handler, each a
// tail-delegate; live-out is memory only (blockCopy's own classification). Contract is RAM (-stack).
// Run: node --test games/invaders/idiomatic/test/equivalence-055b.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_055b as oracleBody } from "../../translated/loc_055b.js";
import { copyWorkBufferToRecord } from "../copyWorkBufferToRecord.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { OBJECT_WORK_BUFFER } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x055b;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x055b dispatches -- copyWorkBufferToRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); copyWorkBufferToRecord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seedPattern(m, addr, n) {
  for (let i = 0; i < n; i++) m.mem.write8(addr + i, (i * 7 + 3) & 0xff);
}

test("CRAFTED: 0x0b bytes copied OBJECT_WORK_BUFFER->(HL) for several destinations", () => {
  for (const DST of [0x2035, 0x2045, 0x2055, 0x2100]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    seedPattern(o, OBJECT_WORK_BUFFER, 0x0b); seedPattern(c, OBJECT_WORK_BUFFER, 0x0b);
    o.regs.hl = DST; c.regs.hl = DST;
    oracle(o); copyWorkBufferToRecord(c);
    assert.equal(ramDiff(o, c), null, `DST=0x${DST.toString(16)}`);
    for (let i = 0; i < 0x0b; i++) {
      assert.equal(c.mem.read8(DST + i), (i * 7 + 3) & 0xff, `dst[${i}] DST=0x${DST.toString(16)}`);
    }
  }
});

test("TEETH: a broken twin (wrong source) is caught", () => {
  function loc_055b_broken(m, hl = m.regs.hl) {
    for (let i = 0; i < 0x0b; i++) m.mem8[hl + i] = (m.mem8[OBJECT_WORK_BUFFER + i] + 1) & 0xff; // BUG: value+1
  }
  const DST = 0x2100;
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedPattern(o, OBJECT_WORK_BUFFER, 0x0b); seedPattern(c, OBJECT_WORK_BUFFER, 0x0b);
  o.regs.hl = DST; c.regs.hl = DST;
  oracle(o); loc_055b_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong copied byte");
  assert.equal(d.addr, DST & 0xffff);
});
