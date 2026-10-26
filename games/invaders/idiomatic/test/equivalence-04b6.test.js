// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for alienShotSlot3Handler (ROM 0x04b6) -- an object handler reached by the object-table walker's
// computed dispatch (which pushes the record pointer for the handler to pop and discard). It runs only
// while a gate cell is clear and a mode cell is one, then primes the record strip, steps the alien shot,
// clamps its column, restores the strip mid-blowup or blits the template band, latches the gate on the
// last surviving alien, and publishes the column word. The arms compare RAM (-stack).
//
// NOT seam-placeable, and deliberately UNWIRED -- same class as alienShotSlot2Handler: the walker leaves the record
// pointer on the stack, so a correct dispatch nets SP +4 with pc on the walker's continuation, outside
// `withOmittedRet`'s 0/+2 window (the seam accepts moved 0 and misplaces it). Dispatchable only once the
// walker (walkObjectTable) is idiomatic and calls it directly; the frozen walker serves it in-game meanwhile.
// Run: node --test games/invaders/idiomatic/test/equivalence-04b6.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_04b6 as oracleBody } from "../../translated/loc_04b6.js";
import { alienShotSlot3Handler } from "../alienShotSlot3Handler.js";
import { copyRecordToWorkBuffer } from "../copyRecordToWorkBuffer.js";
import { stepAlienShot } from "../stepAlienShot.js";
import { copyWorkBufferToRecord } from "../copyWorkBufferToRecord.js";
import { blockCopy } from "../blockCopy.js";
import { loc_067e } from "../loc_067e.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, entryFloor, ramDiff as liveRamDiff } from "./_liveStack.js";
import {
  STACK_SCRATCH, ALIEN_SHOT_SLOT3_DISABLE_FLAG, loc_2080, ALIEN_SHOT_SLOT3_DESC, loc_2036, ALIEN_SHOT_RATE_GATE0, loc_2056, ALIEN_SHOT_RATE_GATE_1, ALIEN_SHOT_COLUMN_CURSOR,
  ALIEN_SHOT_COLUMN_CURSOR_RESET, ALIEN_SHOT_BLOWUP_TIMER, ALIEN_SHOT_SLOT3_RECORD, ALIEN_SHOT_SLOT3_TEMPLATE, ALIEN_COUNT, SHIP_READY_FLAG, TASK_FLAGS,
} from "../names.js";

const oracle = entered(oracleBody);
// The entry `pop h` consumes the walker's record word at [SP]; the oracle's later pushes reuse that dead cell.
const POPPED_ARG = 2;
const ramDiff = (o, c) => liveRamDiff(o, c, entryFloor(o, c) + POPPED_ARG);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x04b6;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2500) : [];

test("CAPTURE: real 0x04b6 dispatches -- alienShotSlot3Handler == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x04b6 at least once");
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && ((a >= sp - 0x40 && a < sp + POPPED_ARG) || deadStackBelow(STACK_SCRATCH, sp + POPPED_ARG)(a)));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); alienShotSlot3Handler(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function craft(seed) {
  const m = new Machine(ROM);
  m.regs.sp = 0x23fe;
  m.mem.write16(0x23fe, 0x0000); // record pointer popped + discarded by the oracle
  m.mem.write16(0x2400, 0xabcd); // caller-return word
  m.io.setInte(false);
  seed(m);
  return m;
}

// Pass the two entry guards, leave the shot stepper idle with its blowup byte clear, so the handler runs
// the template-blit band + column publish.
function bodyIdle(m) {
  m.mem.write8(ALIEN_SHOT_SLOT3_DISABLE_FLAG, 0x00);
  m.mem.write8(loc_2080, 0x01);
  for (let a = ALIEN_SHOT_SLOT3_DESC; a < ALIEN_SHOT_SLOT3_DESC + 0x0b; a++) m.mem.write8(a, 0x00);
  m.mem.write8(SHIP_READY_FLAG, 0x00);
  m.mem.write8(TASK_FLAGS, 0x00);
}

test("CRAFTED: branches leave identical RAM (-stack)", () => {
  const cases = [
    { tag: "gate cell set -> immediate return", seed: (m) => { m.mem.write8(ALIEN_SHOT_SLOT3_DISABLE_FLAG, 0x01); } },
    { tag: "mode cell not one -> return", seed: (m) => { m.mem.write8(ALIEN_SHOT_SLOT3_DISABLE_FLAG, 0x00); m.mem.write8(loc_2080, 0x00); } },
    { tag: "body idle, blowup clear -> template-blit band + column publish", seed: bodyIdle },
    { tag: "body idle, last alien -> latch the gate", seed: (m) => { bodyIdle(m); m.mem.write8(ALIEN_COUNT, 0x01); } },
    {
      tag: "body idle, blowup set -> restore strip",
      seed: (m) => { bodyIdle(m); m.mem.write8(ALIEN_SHOT_SLOT3_DESC + 5, 0x03); },
    },
  ];
  for (const { tag, seed } of cases) {
    const o = craft(seed), c = craft(seed);
    oracle(o); alienShotSlot3Handler(c);
    assert.equal(ramDiff(o, c), null, tag);
  }
});

// TEETH: a broken inline twin that DROPS the last-alien gate latch. Nothing else writes that cell, so the
// RAM diff must catch it.
function alienShotSlot3Handler_droppedLatch(m) {
  if (m.mem8[ALIEN_SHOT_SLOT3_DISABLE_FLAG] !== 0) return;
  if (m.mem8[loc_2080] !== 1) return;
  copyRecordToWorkBuffer(m, 0xed, ALIEN_SHOT_SLOT3_DESC);
  m.mem8[ALIEN_SHOT_RATE_GATE0] = m.mem8[loc_2036];
  m.mem8[ALIEN_SHOT_RATE_GATE_1] = m.mem8[loc_2056];
  stepAlienShot(m);
  if (m.mem8[ALIEN_SHOT_COLUMN_CURSOR] >= 16) m.mem8[ALIEN_SHOT_COLUMN_CURSOR] = m.mem8[ALIEN_SHOT_COLUMN_CURSOR_RESET];
  if (m.mem8[ALIEN_SHOT_BLOWUP_TIMER] !== 0) return copyWorkBufferToRecord(m, ALIEN_SHOT_SLOT3_DESC);
  blockCopy(m, ALIEN_SHOT_SLOT3_TEMPLATE, ALIEN_SHOT_SLOT3_RECORD, 16);
  // BUG: dropped `if (m.mem8[ALIEN_COUNT] === 1) m.mem8[ALIEN_SHOT_SLOT3_DISABLE_FLAG] = 1;`
  return loc_067e(m, m.mem16[ALIEN_SHOT_COLUMN_CURSOR]);
}

test("TEETH: a twin that drops the last-alien gate latch diverges in RAM", () => {
  const seed = (m) => { bodyIdle(m); m.mem.write8(ALIEN_COUNT, 0x01); };
  const o = craft(seed), c = craft(seed);
  oracle(o); alienShotSlot3Handler_droppedLatch(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a dropped last-alien gate latch");
});
