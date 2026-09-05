// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0837 — memory-equivalent to the frozen oracle at ROM 0x0837.
 * Object move dispatch. Its live-out is MEMORY ONLY: the position cell (0x4202) and the four
 * (value, code) pairs staged at 0x4054-0x405b. The caller issues it back-to-back with the next update
 * and never reads a register it leaves, so there is no register live-out to thread -- ramDiff suffices.
 * Paths exercised: active + AI (dec / inc / both / neither), active + input port 0, active + input
 * port 1, the two clamp boundaries, inactive-alt, and inactive-park. Teeth: mutant twins that mis-stage,
 * skip the clamp, move the wrong way, or stage the wrong code. The return-stack window is masked by ramDiff.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { loc_0837 as cand } from "../loc_0837.js";
import { loc_0837 as oracle } from "../../translated/loc_0837.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ACTIVE = 0x4200, ALT = 0x4201, POS = 0x4202;
const SRC_SEL = 0x4006, PORT_SEL = 0x4018, AI_CMD = 0x423f, IN0 = 0x4010, IN1 = 0x4011;
const STAGE = 0x4054;
const SENTINEL = 0x5a; // pre-poked across the staging block so the writer demonstrably overwrites it

// A crafted entry from a scenario; every unset cell defaults to 0.
function entry(s = {}) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    mem8[ACTIVE] = s.active ?? 0;
    mem8[ALT] = s.alt ?? 0;
    mem8[POS] = s.pos ?? 0;
    mem8[SRC_SEL] = s.srcSel ?? 0;
    mem8[PORT_SEL] = s.portSel ?? 0;
    mem8[AI_CMD] = s.ai ?? 0;
    mem8[IN0] = s.in0 ?? 0;
    mem8[IN1] = s.in1 ?? 0;
    for (let i = 0; i < 8; i++) mem8[STAGE + i] = SENTINEL;
  });
}

const scenarios = {
  "active AI dec":     { active: 1, srcSel: 0, ai: 0x08, pos: 0x50 },
  "active AI inc":     { active: 1, srcSel: 0, ai: 0x04, pos: 0x50 },
  "active AI both":    { active: 1, srcSel: 0, ai: 0x0c, pos: 0x50 }, // dec then re-read then inc -> net 0
  "active AI neither": { active: 1, srcSel: 0, ai: 0x00, pos: 0x50 },
  "active port0":      { active: 1, srcSel: 1, portSel: 0, in0: 0x08, pos: 0x40 },
  "active port1":      { active: 1, srcSel: 1, portSel: 1, in1: 0x04, pos: 0x40 },
  "clamp floor":       { active: 1, srcSel: 0, ai: 0x08, pos: 0x16 }, // below floor -> no dec
  "clamp ceiling":     { active: 1, srcSel: 0, ai: 0x04, pos: 0xe9 }, // at ceiling -> no inc
  "inactive alt":      { active: 0, alt: 1, pos: 0x30 },
  "inactive park":     { active: 0, alt: 0, pos: 0x30 },
};

test("EQUAL: loc_0837 == oracle across every dispatch path (RAM)", { skip }, () => {
  for (const [name, s] of Object.entries(scenarios)) {
    assert.equal(ramDiff(oracle, cand, entry(s)), null, `loc_0837 diverged: ${name}`);
  }
  // positive control: the oracle really moves the position and overwrites the staging block.
  const a = entry({ active: 1, srcSel: 0, ai: 0x08, pos: 0x50 }).clone();
  a.routines = STUBS; oracle(a);
  assert.equal(a.mem8[POS], 0x4f, "positive control: oracle decremented the position");
  assert.notEqual(a.mem8[STAGE], SENTINEL, "positive control: oracle overwrote the staging block");
  console.log("  EQUAL: loc_0837 == oracle across 10 dispatch paths (RAM)");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const decE = entry({ active: 1, srcSel: 0, ai: 0x08, pos: 0x50 });
  const altE = entry({ active: 0, alt: 1, pos: 0x30 });

  const noOp = () => {};
  const corruptStage = (m) => { cand(m); m.mem8[STAGE] ^= 1; };
  const corruptPos = (m) => { cand(m); m.mem8[POS] = (m.mem8[POS] + 1) & 0xff; };
  // Moves the position the wrong way (increments where a decrement is due) but stages consistently.
  const wrongDir = (m) => {
    m.mem8[POS] = (m.mem8[POS] + 1) & 0xff;
    const v = (~m.mem8[POS] + 128) & 0xff;
    for (let i = 0; i < 4; i++) { m.mem8[STAGE + 2 * i] = v; m.mem8[STAGE + 2 * i + 1] = 6; }
  };
  // Correct value/position on the alt path but the wrong pair-code (6 instead of 7).
  const wrongCode = (m) => {
    const v = (~m.mem8[POS] + 128) & 0xff;
    for (let i = 0; i < 4; i++) { m.mem8[STAGE + 2 * i] = v; m.mem8[STAGE + 2 * i + 1] = 6; }
  };

  assert.ok(ramDiff(oracle, noOp, decE), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, corruptStage, decE), "the corrupt-stage twin escaped");
  assert.ok(ramDiff(oracle, corruptPos, decE), "the corrupt-position twin escaped");
  assert.ok(ramDiff(oracle, wrongDir, decE), "the wrong-direction twin escaped");
  assert.ok(ramDiff(oracle, wrongCode, altE), "the wrong-alt-code twin escaped");
  console.log("  TEETH: no-op, corrupt-stage, corrupt-position, wrong-direction, wrong-alt-code all caught");
});
