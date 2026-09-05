// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1621 — memory-equivalent to the frozen oracle at ROM 0x1621.
 * Gated one-shot: arms the pending word at 0x4222 (a 16-bit flag/countdown pair) to 1 ONLY when
 * bit 0 of gate 0x4220 is set AND bit 0 of gate 0x4225 is set AND bit 0 of the pending word is clear.
 * Its only live-out is that RAM word (no registers the callers read back), so EQUAL is pure ramDiff.
 * Paths: ALL-PASS (arm), each gate failing (no write), and already-armed (no write). Positive control:
 * on all-pass the oracle really flips 0x4222 low->1 and clears the 0x4223 sentinel. Teeth: no-op,
 * wrong-value, high-byte-left, and a gate-ignoring twin (arms on a failed gate).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { craft, ramDiff, romsPresent } from "./_bootSetup.js";
import { loc_1621 as cand } from "../loc_1621.js";
import { loc_1621 as oracle } from "../../translated/loc_1621.js";

const GATE_A = 0x4220;
const PENDING = 0x4222; // 16-bit: enable byte at 0x4222, countdown byte at 0x4223
const COUNTDOWN = 0x4223;
const GATE_B = 0x4225;
const SENTINEL = 0xaa; // pre-poked into the countdown byte; the arm must zero it
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// All gates pass -> the routine arms. Gate values carry extra bits to prove only bit 0 is tested; the
// pending byte is nonzero-but-even (bit 0 clear) so the arm flips it 0x02->0x01, not merely 0->1.
const allPass = () => craft((mem, m) => {
  m.push16(0x9999);
  mem[GATE_A] = 0x03; mem[GATE_B] = 0x05;
  mem[PENDING] = 0x02; mem[COUNTDOWN] = SENTINEL;
});
const gateAfail = () => craft((mem, m) => {
  m.push16(0x9999);
  mem[GATE_A] = 0x02; mem[GATE_B] = 0x05; // gate A bit 0 clear
  mem[PENDING] = 0x02; mem[COUNTDOWN] = SENTINEL;
});
const gateBfail = () => craft((mem, m) => {
  m.push16(0x9999);
  mem[GATE_A] = 0x03; mem[GATE_B] = 0x04; // gate B bit 0 clear
  mem[PENDING] = 0x02; mem[COUNTDOWN] = SENTINEL;
});
const alreadyArmed = () => craft((mem, m) => {
  m.push16(0x9999);
  mem[GATE_A] = 0x03; mem[GATE_B] = 0x05;
  mem[PENDING] = 0x03; mem[COUNTDOWN] = SENTINEL; // bit 0 already set
});

// Teeth twins.
const noOp = () => {};
const wrongValue = (m) => { m.mem8[PENDING] = 2; m.mem8[COUNTDOWN] = 0; };   // arms to 2, not 1
const highByteLeft = (m) => { m.mem8[PENDING] = 1; };                        // forgets to clear 0x4223
const ignoreGates = (m) => { m.mem8[PENDING] = 1; m.mem8[COUNTDOWN] = 0; };  // arms regardless of gates

test("EQUAL (crafted): loc_1621 == oracle arms the pending word when all gates pass", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, allPass()), null, "loc_1621 diverged on the all-pass path");
  // positive control: the oracle actually arms the word and clears the sentinel.
  const a = allPass(); oracle(a);
  assert.equal(a.mem8[PENDING], 1, "positive control: oracle did not arm the enable byte");
  assert.equal(a.mem8[COUNTDOWN], 0, "positive control: oracle did not clear the countdown byte");
  console.log("  EQUAL: loc_1621 == oracle, pending word armed to 1 (countdown cleared)");
});

test("EQUAL (crafted): loc_1621 == oracle returns without arming when a gate fails or already armed", { skip }, () => {
  assert.equal(ramDiff(oracle, cand, gateAfail()), null, "loc_1621 diverged on the gate-A-fail path");
  assert.equal(ramDiff(oracle, cand, gateBfail()), null, "loc_1621 diverged on the gate-B-fail path");
  assert.equal(ramDiff(oracle, cand, alreadyArmed()), null, "loc_1621 diverged on the already-armed path");
  // positive control: gate A failing leaves the pending word untouched.
  const a = gateAfail(); oracle(a);
  assert.equal(a.mem8[PENDING], 0x02, "positive control: gate A fail should leave the pending byte");
  assert.equal(a.mem8[COUNTDOWN], SENTINEL, "positive control: gate A fail should leave the countdown byte");
  console.log("  EQUAL: loc_1621 == oracle, no write on gate-fail / already-armed");
});

test("TEETH: broken twins are caught", { skip }, () => {
  assert.ok(ramDiff(oracle, noOp, allPass()), "the no-op twin escaped");
  assert.ok(ramDiff(oracle, wrongValue, allPass()), "the wrong-value twin escaped");
  assert.ok(ramDiff(oracle, highByteLeft, allPass()), "the high-byte-left twin escaped");
  assert.ok(ramDiff(oracle, ignoreGates, gateAfail()), "the gate-ignoring twin escaped");
  console.log("  TEETH: no-op, wrong-value, high-byte-left, gate-ignoring all caught");
});
