// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence-harness tests for entry_06b8 (redraw the lives indicator + the
 * two-digit level number). ROM 0x06B8-0x06FD.
 *
 * Three jobs, as for entry_0611:
 *
 *   1. EQUAL -- the idiomatic optimized entry_06b8 reads EQUAL against its
 *      translated oracle, whole-machine and unit.
 *
 *   2. DISPATCH -- the override must actually fire, or EQUAL is vacuous. In plain
 *      attract entry_06b8 fires TWICE from boot: frame 4 takes the DRAW path with
 *      the marker loop skipped (LIVES == payload, so the `jp z` is taken), and
 *      frame 5 takes the SKIP path (ATTRACT bit0 set, sub_0008 returns us to our
 *      caller). A 30-frame window covers both.
 *
 *   3. TEETH -- a deliberately-broken twin (the first marker-blank store lands the
 *      wrong value) must be CAUGHT: NOT-EQUAL, naming the diverging VRAM address.
 *
 * WHY THE UNIT GATE IS OPEN-CODED HERE (not core `unitEquivalence`). core's unit
 * harness installs its snapshot override on `host.overrides` AFTER construction,
 * which only intercepts the two dispatch points that consult that map
 * (dispatchTask / dispatchGameState). entry_06b8 is dispatched as task 6 ONLY
 * during a credited game -- it is NOT queued in attract (verified: zero task-ring
 * dispatches over 300 attract frames) -- but it IS reached at boot via
 * handler_01c3's `m.call(0x06b8)`, which resolves through `m.routines`, the table
 * built from the CONSTRUCTOR's overrides. So the entry state is captured with a
 * constructor override (`captureEntry`), which the boot-time m.call hits at frame
 * 4; the rest (clone / run translated vs optimized / diff RAM + registers + pc)
 * is identical to core `unitEquivalence`. Same reason the whole-machine EQUAL and
 * TEETH tests use the imported harness: it drives no input, so it reaches the
 * attract paths (SKIP + DRAW/Z) but not the NZ marker loop -- which is covered by
 * a driven-input diff folded into the EQUAL/whole test below.
 *
 * THE CYCLE FINDING this routine adds: entry_06b8 is ATOMIC and its charges
 * collapse to one-per-branch and one-per-loop-ITERATION (the marker/split loop
 * counts are data-dependent) while staying EQUAL -- whole-machine AND unit, AND
 * on the NZ marker-loop path (a main-loop task dispatch at frame 34, so its total
 * feeds the spin count and is observable). Its only callee, sub_0008, is a
 * non-interruptible leaf, so the vblank NMI never lands inside the routine.
 *
 * Run: node --test
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { entry_06b8 as translated_06b8 } from "../../translated/mainloop.js";
import { entry_06b8 as optimized_06b8 } from "../entry_06b8.js";
import { wholeMachineEquivalence } from "../harness.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, firstRegDiff } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT
  ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR)))
  : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x06b8;
const FRAMES = 30; // entry_06b8 fires at frame 4 (DRAW/Z) and frame 5 (SKIP)

// The first store on the DRAW path is the first marker-blank cell: entry_06b8
// writes tile 0x10 to VRAM 0x7783 (inside the compared dump, video RAM
// 0x7400-0x77FF). It fires only at frame 4 in attract, so the corrupted cell is
// not rewritten and the diff persists.
const BROKEN_ADDR = 0x7783;

/**
 * Deliberately-broken twin: behaviourally optimized_06b8 EXCEPT the first store
 * to 0x7783 lands a wrong value (correct value XOR 0xFF). Intercepting exactly
 * that one write lets the rest of the routine run verbatim -- the representative
 * "wrong value to one of the routine's own output addresses" bug the gate must
 * catch.
 */
function broken_06b8(m) {
  const realWrite = m.mem.write8.bind(m.mem);
  let broke = false;
  m.mem.write8 = (addr, value, busOffset) => {
    if (!broke && addr === BROKEN_ADDR) {
      broke = true;
      return realWrite(addr, value ^ 0xff, busOffset);
    }
    return realWrite(addr, value, busOffset);
  };
  try {
    return optimized_06b8(m);
  } finally {
    m.mem.write8 = realWrite;
  }
}

// Capture the pristine machine state at entry_06b8's first dispatch, via a
// CONSTRUCTOR override (so the boot-time m.call from handler_01c3 is caught).
function captureEntry(implFn, maxFrames = FRAMES) {
  let entry = null;
  const snap = (mm) => {
    if (entry === null) entry = mm.clone();
    return implFn(mm); // let the host run proceed to a clean stop
  };
  const m = new Machine(ROM, { overrides: new Map([[TARGET, snap]]) });
  m.runFrames(maxFrames);
  if (entry === null) {
    throw new Error(`entry_06b8 never dispatched within ${maxFrames} frames`);
  }
  return entry;
}

// Open-coded unit gate (see header): run translated vs `optFn` on two clones of
// the captured entry state and diff RAM + registers + pc.
function unitCheck(optFn) {
  const entry = captureEntry(translated_06b8);
  const a = entry.clone();
  const b = entry.clone();
  translated_06b8(a);
  optFn(b);
  return {
    ram: firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)),
    regs: firstRegDiff(a.regs, b.regs),
    pc: a.pc === b.pc ? null : { a: a.pc, b: b.pc },
  };
}

// -- EQUAL --------------------------------------------------------------------

test("EQUAL (whole-machine): idiomatic optimized entry_06b8 matches translated every frame", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, optimized_06b8]]));

  // The override must actually have run, or EQUAL would be vacuous.
  assert.ok(
    r.invocations.get(TARGET) >= 1,
    `override at 0x${TARGET.toString(16)} never dispatched (invocations=${r.invocations.get(TARGET)})`,
  );
  assert.equal(
    r.equal,
    true,
    r.equal ? "" : `diverged at frame ${r.frame}, addr 0x${(r.addr ?? 0).toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
  assert.equal(r.framesCompared, FRAMES);

  // SUPPLEMENT -- the NZ marker loop. The input-less harness never reaches a
  // credited game, so it only exercises the SKIP and DRAW/Z paths above. Drive a
  // coin + start so entry_06b8 dispatches as an in-game task (frame ~34) with
  // LIVES != payload, taking the NZ branch and running the marker loop; diff the
  // whole-machine trace directly and assert the NZ branch actually fired.
  const tape = [
    { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin  (IN2 bit7)
    { port: 0x7d00, bits: 0x04, frame: 30, dur: 6 }, // start (IN2 bit2)
  ];
  const runTape = (overrides) => {
    const mm = new Machine(ROM, overrides ? { overrides } : {});
    mm.inputTape = tape;
    return mm;
  };
  const base = runTape().runFrames(60);
  let nzFired = 0;
  const wrapped = new Map([[TARGET, (mm) => {
    if ((mm.mem.read8(0x6007) & 1) === 0 && mm.mem.read8(0x6228) !== mm.regs.a) nzFired++;
    return optimized_06b8(mm);
  }]]);
  const opt = runTape(wrapped).runFrames(60);
  for (let f = 0; f < Math.min(base.length, opt.length); f++) {
    const d = firstStateDiff(base[f], opt[f]);
    assert.equal(d, null, d ? `NZ-path diverged at frame ${f}, offset ${d.offset} (${d.a} vs ${d.b})` : "");
  }
  assert.ok(nzFired >= 1, "NZ marker-loop branch never exercised — supplement is vacuous");

  console.log(
    `  EQUAL/whole: ${r.framesCompared} frames identical, override fired ` +
      `${r.invocations.get(TARGET)}x (attract: SKIP + DRAW/Z); NZ marker loop fired ${nzFired}x under driven input`,
  );
});

test("EQUAL (unit): idiomatic optimized entry_06b8 matches translated in RAM + registers", () => {
  const r = unitCheck(optimized_06b8);

  assert.equal(r.ram, null, r.ram ? `RAM diff at 0x${r.ram.addr.toString(16)}` : "");
  assert.equal(r.regs, null, r.regs ? `reg diff at ${r.regs.reg} (${r.regs.a} vs ${r.regs.b})` : "");
  assert.equal(r.pc, null, "pc must match");
  console.log("  EQUAL/unit: RAM + all registers (incl. F, HL, DE) + pc identical");
});

// -- TEETH --------------------------------------------------------------------

test("TEETH (whole-machine): a wrong marker-blank store is CAUGHT and NOT-EQUAL", () => {
  const r = wholeMachineEquivalence(ROM, {}, FRAMES, new Map([[TARGET, broken_06b8]]));

  assert.ok(r.invocations.get(TARGET) >= 1, "broken override must have dispatched");
  assert.equal(r.equal, false, "harness FAILED to catch a wrong store — it is worthless");
  assert.equal(typeof r.frame, "number");
  assert.ok(r.addr != null, "a caught divergence must name an address");
  console.log(
    `  TEETH/whole: caught at frame ${r.frame}, addr 0x${r.addr.toString(16)} ` +
      `(baseline ${r.baseline} vs optimized ${r.optimized})`,
  );
});

test("TEETH (unit): a wrong marker-blank store is CAUGHT and names 0x7783", () => {
  const r = unitCheck(broken_06b8);

  assert.ok(r.ram != null || r.regs != null, "harness FAILED to catch a wrong store — it is worthless");
  assert.ok(r.ram != null, "a caught divergence must name a RAM address");
  assert.equal(
    r.ram.addr,
    BROKEN_ADDR,
    `expected first diff at the broken address 0x${BROKEN_ADDR.toString(16)}, got 0x${r.ram.addr.toString(16)}`,
  );
  console.log(
    `  TEETH/unit: caught at 0x${r.ram.addr.toString(16)} (translated ${r.ram.a} vs broken ${r.ram.b})`,
  );
});
