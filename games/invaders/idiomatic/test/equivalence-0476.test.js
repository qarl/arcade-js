// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for alienShotSlot2Handler (ROM 0x0476) -- an object handler reached by the object-table walker's
// computed dispatch, which PUSHES the record pointer for the handler to pop. alienShotSlot2Handler discards that
// pointer, so its idiomatic form takes no parameter and models no stack: it mirrors a control byte, gates
// on a 16-bit countdown (resetting it while it reads zero), then primes the record strip, steps the alien
// shot, and either restores the strip mid-blowup or blits the template band. The arms compare RAM (-stack).
//
// NOT seam-placeable, and deliberately UNWIRED: the walker leaves the record pointer on the stack for the
// handler to consume, so a correct dispatch nets SP +4 (pop the pointer, then ret through the tail) with pc
// on the walker's continuation -- outside `withOmittedRet`'s 0/+2 window. The seam would SILENTLY misplace
// it (it accepts moved 0 and supplies one ret, popping the wrong slot). It becomes dispatchable only once
// the walker (walkObjectTable) is itself idiomatic and calls it directly with the record pointer. So there is no
// SP-TOOTH here; the frozen walker serves it in-game meanwhile.
// Run: node --test games/invaders/idiomatic/test/equivalence-0476.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0476 as oracleBody } from "../../translated/loc_0476.js";
import { alienShotSlot2Handler } from "../alienShotSlot2Handler.js";
import { u16 } from "../../../../core/int.js";
import { copyRecordToWorkBuffer } from "../copyRecordToWorkBuffer.js";
import { stepAlienShot } from "../stepAlienShot.js";
import { copyWorkBufferToRecord } from "../copyWorkBufferToRecord.js";
import { blockCopy } from "../blockCopy.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, entryFloor, ramDiff as liveRamDiff } from "./_liveStack.js";
import {
  STACK_SCRATCH, loc_1b32, loc_2032, ALIEN_SHOT2_STEP_GATE, loc_2035, loc_2046, ALIEN_SHOT_RATE_GATE0, loc_2056, ALIEN_SHOT_RATE_GATE_1,
  SHIP_READY_FLAG, TASK_FLAGS, ALIEN_SHOT_BLOWUP_TIMER, ALIEN_SHOT_SLOT2_RECORD, ALIEN_SHOT_SLOT2_TEMPLATE,
} from "../names.js";

const oracle = entered(oracleBody);
// The entry `pop h` consumes the walker's record word at [SP]; the oracle's later pushes reuse that dead cell.
const POPPED_ARG = 2;
const ramDiff = (o, c) => liveRamDiff(o, c, entryFloor(o, c) + POPPED_ARG);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0476;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2500) : [];

test("CAPTURE: real 0x0476 dispatches -- alienShotSlot2Handler == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x0476 at least once");
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    // The walker pushes the record pointer at [sp, sp+1]; the oracle pops it (and repushes return-address
    // scratch there), the idiom leaves it -- dead either way, so the mask spans past sp. SP runs high (into
    // video RAM) during these object-walk dispatches.
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && ((a >= sp - 0x40 && a < sp + POPPED_ARG) || deadStackBelow(STACK_SCRATCH, sp + POPPED_ARG)(a)));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); alienShotSlot2Handler(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A pristine crafted machine. The oracle pops the walker's record pointer first, so SP is seated one slot
// below a real caller-return word; both dead slots sit in the excluded scratch.
function craft(seed) {
  const m = new Machine(ROM);
  m.regs.sp = 0x23fe;
  m.mem.write16(0x23fe, 0x0000); // the record pointer the oracle pops + discards
  m.mem.write16(0x2400, 0xabcd); // the caller-return word its tail ret consumes
  m.io.setInte(false);
  seed(m);
  return m;
}

// Seed the record strip source all-zero so the copied buffer leaves the shot stepper idle and its blowup
// byte clear, and hold the 16-bit countdown nonzero so the handler runs its body to the template-blit branch.
function blockCopyBranch(m) {
  for (let a = loc_2035; a < loc_2035 + 0x0b; a++) m.mem.write8(a, 0x00);
  m.mem.write8(SHIP_READY_FLAG, 0x00);
  m.mem.write8(TASK_FLAGS, 0x00);
  m.mem.write16(ALIEN_SHOT2_STEP_GATE, 0x0001);
}

test("CRAFTED: branches leave identical RAM (-stack)", () => {
  const cases = [
    { tag: "countdown reads zero -> reset to wrap value + return", seed: (m) => { m.mem.write16(ALIEN_SHOT2_STEP_GATE, 0x0000); } },
    { tag: "countdown nonzero, blowup clear -> template-blit band", seed: blockCopyBranch },
    {
      tag: "countdown nonzero, blowup set -> restore strip",
      seed: (m) => {
        for (let a = loc_2035; a < loc_2035 + 0x0b; a++) m.mem.write8(a, 0x00);
        m.mem.write8(SHIP_READY_FLAG, 0x00); m.mem.write8(TASK_FLAGS, 0x00);
        m.mem.write16(ALIEN_SHOT2_STEP_GATE, 0x0001);
        m.mem.write8(loc_2035 + 5, 0x03); // -> ALIEN_SHOT_BLOWUP_TIMER nonzero after the strip copy
      },
    },
  ];
  for (const { tag, seed } of cases) {
    const o = craft(seed), c = craft(seed);
    oracle(o); alienShotSlot2Handler(c);
    assert.equal(ramDiff(o, c), null, tag);
  }
});

// TEETH: a broken inline twin that reproduces the routine through the shared callees but DROPS the second
// rate-cell staging write (ALIEN_SHOT_RATE_GATE_1). Nothing downstream rewrites that cell on this branch, so the RAM diff
// must catch the missing write.
function alienShotSlot2Handler_droppedStaging(m) {
  m.mem8[loc_2032] = m.mem8[loc_1b32];
  const countdown = m.mem16[ALIEN_SHOT2_STEP_GATE];
  if (countdown === 0) { m.mem16[ALIEN_SHOT2_STEP_GATE] = u16(countdown - 1); return; }
  copyRecordToWorkBuffer(m, 0xf9, loc_2035);
  m.mem8[ALIEN_SHOT_RATE_GATE0] = m.mem8[loc_2046];
  // BUG: dropped `m.mem8[ALIEN_SHOT_RATE_GATE_1] = m.mem8[loc_2056];`
  stepAlienShot(m);
  if (m.mem8[ALIEN_SHOT_BLOWUP_TIMER] !== 0) return copyWorkBufferToRecord(m, loc_2035);
  blockCopy(m, ALIEN_SHOT_SLOT2_TEMPLATE, ALIEN_SHOT_SLOT2_RECORD, 16);
}

test("TEETH: a twin that drops a rate-cell staging write diverges in RAM", () => {
  const seed = (m) => { blockCopyBranch(m); m.mem.write8(loc_2056, 0x55); m.mem.write8(ALIEN_SHOT_RATE_GATE_1, 0x00); };
  const o = craft(seed), c = craft(seed);
  oracle(o); alienShotSlot2Handler_droppedStaging(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a dropped rate-cell staging write");
});
