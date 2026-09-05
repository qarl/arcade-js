// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1886 — memory-equivalent to the frozen oracle at ROM 0x1886 (per-tick sound-pitch ramp).
 * GATE: crafted-entry. Register live-in is HL (the {countdown, pitch} pair pointer); the memory effects
 * are, on an active tick, the decremented countdown (HL+1), the advanced pitch (HL+2), the mirrored
 * SOUND_PITCH (0x41c1), and the cleared composite shadow (0x41c0). We clone a post-attract seed, set HL
 * to the real caller pointer (0x41c9), push a return address for the oracle's `ret`, and seed the pair
 * plus the two shadow cells, driving both the active path (countdown>0) and the idle path (countdown==0,
 * where nothing is written). Live-out is memory only; RAM is compared.
 * TEETH: a no-decrement twin, a wrong-step twin (+5), and a flag-not-cleared twin must all diverge.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { advanceSoundPitchRamp as cand } from "../advanceSoundPitchRamp.js";
import { loc_1886 as oracle } from "../../translated/loc_1886.js";

const PTR = 0x41c9;        // the pointer loc_1876 hands in (HL)
const COUNTDOWN = PTR + 1; // 0x41ca
const PITCHCELL = PTR + 2; // 0x41cb
const SOUND_PITCH = 0x41c1;
const COMPOSITE = 0x41c0;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

function seed(countdown, pitch) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.hl = PTR;
    mem8[COUNTDOWN] = countdown;
    mem8[PITCHCELL] = pitch;
    mem8[SOUND_PITCH] = 0x55; // sentinels distinct from the routine's writes
    mem8[COMPOSITE] = 0x66;
  });
}

// [countdown, pitch]: active ticks (countdown>0) plus the +4 wrap, and one idle tick (countdown==0).
const CASES = [
  [5, 0x10],  // active: countdown 5->4, pitch 0x10->0x14
  [1, 0xfc],  // active: countdown 1->0, pitch 0xfc->0x00 (wrap)
  [0, 0x10],  // idle: nothing written
];

test("EQUAL (crafted): loc_1886 == oracle on active and idle ticks", { skip }, () => {
  for (const [cd, p] of CASES) {
    assert.equal(ramDiff(oracle, cand, seed(cd, p)), null, `countdown=${cd} pitch=0x${p.toString(16)} diverged`);
  }
  // Positive control: active advances everything; idle leaves the shadows untouched.
  const act = seed(5, 0x10); oracle(act);
  assert.equal(act.mem8[COUNTDOWN], 4, "control: countdown 5 -> 4");
  assert.equal(act.mem8[PITCHCELL], 0x14, "control: pitch 0x10 -> 0x14");
  assert.equal(act.mem8[SOUND_PITCH], 0x14, "control: SOUND_PITCH mirrors 0x14");
  assert.equal(act.mem8[COMPOSITE], 0x00, "control: composite shadow cleared");
  const idle = seed(0, 0x10); oracle(idle);
  assert.equal(idle.mem8[SOUND_PITCH], 0x55, "control: idle leaves SOUND_PITCH sentinel");
  assert.equal(idle.mem8[COMPOSITE], 0x66, "control: idle leaves composite sentinel");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noDec = (m) => { // skips the countdown decrement
    const { mem8 } = m; const cd = PTR + 1;
    if (mem8[cd] === 0) return;
    const pc = cd + 1; const v = (mem8[pc] + 4) & 0xff;
    mem8[pc] = v; mem8[SOUND_PITCH] = v; mem8[COMPOSITE] = 0;
  };
  const wrongStep = (m) => { // +5 instead of +4
    const { mem8 } = m; const cd = PTR + 1;
    if (mem8[cd] === 0) return;
    mem8[cd] = (mem8[cd] - 1) & 0xff;
    const pc = cd + 1; const v = (mem8[pc] + 5) & 0xff;
    mem8[pc] = v; mem8[SOUND_PITCH] = v; mem8[COMPOSITE] = 0;
  };
  const noFlagClear = (m) => { // never clears the composite shadow
    const { mem8 } = m; const cd = PTR + 1;
    if (mem8[cd] === 0) return;
    mem8[cd] = (mem8[cd] - 1) & 0xff;
    const pc = cd + 1; const v = (mem8[pc] + 4) & 0xff;
    mem8[pc] = v; mem8[SOUND_PITCH] = v;
  };
  assert.ok(CASES.some(([cd, p]) => ramDiff(oracle, noDec, seed(cd, p))), "no-decrement twin escaped");
  assert.ok(CASES.some(([cd, p]) => ramDiff(oracle, wrongStep, seed(cd, p))), "wrong-step twin escaped");
  assert.ok(CASES.some(([cd, p]) => ramDiff(oracle, noFlagClear, seed(cd, p))), "flag-not-cleared twin escaped");
});
