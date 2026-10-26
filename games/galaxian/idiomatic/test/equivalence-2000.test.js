// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_2000 (enterMainLoop) -- equivalence vs the frozen translated oracle. Entry is captured at the real
 * cold-boot dispatch of 0x2000. Compared: RAM minus stack scratch below the entry SP, plus the board io; no
 * register live-out (0x200a reloads HL, B is rewritten before any read). Bound: the oracle's clear loop hands off by m.call(0x200a);
 * a sentinel installed there on both sides stops it; the idiomatic side must return a mainLoop generator
 * without hitting it. The score/HUD block is poked non-zero on both sides so the clear is observable.
 * Teeth: twins clearing 0x1d bytes, starting one byte late or early (each caught at its cell), or returning no
 * generator. (A pass already advanced is not observable here: one mainLoop pass leaves this state's RAM unchanged.)
 */
import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, STACK_SCRATCH, romsPresent } from "./_harness.js";
import { oracleRoutines, ioOf, liveFloor } from "./_coldBoot.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { buildRoutines } from "../../routines.js";
import { enterMainLoop as cand } from "../enterMainLoop.js";
import { mainLoop } from "../mainLoop.js";
import { PLAYER1_SCORE_BCD } from "../names.js";
import { loc_2000 as oracle } from "../../translated/loc_2000.js";

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const HANDOFF = 0x200a;
const SENTINEL = Symbol("main-loop hand-off");

let entry = null;
function capture() {
  if (entry) return entry;
  const m = makeMachine();
  const r = oracleRoutines();
  const wired = r.get(0x2000);
  const seen = [];
  r.set(0x2000, (mm, ...a) => { seen.push(mm.clone()); return wired(mm, ...a); });
  m.routines = r;
  m.call(0x0000);
  assert.equal(seen.length, 1, "positive control: the cold boot dispatches 0x2000 exactly once");
  entry = seen[0];
  return entry;
}

function poked(base) {
  const e = base.clone();
  for (let i = 0; i < 0x1e; i++) e.mem8[PLAYER1_SCORE_BCD + i] = 0x5a ^ i;
  return e;
}

function run(fn, e) {
  const m = e.clone();
  const r = buildRoutines();
  r.set(HANDOFF, () => { throw SENTINEL; });
  m.routines = r;
  try { return { m, ret: fn(m), stopped: false }; } catch (x) {
    if (x !== SENTINEL) throw x;
    return { m, ret: undefined, stopped: true };
  }
}

/** First divergence oracle vs candidate (RAM minus stack scratch below the entry SP, then io), or null. */
function compare(fn, e) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor(e));
  const a = run(oracle, e);
  if (!a.stopped) return "positive control: the oracle did not reach the 0x200a hand-off";
  const b = run(fn, e);
  if (b.stopped) return "candidate ran the translated main loop";
  if (Object.getPrototypeOf(b.ret ?? {}) !== mainLoop.prototype) return "candidate did not return a mainLoop generator";
  const A = a.m.dumpState(), B = b.m.dumpState();
  for (let i = 0; i < A.length; i++) {
    if (A[i] === B[i]) continue;
    const addr = a.m.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return `ram 0x${addr.toString(16)}: ${A[i]} vs ${B[i]}`;
  }
  const x = JSON.stringify(ioOf(a.m)), y = JSON.stringify(ioOf(b.m));
  return x === y ? null : `io ${x} vs ${y}`;
}

test("EQUAL at the real cold-boot dispatch (raw and with the scratch block poked)", { skip }, () => {
  assert.equal(compare(cand, capture()), null, "raw capture");
  const e = poked(capture());
  assert.equal(compare(cand, e), null, "poked capture");
  const o = run(oracle, e).m;
  for (let i = 0; i < 0x1e; i++) assert.equal(o.mem8[PLAYER1_SCORE_BCD + i], 0, "oracle clears the block");
  assert.notEqual(o.mem8[PLAYER1_SCORE_BCD - 1], 0, "neighbour below is non-zero, so an early start shows");
  assert.notEqual(o.mem8[PLAYER1_SCORE_BCD + 0x1e], 0, "neighbour above is non-zero, so an overrun shows");
});

test("TEETH: broken twins are caught at real cells", { skip }, () => {
  const twin = (start, n) => (m) => {
    for (let i = 0; i < n; i++) m.mem8[start + i] = 0;
    return mainLoop(m);
  };
  const e = poked(capture());
  assert.match(compare(twin(PLAYER1_SCORE_BCD, 0x1d), e) ?? "", /^ram 0x40bf:/, "0x1d-byte twin escaped");
  assert.match(compare(twin(PLAYER1_SCORE_BCD + 1, 0x1e), e) ?? "", /^ram 0x40a2:/, "late-start twin escaped");
  assert.match(compare(twin(PLAYER1_SCORE_BCD - 1, 0x1e), e) ?? "", /^ram 0x40a1:/, "early-start twin escaped");
  assert.match(compare((m) => { cand(m); return undefined; }, e) ?? "", /mainLoop generator/, "no-handoff twin escaped");
});
