// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1815 — memory-equivalent to the frozen oracle at ROM 0x1815.
 * GATE: crafted-entry. The routine stages A into SOUND_PITCH (0x41c1); we clone the attract seed,
 * poke A to a known pitch and the target cell to a DIFFERENT value so the store is observable, then
 * assert both sides land the same byte. LIVE-OUT is RAM only; the return-stack window is masked by
 * ramDiff. Teeth: a no-op twin, a wrong-value twin, and a wrong-cell twin must all diverge.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_1815 as cand } from "../loc_1815.js";
import { loc_1815 as oracle } from "../../translated/loc_1815.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const SOUND_PITCH = 0x41c1;
const PITCH = 0x5a;

// A fresh entry: SP has a ret sentinel, A holds the pitch, and SOUND_PITCH holds a different byte so
// writing PITCH is a visible change.
const entry = () => craft((mem, mm) => { mm.push16(0x9999); mm.regs.a = PITCH; mem[SOUND_PITCH] = 0x00; });

const noOp = () => {};
const wrongValue = (m) => { m.mem8[SOUND_PITCH] = (m.regs.a ^ 0xff) & 0xff; };
const wrongCell = (m) => { m.mem8[SOUND_PITCH + 1] = m.regs.a; };

test("EQUAL (crafted): loc_1815 == oracle stages A into SOUND_PITCH", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_1815 diverged from the oracle");
  const a = entry(); oracle(a);
  assert.equal(a.mem8[SOUND_PITCH], PITCH, "positive control: oracle really wrote the pitch value");
  console.log(`  EQUAL: loc_1815 == oracle (RAM), SOUND_PITCH 0x00->0x${PITCH.toString(16)}`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongValue, entry()), "the wrong-value twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, entry()), "the wrong-cell twin escaped");
  console.log("  TEETH: no-op, wrong-value, wrong-cell all caught");
});
