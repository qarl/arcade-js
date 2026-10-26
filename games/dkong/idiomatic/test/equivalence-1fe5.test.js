// SPDX-License-Identifier: GPL-3.0-only
/**
 * stepBarrelRight — memory-equivalent to the frozen oracle at ROM 0x1FE5: the forward horizontal
 * step of the OBJ_ARRAY_67 object sweep.
 * GATE:  captured + crafted + live, ATTRACT ONLY. Every real dispatch in a 3000-frame attract
 *        run is replayed — no sampling — and three crafted arms cover the X values attract
 *        never presents. Attract is 25m only and fills only record slots 0-6, so slots 7-9,
 *        the other boards and credited gameplay are NOT covered.
 *
 * The routine has four acts: swap to the shadow register set, stage two values the
 * still-frozen shared tail at ROM 0x1FF6 consumes (a step selector and a selector-bit
 * byte), increment the object record's OBJ_X, and run that tail. The tail is where all
 * the visible work happens, so this gate is mostly a gate on the FOUR INPUTS the tail is
 * handed — which is what the teeth below are chosen to pin.
 *
 * CONTRACT COMPARED HERE: work/sprite/video RAM minus the stack scratch below the entry SP plus the return
 * value — the required memory-equivalence contract — and, as EXTRAS that happen to hold
 * for this routine, pc, SP and the FULL register file. The extras hold for a derivable
 * reason: this routine models no stack of its own (the oracle has no push/pop either)
 * and the frozen tail it hands to runs the whole rest of the sweep, rewriting every
 * register and returning through the same `ret`. So the only thing this rewrite really
 * drops is the FLAG state its increment leaves at the moment the tail is entered, which
 * the tail overwrites before its first conditional — measured by test 5, not assumed.
 *
 * WHY THE ENTRIES ARE REHOSTED. A capture is cloned from a machine that carries the
 * capturing override, and clone() reruns the constructor, so a clone carries it too.
 * This routine's tail RE-ENTERS 0x1FE5 for the sweep's remaining slots, so replaying on
 * a plain clone would re-trigger the capture hook and clone the machine again, over and
 * over. Every entry is therefore rehosted into a FRESH override-free Machine, which also
 * means the nested re-entries run the oracle on both sides and the comparison isolates
 * the ONE outermost dispatch.
 *
 * WHAT EACH TEST ACTUALLY COVERS — read this before trusting a green run:
 *
 *   1. CAPTURED (real dispatches). 0x1FE5 is dispatched 2775 times in a 3000-frame
 *      attract run and ALL 2775 are replayed — no sampling, so there is no sampling
 *      policy to be wrong about. The test reports the entry shapes it saw. Attract is
 *      25m only and only ever fills slots 0-6 of the ten-record array, so the captures
 *      say nothing about slots 7-9, the other boards, or gameplay.
 *
 *   2. CRAFTED (the X values attract never presents). Attract only ever enters with an
 *      X in 0x2A..0xE3, measured over those same 2775 dispatches, so three arms are
 *      crafted by poking THAT ONE BYTE on a real
 *      captured machine: X=255 (the increment wraps to 0), X=0x10 (below the tail's low
 *      threshold) and X=0x02 (stepping onto the tail's every-eighth-pixel gate). The
 *      base is a real capture, stack included — that is why no return address is pushed
 *      here; the tail chain unwinds through the caller frames the capture already has.
 *      Each arm asserts WHICH tail arm the poke actually reached (ROM 0x202F / 0x215F
 *      dispatch counts), so a poke that changed nothing would fail as vacuous.
 *
 *   3. LIVE (whole-machine). The rewrite is wired at 0x1FE5 for a 3000-frame attract run
 *      and every frame's state dump is compared against the all-oracle baseline, minus
 *      STACK_SCRATCH. THE OVERRIDE RESTORES THE ORACLE'S MEASURED CYCLE COST (measured
 *      per dispatch by running the oracle on a throwaway rehost): cycle-free code
 *      under-charges, which shifts the vblank NMI. Without the restoration this same run
 *      forks on the spin counter at 0x6019 at frame 710, for reasons that have nothing
 *      to do with this routine. The test asserts the restored delta is the same on every
 *      one of the 2775 dispatches — it is the fixed 47 T-states of the four instructions
 *      this rewrite drops. Attract only; gameplay is NOT covered by any test here.
 *
 *   4. LIVE-OUT. A twin identical to the rewrite except that it scrambles the flags
 *      immediately before entering the tail — i.e. the exact state this rewrite drops,
 *      at the exact point it drops it — is wired live for the same 3000-frame run. The
 *      trace stays byte-identical, so nothing downstream reads those flags. Attract only.
 *
 *   5. TEETH — seven deliberately-broken twins the cases above MUST catch:
 *        (a) the register-set swap dropped;
 *        (b) the step decremented instead of incremented;
 *        (c) the mirror branch's staged pair (0xFF / 4) instead of this branch's (1 / 0);
 *        (d) the step applied to OBJ_Y instead of OBJ_X;
 *        (e) the step selector left unstaged;
 *        (f) the selector bits left unstaged;
 *        (g) a saturating increment instead of a wrapping one.
 *      (e) and (f) are the ones that pin this routine's whole reason for existing, and
 *      each fails at a DIFFERENT cell — (e) at the record's Y, (f) at its sprite code —
 *      which is the check behind what the routine's header says the two values feed.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1fe5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1fe5 as oracle } from "../../translated/loc_1fe5.js";
import { stepBarrelRight } from "../stepBarrelRight.js";
import { OBJ_ARRAY_67, OBJ_X, OBJ_Y, OBJ_SPRITE_CODE, STACK_SCRATCH } from "../names.js";
import { firstRegDiff, deadStackBelow } from "../../../../core/equivalence.js";
import { Machine } from "../../machine.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const TARGET = 0x1fe5;
const SHARED_TAIL = 0x1ff6; // the still-frozen tail this routine jumps to
const LOW_X_ARM = 0x202f; // the tail's arm for an X below its low threshold
const GATE_ARM = 0x215f; // the tail's arm for an X on the every-eighth-pixel gate
const RECORD_STRIDE = 32;
const ATTRACT_FRAMES = 3000;
const TEETH_CAPTURE_LIMIT = 300; // captures swept per twin before falling back to the crafted arms
const DROPPED_CYCLES = 47; // T-states of the four instructions this rewrite does not charge

const hx = (v) => "0x" + (v & 0xffff).toString(16);

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
 * A FRESH override-free Machine carrying `base`'s state — see the header. Optionally
 * given an override map, which is used only to COUNT tail-arm dispatches; a counting
 * hook delegates straight to the oracle, so it changes nothing it observes.
 */
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

/**
 * Oracle vs candidate on two byte-identical rehosts of `entry`. Returns the list of
 * contract violations (empty when identical). A fault is a violation too — one of the
 * twins drives the tail into unmapped memory rather than merely diverging.
 */
function contractDiffs(entry, fn) {
  let o, c, oret, cret;
  try {
    o = rehost(entry);
    oret = oracle(o);
    c = rehost(entry);
    cret = fn(c);
  } catch (e) {
    return [`threw ${e.constructor.name}: ${e.message}`];
  }
  const out = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) out.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (oret !== cret) out.push(`return oracle=${String(oret)} cand=${String(cret)}`);
  if (o.pc !== c.pc) out.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) out.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  const reg = firstRegDiff(o.regs, c.regs);
  if (reg) out.push(`reg ${reg.reg} oracle=${reg.a} cand=${reg.b}`);
  return out;
}

/** This routine's entry shape: which record, and which arm of the tail the stepped X selects. */
function shapeOf(m) {
  const record = m.regs.ix;
  const stepped = (m.mem.read8(record + OBJ_X) + 1) & 0xff;
  const band = stepped < 0x1c ? "low" : stepped < 0xe4 ? "mid" : "high";
  return `slot${(record - OBJ_ARRAY_67) / RECORD_STRIDE}/${(stepped & 7) === 3 ? "gate" : "run"}/${band}`;
}

// -- shared fixtures (built once, reused by every test in the file) ------------

let CAPTURES = null;
/** Every real 0x1FE5 dispatch in an attract run, cloned at the moment of dispatch. */
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

/** Wire `body` at 0x1FE5 for a whole attract run and diff every frame against the baseline. */
function liveRun(body) {
  const { m: base, frames: baseFrames, sp: baseFrameSp } = baseline();
  let fired = 0;
  const deltas = new Set();
  const cand = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      fired++;
      // Restore the oracle's cycle cost for THIS entry state. The probe is a rehost, not
      // a clone, so the oracle's re-entrant tail does not recurse back into this hook.
      const probe = rehost(mm);
      const probeStart = probe.cycles;
      oracle(probe);
      const cost = probe.cycles - probeStart;

      const start = mm.cycles;
      const r = body(mm);
      const delta = cost - (mm.cycles - start);
      deltas.add(delta);
      mm.tick(delta);
      return r;
    }]]),
  });
  const candFrameSp = recordFrameSp(cand);
  const candFrames = cand.runFrames(ATTRACT_FRAMES);
  const floors = frameFloors(baseFrameSp, candFrameSp);
  assert.equal(cand.stoppedBy, null, `live run stopped early: ${cand.stoppedBy}`);
  assert.ok(fired > 0, "the override never fired — this case would be vacuous");
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
  return { fired, deltas: [...deltas], firstBad, frames: baseFrames.length, sp: cand.regs.sp, baseSp: base.regs.sp };
}

// -- 1. CAPTURED --------------------------------------------------------------

test("CAPTURED: every real 0x1FE5 dispatch matches the oracle", () => {
  const caps = captures();
  assert.ok(caps.length > 0, "no 0x1FE5 dispatch was captured — this case would be vacuous");

  const shapes = new Map();
  caps.forEach((c) => shapes.set(shapeOf(c), (shapes.get(shapeOf(c)) ?? 0) + 1));

  for (let i = 0; i < caps.length; i++) {
    const diffs = contractDiffs(caps[i], stepBarrelRight);
    assert.equal(diffs.length, 0, `capture ${i} (${shapeOf(caps[i])}): ${diffs.join("; ")}`);
  }
  const slots = [...new Set([...shapes.keys()].map((s) => s.split("/")[0].replace("slot", "")))].sort();
  console.log(
    `  CAPTURED: all ${caps.length} of ${caps.length} dispatches in ${ATTRACT_FRAMES} attract frames replayed — ` +
      `identical; ${shapes.size} distinct entry shapes across record slots ${slots.join(",")}`,
  );
});

// -- 2. CRAFTED (the X values attract never presents) --------------------------

/** Run the oracle on `entry` with counting hooks on the tail's arms; report which fired. */
function tailArms(entry) {
  const counts = new Map([[LOW_X_ARM, 0], [GATE_ARM, 0]]);
  const registry = new Machine(ROM).routines;
  const hooks = new Map();
  for (const addr of counts.keys()) {
    const frozen = registry.get(addr);
    hooks.set(addr, (mm) => { counts.set(addr, counts.get(addr) + 1); return frozen(mm); });
  }
  const e = rehost(entry, hooks);
  oracle(e);
  return { counts, steppedX: e.mem.read8(entry.regs.ix + OBJ_X) };
}

test("CRAFTED: the X values attract never presents match the oracle", () => {
  const caps = captures();
  const base = caps[Math.floor(caps.length / 2)];
  const record = base.regs.ix;

  // A real captured machine — stack, caller frames and all — with ONE byte poked.
  const withX = (x) => { const e = base.clone(); e.mem.write8(record + OBJ_X, x); return e; };

  const arms = [
    { label: "wrap", x: 0xff, expectX: 0, expectArm: LOW_X_ARM, why: "the increment wraps 255 -> 0" },
    { label: "low", x: 0x10, expectX: 0x11, expectArm: LOW_X_ARM, why: "below the tail's low threshold" },
    { label: "gate", x: 0x02, expectX: 0x03, expectArm: GATE_ARM, why: "onto the tail's every-eighth-pixel gate" },
  ];

  const report = [];
  for (const arm of arms) {
    const entry = withX(arm.x);
    const diffs = contractDiffs(entry, stepBarrelRight);
    assert.equal(diffs.length, 0, `crafted ${arm.label}: ${diffs.join("; ")}`);

    // Non-vacuity: the poke must really have moved the step AND reached the intended arm.
    const { counts, steppedX } = tailArms(entry);
    assert.equal(steppedX, arm.expectX, `crafted ${arm.label}: the step did not land where expected`);
    assert.ok(counts.get(arm.expectArm) > 0, `crafted ${arm.label}: never reached ROM ${hx(arm.expectArm)} — vacuous`);
    report.push(`${arm.label} (X ${arm.x}->${steppedX}, ${arm.why}) -> ${hx(arm.expectArm)}`);
  }
  console.log(`  CRAFTED: ${report.join("; ")} — all identical to the oracle`);
});

// -- 3. LIVE (whole-machine attract) ------------------------------------------

test("LIVE: the rewrite wired at 0x1FE5 reproduces the oracle over a whole attract run", () => {
  const r = liveRun(stepBarrelRight);
  assert.equal(r.firstBad, null, String(r.firstBad));
  assert.equal(r.sp, r.baseSp, "guest SP drifted over the live run");
  assert.deepEqual(r.deltas, [DROPPED_CYCLES], `the restored cycle delta must be the constant ${DROPPED_CYCLES}`);
  console.log(
    `  LIVE: ${r.frames} attract frames, ${r.fired} live dispatches — every frame byte-identical ` +
      `(RAM/sprite/video minus stack scratch), guest SP unchanged, restored delta ${r.deltas[0]} T-states on every dispatch`,
  );
});

// -- 4. LIVE-OUT (the flags dropped at the tail boundary really are dead) ------

/** The rewrite, plus scrambled flags at exactly the point where it drops the oracle's. */
function scrambledFlagsTwin(m) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.b = 1;
  regs.c = 0;
  mem8[regs.ix + OBJ_X] = mem8[regs.ix + OBJ_X] + 1;
  regs.f = 0xa5; // the one thing this rewrite drops, poisoned where it is dropped
  return m.call(SHARED_TAIL);
}

test("LIVE-OUT: scrambling the flags at the tail boundary changes nothing over a whole attract run", () => {
  const r = liveRun(scrambledFlagsTwin);
  assert.equal(r.firstBad, null, String(r.firstBad));
  console.log(
    `  LIVE-OUT: flags scrambled immediately before the tail on every one of ${r.fired} dispatches — ` +
      `${r.frames} attract frames still byte-identical, so nothing downstream reads them`,
  );
});

// -- 5. TEETH -----------------------------------------------------------------

/** (a) the register-set swap dropped — the tail then works the sweep's live loop registers. */
function brokenNoSwap(m) {
  const { regs, mem8 } = m;
  regs.b = 1;
  regs.c = 0;
  mem8[regs.ix + OBJ_X] = mem8[regs.ix + OBJ_X] + 1;
  return m.call(SHARED_TAIL);
}

/** (b) the step decremented instead of incremented. */
function brokenDecrement(m) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.b = 1;
  regs.c = 0;
  mem8[regs.ix + OBJ_X] = mem8[regs.ix + OBJ_X] - 1;
  return m.call(SHARED_TAIL);
}

/** (c) the mirror branch's staged pair — this is ROM 0x1FEF's, not this branch's. */
function brokenMirrorPair(m) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.b = 0xff;
  regs.c = 4;
  mem8[regs.ix + OBJ_X] = mem8[regs.ix + OBJ_X] + 1;
  return m.call(SHARED_TAIL);
}

/** (d) the step applied to the record's Y instead of its X. */
function brokenWrongField(m) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.b = 1;
  regs.c = 0;
  mem8[regs.ix + OBJ_Y] = mem8[regs.ix + OBJ_Y] + 1;
  return m.call(SHARED_TAIL);
}

/** (e) the step selector left unstaged — the tail's girder snap then reads whatever was there. */
function brokenNoStepSelector(m) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.c = 0;
  mem8[regs.ix + OBJ_X] = mem8[regs.ix + OBJ_X] + 1;
  return m.call(SHARED_TAIL);
}

/** (f) the selector bits left unstaged. */
function brokenNoSelectBits(m) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.b = 1;
  mem8[regs.ix + OBJ_X] = mem8[regs.ix + OBJ_X] + 1;
  return m.call(SHARED_TAIL);
}

/** (g) a saturating increment instead of a wrapping one. */
function brokenSaturating(m) {
  const { regs, mem8 } = m;
  regs.exx();
  regs.b = 1;
  regs.c = 0;
  const addr = regs.ix + OBJ_X;
  const stepped = mem8[addr] + 1;
  mem8[addr] = stepped > 255 ? 255 : stepped;
  return m.call(SHARED_TAIL);
}

/** Sweep captures then the crafted arms; return where the twin was first caught. */
function sweepForMismatch(twin) {
  const caps = captures();
  const limit = Math.min(caps.length, TEETH_CAPTURE_LIMIT);
  for (let i = 0; i < limit; i++) {
    const diffs = contractDiffs(caps[i], twin);
    if (diffs.length) return { where: `capture ${i} (${shapeOf(caps[i])})`, diffs };
  }
  const base = caps[Math.floor(caps.length / 2)];
  const record = base.regs.ix;
  for (const [label, x] of [["wrap", 0xff], ["low", 0x10], ["gate", 0x02]]) {
    const e = base.clone();
    e.mem.write8(record + OBJ_X, x);
    const diffs = contractDiffs(e, twin);
    if (diffs.length) return { where: `crafted ${label} (X=${x})`, diffs };
  }
  return null;
}

for (const [label, twin] of [
  ["dropped-swap", brokenNoSwap],
  ["decrement", brokenDecrement],
  ["mirror-pair", brokenMirrorPair],
  ["wrong-field", brokenWrongField],
  ["no-step-selector", brokenNoStepSelector],
  ["no-select-bits", brokenNoSelectBits],
  ["saturating", brokenSaturating],
]) {
  test(`TEETH: the ${label} twin is CAUGHT`, () => {
    const mm = sweepForMismatch(twin);
    assert.notEqual(mm, null, `the gate FAILED to catch the ${label} twin — it is worthless for that defect`);
    console.log(`  TEETH/${label}: caught at ${mm.where} — ${mm.diffs.join("; ")}`);
  });
}

/** The first capture where a twin diverges in RAM ALONE — the required contract, no extras. */
function firstRamDivergence(twin) {
  const caps = captures();
  const limit = Math.min(caps.length, TEETH_CAPTURE_LIMIT);
  for (let i = 0; i < limit; i++) {
    const o = rehost(caps[i]);
    const oFloor = o.regs.sp;
    oracle(o);
    const c = rehost(caps[i]);
    twin(c);
    const ram = firstRamDiff(o, c, oFloor);
    if (ram) return { capture: i, addr: ram.addr, cell: ram.addr % RECORD_STRIDE, oracle: ram.a, cand: ram.b };
  }
  return null;
}

// The two teeth that pin what this routine exists to do land on DIFFERENT cells under
// the REQUIRED contract alone: the unstaged step selector shows up at the record's Y
// (the tail's girder snap), the unstaged selector bits at its sprite code (the tail's
// table lookup). Assert that separation — it is the evidence behind what the routine's
// header claims the two staged values feed, and it would have come out otherwise if the
// header were wrong.
test("TEETH: under RAM alone, the two staged values fail at different record cells", () => {
  const stepSelector = firstRamDivergence(brokenNoStepSelector);
  const selectBits = firstRamDivergence(brokenNoSelectBits);
  assert.notEqual(stepSelector, null, "the step-selector twin produced no RAM divergence");
  assert.notEqual(selectBits, null, "the select-bits twin produced no RAM divergence");
  assert.equal(stepSelector.cell, OBJ_Y, "the unstaged step selector should first diverge at the record's Y");
  assert.equal(selectBits.cell, OBJ_SPRITE_CODE, "the unstaged select bits should first diverge at the record's sprite code");
  console.log(
    `  TEETH/separation: unstaged step selector -> RAM@${hx(stepSelector.addr)} (record +${OBJ_Y}, Y) at capture ` +
      `${stepSelector.capture}; unstaged select bits -> RAM@${hx(selectBits.addr)} (record +${OBJ_SPRITE_CODE}, ` +
      `sprite code) at capture ${selectBits.capture}`,
  );
});
