// SPDX-License-Identifier: GPL-3.0-only
/**
 * equivalence-0fd4 — crafted-entry gate: renderFrogAnimArm0 vs the frozen oracle at ROM 0x0FD4. Arm 0
 * loads its row-advance / row-count / column-index from the lane block (0x8270..0x8272), stashes the
 * column stride at 0x81B1 and the tile source at 0x8001, then calls the shared render loop directly.
 * Both sides run the real render loop with the anim index parked at 0x0a so only this arm renders (its
 * tail advances to 0x0b and wraps, no re-cascade); the oracle reaches it with a Z80 call and the rewrite
 * with a direct call, so the only divergence is dead stack scratch below the entry SP, masked. Teeth: a
 * no-op and a twin that skips the 0x81B1 stash. Live-out memory-only.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft } from "./_frogHop.js";
import { STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { renderFrogAnimArm0 as cand } from "../renderFrogAnimArm0.js";
import { loc_0fd4 as oracle } from "../../translated/loc_0fd4.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const ANIM_INDEX = 0x8000;
const BLOCK = 0x8270, ROWADV = 0x81b1, SRC_PTR = 0x8001;

function diff(entry, candFn = cand) {
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const a = entry.clone(); oracle(a);
  const b = entry.clone(); candFn(b);
  const A = a.dumpState(), B = b.dumpState();
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (A[i] === B[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return `0x${addr.toString(16)}: ${A[i]} vs ${B[i]}`;
  }
  return null;
}

const seeded = () => craft((mem) => { mem[ANIM_INDEX] = 0x0a; mem[BLOCK] = 0x11; mem[BLOCK + 1] = 3; mem[BLOCK + 2] = 5; mem[ROWADV] = 0; mem[SRC_PTR] = 0; mem[SRC_PTR + 1] = 0; });

test("EQUAL (crafted): renderFrogAnimArm0 == oracle on the arm-0 render", { skip }, () => {
  assert.equal(diff(seeded()), null, "arm-0 render diverged");
  assert.ok(diff(seeded(), () => {}), "vacuous: oracle wrote nothing on the sample entry");
  console.log("  EQUAL: renderFrogAnimArm0 == oracle on the real render");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const skipRowAdv = (m) => { m.regs.a = m.mem8[BLOCK]; m.mem16[SRC_PTR] = 0x1403; }; // omits mem8[0x81b1]=A + the render
  assert.ok(diff(seeded(), noOp), "no-op twin escaped");
  assert.ok(diff(seeded(), skipRowAdv), "skip-rowadv twin escaped");
  console.log("  TEETH: no-op and skip-rowadv both caught");
});
