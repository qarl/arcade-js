// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1989 — equivalent to the frozen oracle at ROM 0x1989.
 * GATE: crafted-entry + latch observation. The routine clears the coin-lockout latch (0x6002 ->
 * io.setCoinLock(0)). That write hits a board device latch, NOT work/video/OBJ RAM, so it never
 * appears in the state dump — ramDiff is blind to it. So EQUAL is asserted on the observable io.coinLock
 * (seeded to 1, both sides must leave it 0), and ramDiff==null is asserted separately to prove the
 * routine writes no RAM the oracle does not. LIVE-OUT: the coin-lockout latch only (A=0 is dead).
 * Teeth: no-op and wrong-value on the latch, plus a RAM-scribble twin proving ramDiff still has teeth.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent, STUBS } from "./_bootSetup.js";
import { clearCoinLockout as cand } from "../clearCoinLockout.js";
import { loc_1989 as oracle } from "../../translated/loc_1989.js";

const COIN_LOCKOUT = 0x6002;
const SCRATCH_RAM = 0x4100; // a plain work-RAM cell for the ramDiff-teeth twin
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// A fresh attract seed with the coin-lockout latch armed (1) so clearing to 0 is observable + ret target.
const seeded = () => craft((mem8, m) => { mem8[COIN_LOCKOUT] = 1; m.push16(0x9999); });

// The real live-out is the board latch, which is not in dumpState; read it off the io device directly.
function coinLockAfter(fn, entry) {
  const m = entry.clone(); m.routines = STUBS; fn(m); return m.mem.io.coinLock;
}

const brokenNoOp = () => {};
const brokenWrongValue = (m) => { m.mem8[COIN_LOCKOUT] = 1; };
const brokenScribble = (m) => { cand(m); m.mem8[SCRATCH_RAM] = m.mem8[SCRATCH_RAM] ^ 0xff; };

test("EQUAL (crafted): loc_1989 clears the coin-lockout latch like the oracle", { skip }, () => {
  const e = seeded();
  assert.equal(e.mem.io.coinLock, 1, "seed did not arm the latch");
  assert.equal(coinLockAfter(cand, e), 0, "candidate did not clear the latch");
  assert.equal(coinLockAfter(oracle, e), 0, "oracle did not clear the latch");
  assert.equal(coinLockAfter(cand, e), coinLockAfter(oracle, e), "candidate/oracle latch disagree");
  assert.equal(ramDiff(oracle, cand, seeded()), null, "loc_1989 wrote RAM the oracle did not");
  console.log("  EQUAL: coin-lockout 1->0, no RAM touched");
});

test("TEETH: broken twins are caught", { skip }, () => {
  const e = seeded();
  assert.notEqual(coinLockAfter(brokenNoOp, e), coinLockAfter(oracle, e), "no-op twin escaped (latch)");
  assert.notEqual(coinLockAfter(brokenWrongValue, e), coinLockAfter(oracle, e), "wrong-value twin escaped (latch)");
  assert.ok(ramDiff(oracle, brokenScribble, seeded()), "scribble twin escaped (ramDiff teeth)");
  console.log("  TEETH: latch no-op + wrong-value caught, ramDiff scribble caught");
});
