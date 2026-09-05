// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_186c — memory-equivalent to the frozen oracle at ROM 0x186c.
 * Register live-in is A (the selected value). We craft an attract seed, push a return address for the
 * oracle's `ret`, poke A, and seed the two shadow cells (0x41c0/0x41c1) with sentinels. The routine
 * stores (A-1) mod 256 to 0x41c1 and 1 to 0x41c0; we sweep A over the ROM's documented values (0, 0x81)
 * plus the wrap edge (A=0 -> 0xff) and 0xff. LIVE-OUT is memory-only, so RAM is compared.
 * TEETH: a no-decrement twin (stores A) and a flag-cleared twin (0x41c0 <- 0) must both diverge.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_186c } from "../loc_186c.js";
import { loc_186c as oracle } from "../../translated/loc_186c.js";

const FLAG = 0x41c0; // raised to 1
const VALUE = 0x41c1; // A-1
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// broken twins (read A live — test code, not the idiomatic module).
function brokenNoDec(m) {
  m.mem8[VALUE] = m.regs.a; // stores A, not A-1
  m.mem8[FLAG] = 1;
}
function brokenFlagCleared(m) {
  m.mem8[VALUE] = (m.regs.a - 1) & 0xff;
  m.mem8[FLAG] = 0; // oracle raises it to 1
}

function seed(a) {
  return craft((mem8, m) => {
    m.push16(0x9999);
    m.regs.a = a;
    mem8[FLAG] = 0x55; // sentinels distinct from the routine's writes
    mem8[VALUE] = 0x66;
  });
}

test("loc_186c == oracle across A inputs", { skip }, () => {
  for (const a of [0x00, 0x01, 0x81, 0xff]) {
    assert.equal(ramDiff(oracle, loc_186c, seed(a)), null, `A=0x${a.toString(16)} diverged`);
  }
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, brokenNoDec, seed(0x81)) !== null, "the no-decrement twin escaped");
  assert.ok(ramDiff(oracle, brokenFlagCleared, seed(0x81)) !== null, "the flag-cleared twin escaped");
});
