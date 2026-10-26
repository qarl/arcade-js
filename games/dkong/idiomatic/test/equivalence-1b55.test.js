// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for tickPostLandingFreeze (ROM 0x1b55) — the movement-machine branch
 * that counts down Mario's post-landing freeze and, on expiry, unfreezes him.
 *
 * The routine WRITES MEMORY and both its arms exit through a single net `ret` (the
 * early-return arm does `ret nz`; the expiry arm tail-jumps to 0x1da6, which `ret`s), so
 * it is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never on a
 * register file (its live-out is memory-only; see the routine header), and every case
 * runs on a FRESH clone (a reused clone is only safe for a read-only leaf; this writes).
 * The idiomatic routine models the Z80 `ret` as a JS return and touches no pc/SP, so the
 * harness performs ONE m.ret() on the candidate clone after the call to line pc + SP up
 * with the oracle — both arms pop exactly one return address, out of STACK_SCRATCH.
 *
 *   1. EQUAL (real dispatches) — hook 0x1b55 in a real attract run. Each of attract's
 *      landings drives the timer 4->3->2->1 (early-return arm) then 1->0 (expiry arm), so
 *      real captures cover BOTH arms; oracle vs candidate must agree on RAM + pc + SP for
 *      every one. The test asserts both arms were actually seen so neither passes vacuously.
 *
 *   2. EQUAL (crafted source bytes) — attract enters the expiry arm with HAMMER_PENDING /
 *      WALK_ANIM already 0 and SPRITE_CODE a constant 0x8f, so the copy/clear writes are
 *      not pinned by real data alone. Poke MARIO_FREEZE_TIMER to force each arm and the
 *      three source fields to distinct sentinels, so the 0x6218->0x6217 copy, the &0x80
 *      strip, and the 0x6202 clear are each proven against the oracle.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught on REAL dispatches:
 *      (a) wrong-mask — keeps `& 0x7f` (strips the facing bit) instead of `& 0x80`;
 *          diverges on every expiry dispatch (real SPRITE_CODE 0x8f -> 0x0f vs 0x80).
 *      (b) no-early-return — runs the expiry block even while the timer is still nonzero;
 *          diverges on every early-return dispatch (strips SPRITE_CODE it must leave alone).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1b55.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1b55 as oracle } from "../../translated/loc_1b55.js";
import { tickPostLandingFreeze } from "../tickPostLandingFreeze.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_FREEZE_TIMER, MARIO_HAMMER_PENDING, MARIO_HAMMER_ACTIVE,
  MARIO_SPRITE_CODE, MARIO_WALK_ANIM,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1b55;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the dead
 * stack region the standard gate excludes. The oracle's `ret` pops a return address out
 * of this region; the idiomatic routine (JS call stack) never writes it, so excluding it
 * is exactly the contract, not a fudge.
 */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone. Its net `ret` (direct on the early arm, via the
 *  0x1da6 tail-jump on the expiry arm) advances pc/SP. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its single net return with ONE m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it never touches pc/SP itself — the harness supplies the one net return
 * that BOTH arms perform).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO
 *  registers — the live-out is memory-only, and comparing the oracle's dead residual
 *  A/HL/flags would fail on values nothing reads. Returns human-readable mismatches. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x1b55 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. dispatchMarioMovement reaches 0x1b55 by `m.call(0x1b55)` (a tail-jump), which resolves
 * through the routine registry the override overlays, so every dispatch is captured here.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** The enter-arm of a captured/crafted state: the timer BEFORE the decrement. Value 1
 *  takes the expiry arm (dec -> 0); anything else takes the early-return arm. */
const entersExpiryArm = (m) => m.mem.read8(MARIO_FREEZE_TIMER) === 1;

/** A real captured state with the freeze timer + the three expiry source fields poked to
 *  sentinels, and a safe SP so the ret's pop lands in STACK_SCRATCH, clear of work RAM. */
function craft(seed, { timer, pending, code, walk }) {
  const e = seed.clone();
  e.mem.write8(MARIO_FREEZE_TIMER, timer);
  e.mem.write8(MARIO_HAMMER_PENDING, pending);
  e.mem.write8(MARIO_SPRITE_CODE, code);
  e.mem.write8(MARIO_WALK_ANIM, walk);
  e.regs.sp = 0x6bfe;
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** Broken twin (a): WRONG MASK — keeps `& 0x7f` (drops the facing bit 7) instead of
 *  `& 0x80` on the sprite code. Diverges on the expiry arm whenever SPRITE_CODE has bit 7
 *  set (real attract code is 0x8f: 0x8f&0x80=0x80 vs 0x8f&0x7f=0x0f). */
function brokenWrongMask(m) {
  const { mem } = m;
  const remaining = (mem.read8(MARIO_FREEZE_TIMER) - 1) & 0xff;
  mem.write8(MARIO_FREEZE_TIMER, remaining);
  if (remaining !== 0) return;
  mem.write8(MARIO_HAMMER_ACTIVE, mem.read8(MARIO_HAMMER_PENDING));
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) & 0x7f); // BUG: 0x7f, not 0x80
  mem.write8(MARIO_WALK_ANIM, 0);
  writeMarioSpriteRecord(m);
}

/** Broken twin (b): NO EARLY RETURN — always runs the expiry unfreeze, even while the
 *  timer is still nonzero. Diverges on every early-return dispatch (it strips SPRITE_CODE
 *  and refreshes the sprite record when the oracle only decrements the timer). */
function brokenNoEarlyReturn(m) {
  const { mem } = m;
  const remaining = (mem.read8(MARIO_FREEZE_TIMER) - 1) & 0xff;
  mem.write8(MARIO_FREEZE_TIMER, remaining);
  // BUG: missing `if (remaining !== 0) return;`
  mem.write8(MARIO_HAMMER_ACTIVE, mem.read8(MARIO_HAMMER_PENDING));
  mem.write8(MARIO_SPRITE_CODE, mem.read8(MARIO_SPRITE_CODE) & 0x80);
  mem.write8(MARIO_WALK_ANIM, 0);
  writeMarioSpriteRecord(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): tickPostLandingFreeze == oracle on every captured 0x1b55 entry", () => {
  const caps = captureDispatches(256, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1b55 dispatch during attract");

  const expiry = caps.filter(entersExpiryArm);
  const early = caps.filter((c) => !entersExpiryArm(c));
  assert.ok(expiry.length >= 1, "expected at least one real EXPIRY-arm dispatch (timer 1 -> 0)");
  assert.ok(early.length >= 1, "expected at least one real EARLY-RETURN-arm dispatch (timer > 1)");

  for (const cap of caps) {
    const diffs = contractDiffs(cap, tickPostLandingFreeze); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP ` +
      `(${expiry.length} expiry arm, ${early.length} early-return arm)`,
  );
});

// -- 2. EQUAL (crafted source bytes) ------------------------------------------

test("EQUAL (crafted): forced arms + distinct sentinels pin the copy / strip / clear", () => {
  const caps = captureDispatches(1, 4000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  const cases = [
    // Expiry arm (timer 1 -> 0): distinct sentinels prove each expiry write.
    { name: "expiry: all fields distinct, code bit7 set",  e: craft(seed, { timer: 1, pending: 0x77, code: 0x8c, walk: 0x0a }) },
    { name: "expiry: code bit7 clear (strip -> 0x00)",     e: craft(seed, { timer: 1, pending: 0x01, code: 0x0f, walk: 0x02 }) },
    { name: "expiry: pending 0xff, code/walk extremes",    e: craft(seed, { timer: 1, pending: 0xff, code: 0xff, walk: 0xff }) },
    // Early-return arm (timer > 1 -> nonzero): only the timer must change.
    { name: "early-return: timer 5 -> 4",                  e: craft(seed, { timer: 0x05, pending: 0x77, code: 0x8c, walk: 0x0a }) },
    { name: "early-return: timer 2 -> 1 (edge)",           e: craft(seed, { timer: 0x02, pending: 0x33, code: 0x44, walk: 0x55 }) },
    // Wrap edge: timer 0 -> 0xff (nonzero), faithful to `dec (hl)`.
    { name: "wrap: timer 0 -> 0xff (early-return)",        e: craft(seed, { timer: 0x00, pending: 0x33, code: 0x44, walk: 0x55 }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, tickPostLandingFreeze);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} forced-arm sentinel entries identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-mask twin and the no-early-return twin are CAUGHT", () => {
  const caps = captureDispatches(256, 4000);
  assert.ok(caps.length >= 1, "need real captures for the teeth check");
  const expiry = caps.filter(entersExpiryArm);
  const early = caps.filter((c) => !entersExpiryArm(c));
  assert.ok(expiry.length >= 1 && early.length >= 1, "need both arms captured to prove the teeth");

  // (a) wrong-mask must be caught on EVERY expiry dispatch (real code is 0x8f -> bit7 set).
  let caughtMask = 0;
  for (const c of expiry) if (contractDiffs(c, brokenWrongMask).length > 0) caughtMask++;
  assert.equal(caughtMask, expiry.length,
    `wrong-mask escaped on ${expiry.length - caughtMask}/${expiry.length} expiry dispatches`);

  // (b) no-early-return must be caught on EVERY early-return dispatch.
  let caughtNoRet = 0;
  for (const c of early) if (contractDiffs(c, brokenNoEarlyReturn).length > 0) caughtNoRet++;
  assert.equal(caughtNoRet, early.length,
    `no-early-return escaped on ${early.length - caughtNoRet}/${early.length} early-return dispatches`);

  console.log(
    `  TEETH: wrong-mask caught on all ${expiry.length} expiry dispatches; ` +
      `no-early-return caught on all ${early.length} early-return dispatches`,
  );
});
