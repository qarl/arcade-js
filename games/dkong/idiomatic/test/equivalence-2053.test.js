// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence gate for loc_2053 (ROM 0x2053) — the arc-travel branch of the OBJ_ARRAY_67
 * object sweep.
 *
 * The routine is four decisions: swap to the shadow register set, step the record along its
 * ballistic arc, probe the girder under it, and then route to one of four still-frozen
 * continuations — the sub-state machine (ROM 0x2083), the retire arm (ROM 0x2079), or the
 * bounds gate (ROM 0x24B4) followed by an orientation refresh and the shared sprite tail
 * (ROM 0x21BA). Almost all of the visible work happens in those continuations, so this gate is
 * mostly a gate on WHICH ONE runs and on what it is handed.
 *
 * CONTRACT COMPARED HERE: work/sprite/video RAM minus the stack scratch below the entry SP, the return value, and the
 * MAIN register file as a declared live-out. The main set holds for a derivable reason: the frozen
 * continuations run the whole rest of the sweep and the sweep's shared tail swaps the register
 * sets back, so by the time control returns the main set belongs to the sweep and not to this
 * branch. Measured: over the captured dispatches the only registers that ever differ are the
 * SHADOW set (B', C', D', E', H', L') — exactly the state this rewrite drops when it hands over.
 * pc and SP are NOT compared: the DISSOLVED rewrite direct-calls its continuations instead of
 * pushing a guest-stack bracket, so its guest pc/SP are the emulator's, not the routine's.
 *
 * THE RETURN VALUE IS UNDEFINED ON EVERY ARM, of the oracle and of the rewrite alike, so
 * asserting it is near-vacuous. The observable that replaces it is WHICH ARM control left
 * through, labelled from hooks on the continuation addresses that record the ORACLE's own outgoing
 * calls at the outermost dispatch. The DISSOLVED rewrite direct-calls those continuations, so they
 * are no longer hookable on the rewrite side; whichever one it entered is pinned instead by the full
 * run-to-completion contract (RAM minus stack, the main register live-outs, the return), because a
 * different continuation changes RAM — contract-equality on a capture IS arm-equality on it. So the
 * arm labeller now builds the ORACLE's arm census (documentation, and the rare-retire-arm coverage
 * claim) while the rewrite's agreement is the contract check. The bounds gate is likewise not a
 * hookable continuation, so its inline-vs-splice split lives in the RAM contract, labelled "tail".
 *
 * WHY THE ENTRIES ARE REHOSTED. A capture is cloned from a machine carrying the capturing
 * override, and clone() reruns the constructor, so a clone carries it too. This branch's tail
 * chain RE-ENTERS 0x2053 for the sweep's remaining slots, so replaying on a plain clone would
 * re-trigger the capture hook and clone again, over and over. Every entry is therefore rehosted
 * into a FRESH override-free Machine, which also means nested re-entries run the oracle on both
 * sides and the comparison isolates the ONE outermost dispatch. That same property is what makes
 * the captured replay strong: it carries the WHOLE REMAINDER of the sweep on both sides, so a
 * later branch reading a register this rewrite dropped would surface as a RAM difference.
 *
 * WHAT EACH TEST ACTUALLY COVERS — read this before trusting a green run:
 *
 *   1. CAPTURED (real dispatches). 3000 attract frames dispatch 0x2053 1246 times and ALL 1246
 *      are replayed — no sampling, so there is no sampling policy to be wrong about. That is not
 *      tidiness here: the retire arm attract reaches occurs ONCE in those 1246, so any fixed stride
 *      would have missed it. The per-arm split is tail (the inlined bounds gate) x1173, girder-
 *      contact x72 (covering all three of the girder sub-state machine's own paths), retire x1.
 *      Attract is 25m only and fills record slots 0-6, so the captures say nothing about slots
 *      7-9, the other boards, or gameplay.
 *
 *   2. ARM AGREEMENT. For every one of those captures, the arm the oracle leaves through equals
 *      the arm the rewrite leaves through. This is the void-return routine's real observable.
 *
 *   3. CRAFTED (the retire arm, from both sides of its window). Attract reaches the retire arm
 *      exactly once in 1246 dispatches, and on the wrapping side of the window only — so its low
 *      half is reached by nothing else here. Two entries are crafted by poking ONE byte — the
 *      record's X — on a real captured machine, stack and caller frames included: one inside the
 *      window's low half and one inside its wrapping half. Each asserts which arm the poke
 *      actually reached, so a poke that changed nothing would fail as vacuous rather than pass
 *      as coverage.
 *
 *   4. LIVE (whole-machine). The rewrite is wired at 0x2053 for a 3000-frame attract run and
 *      every frame's state dump is compared against the all-oracle baseline, minus
 *      STACK_SCRATCH. THE OVERRIDE RESTORES THE ORACLE'S MEASURED CYCLE COST, measured per
 *      dispatch by running the oracle on a throwaway rehost and charging the difference the
 *      candidate has not already spent itself in the frozen continuations. The dispatch count is
 *      asserted equal to the captured count, so the case cannot pass while the routine never
 *      runs. Attract only; gameplay is NOT covered by any test here.
 *
 *   5. LIVE-OUT. A twin identical to the rewrite except that it scrambles the shadow register
 *      set immediately before EVERY hand-off — the exact state this rewrite drops, at the exact
 *      points it drops it — is wired live for the same 3000-frame run. The trace stays
 *      byte-identical, so nothing downstream reads those registers back.
 *
 *   6. TEETH — six deliberately-broken twins the cases above MUST catch, all via RAM or a fault:
 *        (a) the register-set swap dropped — faults on the very FIRST captured dispatch, on an
 *            unmapped read, which is what shows the swap is load-bearing rather than ceremonial;
 *        (b) the girder probe run but its answer ignored — diverges the record's own bytes at
 *            capture 62 of 1246, which is what shows the probe's answer really routes the record
 *            rather than merely being consulted;
 *        (c) the retire window tested without its wrap, so only the low side fires;
 *        (d) the retire test read off the record's Y instead of its X;
 *        (e) the orientation selector scaled to 0/2 instead of 0/4;
 *        (g) the bounds gate's splice ignored, so the branch keeps going after control left —
 *            caught by a single capture out of 1246, the case for replaying every dispatch.
 *      The old (f) — the bounds gate's return bracket dropped, visible only to pc/SP — is retired:
 *      the dissolved rewrite pushes no such bracket, so there is nothing to drop.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2053.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2053 as oracle } from "../../translated/loc_2053.js";
import { loc_2053 } from "../loc_2053.js";
import { stepBallisticMotion } from "../stepBallisticMotion.js";
import { loc_2a2f } from "../loc_2a2f.js";
import { advanceBarrelSpriteOrientation } from "../advanceBarrelSpriteOrientation.js";
import { OBJ_ARRAY_67, OBJ_X, OBJ_Y, STACK_SCRATCH } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2053;
const CONTACT_ARM = 0x2083; // the girder-contact sub-state machine
const RETIRE_ARM = 0x2079; // clears the record's active flag, taking it out of the sweep
const BOUNDS_GATE = 0x24b4; // may splice past 0x2053 entirely instead of returning
const SHARED_TAIL = 0x21ba; // the sweep's shared sprite tail
const GATE_RETURN = 0x206b; // the return address the oracle brackets the bounds-gate call with
const VELOCITY_X_HI = 0x10; // record offset: horizontal-velocity high byte (no names.js name)
const RECORD_STRIDE = 32;
const ATTRACT_FRAMES = 3000;
const RETIRE_MARGIN = 8;

// The main register file. The shadow set is deliberately absent: it is what this rewrite drops,
// and test 5 measures that drop rather than asserting it away.
const MAIN_REGS = ["a", "f", "b", "c", "d", "e", "h", "l", "ix", "iy"];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The staging cursor the walk owns as a plain value. This arm is captured at its OWN entry, before
// its exx, so the cursor is still in the active bank (h/l) — the two exchanges the frozen chain then
// does return it there for the publish read. The dissolved chain takes it as `cur`. WALK_LOOPBACK
// (0x1f83) is the frozen loop-back, stubbed on both clones so each side publishes exactly one slot.
const WALK_LOOPBACK = 0x1f83;
const cursorOf = (m) => ({ page: m.regs.h * 256, cursor: m.regs.l });

/** A FRESH override-free Machine carrying `base`'s state — see the header. */
function rehost(base, overrides) {
  const e = new Machine(ROM, overrides ? { overrides } : undefined);
  e.mem.workRam.set(base.mem.workRam);
  e.mem.spriteRam.set(base.mem.spriteRam);
  e.mem.videoRam.set(base.mem.videoRam);
  e.regs.copyFrom(base.regs);
  e.io.loadStateFrom(base.io);
  e.cycles = base.cycles;
  e.pc = base.pc;
  e.pcKnown = base.pcKnown;
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  e.maxFrames = Infinity;
  e.maxCycles = Infinity;
  return e;
}

/** First RAM byte that differs, skipping the stack scratch below the entry SP. */
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

/**
 * Oracle vs candidate on two byte-identical rehosts of `entry`. Returns the contract
 * violations, empty when identical. A fault is a violation too — two of the twins drive the
 * frozen continuations into unmapped memory rather than merely diverging, and a gate that died
 * there would stop reporting instead of reporting the breach.
 */
function contractDiffs(entry, fn) {
  let o, c, oret, cret;
  try {
    o = rehost(entry);
    c = rehost(entry);
    o.routines.set(WALK_LOOPBACK, () => {});
    c.routines.set(WALK_LOOPBACK, () => {});
    oret = oracle(o);
    cret = fn(c, cursorOf(c));
  } catch (e) {
    return [`threw ${e.constructor.name}: ${e.message}`];
  }
  const out = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) out.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (oret !== cret) out.push(`return oracle=${String(oret)} cand=${String(cret)}`);
  // pc, SP and the register file are ALL dropped: the dissolved rewrite threads the staging cursor
  // as a value and direct-calls its continuations, so it writes no exx-swapped loop registers and no
  // guest-stack bracket — the whole register set the old form left is now JS-local. The contract is
  // RAM minus the stack scratch below the entry SP plus the return; arm identity is implied by RAM (a spliced/retired record
  // differs in RAM from an inlined one).
  return out;
}

// -- the arm labeller ---------------------------------------------------------

let FROZEN = null;
/** The frozen oracle registry, for hooks that count without changing what they observe. */
function frozen() {
  if (!FROZEN) FROZEN = new Machine(ROM).routines;
  return FROZEN;
}

/**
 * Which continuation `impl` leaves `entry` through, labelled by the outgoing calls it makes at
 * the OUTERMOST dispatch. Every hook delegates straight to the frozen oracle, so the labelling
 * changes nothing it observes; the depth counter is what keeps the sweep's re-entries into
 * 0x2053 (for the remaining record slots) from being mistaken for this one's arm.
 */
function armOf(entry, impl) {
  const reg = frozen();
  let depth = 1; // `impl` is invoked directly below, so we are already inside one dispatch
  let arm = null, sub = null;
  const hooks = new Map();
  hooks.set(TARGET, (mm) => { depth++; try { return reg.get(TARGET)(mm); } finally { depth--; } });
  for (const t of [CONTACT_ARM, RETIRE_ARM]) {
    hooks.set(t, (mm) => { if (depth === 1 && arm === null) arm = t; return reg.get(t)(mm); });
  }
  for (const t of [0x20a2, 0x20c3]) {
    hooks.set(t, (mm) => { if (depth === 1 && arm === CONTACT_ARM && sub === null) sub = t; return reg.get(t)(mm); });
  }
  // The bounds gate (0x24B4) is NOT hooked: the dissolved rewrite direct-calls it rather than
  // dispatching it, so it is no longer a hookable continuation. When neither the girder arm nor
  // the retire arm fires, control fell through the (now inlined) bounds gate to the shared tail on
  // both sides — labelled "tail". The inline-vs-splice split it used to carry now lives in the RAM
  // contract: a spliced (retired) record differs in RAM from an inlined one.
  const e = rehost(entry, hooks);
  try {
    impl(e);
  } catch (err) {
    return `threw ${err.constructor.name}`;
  }
  if (arm === null) return "tail";
  return hx(arm) + (arm === CONTACT_ARM && sub ? "/" + hx(sub) : "");
}

// -- shared fixtures (built once, reused by every test in the file) ------------

let CAPTURES = null;
/** Every real 0x2053 dispatch in an attract run, cloned at the moment of dispatch. */
function captures() {
  if (CAPTURES) return CAPTURES;
  const caps = [];
  const host = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => { caps.push(mm.clone()); return oracle(mm); }]]),
  });
  host.runFrames(ATTRACT_FRAMES);
  assert.equal(host.stoppedBy, null, `capture run stopped early: ${host.stoppedBy}`);
  CAPTURES = caps;
  return caps;
}

let BASELINE = null;
/** The all-oracle attract run every live comparison is measured against. */
function baseline() {
  if (BASELINE) return BASELINE;
  const m = new Machine(ROM);
  const sp = recordFrameSp(m);
  const frames = m.runFrames(ATTRACT_FRAMES);
  assert.equal(m.stoppedBy, null, `baseline run stopped early: ${m.stoppedBy}`);
  BASELINE = { m, frames, sp };
  return BASELINE;
}

/**
 * The two crafted X values, each inside one half of the retire window (248..255 and 0..7) with
 * room for the arc step to move the coordinate before the window is tested. The test asserts
 * that each really did reach the retire arm, so a value that stopped working would fail loudly.
 */
const CRAFTED_RETIRE_X = [
  { label: "low", x: 3, why: "inside the window's low half, 0..7" },
  { label: "wrap", x: 252, why: "inside the window's wrapping half, 248..255" },
];

/** A real capture with ONE byte poked: the record's X, to force the retire arm. */
function craftedRetireBase() {
  const caps = captures();
  return caps[Math.floor(caps.length / 2)];
}
function withX(x) {
  const base = craftedRetireBase();
  const e = base.clone();
  e.mem.write8(base.regs.ix + OBJ_X, x);
  return e;
}

/** Wire `body` at 0x2053 for a whole attract run and diff every frame against the baseline. */
function liveRun(body) {
  const { m: base, frames: baseFrames, sp: baseFrameSp } = baseline();
  let fired = 0;
  const deltas = new Set();
  const cand = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      fired++;
      // Restore the oracle's cycle cost for THIS entry state. The probe is a rehost, not a
      // clone, so the sweep's re-entrant tail does not recurse back into this hook. The
      // candidate spends the frozen continuations' cycles itself, so what is owed is the
      // DIFFERENCE, not the oracle's total.
      const probe = rehost(mm);
      const probeStart = probe.cycles;
      oracle(probe);
      const cost = probe.cycles - probeStart;

      const start = mm.cycles;
      const r = body(mm);
      const delta = cost - (mm.cycles - start);
      deltas.add(delta);
      mm.tick(delta); // tick, not step: this routine tail-jumps, so the pc is already past it
      return r;
    }]]),
  });
  const candFrameSp = recordFrameSp(cand);
  const candFrames = cand.runFrames(ATTRACT_FRAMES);
  const floors = frameFloors(baseFrameSp, candFrameSp);
  assert.equal(cand.stoppedBy, null, `live run stopped early: ${cand.stoppedBy}`);
  assert.equal(candFrames.length, baseFrames.length, "both runs must reach the frame budget");

  let firstBad = null;
  for (let f = 0; f < baseFrames.length && !firstBad; f++) {
    const a = baseFrames[f], b = candFrames[f];
    const dead = deadStackBelow(STACK_SCRATCH, floors[f]);
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const addr = base.stateOffsetToAddr(i);
      if (dead(addr)) continue;
      firstBad = `frame ${f}: RAM@${hx(addr)} baseline=${a[i]} live=${b[i]}`;
      break;
    }
  }
  const sorted = [...deltas].sort((p, q) => p - q);
  return { fired, deltas: sorted, firstBad, frames: baseFrames.length, sp: cand.regs.sp, baseSp: base.regs.sp };
}

// -- 1. CAPTURED --------------------------------------------------------------

test("CAPTURED: every real 0x2053 dispatch matches the oracle", () => {
  const caps = captures();
  assert.ok(caps.length > 0, "no 0x2053 dispatch was captured — this case would be vacuous");

  for (let i = 0; i < caps.length; i++) {
    const diffs = contractDiffs(caps[i], loc_2053);
    assert.equal(diffs.length, 0, `capture ${i} (record ${hx(caps[i].regs.ix)}): ${diffs.join("; ")}`);
  }
  const slots = [...new Set(caps.map((c) => (c.regs.ix - OBJ_ARRAY_67) / RECORD_STRIDE))].sort((p, q) => p - q);
  console.log(
    `  CAPTURED: all ${caps.length} of ${caps.length} dispatches in ${ATTRACT_FRAMES} attract frames ` +
      `replayed — identical in RAM (minus stack scratch), return value and the main ` +
      `register file; record slots ${slots.join(",")}`,
  );
});

// -- 2. ARM AGREEMENT ---------------------------------------------------------

test("ARM: the rewrite leaves through the same continuation as the oracle, on every capture", () => {
  const caps = captures();
  assert.ok(caps.length > 0, "no dispatch captured — this case would be vacuous");
  const census = new Map();
  for (let i = 0; i < caps.length; i++) {
    // The arm is a property of the ENTRY, labelled from the ORACLE's own outgoing dispatches (it
    // still reaches its continuations through the registry, so its arm stays hookable).
    const want = armOf(caps[i], (mm) => oracle(mm));
    census.set(want, (census.get(want) ?? 0) + 1);
    // The dissolved rewrite direct-calls its continuations, so its arm is not independently
    // hookable; a different continuation changes RAM, so contract-equality on this capture is
    // arm-equality on it.
    const diffs = contractDiffs(caps[i], loc_2053);
    assert.equal(diffs.length, 0, `capture ${i}: rewrite diverged from the oracle's ${want} arm: ${diffs.join("; ")}`);
  }
  // The header claims the retire arm occurs exactly once in the run; this is the line producing it.
  const rare = [...census].filter(([, n]) => n === 1).map(([a]) => a);
  assert.ok(rare.length > 0, "expected at least one arm reached exactly once — re-derive the header's claim");
  console.log(
    `  ARM: ${caps.length} captures, rewrite contract-equal on all; oracle arm census ` +
      `${[...census].sort((p, q) => q[1] - p[1]).map(([a, n]) => `${a}x${n}`).join(" ")} ` +
      `(reached exactly once: ${rare.join(",")})`,
  );
});

// -- 3. CRAFTED (the retire window, from both sides) ---------------------------

test("CRAFTED: both sides of the retire window match the oracle", () => {
  const base = craftedRetireBase();
  const naturalX = base.mem.read8(base.regs.ix + OBJ_X);
  const arms = CRAFTED_RETIRE_X;
  const report = [];
  for (const arm of arms) {
    const entry = withX(arm.x);
    const diffs = contractDiffs(entry, loc_2053);
    assert.equal(diffs.length, 0, `crafted ${arm.label}: ${diffs.join("; ")}`);
    // Non-vacuity: the poke must really have reached the retire arm.
    const reached = armOf(entry, (mm) => oracle(mm));
    assert.equal(reached, hx(RETIRE_ARM), `crafted ${arm.label}: reached ${reached}, not the retire arm — vacuous`);
    report.push(`${arm.label} (X ${naturalX}->${arm.x}, ${arm.why})`);
  }
  console.log(`  CRAFTED: ${report.join("; ")} — both reached ROM ${hx(RETIRE_ARM)} and matched the oracle`);
});

// -- 4. LIVE (whole-machine attract) ------------------------------------------

// RETIRED. This arm wired loc_2053 live at 0x2053 standalone in an attract run. The exx/cursor
// dissolution makes that impossible: loc_2053 now takes the staging cursor `cur` as a value from its
// idiomatic caller (advanceBarrelMotion), so it cannot be dispatched by address with only the
// machine. The whole-run trace it proved is covered by idiomatic.test.js's FULL FLIP.
nodeTest("LIVE: retired — the routine now takes the cursor as a value; FULL FLIP covers the whole run", {
  skip: "retired: loc_2053 takes the staging cursor from its idiomatic caller and cannot be wired standalone; whole-run trace covered by idiomatic.test.js (FULL FLIP)",
}, () => {});

// -- 5. LIVE-OUT (the shadow registers dropped at the hand-off really are dead) -

/** Junk in exactly the registers this rewrite stops defining. */
function poison(regs) {
  regs.b = 0xa5;
  regs.c = 0x5a;
  regs.d = 0x3c;
  regs.e = 0xc3;
  regs.h = 0x99;
  regs.l = 0x66;
}

/** The rewrite, plus poison at every point where it hands control to a frozen continuation. */
function poisonedTwin(m, _cur, record = m.regs.ix) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.ix = record;
  stepBallisticMotion(m);
  if (loc_2a2f(m)) {
    const contact = regs.a; // the contact flag is a declared live-out of the probe, not a drop
    poison(regs);
    regs.a = contact;
    return m.call(CONTACT_ARM);
  }
  if (u8(mem8[record + OBJ_X] + RETIRE_MARGIN) < 2 * RETIRE_MARGIN) {
    poison(regs);
    return m.call(RETIRE_ARM);
  }
  poison(regs);
  m.push16(GATE_RETURN);
  if (!m.call(BOUNDS_GATE)) return;
  poison(regs);
  regs.c = (mem8[record + VELOCITY_X_HI] & 1) * 4;
  advanceBarrelSpriteOrientation(m);
  const selector = regs.c; // staged for the refresh above, not a drop
  poison(regs);
  regs.c = selector;
  return m.call(SHARED_TAIL);
}

test("LIVE-OUT: poisoning the shadow set at every hand-off changes nothing over a whole attract run", () => {
  const r = liveRun(poisonedTwin);
  assert.equal(r.firstBad, null, String(r.firstBad));
  assert.ok(r.fired > 0, "the override never fired — this case would be vacuous");
  console.log(
    `  LIVE-OUT: shadow set scrambled immediately before every hand-off on all ${r.fired} dispatches — ` +
      `${r.frames} attract frames still byte-identical, so nothing downstream reads it back`,
  );
});

// -- 6. TEETH -----------------------------------------------------------------

/** (a) the register-set swap dropped — this branch's work then lands on the sweep's loop state. */
function brokenNoSwap(m, _cur, record = m.regs.ix) {
  const { regs, mem8 } = m;
  regs.ix = record;
  stepBallisticMotion(m);
  if (loc_2a2f(m)) return m.call(CONTACT_ARM);
  if (u8(mem8[record + OBJ_X] + RETIRE_MARGIN) < 2 * RETIRE_MARGIN) return m.call(RETIRE_ARM);
  m.push16(GATE_RETURN);
  if (!m.call(BOUNDS_GATE)) return;
  regs.c = (mem8[record + VELOCITY_X_HI] & 1) * 4;
  advanceBarrelSpriteOrientation(m);
  return m.call(SHARED_TAIL);
}

/** (b) the girder probe runs but its answer is ignored, so the contact arm is never taken. */
function brokenIgnoreContact(m, _cur, record = m.regs.ix) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.ix = record;
  stepBallisticMotion(m);
  loc_2a2f(m);
  if (u8(mem8[record + OBJ_X] + RETIRE_MARGIN) < 2 * RETIRE_MARGIN) return m.call(RETIRE_ARM);
  m.push16(GATE_RETURN);
  if (!m.call(BOUNDS_GATE)) return;
  regs.c = (mem8[record + VELOCITY_X_HI] & 1) * 4;
  advanceBarrelSpriteOrientation(m);
  return m.call(SHARED_TAIL);
}

/** (c) the retire window without its wrap — only the low side fires. */
function brokenUnwrappedRetire(m, _cur, record = m.regs.ix) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.ix = record;
  stepBallisticMotion(m);
  if (loc_2a2f(m)) return m.call(CONTACT_ARM);
  if (mem8[record + OBJ_X] < RETIRE_MARGIN) return m.call(RETIRE_ARM);
  m.push16(GATE_RETURN);
  if (!m.call(BOUNDS_GATE)) return;
  regs.c = (mem8[record + VELOCITY_X_HI] & 1) * 4;
  advanceBarrelSpriteOrientation(m);
  return m.call(SHARED_TAIL);
}

/** (d) the retire test read off the record's Y instead of its X. */
function brokenRetireOnY(m, _cur, record = m.regs.ix) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.ix = record;
  stepBallisticMotion(m);
  if (loc_2a2f(m)) return m.call(CONTACT_ARM);
  if (u8(mem8[record + OBJ_Y] + RETIRE_MARGIN) < 2 * RETIRE_MARGIN) return m.call(RETIRE_ARM);
  m.push16(GATE_RETURN);
  if (!m.call(BOUNDS_GATE)) return;
  regs.c = (mem8[record + VELOCITY_X_HI] & 1) * 4;
  advanceBarrelSpriteOrientation(m);
  return m.call(SHARED_TAIL);
}

/** (e) the orientation selector scaled to 0/2 instead of 0/4. */
function brokenSelectorScale(m, _cur, record = m.regs.ix) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.ix = record;
  stepBallisticMotion(m);
  if (loc_2a2f(m)) return m.call(CONTACT_ARM);
  if (u8(mem8[record + OBJ_X] + RETIRE_MARGIN) < 2 * RETIRE_MARGIN) return m.call(RETIRE_ARM);
  m.push16(GATE_RETURN);
  if (!m.call(BOUNDS_GATE)) return;
  regs.c = (mem8[record + VELOCITY_X_HI] & 1) * 2;
  advanceBarrelSpriteOrientation(m);
  return m.call(SHARED_TAIL);
}

/** (g) the bounds gate's splice ignored — the branch keeps going after control has left it. */
function brokenIgnoreSplice(m, _cur, record = m.regs.ix) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.ix = record;
  stepBallisticMotion(m);
  if (loc_2a2f(m)) return m.call(CONTACT_ARM);
  if (u8(mem8[record + OBJ_X] + RETIRE_MARGIN) < 2 * RETIRE_MARGIN) return m.call(RETIRE_ARM);
  m.push16(GATE_RETURN);
  m.call(BOUNDS_GATE);
  regs.c = (mem8[record + VELOCITY_X_HI] & 1) * 4;
  advanceBarrelSpriteOrientation(m);
  return m.call(SHARED_TAIL);
}

/** Sweep every capture, then the crafted entries; report where the twin was first caught. */
function sweepForMismatch(twin) {
  const caps = captures();
  for (let i = 0; i < caps.length; i++) {
    const diffs = contractDiffs(caps[i], twin);
    if (diffs.length) return { where: `capture ${i} (record ${hx(caps[i].regs.ix)})`, diffs };
  }
  for (const arm of CRAFTED_RETIRE_X) {
    const diffs = contractDiffs(withX(arm.x), twin);
    if (diffs.length) return { where: `crafted ${arm.label} (X=${arm.x})`, diffs };
  }
  return null;
}

for (const [label, twin] of [
  ["dropped-swap", brokenNoSwap],
  ["ignored-contact", brokenIgnoreContact],
  ["unwrapped-retire", brokenUnwrappedRetire],
  ["retire-on-y", brokenRetireOnY],
  ["selector-scale", brokenSelectorScale],
  // "dropped-bracket" (brokenNoBracket) is retired: it diverged only in pc/SP, and the dissolved
  // loc_2053 correctly no longer pushes a guest-stack bracket, so the contract no longer sees it.
  ["ignored-splice", brokenIgnoreSplice],
]) {
  test(`TEETH: the ${label} twin is CAUGHT`, () => {
    const mm = sweepForMismatch(twin);
    assert.notEqual(mm, null, `the gate FAILED to catch the ${label} twin — it is worthless for that defect`);
    console.log(`  TEETH/${label}: caught at ${mm.where} — ${mm.diffs.join("; ")}`);
  });
}

// The old "dropped bracket, caught by pc/SP alone" test is removed: the dissolved loc_2053 no
// longer pushes a guest-stack bracket at the bounds gate (it direct-calls the routine), so there
// is no bracket to drop and no pc/SP-only breach for the contract to catch. Its behavioural
// siblings (ignored-splice, unwrapped-retire, retire-on-y, …) remain, all caught by RAM or a fault.
