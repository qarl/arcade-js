// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0983 — memory-equivalent to the frozen oracle at ROM 0x0983.
 * GATE: crafted-entry. The routine clears OBJ_SWEEP_DIRECTION (0x420d) to 0; we clone the attract
 * seed, poke that flag to 1 so the clear is observable, then assert both sides land 0. LIVE-OUT is
 * RAM only; the return-stack window is masked by ramDiff. Teeth: a no-op twin, a wrong-value twin,
 * and a wrong-cell twin must all diverge.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_0983 as cand } from "../loc_0983.js";
import { loc_0983 as oracle } from "../../translated/loc_0983.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const OBJ_SWEEP_DIRECTION = 0x420d;

// A fresh entry: SP has a ret sentinel and the direction flag is set to 1 so clearing it to 0 shows.
const entry = () => craft((mem, mm) => { mm.push16(0x9999); mem[OBJ_SWEEP_DIRECTION] = 0x01; });

const noOp = () => {};
const wrongValue = (m) => { m.mem8[OBJ_SWEEP_DIRECTION] = 1; };
const wrongCell = (m) => { m.mem8[OBJ_SWEEP_DIRECTION + 1] = 0; };

test("EQUAL (crafted): loc_0983 == oracle clears OBJ_SWEEP_DIRECTION", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "loc_0983 diverged from the oracle");
  const a = entry(); oracle(a);
  assert.equal(a.mem8[OBJ_SWEEP_DIRECTION], 0, "positive control: oracle really cleared the flag");
  console.log("  EQUAL: loc_0983 == oracle (RAM), OBJ_SWEEP_DIRECTION 1->0");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, entry()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongValue, entry()), "the wrong-value twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, entry()), "the wrong-cell twin escaped");
  console.log("  TEETH: no-op, wrong-value, wrong-cell all caught");
});
