// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for silenceSound (ROM 0x011c) — "silence the sound
 * hardware": zero the eight ls259.6h trigger latches + their work-RAM shadow, the
 * 0x6088-0x608B sound-control block, the audio IRQ line, and the ls175.3d latch.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired
 * strict whole-machine one. silenceSound WRITES RAM, so every captured case uses a
 * FRESH clone per side (never a reused machine). The oracle is run on one clone,
 * silenceSound on another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + pc + declared live-out (none).
 *
 * SP is deliberately NOT compared: the oracle's only SP mutation is its terminal
 * `ret` (a pop, SP+2), the modelled stack ABI the direct-call layer replaces with a
 * JS return — comparing it would test the stack model we drop, not the routine.
 * pc IS compared and is trivially equal (the oracle uses m.tick/pop16, never m.step,
 * so it leaves pc at entry; silenceSound never touches it).
 *
 * Jobs:
 *   1. EQUAL (captured dispatches) — hook 0x011c in a real run; on each true
 *      dispatch, oracle vs silenceSound leave identical RAM (−STACK_SCRATCH) + pc.
 *   2. WRITE-SET (captured) — the oracle's ONLY work-RAM writes are the 12 bytes
 *      0x6080-0x608B, all 0. Documents the exact memory footprint the gate covers.
 *   3. CRAFTED (clears dirty RAM) — the routine is input-independent and straight
 *      line (no unreached arms), so the meaningful crafted case is prior contents:
 *      pre-dirty 0x6080-0x608B to 0xAA identically on both sides and confirm both
 *      zero them. Proves the clear-semantics, not just agreement on already-zero RAM.
 *   4. TEETH — a twin that writes a WRONG value (0xFF) to one output byte
 *      (SND_BGM, 0x6089) MUST be caught, on every captured state and the crafted one.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-011c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_011c as oracle } from "../../translated/loc_011c.js";
import { silenceSound } from "../silenceSound.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SND_BGM } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x011c;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First RAM difference between two machines on the go-forward contract: the whole
 * state dump minus the stack scratch below the entry SP (dead scratch — neither side writes it
 * here, masked per the contract). Returns {addr,a,b} or null.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  let d = firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off));
  let from = 0;
  while (d && dead(d.addr)) {
    from = d.offset + 1;
    d = firstStateDiff(a.subarray(from), b.subarray(from), (off) => ma.stateOffsetToAddr(off + from));
  }
  return d;
}

/**
 * Hook 0x011c in a real run and clone the machine at up to K true dispatches. It
 * fires first during boot (bootInit @ 0x02B5) and again on attract transitions; the
 * wrapper snapshots the entry state, then runs the oracle so the host proceeds.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

// A plain attract run dispatches 0x011c at boot and again at the demo/game-over
// transition (~frame 3.6k), the latter a NON-boot path; the window covers both.
const CAPS = ROM_PRESENT ? captureDispatches(48, 4000) : [];

// -- 1. EQUAL (captured dispatches) -------------------------------------------

test("EQUAL: real captured dispatches — silenceSound == oracle in RAM (−stack) + pc", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x011c dispatch in the run window");

  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    silenceSound(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} silence=${d.b}`);
    assert.equal(c.pc, o.pc, "pc must match the oracle");
  }
  console.log(`  EQUAL: ${CAPS.length} real dispatches identical (RAM −stack + pc)`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only work-RAM writes are 0x6080-0x608B := 0", () => {
  const cap = CAPS[0];
  const before = cap.clone();
  const after = cap.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  // Every change is within 0x6080-0x608B and lands a 0 (stack region untouched here).
  for (const ch of changed) {
    assert.ok(
      ch.addr >= 0x6080 && ch.addr <= 0x608b,
      `oracle wrote unexpected work-RAM addr ${hx(ch.addr)} (${ch.from}->${ch.to})`,
    );
    assert.equal(ch.to, 0, `oracle wrote non-zero ${ch.to} at ${hx(ch.addr)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} work-RAM byte(s) changed, all in 0x6080-0x608B := 0`);
});

// -- 3. CRAFTED (clears dirty RAM) --------------------------------------------

test("CRAFTED: pre-dirtied 0x6080-0x608B is zeroed identically by both sides", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  // Identical surgical nudge on BOTH sides: dirty the whole output span to 0xAA.
  for (let a = 0x6080; a <= 0x608b; a++) {
    o.mem.write8(a, 0xaa);
    c.mem.write8(a, 0xaa);
  }
  oracle(o);
  silenceSound(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} silence=${d.b}`);
  // ...and both genuinely cleared the dirt (not merely agreed).
  for (let a = 0x6080; a <= 0x608b; a++) {
    assert.equal(c.mem.read8(a), 0, `silenceSound left ${hx(a)} = ${c.mem.read8(a)} (expected 0)`);
  }
  console.log("  CRAFTED: 0x6080-0x608B dirtied to 0xAA -> both zero it, RAM identical");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: writes a WRONG value (0xFF) to SND_BGM (0x6089) instead of 0. */
function brokenSilenceSound(m) {
  silenceSound(m);
  m.mem.write8(SND_BGM, 0xff); // BUG: SND_BGM must be cleared to 0
}

test("TEETH: a wrong output value at SND_BGM is CAUGHT on every case", () => {
  // Captured states.
  let caughtAt = null;
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    brokenSilenceSound(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    if (d) { caughtAt = d; break; }
  }
  assert.notEqual(caughtAt, null, "the gate FAILED to catch a wrong SND_BGM store — it is worthless");
  assert.equal(caughtAt.addr, SND_BGM, `teeth caught the wrong address ${hx(caughtAt.addr ?? 0)}`);

  // Crafted dirtied state too (must be caught regardless of prior contents).
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  for (let a = 0x6080; a <= 0x608b; a++) { o.mem.write8(a, 0xaa); c.mem.write8(a, 0xaa); }
  oracle(o);
  brokenSilenceSound(c);
  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch the wrong store on the crafted state");
  assert.equal(d.addr, SND_BGM, `crafted teeth caught the wrong address ${hx(d.addr ?? 0)}`);

  console.log(`  TEETH: wrong SND_BGM (0x6089) store caught at ${hx(caughtAt.addr)} (oracle=${caughtAt.a} broken=${caughtAt.b})`);
});
