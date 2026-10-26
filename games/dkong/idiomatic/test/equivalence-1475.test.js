// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for enterAttractMode (ROM 0x1475) — "reset into attract
 * mode": flip-screen latch 0x7D82 := 1, GAME_STATE (0x6005) := 1, ATTRACT (0x6007)
 * := 1, GAME_SUBSTATE (0x600A) := 0.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline), not the retired strict
 * whole-machine one. enterAttractMode WRITES RAM, so every case uses a FRESH clone
 * per side (never a reused machine). The oracle runs on one clone, enterAttractMode
 * on another, and they are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus the stack scratch below the entry SP) + declared live-out (none).
 *
 * NEITHER pc NOR SP is compared, and both exclusions are honest live-out, not a
 * dodge. The oracle's terminal step is `m.ret`, which pops the return address (SP+2)
 * AND sets pc to it via step(); the direct-call layer replaces that whole stack ABI
 * with a JS return, so enterAttractMode leaves pc and SP at entry. Both are dead —
 * the game-state dispatcher reloads its own context each vblank and reads no register
 * or flag this routine leaves. (This differs from silenceSound/0x011c, whose oracle
 * ends with pop16+tick and so *could* compare pc; loc_1475's `m.ret` mutates pc, so
 * here pc is dead ABI too.)
 *
 * loc_1475 reads NOTHING (no memory, no register), so its behaviour is a constant
 * independent of the entry state — the same shape as silenceSound. Its own dispatch
 * site is NOT reached in a plain attract run (loc_141e's neither-found fall-through
 * never fires there), so realistic full-machine entries are sourced at a hot
 * REACHABLE dispatch (rst 0x18 / 0x0018) and enterAttractMode is run on each; that is
 * valid precisely because the routine ignores its input. Jobs:
 *
 *   1. EQUAL (captured states) — real machine states captured at rst 0x18; on each,
 *      oracle vs enterAttractMode leave identical RAM (−STACK_SCRATCH).
 *   2. WRITE-SET (crafted) — on a pre-dirtied entry the oracle's ONLY work-RAM writes
 *      are exactly 0x6005:=1, 0x6007:=1, 0x600A:=0. Documents the diffed footprint
 *      (0x7D82 is a write-only board output, outside the RAM dump).
 *   3. CRAFTED (overwrite dirty RAM) — pre-dirty 0x6005/0x6007/0x600A to 0x77 on BOTH
 *      sides and confirm both drive them to 1/1/0, RAM identical. Proves the set-
 *      semantics (input-independence), not mere agreement on already-matching RAM.
 *   4. TEETH — two broken twins the gate MUST catch: (a) wrong GAME_STATE constant
 *      (=2), caught by RAM on every state; (b) skips clearing GAME_SUBSTATE, caught on
 *      any state whose 0x600A != 0 (the captured and the crafted-dirtied entries).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1475.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1475 as oracle } from "../../translated/loc_1475.js";
import { loc_0018 as captureSiteOracle } from "../../translated/loc_0018.js";
import { enterAttractMode } from "../enterAttractMode.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, GAME_STATE, ATTRACT, GAME_SUBSTATE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

// loc_1475's own dispatch is unreached in attract; capture realistic full-machine
// states at a hot reachable dispatch instead (valid — the routine reads no input).
const CAPTURE_SITE = 0x0018;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First RAM difference between two machines on the go-forward contract: the whole
 * 5120-byte state dump minus the stack scratch below the entry SP (dead scratch — neither side
 * writes it here, masked per the contract). Returns {addr,a,b,offset} or null.
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
 * Hook a hot REACHABLE dispatch (rst 0x18) in a real attract run and clone the
 * machine at up to K true dispatches — a source of realistic full-machine states.
 * The wrapper snapshots the entry state, then delegates to the site's own oracle so
 * the host game proceeds undisturbed.
 */
function captureStates(K, maxFrames) {
  const caps = [];
  const snap = new Map([[CAPTURE_SITE, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return captureSiteOracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureStates(48, 1500) : [];

// -- 1. EQUAL (captured states) -----------------------------------------------

test("EQUAL: real captured states — enterAttractMode == oracle in RAM (−stack)", () => {
  assert.ok(CAPS.length >= 1, "expected at least one captured machine state from the run window");

  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    enterAttractMode(c);

    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} attract=${d.b}`);
  }
  console.log(`  EQUAL: ${CAPS.length} real captured states identical (RAM −stack)`);
});

// -- 2. WRITE-SET (crafted) ---------------------------------------------------

test("WRITE-SET: the oracle's only work-RAM writes are 0x6005:=1, 0x6007:=1, 0x600A:=0", () => {
  const before = CAPS[0].clone();
  // Pre-dirty the three target work-RAM bytes so EACH store shows as a change (in a
  // raw attract capture 0x6005/0x6007 already hold 1 and would not register).
  for (const a of [GAME_STATE, ATTRACT, GAME_SUBSTATE]) before.mem.write8(a, 0x77);
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push({ addr: after.stateOffsetToAddr(off), from: b0[off], to: a1[off] });
  }
  const want = new Map([[GAME_STATE, 1], [ATTRACT, 1], [GAME_SUBSTATE, 0]]);
  for (const ch of changed) {
    assert.ok(want.has(ch.addr), `oracle wrote unexpected work-RAM addr ${hx(ch.addr)} (${ch.from}->${ch.to})`);
    assert.equal(ch.to, want.get(ch.addr), `oracle wrote ${ch.to} at ${hx(ch.addr)} (expected ${want.get(ch.addr)})`);
  }
  assert.equal(changed.length, 3, `expected exactly 3 work-RAM writes, saw ${changed.length}`);
  console.log("  WRITE-SET: 3 work-RAM writes — 0x6005:=1, 0x6007:=1, 0x600A:=0 (0x7D82 is io, off-dump)");
});

// -- 3. CRAFTED (overwrite dirty RAM) -----------------------------------------

test("CRAFTED: pre-dirtied 0x6005/0x6007/0x600A is driven to 1/1/0 identically by both sides", () => {
  const base = CAPS[0];
  const o = base.clone();
  const c = base.clone();
  // Identical surgical nudge on BOTH sides: arbitrary prior contents.
  for (const a of [GAME_STATE, ATTRACT, GAME_SUBSTATE]) {
    o.mem.write8(a, 0x77);
    c.mem.write8(a, 0x77);
  }
  oracle(o);
  enterAttractMode(c);

  const d = ramDiffMinusStack(o, c, base.regs.sp);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} attract=${d.b}`);
  // ...and both genuinely set the target values (not merely agreed).
  assert.equal(c.mem.read8(GAME_STATE), 1, "GAME_STATE must be 1");
  assert.equal(c.mem.read8(ATTRACT), 1, "ATTRACT must be 1");
  assert.equal(c.mem.read8(GAME_SUBSTATE), 0, "GAME_SUBSTATE must be 0");
  console.log("  CRAFTED: 0x6005/0x6007/0x600A dirtied to 0x77 -> both drive 1/1/0, RAM identical");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: writes the WRONG GAME_STATE constant (2 instead of 1). */
function brokenWrongState(m) {
  enterAttractMode(m);
  m.mem.write8(GAME_STATE, 2); // BUG: GAME_STATE must be 1 (attract)
}

/** Broken twin: forgets to clear GAME_SUBSTATE (leaves whatever the entry held). */
function brokenSkipSubstate(m) {
  const { mem } = m;
  mem.write8(0x7d82, 1);
  mem.write8(GAME_STATE, 1);
  mem.write8(ATTRACT, 1);
  // BUG: missing `mem.write8(GAME_SUBSTATE, 0)`.
}

test("TEETH: a wrong GAME_STATE constant is CAUGHT on every case", () => {
  // Captured states.
  let caughtAt = null;
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    brokenWrongState(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    if (d) { caughtAt = d; break; }
  }
  assert.notEqual(caughtAt, null, "the gate FAILED to catch a wrong GAME_STATE store — it is worthless");
  assert.equal(caughtAt.addr, GAME_STATE, `teeth caught the wrong address ${hx(caughtAt.addr ?? 0)}`);

  // Crafted dirtied state too (must be caught regardless of prior contents).
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  for (const a of [GAME_STATE, ATTRACT, GAME_SUBSTATE]) { o.mem.write8(a, 0x77); c.mem.write8(a, 0x77); }
  oracle(o);
  brokenWrongState(c);
  const d = ramDiffMinusStack(o, c, oFloor);
  assert.notEqual(d, null, "the gate FAILED to catch the wrong store on the crafted state");
  assert.equal(d.addr, GAME_STATE, `crafted teeth caught the wrong address ${hx(d.addr ?? 0)}`);

  console.log(`  TEETH/state: wrong GAME_STATE (0x6005) store caught at ${hx(caughtAt.addr)} (oracle=${caughtAt.a} broken=${caughtAt.b})`);
});

test("TEETH: skipping the GAME_SUBSTATE clear is CAUGHT (the 0x600A clear is tested)", () => {
  // On a crafted entry whose 0x600A != 0 the missing clear must diverge.
  const o = CAPS[0].clone();
  const oFloor = o.regs.sp;
  const c = CAPS[0].clone();
  o.mem.write8(GAME_SUBSTATE, 0x77);
  c.mem.write8(GAME_SUBSTATE, 0x77);
  oracle(o);
  brokenSkipSubstate(c);
  const d = ramDiffMinusStack(o, c, oFloor);
  assert.notEqual(d, null, "the gate FAILED to catch a missing GAME_SUBSTATE clear — the 0x600A check is worthless");
  assert.equal(d.addr, GAME_SUBSTATE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/substate: missing 0x600A clear caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
