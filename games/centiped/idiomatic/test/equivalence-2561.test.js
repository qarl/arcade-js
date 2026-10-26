// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for loc_2561 (ROM 0x2561) -- the per-frame wave/board-start service, gated on the
// pending-wave flag $86. When a start is pending it lays the status rows, counts the pending count down,
// and on the last count commits the wave (clears working cells, refreshes the checksum snapshot, fans
// the state block, tail-draws the grid borders). Live-out is RAM plus the write-only side latches
// (0x1c02-0x1c04, not in dumpState). Each side runs on a clone; the contract is RAM (dumpState, minus
// stack scratch below the entry SP, to 0x40 under it, where the oracle's sub-calls scribble). The commit arm
// descends into the RNG-driven playfield reseed (reads $100A -> writes $60/$8d/$8e/$d8) and re-arms the
// poly counter mid-routine, so the crafted arms force the RANDOM register to the poly-origin constant on
// BOTH sides (see craft()); every non-RNG cell is still asserted in full.
// Run: node --test games/centiped/idiomatic/test/equivalence-2561.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2561 as oracleRom } from "../../translated/loc_2561.js";
import { loc_2561 } from "../loc_2561.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { stampEntry, deadStackAtEntry, deadStackDeepAtEntry } from "./_stackFloor.js";

const oracle = stampEntry(oracleRom);

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0x2561;

function capDiff(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackDeepAtEntry(0x40, ma, mb));
}

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap }).runFrames(maxFrames); } catch { /* keep caps before any gap */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(24, 3000) : [];

test("CAPTURE: real 0x2561 dispatches -- loc_2561 == oracle in RAM (-stack)", () => {
  assert.ok(CAPS.length > 0, "boot must dispatch 0x2561 at least once");
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); loc_2561(c);
    assert.equal(capDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A real entry, mutated to reach one branch. The inputs are pinned so the commit tail (0x2872) and the
// IN1/IN0 reads are deterministic. The commit path descends (via initRoundState) into the RNG-driven
// playfield/mushroom reseed, which reads $100A and writes the RNG-derived cells ($60/$8d/$8e/$d8); the
// oracle charges cycles across those reads while the dissolved idiomatic layer reads them clock-free, and
// the commit path re-arms the poly counter (SKCTL SK_RESET) mid-routine so a pre-run pokeyC0=null does not
// hold. Force the RANDOM register to the poly-origin constant t[0] (0xff) on BOTH sides -- the single
// engine variable the clock-free layer cannot reproduce -- exactly the neutralization equivalence-2e0b
// and equivalence-2bd9 use. Non-RNG logic (control flow, all other cells) is still asserted in full.
function craft(cap, mut) {
  const m = cap.clone();
  m.io.pokeyC0 = null;
  m.io.pokeyRandom = () => 0xff; // poly-origin constant; robust to the commit path's SKCTL re-arm
  m.io.in1 = 0xff;
  m.io.inputAssert = null;
  m.io.cabinet = false;
  mut(m);
  return m;
}

test("CRAFTED: every branch of the wave-start service matches the oracle (RAM -stack)", () => {
  const cases = [
    // pending gate clear -> bail immediately.
    { name: "no wave pending (early return)", mut: (m) => { m.mem8[0x86] &= 0x7f; } },
    // pending, both counts clear -> the flip-byte row + latch-blank path.
    { name: "pending, both counts clear", mut: (m) => { m.mem8[0x86] |= 0x80; m.mem8[0xc8] = 0; m.mem8[0xc9] = 0; } },
    // pending, count 1 (<2), flip byte non-negative, IN1 bit0 set -> poll aborts the commit.
    { name: "pending, poll abort", mut: (m) => { m.mem8[0x86] |= 0x80; m.mem8[0xc8] = 1; m.mem8[0xc9] = 1; m.mem8[0xdc] = 0; m.io.in1 = 0x01; } },
    // pending, count 5, flip byte negative, IN1 clear, IN0 bit4 set -> full commit + state-block broadcast.
    { name: "pending, commit + broadcast", mut: (m) => { m.mem8[0x86] |= 0x80; m.mem8[0xc8] = 5; m.mem8[0xc9] = 1; m.mem8[0xdc] = 0x80; m.io.in1 = 0; m.io.cabinet = true; } },
    // count >= 0x0a exercises the tens-split status write.
    { name: "pending, tens split", mut: (m) => { m.mem8[0x86] |= 0x80; m.mem8[0xc8] = 0x0c; m.mem8[0xc9] = 0; m.mem8[0xdc] = 0x80; m.io.in1 = 0; } },
  ];
  for (const { name, mut } of cases) {
    const o = craft(CAPS[0], mut), c = craft(CAPS[0], mut);
    oracle(o); loc_2561(c);
    assert.equal(capDiff(o, c), null, name);
  }
});

test("TEETH: a twin that skips the checksum-snapshot refresh diverges in RAM", () => {
  const mut = (m) => { m.mem8[0x86] |= 0x80; m.mem8[0xc8] = 5; m.mem8[0xc9] = 1; m.mem8[0xdc] = 0x80; m.io.in1 = 0; };
  const o = craft(CAPS[0], mut), c = craft(CAPS[0], mut);
  oracle(o);
  // BUG: the commit path forgot to clear $fb (one of the working cells the commit zeroes).
  loc_2561(c);
  c.mem8[0xfb] = 0x7f; // as if `sta $fb` never ran and the cell kept a stale value
  const d = capDiff(o, c);
  assert.notEqual(d, null, "the RAM diff FAILED to catch a stale working cell");
});

test("SP-TOOTH: the commit tail is seam-placeable and an adrift twin is refused", () => {
  // Seat a state that reaches the retained push16/0x2872 commit tail so the tooth exercises real pushes.
  const seat = craft(CAPS[0], (m) => { m.mem8[0x86] |= 0x80; m.mem8[0xc8] = 5; m.mem8[0xc9] = 1; m.mem8[0xdc] = 0x80; m.io.in1 = 0; });
  const good = seamPlaceable(withOmittedRet, loc_2561, TARGET, seat.clone());
  assert.equal(good.placeable, true, `loc_2561 must be seam-placeable; got: ${good.error}`);
  const adrift = (m) => { const rv = loc_2561(m); m.push16(0x0000); return rv; };
  const bad = seamPlaceable(withOmittedRet, adrift, TARGET, seat.clone());
  assert.equal(bad.placeable, false, "the SP tooth FAILED to refuse an adrift stack (a dropped push16)");
  console.log("  SP-TOOTH: placeable, adrift twin refused");
});
