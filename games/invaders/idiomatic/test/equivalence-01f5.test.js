// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for initPlayer2ShieldBuffers -- seat the player-2 shield buffer base, then delegate to
// initShieldBuffers (the 0x01f8 tail dissolved): replicate the 0x2c-byte template into four consecutive
// slots. Live-in: none (the base is seated internally). Live-out: the four filled slots (RAM) AND HL,
// which lands 4*0x2c past the base. The oracle push/pops its block-copy below the entry SP, so the diff
// excludes that dead scratch. Run: node --test games/invaders/idiomatic/test/equivalence-01f5.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_01f5 as oracleBody } from "../../translated/loc_01f5.js";
import { initPlayer2ShieldBuffers } from "../initPlayer2ShieldBuffers.js";
import { initShieldBuffers } from "../initShieldBuffers.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { entered, ramDiff } from "./_liveStack.js";
import { SHIELD_TEMPLATE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x01f5;
const BASE = 0x2242;
const BLOCK = 0x2c;
const endHl = (hl) => (hl + 4 * BLOCK) & 0xffff;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x01f5 dispatches -- initPlayer2ShieldBuffers == oracle in RAM (-stack) and HL", () => {
  for (const cap of CAPS) {
    // The oracle pushes DE + a return slot each pass, just below the ENTRY SP; exclude relative to it.
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && a >= sp - 0x10 && a < sp);
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); initPlayer2ShieldBuffers(c);
    assert.equal(capDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "HL live-out matches the oracle");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: four copies of the template from the player-2 base, HL past the fourth", () => {
  for (const hl of [0x0000, 0x2400, 0x1111]) { // incoming HL is ignored -- the base is seated internally
    const o = new Machine(ROM); o.regs.hl = hl; o.regs.sp = 0x2400;
    const c = new Machine(ROM); c.regs.hl = hl; c.regs.sp = 0x2400;
    oracle(o); initPlayer2ShieldBuffers(c);
    const tag = `HL_in=0x${hl.toString(16)}`;
    assert.equal(ramDiff(o, c), null, tag);
    assert.equal(c.regs.hl, endHl(BASE), `HL advanced 4*0x2c: ${tag}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL matches oracle: ${tag}`);
    for (let k = 0; k < 4; k++) {
      for (const j of [0, BLOCK - 1]) {
        assert.equal(c.mem.read8(BASE + k * BLOCK + j), c.mem.read8(SHIELD_TEMPLATE + j),
          `slot ${k} byte ${j}: ${tag}`);
      }
    }
  }
});

test("TEETH: a module seating the wrong base is caught by the RAM diff", () => {
  // Broken twin: the real delegation with the base seated one byte high -- the whole fill shifts by one.
  const broken = (m) => initShieldBuffers(m, (BASE + 1) & 0xffff); // BUG: off-by-one base
  const o = new Machine(ROM); o.regs.sp = 0x2400;
  const c = new Machine(ROM); c.regs.sp = 0x2400;
  oracle(o); broken(c);
  const d = ramDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch the shifted fill base -- it is worthless");
  assert.ok(d.addr >= BASE && d.addr < BASE + 4 * BLOCK + 1,
    `divergence at 0x${d.addr.toString(16)} not in the fill region`);
});
