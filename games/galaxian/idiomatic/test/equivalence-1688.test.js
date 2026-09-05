// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1688 — crafted-entry equivalence vs the frozen gated-countdown tail at ROM 0x1688.
 * Live-out is memory only: the counter byte at 0x422c decrements, and on reaching zero the
 * arm flag at 0x422b is cleared. The routine ticks only while 0x422b bit 0 is set and at least
 * one activity gate is open — 0x4224 (whole byte), 0x4221 (whole byte), or 0x4226 bit 0. A
 * post-attract seed is cloned, the flag/counter/gates poked, and a return address laid for the
 * oracle's `ret`. EQUAL asserts ramDiff==null on the run, expiry, gate-via-0x4226-bit-0, hold
 * (all gates closed), and disarmed paths, each with a non-vacuous positive control. Teeth:
 * no-op, decrement-twice, wrong-cell, gate-ignoring, disarm-ignoring, and no-disarm twins.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { romsPresent, craft, ramDiff } from "./_bootSetup.js";
import { loc_1688 as cand } from "../loc_1688.js";
import { loc_1688 as oracle } from "../../translated/loc_1688.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const ARM = 0x422b; // bit 0 = armed; self-clears on expiry
const CTR = 0x422c; // the countdown byte
const G0 = 0x4224; // activity gate (whole byte)
const G1 = 0x4221; // activity gate (whole byte)
const G2 = 0x4226; // activity gate (bit 0 only)

// Armed, gate G0 open, counter running.
const run = () => craft((mem, m) => { m.push16(0x9999); mem[ARM] = 0x01; mem[CTR] = 5; mem[G0] = 0x01; mem[G1] = 0x00; mem[G2] = 0x00; });
// Armed, gate G0 open, counter about to expire.
const expire = () => craft((mem, m) => { m.push16(0x9999); mem[ARM] = 0x01; mem[CTR] = 1; mem[G0] = 0x01; mem[G1] = 0x00; mem[G2] = 0x00; });
// Armed, only G2 bit 0 open -> tick.
const runViaG2 = () => craft((mem, m) => { m.push16(0x9999); mem[ARM] = 0x01; mem[CTR] = 5; mem[G0] = 0x00; mem[G1] = 0x00; mem[G2] = 0x01; });
// Armed, all gates closed (G2 nonzero but its bit 0 clear) -> hold.
const hold = () => craft((mem, m) => { m.push16(0x9999); mem[ARM] = 0x01; mem[CTR] = 5; mem[G0] = 0x00; mem[G1] = 0x00; mem[G2] = 0x02; });
// Not armed (bit 0 clear, high bit set) with gates open -> nothing.
const disarmed = () => craft((mem, m) => { m.push16(0x9999); mem[ARM] = 0x02; mem[CTR] = 5; mem[G0] = 0x01; mem[G1] = 0x01; mem[G2] = 0x01; });

test("EQUAL (crafted): loc_1688 == oracle on run, expiry, G2 gate, hold, and disarmed", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, run()), null, "the run path diverged");
  assert.equal(ramDiff(oracle, cand, expire()), null, "the expiry path diverged");
  assert.equal(ramDiff(oracle, cand, runViaG2()), null, "the G2-bit-0 gate path diverged");
  assert.equal(ramDiff(oracle, cand, hold()), null, "the hold path diverged");
  assert.equal(ramDiff(oracle, cand, disarmed()), null, "the disarmed path diverged");

  // Non-vacuous positive controls: the oracle really moves the live-outs (and holds where it should).
  const a = run(); oracle(a);
  assert.equal(a.mem8[CTR], 4, "control: counter 5->4 on a plain tick");
  assert.equal(a.mem8[ARM], 0x01, "control: flag stays armed while counting");
  const b = expire(); oracle(b);
  assert.equal(b.mem8[CTR], 0, "control: counter 1->0 on expiry");
  assert.equal(b.mem8[ARM], 0x00, "control: flag disarmed on expiry");
  const g = runViaG2(); oracle(g);
  assert.equal(g.mem8[CTR], 4, "control: G2 bit 0 opens the gate -> tick");
  const h = hold(); oracle(h);
  assert.equal(h.mem8[CTR], 5, "control: all gates closed -> counter held");
  const d = disarmed(); oracle(d);
  assert.equal(d.mem8[CTR], 5, "control: disarmed -> counter untouched");
  assert.equal(d.mem8[ARM], 0x02, "control: disarmed -> flag untouched");
  console.log("  EQUAL: loc_1688 == oracle on run/expiry/G2/hold/disarmed (RAM)");
});

test("TEETH: broken twins are caught by the RAM diff", { skip }, () => {
  const noOp = () => {};
  const decTwice = (m) => { m.mem8[CTR] = (m.mem8[CTR] - 2) & 0xff; };
  const wrongCell = (m) => { m.mem8[CTR + 1] = (m.mem8[CTR + 1] - 1) & 0xff; };
  const ignoreGate = (m) => { m.mem8[CTR] = (m.mem8[CTR] - 1) & 0xff; }; // ticks on the hold path
  const ignoreDisarm = (m) => { m.mem8[CTR] = (m.mem8[CTR] - 1) & 0xff; }; // ticks on the disarmed path
  const noDisarm = (m) => { m.mem8[CTR] = (m.mem8[CTR] - 1) & 0xff; }; // reaches 0 but never clears the flag

  assert.ok(ramDiff(oracle, noOp, run()), "no-op twin escaped");
  assert.ok(ramDiff(oracle, decTwice, run()), "decrement-twice twin escaped");
  assert.ok(ramDiff(oracle, wrongCell, run()), "wrong-cell twin escaped");
  assert.ok(ramDiff(oracle, ignoreGate, hold()), "gate-ignoring twin escaped");
  assert.ok(ramDiff(oracle, ignoreDisarm, disarmed()), "disarm-ignoring twin escaped");
  assert.ok(ramDiff(oracle, noDisarm, expire()), "no-disarm twin escaped");
  console.log("  TEETH: no-op, dec-twice, wrong-cell, gate-ignore, disarm-ignore, no-disarm all caught");
});
