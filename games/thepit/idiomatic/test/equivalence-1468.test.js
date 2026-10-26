// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for windUpObjectMove (ROM 0x1468) — settle the object's animation phase toward a
 * move command, deferring the frame while it settles, then dispatch the object's move handler.
 *
 * One arm of the at-rest object dispatcher (routeIdleObjectByMoveCommand), reached when the per-frame move command
 * carries a direction bit (bit 2 or bit 3). It runs the command through the animation-phase byte
 * 0x801a — a short wind-up counter packed in the byte's high bits with the command in the low bits:
 * a settled phase dispatches the move handler, a clear phase arms the wind-up then dispatches, and a
 * mid-wind-up phase steps the counter down and DEFERS the frame (snapping straight to the command
 * once it has run far enough). The dispatch splits on the command's bit 2: set -> the frame-stamp
 * handler stampFixedFrameAndResolveTile, clear -> the step-and-resolve handler stepObjectAndResolveTile.
 *
 * The declared LIVE-OUT is MEMORY-ONLY: the phase byte plus whatever the dispatched handler (or the
 * deferral record) writes. The move command is its one genuine register live-in, surfaced as the
 * moveCommand parameter (defaulting to the register, so a no-arg call reproduces the oracle); it is
 * read, never written, so it stays intact for the handlers. Registers/flags/pc/SP are excluded per
 * the honest-signature contract — the idiomatic layer does not preserve the Z80 register/step trace.
 *
 * THE STACK SCRATCH. The comparison runs the still-frozen ORACLE windUpObjectMove (every terminal a tail
 * `m.call` to the frozen handler/deferral routines) against the stack-free idiomatic routine (which
 * calls its already-idiomatic callees directly). windUpObjectMove does no stack manipulation of its own, so
 * for the arms this gate exercises the two leave byte-identical RAM including the stack; the diff
 * still excludes the standard dead-scratch window just below the entry stack pointer (The Pit's
 * stack is real diffed work RAM, ~0x83fd here) as the defensive guard for the delegated award /
 * deferral push chain — every real output sits far below the stack (0x801a plus the handlers'
 * 0x8020..0x80e7 and video RAM), so the window can hide none; the teeth confirm it.
 *
 * Checks:
 *   0. HARNESS   — capture real 0x1468 dispatches from attract; confirm the oracle run is
 *      deterministic and that all three arms (settled dispatch, wind-down, arm) occur in a real run.
 *   1. EQUAL     — windUpObjectMove == oracle over RAM across every real attract dispatch (the demo's
 *      command is always bit 2, so these settle onto / dispatch through stampFixedFrameAndResolveTile).
 *   2. EQUAL (crafted bit-3 dispatch) — force a settled bit-3 command: both dispatch the OTHER
 *      handler (stepObjectAndResolveTile), identical; and it produces a different result than the bit-2 command on
 *      the same base, proving the bit-2 dispatch really selects the handler.
 *   3. EQUAL (crafted snap wind-down) — force a mid-wind-up phase that has run far enough to snap
 *      straight to the command: both write the snapped phase and defer, identical.
 *   4. NON-VACUOUS — the arm arm actually seeds the phase byte high and the wind-down actually
 *      steps it, matching the oracle (a no-op twin cannot pass).
 *   5. TEETH (phase) — a twin that leaves the wrong settled phase on a wind-down entry is CAUGHT at
 *      the phase byte.
 *   6. TEETH (dispatch) — a twin that defers instead of dispatching on a settled entry is CAUGHT by
 *      the handler's missing writes.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-1468.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1468 as oracle } from "../../translated/loc_1468.js";
import { windUpObjectMove as idiomatic } from "../windUpObjectMove.js";
import { stageObjectSpriteRecord } from "../stageObjectSpriteRecord.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x1468;
const STACK_SCRATCH = 32; // dead-scratch window below entry SP (guards the delegated handler/award/
// deferral push chain; in practice windUpObjectMove's own arms leave the stack identical, and no real
// work-RAM output lives in 0x83xx, so the window can hide none)
const PLAYER_ANIM_PHASE = 0x801a; // the object's animation-phase byte / wind-up counter (also reset by routeIdleObjectByMoveCommand)
const BIT2_COMMAND = 0x04; // the down command attract uses (bit 2 -> stampFixedFrameAndResolveTile)
const BIT3_COMMAND = 0x08; // crafted: bit 3 -> stepObjectAndResolveTile
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build the
// factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook 0x1468 in a real attract run and clone the machine at up to K real dispatches. The wrapper
 * snapshots the entry state, then runs the oracle so the host game proceeds undisturbed.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return caps;
}

/** Which arm a captured entry lands on, from the phase byte vs the move command. */
function armOf(entry) {
  const phase = entry.mem.read8(PLAYER_ANIM_PHASE);
  const cmd = entry.regs.l;
  if (phase === cmd) return "dispatch";
  if (phase !== 0) return "wind-down";
  return "arm";
}

/**
 * First differing state byte between two machines, EXCLUDING the dead stack scratch below the entry
 * stack pointer. Null when otherwise identical. RAM-only (dumpState) — pc/SP/registers/flags are the
 * dropped, dead part of the contract.
 */
function stateDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run oracle and candidate on independent clones of `entry`; return the first differing state byte
 *  outside the stack scratch (or null). The idiomatic moveCommand defaults to the register, so a
 *  no-arg call matches the oracle's read of it. */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

// -- 0. HARNESS (reachability + determinism + arm coverage) ------------------

test("HARNESS: real 0x1468 dispatches are captured from attract, deterministic, covering all arms", () => {
  const caps = captureDispatches(200, 6000);
  assert.ok(caps.length > 0, "expected 0x1468 to be dispatched during attract");

  const a = caps[0].clone();
  oracle(a);
  const b = caps[0].clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);

  const arms = { dispatch: 0, "wind-down": 0, arm: 0 };
  for (const c of caps) arms[armOf(c)]++;
  assert.ok(arms.dispatch > 0, "expected the settled-dispatch arm in attract");
  assert.ok(arms["wind-down"] > 0, "expected the wind-down arm in attract");
  assert.ok(arms.arm > 0, "expected the arm (phase-clear) arm in attract");
  console.log(
    `  HARNESS: captured ${caps.length} real 0x1468 entries (L=${hx(caps[0].regs.l)}); ` +
      `arms dispatch=${arms.dispatch} wind-down=${arms["wind-down"]} arm=${arms.arm}; oracle deterministic`,
  );
});

// -- 1. EQUAL over every real captured attract dispatch ----------------------

test("EQUAL: windUpObjectMove leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(200, 6000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");

  for (const cap of caps) {
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (outside stack scratch)`);
});

// -- 2. EQUAL crafted: a settled bit-3 command dispatches the OTHER handler ---

test("EQUAL (crafted bit-3): a settled bit-3 command dispatches stepObjectAndResolveTile, identical + distinct from bit-2", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft from");

  // A settled bit-3 command: phase already equals the command, so it dispatches immediately.
  const bit3 = base.clone();
  bit3.regs.l = BIT3_COMMAND;
  bit3.mem.write8(PLAYER_ANIM_PHASE, BIT3_COMMAND);
  const d = stateDiff(bit3, idiomatic);
  assert.equal(d, null, d && `bit-3: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  // The same base with a settled bit-2 command must produce a DIFFERENT result at a HANDLER-written
  // byte — otherwise the dispatch is not actually branching on bit 2. Skip the phase byte itself,
  // which trivially differs because the two settled commands seed it differently; the meaningful
  // difference is in the geometry/sprite the two handlers write (they compute the column oppositely).
  const bit2 = base.clone();
  bit2.regs.l = BIT2_COMMAND;
  bit2.mem.write8(PLAYER_ANIM_PHASE, BIT2_COMMAND);
  const r3 = bit3.clone(); idiomatic(r3);
  const r2 = bit2.clone(); idiomatic(r2);
  const da = r2.dumpState();
  const db = r3.dumpState();
  let handlerDiff = null;
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = r2.stateOffsetToAddr(i);
    if (addr === PLAYER_ANIM_PHASE) continue; // the input phase byte, not a handler output
    handlerDiff = addr;
    break;
  }
  assert.notEqual(handlerDiff, null, "bit-2 and bit-3 wrote identical handler output — bit 2 is not selecting the handler");
  console.log(`  EQUAL/bit-3: settled bit-3 -> stepObjectAndResolveTile identical to the oracle; differs from bit-2 at ${hx(handlerDiff)}`);
});

// -- 3. EQUAL crafted: a wind-down that snaps straight to the command --------

test("EQUAL (crafted snap wind-down): a run-down counter snaps to the command and defers, identical", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft from");

  // phase 0x10 with command 0x04: stepping down leaves the command out of the low bits, so the
  // routine snaps the phase straight to the command (the sub-branch attract's bit-2 wind-up never hits).
  const e = base.clone();
  e.regs.l = BIT2_COMMAND;
  e.mem.write8(PLAYER_ANIM_PHASE, 0x10);

  const probe = e.clone();
  oracle(probe);
  assert.equal(probe.mem.read8(PLAYER_ANIM_PHASE), BIT2_COMMAND, "snap craft did not snap the phase to the command on the oracle");

  const d = stateDiff(e, idiomatic);
  assert.equal(d, null, d && `snap: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL/snap: wind-down snapped the phase to the command and deferred; identical to the oracle");
});

// -- 4. NON-VACUOUS: the arm/wind-down arms actually move the phase byte -----

test("NON-VACUOUS: the arm arm seeds the phase high and the wind-down arm steps it, matching the oracle", () => {
  const caps = captureDispatches(200, 6000);
  const seed = caps.find((c) => armOf(c) === "arm");
  const wind = caps.find((c) => armOf(c) === "wind-down");
  assert.ok(seed, "need a captured arm (phase-clear) entry");
  assert.ok(wind, "need a captured wind-down entry");

  // Arm arm: phase clear -> armed to command | 0xc0 (bit 2 command -> 0xc4).
  const s = seed.clone();
  idiomatic(s);
  assert.equal(s.mem.read8(PLAYER_ANIM_PHASE), seed.regs.l | 0xc0, "arm arm did not seed the phase to command | 0xc0");
  assert.equal(stateDiff(seed, idiomatic), null, "arm arm must also match the oracle");

  // Wind-down arm: phase steps down one notch (0x20) from where it was.
  const startPhase = wind.mem.read8(PLAYER_ANIM_PHASE);
  const w = wind.clone();
  idiomatic(w);
  assert.equal(w.mem.read8(PLAYER_ANIM_PHASE), (startPhase - 0x20) & 0xff, "wind-down arm did not step the phase down by 0x20");
  assert.equal(stateDiff(wind, idiomatic), null, "wind-down arm must also match the oracle");

  console.log(
    `  NON-VACUOUS: arm ${hx(seed.regs.l)} -> phase ${hx(seed.regs.l | 0xc0)}; ` +
      `wind-down ${hx(startPhase)} -> ${hx((startPhase - 0x20) & 0xff)}; arms agree`,
  );
});

// -- 5. TEETH (phase): a wrong settled phase on a wind-down entry is CAUGHT ---

/** Broken twin: runs the routine, then corrupts the resulting phase byte. */
function twinWrongPhase(m) {
  idiomatic(m);
  m.mem.write8(PLAYER_ANIM_PHASE, m.mem.read8(PLAYER_ANIM_PHASE) ^ 0xff);
}

test("TEETH (phase): a twin that leaves the wrong wind-down phase is CAUGHT at the phase byte", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to seed the teeth check");

  // A wind-down entry (phase 0xc4 with command 0x04 steps to 0xa4).
  const e = base.clone();
  e.regs.l = BIT2_COMMAND;
  e.mem.write8(PLAYER_ANIM_PHASE, 0xc4);

  const d = stateDiff(e, twinWrongPhase);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong wind-down phase — it proves nothing");
  assert.equal(d.addr, PLAYER_ANIM_PHASE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_ANIM_PHASE)})`);
  assert.equal(stateDiff(e, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/phase: wrong wind-down phase caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 6. TEETH (dispatch): deferring instead of dispatching is CAUGHT ---------

/** Broken twin: defers the frame instead of dispatching the settled move handler (skips the handler
 *  entirely — the frame-stamp / step-and-resolve geometry and sprite writes go missing). */
function twinDeferNotDispatch(m) {
  return stageObjectSpriteRecord(m);
}

test("TEETH (dispatch): a twin that defers instead of dispatching is CAUGHT by the handler's missing writes", () => {
  const caps = captureDispatches(200, 6000);
  const settled = caps.find((c) => armOf(c) === "dispatch");
  assert.ok(settled, "need a captured settled-dispatch entry to seed the teeth check");

  const d = stateDiff(settled, twinDeferNotDispatch);
  assert.notEqual(d, null, "the gate FAILED to catch the skipped-dispatch twin — it proves nothing");
  assert.equal(stateDiff(settled, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/dispatch: defer-not-dispatch twin caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});
