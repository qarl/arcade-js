// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for saucerHandler (ROM 0x0682) -- the mystery-ship object handler, reached by the object-
// table walker's computed dispatch (which pushes the record pointer for the handler to pop and discard).
// It only runs in the saucer mode, else delegates to the plain step handler; it launches a saucer once
// enough aliens are gone, walks it across the row gated on the draw phase, and on a hit counts its
// explosion phases (hit sound, score award, tone silence) before clearing the strip and reloading the
// record template. The arms compare RAM (-stack).
//
// The attract boot dispatches it heavily but never past the saucer mode's first branch (loc_2083 is 0 in
// attract, so every dispatch delegates to the step handler); the CRAFTED cases drive the saucer body with
// a small, safely-placed sprite descriptor so the shared blit/score callees run identically on both sides.
//
// NOT seam-placeable, and deliberately UNWIRED -- same class as alienShotSlot2Handler/alienShotSlot3Handler: the walker leaves the
// record pointer on the stack, so a correct dispatch nets SP +4 with pc on the walker's continuation,
// outside `withOmittedRet`'s 0/+2 window. Dispatchable only once the walker (walkObjectTable) is idiomatic and
// calls it directly; the frozen walker serves it in-game meanwhile.
// Run: node --test games/invaders/idiomatic/test/equivalence-0682.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0682 as oracleBody } from "../../translated/loc_0682.js";
import { saucerHandler } from "../saucerHandler.js";
import { u8 } from "../../../../core/int.js";
import { objectMatchesDrawPhase } from "../objectMatchesDrawPhase.js";
import { drawSaucerSprite } from "../drawSaucerSprite.js";
import { alienShotSlot4Handler } from "../alienShotSlot4Handler.js";
import { clearSoundPort3Bit } from "../clearSoundPort3Bit.js";
import { playSaucerHitSoundAndDrawSprite } from "../playSaucerHitSoundAndDrawSprite.js";
import { awardSaucerScore } from "../awardSaucerScore.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { entered, entryFloor, ramDiff as liveRamDiff } from "./_liveStack.js";
import {
  STACK_SCRATCH, loc_2080, loc_2083, loc_2056, SAUCER_ACTIVE, ALIEN_COUNT, loc_208a, SAUCER_STEP_DX,
  SAUCER_HIT, loc_2086, loc_2087, DRAW_PHASE_FLAG, SAUCER_SCORE_KEY_PTR, SHIP_READY_FLAG, TASK_FLAGS,
} from "../names.js";

const oracle = entered(oracleBody);
// The entry `pop h` consumes the walker's record word at [SP]; the oracle's later pushes reuse that dead cell.
const POPPED_ARG = 2;
const ramDiff = (o, c) => liveRamDiff(o, c, entryFloor(o, c) + POPPED_ARG);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x0682;

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 2500) : [];

test("CAPTURE: real 0x0682 dispatches -- saucerHandler == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x0682 at least once");
  for (const cap of CAPS) {
    const sp = cap.regs.sp;
    const capDiff = (ma, mb) => firstStateDiff(ma.dumpState(), mb.dumpState(),
      (off) => ma.stateOffsetToAddr(off), (a) => a != null && ((a >= sp - 0x40 && a < sp + POPPED_ARG) || deadStackBelow(STACK_SCRATCH, sp + POPPED_ARG)(a)));
    const o = cap.clone(), c = cap.clone();
    o.io.setInte(false); c.io.setInte(false);
    oracle(o); saucerHandler(c);
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

// Leave the delegated step handler idle (its record strip source zero, launch gate zero) so a delegation
// case does bounded, blit-free work identical on both sides.
function stepIdle(m) {
  for (let a = 0x2055; a < 0x2060; a++) m.mem.write8(a, 0x00);
  m.mem.write8(SHIP_READY_FLAG, 0x00);
  m.mem.write8(TASK_FLAGS, 0x00);
}

// Seat a small saucer sprite descriptor whose coordinate folds to a safe high video-RAM address (far from
// the stack), with a 2-row blit and a ROM source -- so drawSaucerSprite / the score draw touch known video RAM.
function saucerDescriptor(m) {
  m.mem.write8(loc_2087 + 0, 0x00);     // descriptor E (source low)
  m.mem.write8(loc_2087 + 1, 0x1b);     // descriptor D (source high -> ROM)
  m.mem.write8(loc_2087 + 2, 0x00);     // descriptor A (coord low)
  m.mem.write8(loc_208a, 0x50);         // descriptor C == the saucer X cell (coord high) -> screen ~0x2a00
  m.mem.write8(loc_2087 + 4, 0x02);     // descriptor B (row count)
}

// The saucer body reached: saucer mode, present, no pending step, draw phase matches.
function saucerCommon(m) {
  m.mem.write8(loc_2080, 0x02);
  m.mem.write8(loc_2083, 0x01);
  m.mem.write8(loc_2056, 0x00);
  m.mem.write8(DRAW_PHASE_FLAG, 0x00); // matches loc_208a bit7 clear (0x50)
  saucerDescriptor(m);
  m.mem.write8(SAUCER_STEP_DX, 0x02);        // saucer step
}

test("CRAFTED: branches leave identical RAM (-stack)", () => {
  const cases = [
    { tag: "not saucer mode -> return", seed: (m) => { m.mem.write8(loc_2080, 0x00); } },
    { tag: "saucer absent (loc_2083==0) -> delegate to step handler", seed: (m) => { stepIdle(m); m.mem.write8(loc_2080, 0x02); m.mem.write8(loc_2083, 0x00); } },
    { tag: "pending step (loc_2056!=0) -> delegate", seed: (m) => { stepIdle(m); m.mem.write8(loc_2080, 0x02); m.mem.write8(loc_2083, 0x01); m.mem.write8(loc_2056, 0x01); } },
    { tag: "no saucer, too few aliens -> delegate", seed: (m) => { stepIdle(m); m.mem.write8(loc_2080, 0x02); m.mem.write8(loc_2083, 0x01); m.mem.write8(loc_2056, 0x00); m.mem.write8(SAUCER_ACTIVE, 0x00); m.mem.write8(ALIEN_COUNT, 0x04); } },
    {
      tag: "launch a saucer then walk it (draw phase matches, in bounds) -> return",
      seed: (m) => { saucerCommon(m); m.mem.write8(SAUCER_ACTIVE, 0x00); m.mem.write8(ALIEN_COUNT, 0x20); m.mem.write8(SAUCER_HIT, 0x00); },
    },
    {
      tag: "draw phase mismatch -> return",
      seed: (m) => { saucerCommon(m); m.mem.write8(SAUCER_ACTIVE, 0x01); m.mem.write8(loc_208a, 0xd0); m.mem.write8(DRAW_PHASE_FLAG, 0x00); },
    },
    {
      tag: "hit, explosion phase reaches the hit-sound frame",
      seed: (m) => { saucerCommon(m); m.mem.write8(SAUCER_ACTIVE, 0x01); m.mem.write8(SAUCER_HIT, 0x01); m.mem.write8(loc_2086, 0x20); },
    },
    {
      tag: "hit, explosion phase reaches the score-award frame",
      seed: (m) => { saucerCommon(m); m.mem.write8(SAUCER_ACTIVE, 0x01); m.mem.write8(SAUCER_HIT, 0x01); m.mem.write8(loc_2086, 0x19); m.mem.write16(SAUCER_SCORE_KEY_PTR, 0x2100); m.mem.write8(0x2100, 0x10); },
    },
    {
      tag: "hit, explosion phase reaches the silence frame -> tail template reload",
      seed: (m) => { saucerCommon(m); m.mem.write8(SAUCER_ACTIVE, 0x01); m.mem.write8(SAUCER_HIT, 0x01); m.mem.write8(loc_2086, 0x01); },
    },
    {
      tag: "hit, explosion phase between markers -> return",
      seed: (m) => { saucerCommon(m); m.mem.write8(SAUCER_ACTIVE, 0x01); m.mem.write8(SAUCER_HIT, 0x01); m.mem.write8(loc_2086, 0x06); },
    },
  ];
  for (const { tag, seed } of cases) {
    const o = craft(seed), c = craft(seed);
    oracle(o); saucerHandler(c);
    assert.equal(ramDiff(o, c), null, tag);
  }
});

// TEETH: a broken inline twin that reproduces the alive-walk path through the shared callees but DROPS the
// saucer-launch latch. Nothing on the walk path rewrites that cell, so the RAM diff must catch it.
function saucerHandler_droppedLaunch(m) {
  if (m.mem8[loc_2080] !== 2) return;
  if (m.mem8[loc_2083] === 0) return alienShotSlot4Handler(m);
  if (m.mem8[loc_2056] !== 0) return alienShotSlot4Handler(m);
  if (m.mem8[SAUCER_ACTIVE] === 0) {
    if (m.mem8[ALIEN_COUNT] < 8) return alienShotSlot4Handler(m);
    // BUG: dropped `m.mem8[SAUCER_ACTIVE] = 1;`
    drawSaucerSprite(m);
  }
  if (!objectMatchesDrawPhase(m, loc_208a)) return;
  if (m.mem8[SAUCER_HIT] === 0) {
    m.mem8[loc_208a] = u8(m.mem8[loc_208a] + m.mem8[SAUCER_STEP_DX]);
    drawSaucerSprite(m);
    const x = m.mem8[loc_208a];
    if (x >= 40 && x < 225) return;
  } else {
    clearSoundPort3Bit(m, 0xfe);
    m.mem8[loc_2086] = u8(m.mem8[loc_2086] - 1);
    const phase = m.mem8[loc_2086];
    if (phase === 31) return playSaucerHitSoundAndDrawSprite(m);
    if (phase === 24) return awardSaucerScore(m);
    if (phase !== 0) return;
  }
}

test("TEETH: a twin that drops the saucer-launch latch diverges in RAM", () => {
  const seed = (m) => { saucerCommon(m); m.mem.write8(SAUCER_ACTIVE, 0x00); m.mem.write8(ALIEN_COUNT, 0x20); m.mem.write8(SAUCER_HIT, 0x00); };
  const o = craft(seed), c = craft(seed);
  oracle(o); saucerHandler_droppedLaunch(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM-diff check FAILED to catch a dropped saucer-launch latch");
});
