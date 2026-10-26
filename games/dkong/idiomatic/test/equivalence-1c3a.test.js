// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1c3a (ROM 0x1C3A) — the airborne handler's counter tick:
 * settle the landing when the mover's object-counter reaches zero, otherwise arm the
 * land-check phase and zero the ballistic state, then refresh Mario's sprite record.
 *
 * loc_1c3a is entered from the airborne handler (entry_1c05, still the frozen oracle) by
 * a tail branch, with the object-counter in one register and the landing flag in another.
 * The idiomatic routine keeps that register boundary (its caller is oracle) and dissolves
 * both tail jumps into direct calls to the two already-idiomatic callees:
 *
 *   - counter tick reaches 0  -> loc_1c4f (landing settle; itself tail-refreshes the sprite)
 *   - counter tick nonzero    -> arm MARIO_AIR_LANDCHECK, zero the 5-byte ballistic block,
 *                                then writeMarioSpriteRecord (the mover's convergence tail)
 *
 * MEMORY-EQUIVALENCE CONTRACT. The oracle chain reaches its exit through a single terminal
 * `ret` (entry_1da6's), and on the landing arm's pending-pickup path entry_1c4f `push16`s a
 * return address that sub_1d95 pops — a balanced bracket the idiomatic layer models with the
 * JS call stack, so those pushed bytes are DEAD scratch the candidate never writes. The gate
 * therefore compares RAM MINUS the stack scratch below the entry SP [0x6be0,0x6c00), plus pc and SP, and the
 * candidate performs ONE m.ret() after running to line pc + SP up with the oracle's terminal
 * ret. Live-out is memory-only; the counter and landing registers are dead past the branch.
 *
 *   1. REALISM (captured) — hook 0x1C3A in a real attract run (the airborne handler runs
 *      while the 25m demo jumps), clone at each dispatch, and confirm loc_1c3a reproduces
 *      the oracle chain on every real state the game actually produces.
 *
 *   2. EQUAL (crafted) — a real attract base + a surgical register/RAM nudge, identically on
 *      both sides, to reach: the still-airborne arm with a nonzero landing register (pins the
 *      land-check +1), the airborne arm with the register 0 (the in-play value -> stores 1),
 *      the counter=0 non-landing case (register wrap, proving the branch is dec-to-zero not
 *      b<=1), the landing arm with NO pending pickup, and the landing arm WITH a pending
 *      pickup (drives loc_1c4f -> loc_1d95, whose dissolved push16/ret makes the STACK_SCRATCH
 *      exclusion load-bearing — asserted directly).
 *
 *   3. TEETH — three broken twins, each MUST be caught by the same suite:
 *      (a) dropped land-check +1  (stores the register, not register+1) — caught at 0x621F.
 *      (b) skipped ballistic clear (leaves MARIO_AIR_FRAMES)            — caught at 0x6214.
 *      (c) inverted counter branch (lands when it should stay airborne) — caught at 0x6216.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1c3a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1c3a as oracle } from "../../translated/loc_1c3a.js";
import { loc_1c3a } from "../loc_1c3a.js";
import { settleMarioOnLanding as loc_1c4f } from "../settleMarioOnLanding.js";
import { writeMarioSpriteRecord } from "../writeMarioSpriteRecord.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_AIR_LANDCHECK,
  MARIO_AIR_VX_HI,
  MARIO_AIR_VX_LO,
  MARIO_AIR_VY_HI,
  MARIO_AIR_VY_LO,
  MARIO_AIR_FRAMES,
  MARIO_AIRBORNE,
  ITEM_COLLECTED,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1c3a;
const RET_ADDR = 0x1c08; // a plausible caller-return for crafted entries (entry_1c05's site)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
// (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
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

// First RAM byte that differs INCLUDING the stack — used to prove the STACK_SCRATCH
// exclusion is genuinely load-bearing on the dissolved-push path (not a vacuous exclusion).
function firstAnyRamDiff(a, b) {
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    return { addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] };
  }
  return null;
}

/** Run the ORACLE on a fresh clone; it performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model the oracle's single terminal `ret` with one
 * m.ret() so pc + SP line up (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself). Every path through loc_1c3a nets exactly one
 * terminal ret, so this is one ret on both arms.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A real, self-consistent machine: boot + a stretch of attract so work RAM (Mario's fields,
// the sprite buffer, the object counter) holds realistic values. The specific arms are then
// reached by a surgical register/RAM poke, identically on both sides.
function attractBase(frames = 400) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

// Stamp a crafted 0x1C3A dispatch onto a clone of the base: a defined stack with a plausible
// caller-return (so the terminal ret has a sane target), the counter (b) and landing flag (a)
// the mover would have supplied in registers, and the pending-pickup latch.
function craft(base, { b, a = 0, item = 0, airFrames } = {}) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.b = b;
  m.regs.a = a;
  m.mem.write8(ITEM_COLLECTED, item);
  if (airFrames !== undefined) m.mem.write8(MARIO_AIR_FRAMES, airFrames);
  return m;
}

// -- 1. REALISM (captured) ----------------------------------------------------

test("REALISM: real captured 0x1C3A dispatches — loc_1c3a matches the oracle chain", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 200) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1C3A dispatch during attract");

  let sawLand = 0, sawAir = 0;
  for (const entry of caps) {
    const diffs = contractDiffs(entry, loc_1c3a);
    assert.equal(diffs.length, 0, `captured dispatch: ${diffs.join("; ")}`);
    // Classify which arm the oracle took (landing settles MARIO_AIRBORNE) for reporting.
    if (runOracle(entry).mem.read8(MARIO_AIRBORNE) !== entry.mem.read8(MARIO_AIRBORNE)) sawLand++;
    else sawAir++;
  }
  console.log(`  REALISM: ${caps.length} real 0x1C3A dispatches identical to the oracle (${sawLand} landing, ${sawAir} airborne)`);
});

// -- 2. EQUAL (crafted, all arms) ---------------------------------------------

test("EQUAL (crafted): the airborne, counter-wrap, and landing arms all match the oracle", () => {
  const base = attractBase();

  const cases = [
    // still airborne, nonzero landing register -> MARIO_AIR_LANDCHECK = register + 1
    { name: "airborne, landing-reg 5", opts: { b: 3, a: 0x05 } },
    // still airborne, register 0 (the in-play value) -> MARIO_AIR_LANDCHECK = 1
    { name: "airborne, landing-reg 0", opts: { b: 2, a: 0x00 } },
    // counter register 0 -> dec wraps to 255, NOT zero -> still airborne (not landing)
    { name: "counter wrap (b=0)", opts: { b: 0x00, a: 0x00 } },
    // counter ticks to zero, no pending pickup -> loc_1c4f no-pickup arm
    { name: "landing, no pickup", opts: { b: 1, a: 0x00, item: 0 } },
    // counter ticks to zero WITH a pending pickup -> loc_1c4f -> loc_1d95 (dissolved push16)
    { name: "landing, pending pickup", opts: { b: 1, a: 0x00, item: 1 } },
  ];

  for (const { name, opts } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_1c3a);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }

  // The STACK_SCRATCH exclusion is load-bearing, not vacuous: on the pending-pickup arm the
  // oracle's entry_1c4f push16(0x1c73) writes stack bytes the idiomatic layer never touches,
  // so the ONLY oracle/candidate difference is inside STACK_SCRATCH. Prove it.
  const pickup = craft(base, { b: 1, a: 0x00, item: 1 });
  const o = runOracle(pickup);
  const c = runCandidate(pickup, loc_1c3a);
  const anyDiff = firstAnyRamDiff(o, c);
  assert.notEqual(anyDiff, null, "expected the dissolved push16 to leave a stack-scratch difference");
  assert.ok(deadStackBelow(STACK_SCRATCH, pickup.regs.sp)(anyDiff.addr), `the only RAM difference must be in the stack scratch below the entry SP, got ${hx(anyDiff.addr)}`);

  console.log(`  EQUAL/crafted: ${cases.length} arms identical; pickup-arm push16 difference confined to STACK_SCRATCH (${hx(anyDiff.addr)})`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): stores the landing register itself, dropping the +1. */
function brokenNoLandcheckInc(m) {
  const { regs, mem } = m;
  const airCounter = regs.b - 1;
  if (airCounter === 0) { loc_1c4f(m); return; }
  mem.write8(MARIO_AIR_LANDCHECK, regs.a); // BUG: dropped + 1
  mem.write8(MARIO_AIR_VX_HI, 0);
  mem.write8(MARIO_AIR_VX_LO, 0);
  mem.write8(MARIO_AIR_VY_HI, 0);
  mem.write8(MARIO_AIR_VY_LO, 0);
  mem.write8(MARIO_AIR_FRAMES, 0);
  writeMarioSpriteRecord(m);
}

/** Broken twin (b): skips zeroing the airborne-frame count. */
function brokenSkipAirFrames(m) {
  const { regs, mem } = m;
  const airCounter = regs.b - 1;
  if (airCounter === 0) { loc_1c4f(m); return; }
  mem.write8(MARIO_AIR_LANDCHECK, regs.a + 1);
  mem.write8(MARIO_AIR_VX_HI, 0);
  mem.write8(MARIO_AIR_VX_LO, 0);
  mem.write8(MARIO_AIR_VY_HI, 0);
  mem.write8(MARIO_AIR_VY_LO, 0);
  // BUG: MARIO_AIR_FRAMES left untouched
  writeMarioSpriteRecord(m);
}

/** Broken twin (c): inverts the counter branch — lands when it should stay airborne. */
function brokenInvertedBranch(m) {
  const { regs, mem } = m;
  const airCounter = regs.b - 1;
  if (airCounter !== 0) { loc_1c4f(m); return; } // BUG: inverted test
  mem.write8(MARIO_AIR_LANDCHECK, regs.a + 1);
  mem.write8(MARIO_AIR_VX_HI, 0);
  mem.write8(MARIO_AIR_VX_LO, 0);
  mem.write8(MARIO_AIR_VY_HI, 0);
  mem.write8(MARIO_AIR_VY_LO, 0);
  mem.write8(MARIO_AIR_FRAMES, 0);
  writeMarioSpriteRecord(m);
}

test("TEETH: dropped land-check +1, skipped ballistic clear, and inverted branch are CAUGHT", () => {
  const base = attractBase();

  // (a) dropped +1: airborne arm with landing-reg 5 -> oracle 6 vs twin 5 at MARIO_AIR_LANDCHECK.
  const incEntry = craft(base, { b: 3, a: 0x05 });
  const incDiffs = contractDiffs(incEntry, brokenNoLandcheckInc);
  assert.ok(incDiffs.length > 0, "the dropped-+1 twin escaped — the gate is worthless");
  assert.ok(incDiffs[0].startsWith(`RAM@${hx(MARIO_AIR_LANDCHECK)}`), `expected the diff at ${hx(MARIO_AIR_LANDCHECK)}, got ${incDiffs[0]}`);

  // (b) skipped ballistic clear: airborne arm with MARIO_AIR_FRAMES poked nonzero -> oracle 0
  //     vs twin's leftover value at 0x6214.
  const afEntry = craft(base, { b: 3, a: 0x00, airFrames: 0x0a });
  const afDiffs = contractDiffs(afEntry, brokenSkipAirFrames);
  assert.ok(afDiffs.length > 0, "the skipped-ballistic-clear twin escaped — the gate is worthless");
  assert.ok(afDiffs[0].startsWith(`RAM@${hx(MARIO_AIR_FRAMES)}`), `expected the diff at ${hx(MARIO_AIR_FRAMES)}, got ${afDiffs[0]}`);

  // (c) inverted branch: landing arm (b=1) -> oracle settles the landing (writes MARIO_AIRBORNE),
  //     twin runs the airborne arm instead, so 0x6216 (and more) diverge.
  const invEntry = craft(base, { b: 1, a: 0x00, item: 0 });
  const invDiffs = contractDiffs(invEntry, brokenInvertedBranch);
  assert.ok(invDiffs.length > 0, "the inverted-branch twin escaped — the gate is worthless");

  console.log(`  TEETH: dropped-+1 caught (${incDiffs[0]}); skipped-clear caught (${afDiffs[0]}); inverted-branch caught (${invDiffs[0]})`);
});
