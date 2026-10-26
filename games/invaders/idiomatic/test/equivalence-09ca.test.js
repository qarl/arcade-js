// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for currentPlayerRecordPtr -- pick the active player's data pointer from bit0 of the flag cell:
// HL = (mem[ACTIVE_PLAYER_PAGE] & 1) ? PLAYER1_OBJ_DESC : PLAYER2_OBJ_DESC. Input is memory, live-out register HL (callers read
// mem[HL]); no memory is written, so RAM must stay identical (dumpState, minus stack scratch below the entry SP) AND the
// returned HL must match.
// Run: node --test games/invaders/idiomatic/test/equivalence-09ca.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09ca as oracleBody } from "../../translated/loc_09ca.js";
import { currentPlayerRecordPtr } from "../currentPlayerRecordPtr.js";
import { Machine } from "../../machine.js";
import { entered, ramDiff } from "./_liveStack.js";
import { ACTIVE_PLAYER_PAGE, PLAYER1_OBJ_DESC, PLAYER2_OBJ_DESC } from "../names.js";

const oracle = entered(oracleBody);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x09ca;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 1500) : [];

test("CAPTURE: real 0x09ca dispatches -- currentPlayerRecordPtr == oracle in RAM and HL", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); currentPlayerRecordPtr(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.hl, o.regs.hl, "returned HL");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: bit0 of ACTIVE_PLAYER_PAGE selects the pointer, for several flag values", () => {
  for (const flag of [0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]) {
    const o = new Machine(ROM); o.mem.write8(ACTIVE_PLAYER_PAGE, flag);
    const c = new Machine(ROM); c.mem.write8(ACTIVE_PLAYER_PAGE, flag);
    oracle(o); currentPlayerRecordPtr(c);
    assert.equal(ramDiff(o, c), null, `flag=0x${flag.toString(16)}`);
    assert.equal(c.regs.hl, o.regs.hl, `HL vs oracle flag=0x${flag.toString(16)}`);
    assert.equal(c.regs.hl, (flag & 1) ? PLAYER1_OBJ_DESC : PLAYER2_OBJ_DESC, `HL value flag=0x${flag.toString(16)}`);
  }
});

test("TEETH: a broken twin (swapped pointers) returns a wrong HL that is caught", () => {
  const broken = (m) => (m.regs.hl = (m.mem8[ACTIVE_PLAYER_PAGE] & 1) ? PLAYER2_OBJ_DESC : PLAYER1_OBJ_DESC); // BUG: pointers swapped
  const o = new Machine(ROM); o.mem.write8(ACTIVE_PLAYER_PAGE, 0x01);
  const c = new Machine(ROM); c.mem.write8(ACTIVE_PLAYER_PAGE, 0x01);
  oracle(o); broken(c);
  assert.notEqual(c.regs.hl, o.regs.hl, "the HL check FAILED to catch a swapped pointer");
});
