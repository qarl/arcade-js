// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for serviceHeartbeatInterrupt (ROM 0xd704-0xd7dc) -- the periodic ~246Hz IRQ handler. Contract:
// RAM only (dumpState minus stack scratch below the entry SP). The ROM saves A/X/Y and restores them around the body and
// returns via RTI, so A/X/Y/P/PC are plumbing, not live-outs, and the only register READ is S (the stack
// pointer, for the depth guard) -- passed as the m.regs.s param default. Two internal JSRs (tickHeartbeatCounters,
// stepSoundVoices) are dissolved to direct idiomatic calls; the rare BRK re-init arm stays a TEMPORARY m.call.
// IN0 bit7 = (cycles & 0x100): the ROM oracle steps cycles while the idiomatic layer does not, so the raw
// IN0 byte latched into $08 would drift. Both clones' mem.clock is pinned to a constant to freeze that bit
// (the analog of freezing POKEY random) -- POKEY random (0x60ca/0x60da) is NOT reached here (only ALLPOT
// reg 8, whose return is cycle-independent).
// Run: node --test games/tempest/idiomatic/test/equivalence-d704.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_d704 } from "../../translated/loc_d704.js";
import { serviceHeartbeatInterrupt } from "../serviceHeartbeatInterrupt.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  STATUS_FLAGS, PHASE_COUNTER, IRQ_SUBTIMER, INPUT_PORT_LATCH, ACTIVE_SLOT_COUNT, IRQ_HEARTBEAT,
  TIMER1_LO, TIMER1_MID, TIMER1_HI, TIMER2_LO, TIMER2_MID, TIMER2_HI,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xd704;
const oracle = atEntry(loc_d704);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

// Freeze the cycle-derived IN0 bit7 so the stepped oracle and the step-free idiomatic layer read the same
// raw IN0 byte into $08. clock()=0 keeps (cycles & 0x100) == 0 on every read.
const pinClock = (m) => { m.mem.clock = () => 0; return m; };

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

test("CAPTURE: real 0xd704 dispatches -- serviceHeartbeatInterrupt == oracle in RAM (-stack)", () => {
  let checked = 0;
  for (const cap of CAPS) {
    const o = pinClock(cap.clone()), c = pinClock(cap.clone());
    let threw = false;
    try { oracle(o); } catch { threw = true; } // guard/BRK re-init or an unimplemented callee arm
    if (threw) continue; // both layers would diverge into the same unported arm; nothing to compare
    serviceHeartbeatInterrupt(c);
    assert.equal(ramDiff(o, c), null, "RAM equal for a captured IRQ dispatch");
    checked++;
  }
  console.log(`  CAPTURE: ${checked}/${CAPS.length} dispatch(es) compared`);
});

// Main path with the deep timer cascades armed: $07 wraps to 0 -> the $0406 carry chain runs; bit6 of $05
// is set so the $0409 chain runs too; $05 nonzero also selects the $3e+1 dispatch index. S=0xfd (fresh
// post-reset) and $53 positive keep the guard on the main path.
function seedMain(m) {
  m.mem.write8(IRQ_HEARTBEAT, 0x10);
  m.mem.write8(IRQ_SUBTIMER, 0xff); // INC -> 0 -> enter the cascade block
  m.mem.write8(STATUS_FLAGS, 0x40); // nonzero (dispatch = $3e+1) AND bit6 set (arm the $0409 chain)
  m.mem.write8(ACTIVE_SLOT_COUNT, 0x02);
  m.mem.write8(TIMER1_LO, 0xff); // 0xff -> 0 -> carry into $0407
  m.mem.write8(TIMER1_MID, 0xff); // 0xff -> 0 -> carry into $0408
  m.mem.write8(TIMER1_HI, 0x20);
  m.mem.write8(TIMER2_LO, 0xff); // 0xff -> 0 -> carry into $040a
  m.mem.write8(TIMER2_MID, 0xff); // 0xff -> 0 -> carry into $040b
  m.mem.write8(TIMER2_HI, 0x00);
}

test("CRAFTED: main path with both timer cascades -- RAM equal + cascade cells correct", () => {
  const o = pinClock(new Machine(ROM, OPTS)); seedMain(o);
  const c = pinClock(new Machine(ROM, OPTS)); seedMain(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED: oracle threw (unported callee arm) -- skipped"); return; }
  serviceHeartbeatInterrupt(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after the main-path IRQ tick");
  assert.equal(c.mem.read8(IRQ_HEARTBEAT), 0x11, "heartbeat $53 advanced by 1");
  assert.equal(c.mem.read8(IRQ_SUBTIMER), 0x00, "$07 wrapped to 0");
  assert.equal(c.mem.read8(TIMER1_LO), 0x00, "$0406 wrapped to 0");
  assert.equal(c.mem.read8(TIMER1_MID), 0x00, "$0407 wrapped to 0");
  assert.equal(c.mem.read8(TIMER1_HI), 0x21, "$0408 carried +1");
  assert.equal(c.mem.read8(TIMER2_LO), 0x00, "$0409 wrapped to 0 (bit6 of $05 armed the chain)");
  assert.equal(c.mem.read8(TIMER2_MID), 0x00, "$040a wrapped to 0");
  assert.equal(c.mem.read8(TIMER2_HI), 0x01, "$040b carried +1");
});

test("CRAFTED: $07 low keeps the timer cascades and $0409 chain untouched", () => {
  const seed = (m) => {
    m.mem.write8(IRQ_HEARTBEAT, 0x10);
    m.mem.write8(IRQ_SUBTIMER, 0x10);  // INC -> 0x11 (nonzero) -> skip ALL cascades
    m.mem.write8(STATUS_FLAGS, 0x40);  // bit6 set, but the chain is gated by the $07 wrap that never happens
    m.mem.write8(TIMER1_LO, 0x55);
    m.mem.write8(TIMER2_LO, 0x66);
  };
  const o = pinClock(new Machine(ROM, OPTS)); seed(o);
  const c = pinClock(new Machine(ROM, OPTS)); seed(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  CRAFTED-2: oracle threw -- skipped"); return; }
  serviceHeartbeatInterrupt(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the no-cascade path");
  assert.equal(c.mem.read8(IRQ_SUBTIMER), 0x11, "$07 advanced but did not wrap");
  assert.equal(c.mem.read8(TIMER1_LO), 0x55, "$0406 untouched (no wrap)");
  assert.equal(c.mem.read8(TIMER2_LO), 0x66, "$0409 untouched (chain gated off)");
});

test("TEETH: a twin that skips the $53 heartbeat INC MUST diverge in RAM", () => {
  const o = pinClock(new Machine(ROM, OPTS)); seedMain(o);
  const c = pinClock(new Machine(ROM, OPTS)); seedMain(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH: oracle threw -- skipped"); return; }
  let ran = false;
  const broken = (m) => {
    const before = m.mem.read8(IRQ_HEARTBEAT);
    serviceHeartbeatInterrupt(m);
    m.mem.write8(IRQ_HEARTBEAT, before); // BUG: revert the +1/IRQ heartbeat advance
    ran = true;
  };
  broken(c);
  assert.ok(ran, "the teeth twin did not run");
  assert.notEqual(ramDiff(o, c), null, "the dropped $53 INC was NOT caught by the RAM compare");
});

test("TEETH: a twin that skips latching raw IN0 into $08 MUST diverge in RAM", () => {
  const o = pinClock(new Machine(ROM, OPTS)); seedMain(o);
  const c = pinClock(new Machine(ROM, OPTS)); seedMain(c);
  let threw = false;
  try { oracle(o); } catch { threw = true; }
  if (threw) { console.log("  TEETH-2: oracle threw -- skipped"); return; }
  const broken = (m) => {
    const before = m.mem.read8(INPUT_PORT_LATCH);
    serviceHeartbeatInterrupt(m);
    m.mem.write8(INPUT_PORT_LATCH, before); // BUG: never latched IN0 -> $08
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the dropped $08 IN0 latch was NOT caught by the RAM compare");
});
