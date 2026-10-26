// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loadDrawSequenceBlock (ROM 0x0ae2) -- seat HL=0x20c2, B=0x0c, tail-jump into blockCopy
// (0x1a32): copy 12 bytes from (DE) to 0x20c2. The 0x1a32 m.call is DISSOLVED into a direct blockCopy.
// Input register DE (source); live-out is memory only (blockCopy's HL/DE/B advances are dead across its
// callers), so each side runs on its own machine and the contract is RAM (dumpState, minus stack scratch below the entry SP).
// Run: node --test games/invaders/idiomatic/test/equivalence-0ae2.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0ae2 as oracleBody } from "../../translated/loc_0ae2.js";
import { loadDrawSequenceBlock } from "../loadDrawSequenceBlock.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { STACK_SCRATCH, ANIM_FRAME_COUNTER as DEST } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0ae2;
const N = 0x0c; // bytes copied
const CALLER_RET = 0xabcd;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x0ae2 dispatches -- loadDrawSequenceBlock == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    // The oracle tail-rets through the seam (pops the caller word just below the entry SP); exclude
    // relative to that SP as well as the fixed scratch window. The module never touches the stack.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off),
      (a) => deadStackBelow(STACK_SCRATCH, sp)(a) || (a != null && a >= sp - 0x10 && a < sp));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); loadDrawSequenceBlock(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seedPattern(m, addr, n) {
  for (let i = 0; i < n; i++) m.mem.write8(addr + i, (i * 7 + 3) & 0xff);
}

test("CRAFTED: 12 bytes copied (DE)->0x20c2 for several sources", () => {
  for (const src of [0x2280, 0x2100, 0x1cfa /* ROM source */]) {
    const o = new Machine(ROM); const c = new Machine(ROM);
    o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
    c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
    if (src >= 0x2000) { seedPattern(o, src, N); seedPattern(c, src, N); }
    o.regs.de = src; c.regs.de = src;
    oracle(o); loadDrawSequenceBlock(c);
    assert.equal(ramDiff(o, c), null, `src=0x${src.toString(16)}`);
    for (let i = 0; i < N; i++) {
      assert.equal(c.mem.read8(DEST + i), o.mem.read8(DEST + i), `dst[${i}] src=0x${src.toString(16)}`);
    }
  }
});

test("TEETH: a module-mutating twin (wrong byte count) is caught", () => {
  // Broken twin of loadDrawSequenceBlock: copies 11 bytes instead of 12 -- leaves the 12th cell unwritten.
  function loc_0ae2_broken(m, de = m.regs.de) {
    for (let i = 0; i < N - 1; i++) m.mem8[DEST + i] = m.mem8[de + i]; // BUG: N-1
  }
  const src = 0x2280;
  const o = new Machine(ROM); const c = new Machine(ROM);
  o.regs.sp = 0x2400; o.push16(CALLER_RET); o.io.setInte(false);
  c.regs.sp = 0x2400; c.push16(CALLER_RET); c.io.setInte(false);
  seedPattern(o, src, N); seedPattern(c, src, N);
  // pre-dirty the 12th dst cell on BOTH so the oracle overwrites it and the twin does not
  o.mem.write8(DEST + N - 1, 0x99); c.mem.write8(DEST + N - 1, 0x99);
  o.regs.de = src; c.regs.de = src;
  oracle(o); loc_0ae2_broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a short copy");
  assert.equal(d.addr, (DEST + N - 1) & 0xffff);
});
