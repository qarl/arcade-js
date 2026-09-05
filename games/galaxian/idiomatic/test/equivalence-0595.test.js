// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0595 — crafted-entry equivalence vs the frozen translated oracle at ROM 0x0595. This routine sets
 * the copy source and falls into the strided-copy helper; the idiomatic form DISSOLVES that into a direct
 * call of the idiomatic helper with the source passed explicitly. Live-out is memory only (32 bytes into
 * the odd cells 0x4021..0x405f), so ramDiff covers it (stack window masked). Teeth: a no-op, a wrong-source
 * twin (a different ROM window, guarded non-vacuous), and a stride-1 twin (clobbers the even cells).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { loc_0595 as cand } from "../loc_0595.js";
import { loc_0595 as oracle } from "../../translated/loc_0595.js";
import { seedObjectRamShadowField as loc_0598 } from "../seedObjectRamShadowField.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const SRC = 0x1d71; // the ROM source window loc_0595 selects
const WRONG_SRC = 0x1d51; // a clearly different ROM window for the wrong-source twin
const DEST = 0x4021; // strided destination base (odd cells 0x4021, 0x4023 … 0x405f)
const SENTINEL = 0xee;

// Sentinel the whole 0x4020..0x405f window so any missed/extra/wrong write shows; push a ret for the oracle.
const entry = () => craft((mem, m) => {
  for (let a = 0x4020; a <= 0x405f; a++) mem[a] = SENTINEL;
  m.push16(0x9999);
});

test("EQUAL (crafted): loc_0595 == oracle seeds the strided table from the fixed source", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, entry()), null, "the strided seed diverged");

  // Positive control: odd cells take the source bytes in order; the even cell between stays untouched.
  const a = entry(); oracle(a);
  assert.equal(a.mem8[DEST], a.mem8[SRC], "control: entry 0 copied to the base");
  assert.equal(a.mem8[DEST + 62], a.mem8[SRC + 31], "control: entry 31 copied to the top");
  assert.equal(a.mem8[DEST + 1], SENTINEL, "control: the even cell between stays untouched");
  console.log("  EQUAL: 32 bytes seeded into odd cells 0x4021..0x405f");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const noOp = () => {};
  const wrongSrc = (m) => loc_0598(m, WRONG_SRC);
  const stride1 = (m) => { const { mem8 } = m; for (let i = 0; i < 32; i++) mem8[DEST + i] = mem8[SRC + i]; };

  // Guard: the wrong-source twin is only a tooth if the two ROM windows actually differ.
  const probe = entry();
  const differs = Array.from({ length: 32 }, (_, i) => i)
    .some((i) => probe.mem8[SRC + i] !== probe.mem8[WRONG_SRC + i]);
  assert.ok(differs, "precondition: the two source windows must differ");

  assert.ok(ramDiff(oracle, noOp, entry()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongSrc, entry()), "wrong-source twin escaped");
  assert.ok(ramDiff(oracle, stride1, entry()), "stride-1 twin escaped");
  console.log("  TEETH: no-op, wrong-source, stride-1 all caught");
});
