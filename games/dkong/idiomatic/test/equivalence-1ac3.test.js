// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchMarioMovement (ROM 0x1AC3) — the movement machine's router: five tests in a
 * fixed priority order that pick which handler owns Mario's frame.
 *
 * dispatchMarioMovement writes nothing itself, so a gate that only diffed its own footprint would compare
 * two empty sets and pass no matter which arm it picked. What is gated instead is the ROUTING:
 * both sides run the WHOLE downstream cascade of the arm they chose — the frozen oracle end to
 * end on the reference side, all five idiomatic handlers plus their still-oracle remainders on
 * the candidate side — so a mis-routed frame surfaces as divergent RAM inside the handler.
 *
 * CONTRACT COMPARED: RAM − the stack scratch below the entry SP, plus the return value. Registers and pc/SP are NOT
 * in the contract, and this file measures that rather than asserting it:
 *
 *   - REGISTERS. All five handlers are idiomatic and drop the oracle's dead register dance, so
 *     a/f/b/c/d/e/h/l differ on some arms (the airborne arm inherits exactly the C residue
 *     advanceMarioAirborneFrame's own gate already declares dead). The LIVE-OUT test below
 *     proves they are dead instead of taking it on trust: after every captured dispatch it
 *     continues the CALLER's own cascade — the next four routines ROM 0x197A runs after this
 *     one — on both machines and requires RAM to still agree. A live register or flag would
 *     fork there; none does.
 *   - pc/SP. The idiomatic handlers model the Z80 `ret` as a plain JS return, so each arm
 *     leaves an SP residue of 0 or −2 bytes depending on whether its chain happened to end in
 *     still-oracle code that returned or in an idiomatic routine that did not. The test prints
 *     the measured per-arm residue and asserts only what the dropped stack model actually
 *     claims — that both stack pointers stay inside the dead STACK_SCRATCH region.
 *
 *   1. REACHABILITY — 0x1AC3 needs NO crafting for arm coverage. A plain 2000-frame attract
 *      run (no coin, no pokes, no tape) dispatches it 1197x and the demo alone drives ALL SIX
 *      arms: the ground fall-through, the hammer arm, the airborne arm, the ladder arm, the
 *      post-landing freeze arm and the jump-press arm. The test asserts every arm was seen, so
 *      the coverage claim cannot go stale silently.
 *
 *   2. EQUAL (captured) — replay every one of those real dispatches oracle-vs-candidate.
 *
 *   3. LIVE-OUT (dead registers, measured) — the caller-cascade continuation described above.
 *
 *   4. EQUAL (selector sweeps) — from a real grounded capture, drive each of the five selector
 *      cells over all 256 values, comparing both sides every time. This pins the exact
 *      predicates the oracle uses rather than plausible ones: each of the three flag tests
 *      fires on the value 1 ALONE (255 of 256 values fall through), the freeze test fires on
 *      any nonzero, and the jump test looks at the input word's top bit only (exactly 128 of
 *      256 values jump). The arm histogram is asserted, so a relaxed predicate fails here.
 *
 *   5. EQUAL (priority, crafted) — real captures with a second selector poked on, so two tests
 *      fire at once: airborne+freeze, hammer+jump-edge, hammer+ladder, ladder+jump-edge,
 *      freeze+hammer. These are the states the demo never produces and the ones a reordered
 *      router would get wrong.
 *
 *   6. TEETH — five broken twins, each required to be caught at a live cell:
 *      (a) relaxed-airborne — the airborne test accepts any nonzero instead of exactly 1;
 *          invisible on real dispatches (the flag is only ever 0 or 1) and caught by the
 *          AIRBORNE sweep, which is precisely why the sweep is in the gate.
 *      (b) jump-bit0 — the jump edge read as bit 0 (Right) instead of bit 7; caught on real
 *          dispatches, because the demo walks right constantly.
 *      (c) no-ladder — the ladder arm dropped so climbs fall through to ground movement;
 *          caught on real ladder dispatches.
 *      (d) hammer-below-jump — the hammer arm moved below the jump test, so a hammer-carrying
 *          Mario could jump; caught on crafted hammer+jump-edge and hammer+ladder states.
 *      (e) freeze-first — the priority inverted so the post-landing freeze outranks airborne;
 *          caught on a crafted airborne+freeze state.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1ac3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1ac3 as oracle } from "../../translated/loc_1ac3.js";
import { dispatchMarioMovement as candidate } from "../dispatchMarioMovement.js";
import { advanceMarioAirborneFrame } from "../advanceMarioAirborneFrame.js"; // ROM 0x1BB2
import { tickPostLandingFreeze } from "../tickPostLandingFreeze.js"; // ROM 0x1B55
import { walkRightWhileHeld } from "../walkRightWhileHeld.js"; // ROM 0x1AE6
import { climbDownWhileHeld } from "../climbDownWhileHeld.js"; // ROM 0x1B38
import { initMarioJump } from "../initMarioJump.js"; // ROM 0x1B6E
import { Machine } from "../../machine.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import {
  STACK_SCRATCH,
  MARIO_AIRBORNE,
  MARIO_FREEZE_TIMER,
  MARIO_HAMMER_ACTIVE,
  MARIO_ON_LADDER,
  P1_INPUT,
  MARIO_X,
  MARIO_Y,
  MARIO_AIR_PREV_X,
  MARIO_AIR_PREV_Y,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1ac3;
const ATTRACT_FRAMES = 2000;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

// -- the memory-equivalence contract ------------------------------------------

/** Every differing live (non-stack) RAM address between two machines. */
function ramDiffAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = new Set();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (!dead(addr)) out.add(addr);
  }
  return out;
}

/** First differing RAM byte outside the stack scratch below the entry SP, or null. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (!dead(addr)) return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Bytes that differ INSIDE the excluded region — diagnostic, proves the exclusion is used. */
function stackDiffCount(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  let n = 0;
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] !== db[i] && dead(a.stateOffsetToAddr(i))) n++;
  }
  return n;
}

/**
 * Run the oracle and `fn` on two fresh clones of `entry`; report every contract violation
 * (RAM − the stack scratch below the entry SP and the return value) plus the measured, out-of-contract residues.
 */
function compare(entry, fn) {
  const a = entry.clone(); const wantRet = oracle(a);
  const b = entry.clone(); const gotRet = fn(b);
  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (wantRet !== gotRet) diffs.push(`return oracle=${wantRet} cand=${gotRet}`);
  return {
    diffs,
    a, b,
    spDelta: b.regs.sp - a.regs.sp,
    stackBytes: stackDiffCount(a, b, entry.regs.sp),
    regsDiffering: REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k] && k !== "sp"),
  };
}

// -- arm classification (never an equivalence assertion) ----------------------

/**
 * Which arm does this entry select? Read straight off the five selector cells, exactly as the
 * oracle's five tests do. Used only to report coverage and to check that a crafted state
 * really reaches the arm it claims — never as the pass/fail comparison.
 */
function armOf(m) {
  const r = (addr) => m.mem.read8(addr);
  if (r(MARIO_AIRBORNE) === 1) return "airborne";
  if (r(MARIO_FREEZE_TIMER) !== 0) return "freeze";
  if (r(MARIO_HAMMER_ACTIVE) === 1) return "hammer";
  if (r(MARIO_ON_LADDER) === 1) return "ladder";
  if (r(P1_INPUT) & 0x80) return "jump";
  return "ground";
}

const ALL_ARMS = ["airborne", "freeze", "hammer", "ladder", "jump", "ground"];

/** Hook 0x1AC3 in a plain attract run and clone the machine at each real dispatch. */
function captureDispatches(frames = ATTRACT_FRAMES) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(frames);
  return caps;
}

/** One real captured entry per arm, keyed by arm name. */
function capturesByArm(caps) {
  const byArm = new Map();
  for (const c of caps) if (!byArm.has(armOf(c))) byArm.set(armOf(c), c);
  return byArm;
}

/** A real captured state with `pokes` ([addr, byte] pairs) applied — the crafted construction. */
function craft(base, pokes) {
  const c = base.clone();
  for (const [addr, val] of pokes) c.mem.write8(addr, val);
  return c;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: plain attract dispatches 0x1AC3 and drives all six arms", () => {
  const caps = captureDispatches();
  assert.ok(caps.length > 0, "0x1AC3 should be dispatched — the per-frame cascade calls it every frame Mario is live");

  const counts = new Map();
  for (const c of caps) counts.set(armOf(c), (counts.get(armOf(c)) ?? 0) + 1);
  for (const arm of ALL_ARMS) {
    assert.ok(
      (counts.get(arm) ?? 0) > 0,
      `attract no longer reaches the ${arm} arm — the header's "no crafting needed for coverage" claim is now stale`,
    );
  }
  console.log(
    `  REACHABILITY: ${caps.length} natural 0x1AC3 dispatches in ${ATTRACT_FRAMES} attract frames; ` +
      ALL_ARMS.map((a) => `${a}=${counts.get(a)}`).join(" "),
  );
});

// -- 2. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): dispatchMarioMovement == oracle on every real attract dispatch", () => {
  const caps = captureDispatches();
  const spByArm = new Map();
  const regsByArm = new Map();
  let stackExcluded = 0;

  for (const cap of caps) {
    const arm = armOf(cap);
    const r = compare(cap, candidate);
    assert.equal(
      r.diffs.length,
      0,
      `real ${arm} dispatch (X=${hx(cap.mem.read8(MARIO_X))} Y=${hx(cap.mem.read8(MARIO_Y))}): ${r.diffs.join("; ")}`,
    );
    // The dropped stack model's actual claim: the residue stays in dead scratch.
    assert.ok(
      inStack(r.a.regs.sp) && inStack(r.b.regs.sp),
      `${arm}: SP left STACK_SCRATCH (oracle=${hx(r.a.regs.sp)} cand=${hx(r.b.regs.sp)}) — the exclusion no longer covers it`,
    );
    stackExcluded += r.stackBytes;
    if (!spByArm.has(arm)) spByArm.set(arm, new Set());
    if (!regsByArm.has(arm)) regsByArm.set(arm, new Set());
    spByArm.get(arm).add(r.spDelta);
    for (const k of r.regsDiffering) regsByArm.get(arm).add(k);
  }

  console.log(
    `  EQUAL/captured: ${caps.length} real dispatches identical on RAM − the stack scratch below the entry SP + return value; ` +
      `${stackExcluded} byte(s) of excluded stack scratch`,
  );
  console.log(
    `  measured out-of-contract residues per arm — SP delta ` +
      ALL_ARMS.map((a) => `${a}=${[...(spByArm.get(a) ?? [])].join("/")}`).join(" ") +
      `; registers ` +
      ALL_ARMS.map((a) => `${a}=[${[...(regsByArm.get(a) ?? [])].join("")}]`).join(" "),
  );
});

// -- 3. LIVE-OUT (the dead registers, measured rather than asserted) ----------

/**
 * The next four routines ROM 0x197A calls after this one, with the return address it pushes
 * for each. Running them on both machines is what turns "the differing registers are dead"
 * into a measurement: if any of a/f/b/c/d/e/h/l or a flag were live, they would fork here.
 */
const CALLER_CASCADE = [
  [0x1986, 0x1f72],
  [0x1989, 0x2c8f],
  [0x198c, 0x2c03],
  [0x198f, 0x30ed],
];

test("LIVE-OUT: the registers that differ are dead — the caller's own cascade does not fork", () => {
  const caps = captureDispatches();
  let checked = 0;
  let lowWater = 0x10000;

  for (const cap of caps) {
    const a = cap.clone(); oracle(a);
    const b = cap.clone(); candidate(b);

    // SP is aligned before the continuation ON PURPOSE, and it is not a way of hiding a
    // failure: SP is not what this test measures — the REGISTERS and FLAGS are. Left
    // unaligned, the candidate's few-bytes-lower SP makes the four continuation routines
    // push their own return markers at different addresses than the oracle's, and one of
    // those lands two bytes BELOW STACK_SCRATCH's low-water bound (0x6BDE) where the
    // exclusion no longer covers it — a stack ghost that says nothing about liveness.
    // Aligning first puts both sides' continuation traffic on the same slots, so anything
    // that still differs is a live register or flag being read downstream.
    b.regs.sp = a.regs.sp;
    b.pc = a.pc;

    for (const [ret, target] of CALLER_CASCADE) {
      a.push16(ret); a.call(target);
      b.push16(ret); b.call(target);
    }
    lowWater = Math.min(lowWater, a.regs.sp, b.regs.sp);

    const d = ramDiffAddrs(a, b, cap.regs.sp);
    assert.equal(
      d.size,
      0,
      `${armOf(cap)}: continuing the caller's cascade forked at ${[...d].slice(0, 8).map(hx).join(",")} — ` +
        `a register or flag this routine leaves behind IS live, so the memory-only live-out is wrong`,
    );
    checked++;
  }

  // The continuation must not itself outgrow the excluded region, or the diff above would be
  // comparing stack ghosts as if they were game state.
  assert.ok(
    lowWater >= STACK_SCRATCH.lo,
    `the continuation pushed to ${hx(lowWater)}, below STACK_SCRATCH — its stack traffic is no longer excluded`,
  );

  console.log(
    `  LIVE-OUT: ${checked} dispatches carried ${CALLER_CASCADE.length} further cascade routines on both sides ` +
      `with zero RAM divergence — the differing registers/flags are dead ` +
      `(continuation SP low-water ${hx(lowWater)}, inside STACK_SCRATCH)`,
  );
});

// -- 4. EQUAL (selector sweeps) ----------------------------------------------

/**
 * Each selector cell, swept over all 256 values from a real GROUNDED capture (where every
 * test falls through), with the arm histogram the oracle's predicate must produce.
 */
const SWEEPS = [
  { label: "MARIO_AIRBORNE", cell: MARIO_AIRBORNE, expect: { airborne: 1, ground: 255 } },
  { label: "MARIO_FREEZE_TIMER", cell: MARIO_FREEZE_TIMER, expect: { freeze: 255, ground: 1 } },
  { label: "MARIO_HAMMER_ACTIVE", cell: MARIO_HAMMER_ACTIVE, expect: { hammer: 1, ground: 255 } },
  { label: "MARIO_ON_LADDER", cell: MARIO_ON_LADDER, expect: { ladder: 1, ground: 255 } },
  { label: "P1_INPUT", cell: P1_INPUT, expect: { jump: 128, ground: 128 } },
];

test("EQUAL (sweeps): all 256 values of each selector cell — dispatchMarioMovement == oracle", () => {
  const base = capturesByArm(captureDispatches()).get("ground");
  assert.ok(base, "expected a real grounded 0x1AC3 dispatch to sweep from");

  const reports = [];
  for (const s of SWEEPS) {
    const counts = new Map();
    for (let v = 0; v < 256; v++) {
      const entry = craft(base, [[s.cell, v]]);
      const r = compare(entry, candidate);
      assert.equal(r.diffs.length, 0, `${s.label} = ${v}: ${r.diffs.join("; ")}`);
      const arm = armOf(entry);
      counts.set(arm, (counts.get(arm) ?? 0) + 1);
    }
    // The predicate itself, pinned: a relaxed test would change this histogram.
    assert.deepEqual(
      Object.fromEntries([...counts].sort()),
      Object.fromEntries(Object.entries(s.expect).sort()),
      `${s.label}: the arm histogram changed — the selector predicate is not what the oracle uses`,
    );
    reports.push(`${s.label}=${[...counts].map(([k, v]) => `${k}:${v}`).join(",")}`);
  }
  console.log(`  SWEEPS: 5x256 values identical to the oracle; ${reports.join(" | ")}`);
});

// -- 5. EQUAL (priority, crafted) --------------------------------------------

/**
 * States where two selectors fire at once — the ones the demo never produces and the ones a
 * reordered router gets wrong. `arm` is the arm the priority order must pick.
 */
const PRIORITY = [
  { label: "airborne + freeze -> airborne wins", from: "airborne", pokes: [[MARIO_FREEZE_TIMER, 3]], arm: "airborne" },
  { label: "freeze + hammer -> freeze wins", from: "freeze", pokes: [[MARIO_HAMMER_ACTIVE, 1]], arm: "freeze" },
  { label: "hammer + jump edge -> hammer wins (no jumping with a hammer)", from: "hammer", pokes: [[P1_INPUT, 0x80]], arm: "hammer" },
  { label: "hammer + ladder -> hammer wins (no climbing with a hammer)", from: "hammer", pokes: [[MARIO_ON_LADDER, 1]], arm: "hammer" },
  { label: "ladder + jump edge -> ladder wins", from: "ladder", pokes: [[P1_INPUT, 0x80 | 0x04]], arm: "ladder" },
];

test("EQUAL (priority): overlapping selectors resolve identically to the oracle", () => {
  const byArm = capturesByArm(captureDispatches());
  for (const p of PRIORITY) {
    const base = byArm.get(p.from);
    assert.ok(base, `expected a real ${p.from} dispatch to craft "${p.label}" from`);
    const entry = craft(base, p.pokes);
    assert.equal(armOf(entry), p.arm, `crafted "${p.label}" did not select the ${p.arm} arm`);
    const r = compare(entry, candidate);
    assert.equal(r.diffs.length, 0, `crafted "${p.label}": ${r.diffs.join("; ")}`);
  }
  console.log(`  PRIORITY: ${PRIORITY.length} overlapping-selector states identical to the oracle`);
});

// -- 6. TEETH -----------------------------------------------------------------

/** (a) The airborne test relaxed to "nonzero" instead of exactly 1. */
function twinRelaxedAirborne(m) {
  const { mem } = m;
  if (mem.read8(MARIO_AIRBORNE) !== 0) return advanceMarioAirborneFrame(m); // BUG: was === 1
  if (mem.read8(MARIO_FREEZE_TIMER) !== 0) return tickPostLandingFreeze(m);
  if (mem.read8(MARIO_HAMMER_ACTIVE) === 1) return walkRightWhileHeld(m);
  if (mem.read8(MARIO_ON_LADDER) === 1) return climbDownWhileHeld(m);
  if (mem.read8(P1_INPUT) & 0x80) return initMarioJump(m);
  return walkRightWhileHeld(m);
}

/** (b) The jump edge read as bit 0 (Right) instead of bit 7. */
function twinJumpBit0(m) {
  const { mem } = m;
  if (mem.read8(MARIO_AIRBORNE) === 1) return advanceMarioAirborneFrame(m);
  if (mem.read8(MARIO_FREEZE_TIMER) !== 0) return tickPostLandingFreeze(m);
  if (mem.read8(MARIO_HAMMER_ACTIVE) === 1) return walkRightWhileHeld(m);
  if (mem.read8(MARIO_ON_LADDER) === 1) return climbDownWhileHeld(m);
  if (mem.read8(P1_INPUT) & 0x01) return initMarioJump(m); // BUG: was the top bit
  return walkRightWhileHeld(m);
}

/** (c) The ladder arm dropped — climbs fall through to ground movement. */
function twinNoLadder(m) {
  const { mem } = m;
  if (mem.read8(MARIO_AIRBORNE) === 1) return advanceMarioAirborneFrame(m);
  if (mem.read8(MARIO_FREEZE_TIMER) !== 0) return tickPostLandingFreeze(m);
  if (mem.read8(MARIO_HAMMER_ACTIVE) === 1) return walkRightWhileHeld(m);
  // BUG: the MARIO_ON_LADDER test is gone
  if (mem.read8(P1_INPUT) & 0x80) return initMarioJump(m);
  return walkRightWhileHeld(m);
}

/** (d) The hammer arm moved below the jump test — a hammer-carrying Mario could jump. */
function twinHammerBelowJump(m) {
  const { mem } = m;
  if (mem.read8(MARIO_AIRBORNE) === 1) return advanceMarioAirborneFrame(m);
  if (mem.read8(MARIO_FREEZE_TIMER) !== 0) return tickPostLandingFreeze(m);
  // BUG: the hammer test used to be here, above both of these
  if (mem.read8(MARIO_ON_LADDER) === 1) return climbDownWhileHeld(m);
  if (mem.read8(P1_INPUT) & 0x80) return initMarioJump(m);
  return walkRightWhileHeld(m);
}

/** (e) Priority inverted — the post-landing freeze outranks the airborne test. */
function twinFreezeFirst(m) {
  const { mem } = m;
  if (mem.read8(MARIO_FREEZE_TIMER) !== 0) return tickPostLandingFreeze(m); // BUG: was second
  if (mem.read8(MARIO_AIRBORNE) === 1) return advanceMarioAirborneFrame(m);
  if (mem.read8(MARIO_HAMMER_ACTIVE) === 1) return walkRightWhileHeld(m);
  if (mem.read8(MARIO_ON_LADDER) === 1) return climbDownWhileHeld(m);
  if (mem.read8(P1_INPUT) & 0x80) return initMarioJump(m);
  return walkRightWhileHeld(m);
}

/**
 * Run a twin against every entry and report which live cells it corrupted. `mustTouch` names
 * cells the twin is REQUIRED to have broken, so a twin caught only by an incidental knock-on
 * still fails the check.
 */
function teeth(entries, twin, label, mustTouch) {
  const cells = new Set();
  let caught = 0;
  for (const entry of entries) {
    const a = entry.clone(); oracle(a);
    const b = entry.clone(); twin(b);
    const d = ramDiffAddrs(a, b, entry.regs.sp);
    if (d.size === 0) continue;
    caught++;
    for (const addr of d) cells.add(addr);
  }
  assert.ok(caught > 0, `the ${label} twin escaped the gate on every entry — the gate is worthless here`);
  assert.ok(
    mustTouch.some((addr) => cells.has(addr)),
    `the ${label} twin was not caught at ${mustTouch.map(hx).join("/")} — live cells hit: ` +
      [...cells].sort((x, y) => x - y).map(hx).join(","),
  );
  return `${label}: caught on ${caught}/${entries.length} entries, ${cells.size} live cell(s)`;
}

test("TEETH: all five broken twins are CAUGHT at live cells", () => {
  const caps = captureDispatches();
  const byArm = capturesByArm(caps);

  // (a) is INVISIBLE on real dispatches — MARIO_AIRBORNE is only ever 0 or 1 in play — so it
  // is run against the AIRBORNE sweep, the case the sweep exists to cover.
  const airborneSweep = [];
  for (let v = 0; v < 256; v++) airborneSweep.push(craft(byArm.get("ground"), [[MARIO_AIRBORNE, v]]));

  // (d) and (e) need the overlapping-selector states from the priority set.
  const hammerOverlap = [
    craft(byArm.get("hammer"), [[P1_INPUT, 0x80]]),
    craft(byArm.get("hammer"), [[MARIO_ON_LADDER, 1]]),
  ];
  const airborneAndFrozen = [craft(byArm.get("airborne"), [[MARIO_FREEZE_TIMER, 3]])];

  const reports = [
    teeth(airborneSweep, twinRelaxedAirborne, "relaxed-airborne", [MARIO_AIRBORNE, MARIO_FREEZE_TIMER]),
    teeth(caps, twinJumpBit0, "jump-bit0", [MARIO_AIRBORNE, MARIO_X]),
    teeth(caps, twinNoLadder, "no-ladder", [MARIO_ON_LADDER, MARIO_Y]),
    teeth(hammerOverlap, twinHammerBelowJump, "hammer-below-jump", [MARIO_AIRBORNE]),
    teeth(airborneAndFrozen, twinFreezeFirst, "freeze-first", [MARIO_FREEZE_TIMER, MARIO_AIR_PREV_X, MARIO_AIR_PREV_Y]),
  ];

  console.log(`  TEETH: ${reports.join(" | ")}`);
});
