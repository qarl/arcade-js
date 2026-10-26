// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for copyRecordToWorkBuffer (ROM 0x0550) -- stash A at ALIEN_SHOT_SPRITE_FRAME_CEILING, then block-copy 0x0b bytes from
// (DE) into the OBJECT_WORK_BUFFER strip buffer (tail-jump into blockCopy). Live-out is memory only: every caller
// overwrites A immediately after the call (alienShotSlot2Handler/alienShotSlot3Handler/alienShotSlot4Handler), so the contract is RAM (-stack).
// Run: node --test games/invaders/idiomatic/test/equivalence-0550.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0550 as oracleBody } from "../../translated/loc_0550.js";
import { copyRecordToWorkBuffer } from "../copyRecordToWorkBuffer.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { OBJECT_WORK_BUFFER, ALIEN_SHOT_SPRITE_FRAME_CEILING } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0550;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0550 dispatches -- copyRecordToWorkBuffer == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); copyRecordToWorkBuffer(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seedPattern(m, addr, n) {
  for (let i = 0; i < n; i++) m.mem.write8(addr + i, (i * 7 + 3) & 0xff);
}

test("CRAFTED: A stashed at ALIEN_SHOT_SPRITE_FRAME_CEILING and 0x0b bytes copied (DE)->OBJECT_WORK_BUFFER", () => {
  const SRC = 0x2100; // source strip in work RAM, disjoint from OBJECT_WORK_BUFFER
  for (const a of [0x00, 0x01, 0x7f, 0xff, 0xa5]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    seedPattern(o, SRC, 0x0b); seedPattern(c, SRC, 0x0b);
    o.regs.a = a; o.regs.de = SRC;
    c.regs.a = a; c.regs.de = SRC;
    oracle(o); copyRecordToWorkBuffer(c);
    assert.equal(ramDiff(o, c), null, `A=0x${a.toString(16)}`);
    assert.equal(c.mem.read8(ALIEN_SHOT_SPRITE_FRAME_CEILING), a, `A stashed A=0x${a.toString(16)}`);
    for (let i = 0; i < 0x0b; i++) {
      assert.equal(c.mem.read8(OBJECT_WORK_BUFFER + i), (i * 7 + 3) & 0xff, `strip[${i}] A=0x${a.toString(16)}`);
    }
  }
});

test("TEETH: a broken twin (copies one byte short) is caught", () => {
  function loc_0550_broken(m, a = m.regs.a, de = m.regs.de) {
    m.mem8[ALIEN_SHOT_SPRITE_FRAME_CEILING] = a;
    blockCopyShort(m, de, OBJECT_WORK_BUFFER, 0x0b);
  }
  function blockCopyShort(m, de, hl, b) { // BUG: copies b-1 bytes, leaves the last byte stale
    for (let i = 0; i < b - 1; i++) m.mem8[hl + i] = m.mem8[de + i];
  }
  const SRC = 0x2100;
  const o = new Machine(ROM); const c = new Machine(ROM);
  seedPattern(o, SRC, 0x0b); seedPattern(c, SRC, 0x0b);
  o.regs.a = 0xa5; o.regs.de = SRC;
  c.regs.a = 0xa5; c.regs.de = SRC;
  oracle(o); loc_0550_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a short copy");
  assert.equal(d.addr, (OBJECT_WORK_BUFFER + 0x0a) & 0xffff);
});
