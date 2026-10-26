// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for triggerWalkSound (ROM 0x1d8f) — "request the walk
 * (footstep) sound": store 3 into SND_TRIGGER[0] (0x6080), a 3-frame hold that the
 * per-vblank sound driver counts down onto ls259.6h bit 0 (hardware latch 0x7D00).
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. triggerWalkSound WRITES RAM, so every captured case uses a FRESH
 * clone per side (never a reused machine). The oracle runs on one clone, the rewrite
 * on another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + declared live-out (none).
 *
 * pc and SP are deliberately NOT compared. sub_1d8f's oracle models its terminal
 * `ret` with m.step/m.ret — advancing pc to the popped return address and SP by +2 —
 * which is exactly the stack/PC ABI the direct-call layer replaces with a JS return;
 * comparing either would test the stack model we drop, not the routine. (Contrast
 * silenceSound at 0x011c, whose oracle uses tick/pop16 and leaves pc at entry, so it
 * could keep pc; this oracle steps, so pc is a ret artifact here.) The routine reads
 * nothing and leaves no live register, so the memory footprint IS the whole contract.
 *
 * Jobs:
 *   1. EQUAL (captured dispatches) — hook 0x1d8f in a real attract run; on each true
 *      25m dispatch, oracle vs triggerWalkSound leave identical RAM (−STACK_SCRATCH).
 *   2. WRITE-SET (captured) — the oracle's ONLY work-RAM write is the single byte
 *      SND_TRIGGER[0] (0x6080) := 3. Documents the exact footprint the gate covers.
 *   3. CRAFTED (overwrites prior contents) — the routine is input-independent and
 *      straight-line (no unreached arms), so the meaningful crafted case is prior
 *      contents: pre-dirty 0x6080 to 0xAA identically on both sides and confirm both
 *      land 3. Proves the store-semantics, not mere agreement on an already-3 byte.
 *   4. TEETH — a twin that writes the WRONG frame count (0x02 instead of 0x03) to
 *      SND_TRIGGER[0] MUST be caught, on every captured state and the crafted one.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1d8f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d8f as oracle } from "../../translated/loc_1d8f.js";
import { triggerWalkSound } from "../triggerWalkSound.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SND_TRIGGER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1d8f;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First RAM difference between two machines on the go-forward contract: the whole
 * state dump minus the stack scratch below the entry SP (dead scratch — the oracle's `ret` pops
 * from there but neither side writes it, and it is masked per the contract). Returns
 * {addr,a,b} or null.
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
 * Hook 0x1d8f in a real attract run and clone the machine at up to K true dispatches.
 * The attract demo plays 25m; once Mario starts walking (~f640) the move tail loc_1cc2
 * (`call c`) and the climb arm loc_1d51 (`call z`) dispatch this trigger. The wrapper
 * snapshots the entry state, then runs the oracle so the host game proceeds undisturbed.
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

const CAPS = ROM_PRESENT ? captureDispatches(48, 1600) : [];

// -- 1. EQUAL (captured dispatches) -------------------------------------------

test("EQUAL: real captured 25m dispatches — triggerWalkSound == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x1d8f dispatch during 25m attract");

  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    triggerWalkSound(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} walk=${d.b}`);
  }
  console.log(`  EQUAL: ${CAPS.length} real 25m dispatches identical (RAM −stack)`);
});

// -- 2. WRITE-SET (captured) --------------------------------------------------

test("WRITE-SET: the oracle's only work-RAM write is SND_TRIGGER[0] (0x6080) := 3", () => {
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
  // Exactly one work-RAM byte changes: SND_TRIGGER[0] := 3. (No stack write — leaf.)
  assert.equal(changed.length, 1, `oracle changed ${changed.length} bytes, expected exactly 1`);
  assert.equal(changed[0].addr, SND_TRIGGER, `oracle wrote ${hx(changed[0].addr)}, expected SND_TRIGGER[0]`);
  assert.equal(changed[0].to, 0x03, `oracle wrote ${changed[0].to} to SND_TRIGGER[0], expected 3`);
  console.log(`  WRITE-SET: 1 work-RAM byte changed — SND_TRIGGER[0] (0x6080) ${changed[0].from} -> ${changed[0].to}`);
});

// -- 3. CRAFTED (overwrites prior contents) -----------------------------------

test("CRAFTED: a pre-dirtied SND_TRIGGER[0] is overwritten with 3 identically by both sides", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  // Identical surgical nudge on BOTH sides: dirty the target byte to a non-3 value.
  o.mem.write8(SND_TRIGGER, 0xaa);
  c.mem.write8(SND_TRIGGER, 0xaa);
  oracle(o);
  triggerWalkSound(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} walk=${d.b}`);
  // ...and both genuinely landed 3 (not merely agreed on the dirt).
  assert.equal(c.mem.read8(SND_TRIGGER), 0x03, `triggerWalkSound left SND_TRIGGER[0] = ${c.mem.read8(SND_TRIGGER)} (expected 3)`);
  assert.equal(o.mem.read8(SND_TRIGGER), 0x03, "oracle should also have landed 3");
  console.log("  CRAFTED: SND_TRIGGER[0] dirtied to 0xAA -> both store 3, RAM identical");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: stores the WRONG frame count (0x02, a plausible off-by-one on the
 *  3-frame hold) into SND_TRIGGER[0] instead of 3. */
function brokenTriggerWalkSound(m) {
  m.mem.write8(SND_TRIGGER, 0x02); // BUG: must be 3
}

test("TEETH: a wrong frame count at SND_TRIGGER[0] is CAUGHT on every case", () => {
  // Captured states.
  let caughtAt = null;
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    brokenTriggerWalkSound(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    if (d) { caughtAt = d; break; }
  }
  assert.notEqual(caughtAt, null, "the gate FAILED to catch a wrong SND_TRIGGER[0] store — it is worthless");
  assert.equal(caughtAt.addr, SND_TRIGGER, `teeth caught the wrong address ${hx(caughtAt.addr ?? 0)}`);

  // Crafted dirtied state too (must be caught regardless of prior contents).
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  o.mem.write8(SND_TRIGGER, 0xaa);
  c.mem.write8(SND_TRIGGER, 0xaa);
  oracle(o);
  brokenTriggerWalkSound(c);
  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.notEqual(d, null, "the gate FAILED to catch the wrong store on the crafted state");
  assert.equal(d.addr, SND_TRIGGER, `crafted teeth caught the wrong address ${hx(d.addr ?? 0)}`);

  console.log(`  TEETH: wrong SND_TRIGGER[0] (0x6080) store caught at ${hx(caughtAt.addr)} (oracle=${caughtAt.a} broken=${caughtAt.b})`);
});
