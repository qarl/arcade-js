// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for readActivePlayerInput (ROM 0x17c0-0x17cc) -- "flag ACTIVE_PLAYER_PAGE bit0 (via rrc->carry) selects
// the input port: set -> IN 1, clear -> IN 2; returns A". Input is the flag cell; live-out is register A
// (the port read value); no RAM write. Contract: RAM (minus stack scratch below the entry SP) PLUS the returned A.
// Run: node --test games/invaders/idiomatic/test/equivalence-17c0.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_17c0 as oracleBody } from "../../translated/loc_17c0.js";
import { readActivePlayerInput } from "../readActivePlayerInput.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x17c0;

// Distinct sentinels on the two read ports so the returned-A assertion has teeth (IN1 != IN2).
const IN1 = 0x5a, IN2 = 0xa5;
function seed(m, flag) {
  m.io.in1 = IN1; m.io.in2 = IN2;
  m.mem.write8(ACTIVE_PLAYER_PAGE, flag);
  return m;
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x17c0 dispatches -- readActivePlayerInput == oracle (RAM -stack + returned A)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); readActivePlayerInput(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: flag bit0 selects the port; A is the read value", () => {
  for (const flag of [0x00, 0x01, 0x02, 0x03, 0x80, 0xfe, 0xff]) {
    const o = seed(new Machine(ROM), flag);
    const c = seed(new Machine(ROM), flag);
    oracle(o); readActivePlayerInput(c);
    assert.equal(ramDiff(o, c), null, `flag=0x${flag.toString(16)}`);
    assert.equal(c.regs.a, o.regs.a, `returned A flag=0x${flag.toString(16)}`);
    const expected = (flag & 0x01) ? IN1 : IN2;
    assert.equal(c.regs.a, expected, `port select flag=0x${flag.toString(16)}`);
  }
});

test("TEETH: reading the wrong port (a wrong returned A) is caught", () => {
  const o = seed(new Machine(ROM), 0x01); // bit0 set -> IN 1 -> 0x5a
  const c = seed(new Machine(ROM), 0x01);
  oracle(o);
  readActivePlayerInput(c); c.regs.a = IN2; // BUG: returned the other port's value
  assert.notEqual(c.regs.a, o.regs.a, "the check FAILED to catch a wrong returned value");
});
