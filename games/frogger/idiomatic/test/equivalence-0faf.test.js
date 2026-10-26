// SPDX-License-Identifier: GPL-3.0-only
/**
 * equivalence-0faf — crafted-entry gate: dispatchFrogAnimationArm vs the frozen oracle at ROM 0x0FAF.
 * The dispatcher reads the anim index (0x8000), follows the ROM pointer table, and calls the matching
 * arm; each arm now calls the shared render loop directly. Parked at index 10 so the dispatcher selects
 * arm 10, renders it (bounded triple), and its render tail advances past the wrap without re-cascading.
 * Both sides run the real render loop; the oracle reaches it with a Z80 call and the rewrite with a
 * direct call, so the only divergence is dead stack scratch below the entry SP, masked. Per-arm dispatch is
 * covered by the individual arm equivalence gates. Teeth: a no-op and a wrong-arm twin. Live-out memory-only.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft } from "./_frogHop.js";
import { STACK_SCRATCH } from "./_harness.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { dispatchFrogAnimationArm as cand } from "../dispatchFrogAnimationArm.js";
import { renderFrogAnimArm9 } from "../renderFrogAnimArm9.js";
import { loc_0faf as oracle } from "../../translated/loc_0faf.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const ANIM_INDEX = 0x8000, ARM10_STRIDE = 0x81b1;
const ARM10_BLOCK = 0x828e, ARM9_BLOCK = 0x828b;

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

// Index parked at 10 -> the dispatcher selects arm 10; its render tail advances to 0x0b and wraps, so no
// re-cascade. Bounded triples for arms 9 and 10 keep both the real dispatch and the wrong-arm twin in VRAM.
const seeded = () => craft((mem) => {
  mem[ANIM_INDEX] = 0x0a;
  mem[ARM10_BLOCK] = 0x11; mem[ARM10_BLOCK + 1] = 3; mem[ARM10_BLOCK + 2] = 5;
  mem[ARM9_BLOCK] = 0x11; mem[ARM9_BLOCK + 1] = 3; mem[ARM9_BLOCK + 2] = 5;
});

test("EQUAL (crafted): dispatchFrogAnimationArm == oracle dispatching arm 10", { skip }, () => {
  assert.equal(diff(seeded()), null, "arm-10 dispatch diverged");
  const a = seeded(); const before = a.mem8[ARM10_STRIDE]; oracle(a);
  assert.equal(a.mem8[ARM10_STRIDE], 0x11, "vacuous: arm 10 never stamped its column stride");
  console.log(`  EQUAL: dispatch arm 10; stride ${before}->${a.mem8[ARM10_STRIDE]}`);
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongArm = (m) => renderFrogAnimArm9(m); // dispatcher wrongly runs arm 9 instead of arm 10
  assert.ok(diff(seeded(), noOp), "no-op twin escaped");
  assert.ok(diff(seeded(), wrongArm), "wrong-arm twin escaped");
  console.log("  TEETH: no-op and wrong-arm both caught");
});
