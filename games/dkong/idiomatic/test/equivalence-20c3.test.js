// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence gate for loc_20c3 (ROM 0x20C3) — reflect an object record's vertical arc, store a
 * QUARTER of the reflection back as the arc's new launch speed (+0x12/+0x13), clear the elapsed
 * frame counter (+0x14) and both coordinate fractions (+0x04/+0x06), then jump to the shared
 * object-sprite tail at ROM 0x21BA. That tail, the object loop behind it and its return are the
 * FROZEN ORACLE on both sides here and are not under test; what this gate has to prove is the
 * five writes, the exact arithmetic that produces the two stored halves, and that the tail's
 * result is handed back.
 *
 *   0. REACHABILITY — how many real 0x20C3 dispatches a 4000-frame attract run produces, on which
 *      records, and through which of the four callers. The caller identity is MEASURED, by hooking
 *      ROM 0x2083 / 0x20A2 / 0x20B5 / 0x20E1 with their own frozen oracles in the same run, not
 *      inferred from the entry state.
 *
 *   1. EQUAL (captured) — EVERY captured dispatch is replayed, not a sample: the run produces 49,
 *      far below the point where sampling would be worth its coverage risk. Each is replayed on
 *      two byte-identical clones — oracle on one, loc_20c3 on the other — and compared on
 *      RAM − the stack scratch below the entry SP, the RETURN VALUE, and the register file. This test ALSO produces the
 *      coverage holes the routine's GATE: line quotes, as assertions rather than prose: attract
 *      never delivers a reflection with the high bit set, never one with either low bit set, and
 *      never a stored high byte other than 0 — so on its own this arm cannot distinguish a
 *      sign-preserving shift, a rounded shift, or a hard-zeroed high byte. Arm 2 is what does.
 *
 *   2. EQUAL (crafted) — all 256 elapsed-frame counts × 16 launch speeds, poked identically onto
 *      both sides of a REAL capture of each distinct entry shape. The speeds are chosen to drive
 *      the three holes above, and the test ASSERTS that they did (a reflection past the sign
 *      boundary, reflections with low bits to discard, and stored high bytes that are not 0), so
 *      the sweep cannot silently stop covering what it claims to cover.
 *
 *   3. LIVE-WIRE — loc_20c3 drives a whole 4000-frame attract run as a registered override, and
 *      every frame of the state trace must match the PURE all-oracle baseline. Nothing else is
 *      wired: the baseline is the frozen game, so this arm measures the composition of this
 *      routine with the already-idiomatic loc_2407 it direct-calls against the untouched ROM.
 *      Unusually, the comparison here includes STACK_SCRATCH — the unit arms must exclude it
 *      (dissolving the oracle's call bracket around ROM 0x2407 leaves a real difference at
 *      0x6BEA mid-routine), but the trace is sampled at frame boundaries, by which point both
 *      sides have overwritten that residue identically. THE CYCLE RESTORATION IS NOT COSMETIC:
 *      Donkey Kong seeds entropy from timing, and the CONTROL arm wires the same rewrite without
 *      it and asserts the trace DOES fork — measured at frame 966, on SPIN_COUNT, which is the
 *      very first dispatch. The head cost is measured, not assumed: the oracle is run on a
 *      throwaway clone with the tail STUBBED (and the stub proven live by a counter), so only the
 *      fragment this routine replaces is priced — the tail is not, because the rewrite still runs
 *      it and charges it itself.
 *
 *   4. TEETH — eight broken twins, each annotated with the arm that MUST catch it, and the
 *      annotation is ASSERTED both ways: a twin marked invisible to the captured arm fails the
 *      test if that arm catches it after all, so the coverage holes above cannot rot silently.
 *        (a) sign-preserving shift  — INVISIBLE to arms 1 and 3 (attract produces no reflection
 *                                     past the sign boundary); caught only by arm 2.
 *        (b) rounded shift          — INVISIBLE to arms 1 and 3 (attract's reflections are all
 *                                     exact multiples of 4); caught only by arm 2.
 *        (c) hard-zero high byte    — INVISIBLE to arm 1 (the stored high byte is 0 on all 49);
 *                                     caught only by arm 2.
 *        (d) swapped halves         — caught by arm 1.
 *        (e) no counter reset       — caught by arm 1.
 *        (f) no X-fraction clear    — caught by arm 1.
 *        (g) dropped register mirror— identical RAM and identical return; caught ONLY by the
 *                                     register comparison, on 10 of the 49 captures.
 *        (h) swallowed tail result  — identical RAM, wrong result. INVISIBLE to the RAM diff, and
 *                                     `false` from an address that is not in machine.js's
 *                                     SEAM_CALLER_SKIP makes the seam consume a stack word the
 *                                     routine does not owe.
 *
 *   5. BEHAVIOUR — the reading the routine's header rests on, checked against the ORACLE's own
 *      attract run rather than a scratchpad: across the captured dispatches the object's vertical
 *      step must reverse sign (or already be at rest), and its magnitude must be SMALLER after
 *      than before. A re-launch, a position edit, or an undamped reflection would each fail this.
 *
 *   6. THE ONE REGISTER EXCLUSION, PINNED. The register comparison excludes exactly two fields,
 *      the alternate B and C. They differ because the FROZEN ROM 0x2407 loads the record's
 *      +0x12/+0x13 operand into that pair while the already-idiomatic loc_2407 — whose own gate
 *      declares every register but the returned pair dead — does not. This test asserts that
 *      characterisation rather than assuming it: wherever the pair differs, the oracle's value
 *      must equal those two record bytes as they stood at entry. If that ever stops holding, the
 *      exclusion is hiding something else and this test says so.
 *
 * COVERAGE THIS DOES NOT CLAIM: attract only, plus pokes on top of attract state. No credited
 * game, no board other than 25m. The crafted sweep varies only the three bytes the routine reads;
 * record bases other than the seven attract walks are not covered.
 *
 * Isolated replays use clone(), whose frame machinery is neutralised (nextNmi / nextBoundary =
 * Infinity), so an m.step inside the oracle cannot trip a live NMI whose handler would write RAM
 * and masquerade as an oracle side effect. The four caller hooks are their own FROZEN oracles,
 * delegating unchanged — they are a label on each capture, not a substitution, so the capture run
 * is the oracle's own run. That is deliberate for ROM 0x20E1 in particular, which HAS an idiomatic
 * file now (written alongside this one, and not yet in ROUTINES): hooking its oracle keeps the
 * capture run the frozen game rather than a half-flipped one. The capturing hook is LEFT INSTALLED on every clone but
 * stops recording once capture is done — the tail chain re-enters 0x20C3 on later slots of the
 * same object loop, so a hook that kept appending would grow the capture list underneath the
 * replay it is driving.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-20c3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_20c3 as oracle } from "../../translated/loc_20c3.js";
import { loc_2083 as oracle2083 } from "../../translated/loc_2083.js";
import { loc_20a2 as oracle20a2 } from "../../translated/loc_20a2.js";
import { loc_20b5 as oracle20b5 } from "../../translated/loc_20b5.js";
import { loc_20e1 as oracle20e1 } from "../../translated/loc_20e1.js";
import { loc_20c3 } from "../loc_20c3.js";
import { loc_2407 } from "../loc_2407.js";
import { Machine } from "../../machine.js";
import { OBJ_ARRAY_67, STACK_SCRATCH } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const TARGET = 0x20c3;
const TAIL = 0x21ba; //          the shared object-sprite tail, frozen on both sides
const CAPTURE_FRAMES = 4000; //  the capture run the reachability numbers in both headers quote
const LIVE_FRAMES = 4000; //     the live-wire run and its baseline

// The census both this file's header and loc_20c3.js's GATE: line quote. Asserted, not merely
// printed, so neither header can go stale without a test failure naming the new numbers.
const EXPECTED_DISPATCHES = 49;
const EXPECTED_BY_CALLER = { "0x2083": 24, "0x20a2": 2, "0x20b5": 12, "0x20e1": 11 };
const EXPECTED_RECORDS = 7;
const EXPECTED_FIRST_FRAME = 966;

// The record offsets the routine touches, restated here rather than imported from it, so the test
// asserts against an independent statement of the contract.
const LAUNCH_VY_HI = 0x12;
const LAUNCH_VY_LO = 0x13;
const AIRBORNE_FRAMES = 0x14;
const X_FRAC = 0x04;
const Y_FRAC = 0x06;

// The alternate B and C: the only two register fields excluded from the comparison. Test 5 pins why.
const EXCLUDED_REGS = new Set(["b_", "c_"]);
const COMPARED_REGS = REG_FIELDS.filter((k) => !EXCLUDED_REGS.has(k));

const hx = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const rd = (mm, base, off) => mm.mem.read8((base + off) & 0xffff);

/** The reflection the frozen ROM 0x2407 computes for this record, restated independently. */
function reflectionAt(mm) {
  const ix = mm.regs.ix;
  const frames = rd(mm, ix, AIRBORNE_FRAMES);
  const speed = (rd(mm, ix, LAUNCH_VY_HI) << 8) | rd(mm, ix, LAUNCH_VY_LO);
  return ((frames << 4) - speed) & 0xffff;
}

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Run oracle and candidate on two FRESH, byte-identical clones of `entry` and report the contract:
 * RAM − the stack scratch below the entry SP, the compared register fields, and the RETURN VALUE.
 *
 * STACK_SCRATCH is excluded because this rewrite DISSOLVES the oracle's call bracket around
 * ROM 0x2407 — measured, the residue differs at 0x6BEA on 10 of the 49 captures. The stack
 * POINTER is compared, and legitimately so: the oracle's push is popped again by ROM 0x2407's own
 * return before this routine ends, so SP is back where it started on both sides.
 *
 * Registers ARE compared, unlike the sibling gates on this tail, because the tail is frozen on
 * both sides and therefore leaves an identical register file — which makes the comparison a real
 * check on what this routine hands the tail, and the only thing that catches twin (g).
 */
function contractDiffs(entry, fn) {
  const a = entry.clone();
  const b = entry.clone();
  const retA = oracle(a);
  const retB = fn(b);

  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  for (const k of COMPARED_REGS) {
    if (a.regs[k] !== b.regs[k]) {
      diffs.push(`reg ${k} oracle=${a.regs[k]} cand=${b.regs[k]}`);
      break;
    }
  }
  if (retA !== retB) diffs.push(`return oracle=${String(retA)} cand=${String(retB)}`);
  return { diffs, a, b };
}

// -- capture ------------------------------------------------------------------

/**
 * ONE attract run serves every replay test below. It hooks 0x20C3 and clones the machine at every
 * dispatch, and it hooks the four frozen callers so each capture carries the caller it actually
 * came through. Every hook delegates to its own frozen oracle unchanged — they are labels on the
 * run, not substitutions, so this is the oracle's own run.
 *
 * `capturing` is cleared as soon as the run ends. Clones inherit the hook (Machine.clone rebuilds
 * the routine map from the same assets), and the tail chain DOES re-enter 0x20C3 on later slots of
 * the same object loop, so without the flag a replay would append to the list it is iterating.
 * The hook stays installed and keeps delegating to the oracle, which is what keeps nested
 * dispatches identical on both sides of every replay.
 */
let capturing = false;
let ATTRACT = null;
function attractRun() {
  if (ATTRACT) return ATTRACT;
  const caps = [];
  const stack = [];
  const via = (name, fn) => (mm) => {
    stack.push(name);
    try { return fn(mm); } finally { stack.pop(); }
  };

  capturing = true;
  const host = new Machine(ROM, {
    overrides: new Map([
      [0x2083, via("0x2083", oracle2083)],
      [0x20a2, via("0x20a2", oracle20a2)],
      [0x20b5, via("0x20b5", oracle20b5)],
      [0x20e1, via("0x20e1", oracle20e1)],
      [TARGET, (mm) => {
        if (capturing) {
          const entry = mm.clone();
          const ix = mm.regs.ix;
          caps.push({
            entry,
            frame: mm.frames.length,
            record: ix,
            caller: stack.length ? stack[stack.length - 1] : "(none)",
            shape: `frames=${rd(mm, ix, AIRBORNE_FRAMES)} speed=${hx((rd(mm, ix, LAUNCH_VY_HI) << 8) | rd(mm, ix, LAUNCH_VY_LO))}` +
              ` xFrac=${rd(mm, ix, X_FRAC)} yFrac=${rd(mm, ix, Y_FRAC)}`,
            reflection: reflectionAt(mm),
          });
        }
        return oracle(mm);
      }],
    ]),
  });
  const frames = host.runFrames(CAPTURE_FRAMES);
  capturing = false;
  assert.equal(host.stoppedBy ?? null, null, `capture run stopped early: ${host.stoppedBy}`);
  ATTRACT = { caps, frames, host };
  return ATTRACT;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x20C3 is dispatched during 25m attract, through all four callers", () => {
  const { caps } = attractRun();
  assert.ok(caps.length > 0, "0x20C3 should be dispatched — the object update cascade reaches it");

  const byCaller = {};
  for (const c of caps) byCaller[c.caller] = (byCaller[c.caller] ?? 0) + 1;
  const records = new Set(caps.map((c) => c.record));

  assert.equal(caps.length, EXPECTED_DISPATCHES,
    `the dispatch count changed (${caps.length}); loc_20c3.js's GATE: line and this file's header quote ${EXPECTED_DISPATCHES}`);
  assert.deepEqual(byCaller, EXPECTED_BY_CALLER,
    `the per-caller split changed (${JSON.stringify(byCaller)}); the GATE: line quotes ${JSON.stringify(EXPECTED_BY_CALLER)}`);
  assert.equal(records.size, EXPECTED_RECORDS,
    `the record count changed (${records.size}); the GATE: line quotes ${EXPECTED_RECORDS}`);
  assert.equal(caps[0].frame, EXPECTED_FIRST_FRAME,
    `the first dispatch moved to frame ${caps[0].frame}; the GATE: line quotes ${EXPECTED_FIRST_FRAME}`);

  // The routine's header says every dispatch lands on an OBJ_ARRAY_67 record; this is that line.
  for (const r of records) {
    assert.ok(r >= OBJ_ARRAY_67 && r < OBJ_ARRAY_67 + 10 * 0x20 && (r - OBJ_ARRAY_67) % 0x20 === 0,
      `record ${hx(r)} is not an OBJ_ARRAY_67 slot — the routine's header says all of them are`);
  }

  console.log(`  REACHABILITY: ${caps.length} natural dispatches in ${CAPTURE_FRAMES} attract frames, ` +
    `first at frame ${caps[0].frame}, on ${records.size} records ` +
    `(${[...records].map(hx).join(" ")}); by caller ${JSON.stringify(byCaller)}`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): loc_20c3 == oracle on EVERY real dispatch", () => {
  const { caps } = attractRun();
  assert.ok(caps.length >= 1, "expected at least one real 0x20C3 dispatch during attract");

  for (const c of caps) {
    const { diffs, a } = contractDiffs(c.entry, loc_20c3);
    assert.deepEqual(diffs, [], `captured dispatch frame ${c.frame} [${c.shape}]: ${diffs.join("; ")}`);

    // The routine's header states the arithmetic as a law over the record's own bytes. This is the
    // line that produces that claim, restated independently of the routine and checked against the
    // ORACLE's result, so it could refute the reading rather than echo it.
    const want = c.reflection >>> 2;
    const ix = c.entry.regs.ix;
    assert.equal((rd(a, ix, LAUNCH_VY_HI) << 8) | rd(a, ix, LAUNCH_VY_LO), want,
      `frame ${c.frame}: the oracle stored ${hx((rd(a, ix, LAUNCH_VY_HI) << 8) | rd(a, ix, LAUNCH_VY_LO))}, ` +
      `not ((16*frames - launchSpeed) & 0xFFFF) >> 2 = ${hx(want)}`);
  }

  // Non-vacuity: the three clears must actually have had something to clear, or twins (e) and (f)
  // would pass for the wrong reason.
  const hadFrames = caps.filter((c) => rd(c.entry, c.entry.regs.ix, AIRBORNE_FRAMES) !== 0).length;
  const hadXFrac = caps.filter((c) => rd(c.entry, c.entry.regs.ix, X_FRAC) !== 0).length;
  const hadYFrac = caps.filter((c) => rd(c.entry, c.entry.regs.ix, Y_FRAC) !== 0).length;
  assert.ok(hadFrames > 0 && hadXFrac > 0 && hadYFrac > 0,
    `a cleared field was already 0 on every capture (frames ${hadFrames}, xFrac ${hadXFrac}, yFrac ${hadYFrac})`);

  // THE COVERAGE HOLES both headers quote, produced here rather than asserted in prose.
  const signBit = caps.filter((c) => c.reflection >= 0x8000).length;
  const lowBits = caps.filter((c) => c.reflection & 3).length;
  const highByte = caps.filter((c) => (c.reflection >>> 2) >> 8).length;
  assert.equal(signBit, 0, `attract now DOES produce a reflection past the sign boundary (${signBit}) — the headers' hole claim is stale`);
  assert.equal(lowBits, 0, `attract now DOES produce a reflection with low bits to discard (${lowBits}) — the headers' hole claim is stale`);
  assert.equal(highByte, 0, `attract now DOES produce a non-zero stored high byte (${highByte}) — the headers' hole claim is stale`);

  console.log(`  EQUAL/captured: ALL ${caps.length} of ${caps.length} real dispatches replayed identical; ` +
    `${new Set(caps.map((c) => c.shape)).size} distinct entry shapes; ` +
    `entries arriving with a non-zero field: frames ${hadFrames}, xFrac ${hadXFrac}, yFrac ${hadYFrac}; ` +
    `HOLES — sign-boundary reflections ${signBit}/${caps.length}, low-bit reflections ${lowBits}/${caps.length}, ` +
    `non-zero stored high bytes ${highByte}/${caps.length}`);
});

// -- 2. EQUAL (crafted: the value space attract never enters) -------------------

/** One capture per distinct entry shape — the real entries the crafted sweep sits on. */
function shapeBases() {
  const { caps } = attractRun();
  const first = new Map();
  for (const c of caps) if (!first.has(c.shape)) first.set(c.shape, c);
  return [...first.values()];
}

// Launch speeds chosen to drive the three holes: exact and inexact quarters, the sign boundary,
// and results whose high byte is not 0.
const SWEPT_SPEEDS = [
  0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0068, 0x00ff, 0x0100,
  0x1000, 0x7ffe, 0x7fff, 0x8000, 0x8001, 0xfff0, 0xfffe, 0xffff,
];

test("EQUAL (crafted): every elapsed-frame count × 16 launch speeds matches the oracle", () => {
  const bases = shapeBases();
  let compared = 0, signBoundary = 0, lowBits = 0, highByte = 0;

  for (const { entry, shape } of bases) {
    for (let frames = 0; frames < 256; frames++) {
      for (const speed of SWEPT_SPEEDS) {
        const poked = entry.clone();
        const ix = poked.regs.ix;
        poked.mem.write8(ix + AIRBORNE_FRAMES, frames);
        poked.mem.write8(ix + LAUNCH_VY_HI, speed >> 8);
        poked.mem.write8(ix + LAUNCH_VY_LO, speed & 0xff);

        const reflection = reflectionAt(poked);
        if (reflection >= 0x8000) signBoundary++;
        if (reflection & 3) lowBits++;
        if ((reflection >>> 2) >> 8) highByte++;

        const { diffs, a } = contractDiffs(poked, loc_20c3);
        assert.deepEqual(diffs, [],
          `[${shape}] frames=${frames} speed=${hx(speed)}: ${diffs.join("; ")}`);
        compared++;

        // Non-vacuity: the crafted inputs really did reach the stored halves on the oracle side.
        // (The frozen tail does not touch these two offsets, so they survive to be read back.)
        const want = reflection >>> 2;
        assert.equal(rd(a, ix, LAUNCH_VY_HI), want >> 8,
          `[${shape}] frames=${frames} speed=${hx(speed)}: oracle's stored high half is not the quartered reflection`);
        assert.equal(rd(a, ix, LAUNCH_VY_LO), want & 0xff,
          `[${shape}] frames=${frames} speed=${hx(speed)}: oracle's stored low half is not the quartered reflection`);
      }
    }
  }

  // The sweep must actually enter all three holes, or arm 2's whole reason for existing is gone.
  assert.ok(signBoundary > 0, "the crafted sweep never crossed the sign boundary");
  assert.ok(lowBits > 0, "the crafted sweep never produced a reflection with low bits to discard");
  assert.ok(highByte > 0, "the crafted sweep never produced a non-zero stored high byte");

  console.log(`  EQUAL/crafted: ${compared} entries (256 frame counts × ${SWEPT_SPEEDS.length} speeds ` +
    `× ${bases.length} real entry shapes) identical to the oracle; the three holes attract leaves are ` +
    `entered ${signBoundary} / ${lowBits} / ${highByte} times`);
});

// -- 3. LIVE-WIRE -------------------------------------------------------------

/**
 * What the oracle spends on the FRAGMENT THIS ROUTINE REPLACES — everything up to and including
 * the jump to the tail, and nothing of the tail itself, which the rewrite still runs and charges.
 * Measured on throwaway clones with the tail stubbed, and asserted constant (the head is
 * straight-line, so it should be; if it ever is not, charging one number is wrong).
 *
 * The stub is installed on EACH fresh clone, because Machine.clone() rebuilds the routine map from
 * the assets and would drop it, and its counter is asserted so that a stub nobody can see fire
 * cannot be mistaken for a stub that worked.
 */
function headCycleCost() {
  const { caps } = attractRun();
  const costs = new Set();
  let stubHits = 0;
  for (const c of caps) {
    const probe = c.entry.clone();
    probe.routines.set(TAIL, () => { stubHits++; return undefined; });
    const before = probe.cycles;
    oracle(probe);
    costs.add(probe.cycles - before);
  }
  assert.equal(stubHits, caps.length,
    `the tail stub fired ${stubHits} times for ${caps.length} probes — it was not installed, so the ` +
    "measured cost includes the tail chain and the live arm would double-charge it");
  assert.equal(costs.size, 1, `the head's cost is not constant: ${[...costs].join(",")}`);
  return [...costs][0];
}

/** First frame+byte where two traces differ, or null. Per-frame `floors` skip the stack scratch below them. */
function firstTraceDiff(base, other, offToAddr, floors) {
  for (let f = 0; f < Math.min(base.length, other.length); f++) {
    const a = base[f], b = other[f];
    const dead = floors ? deadStackBelow(STACK_SCRATCH, floors[f]) : () => false;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) continue;
      const addr = offToAddr(i);
      if (dead(addr)) continue;
      return { frame: f, addr, a: a[i], b: b[i] };
    }
  }
  return null;
}

/** Run `frames` of attract with loc_20c3 wired live at 0x20C3, optionally charging the head. */
function liveWire(frames, cost) {
  let dispatches = 0;
  const m = new Machine(ROM, {
    overrides: new Map([[TARGET, (mm) => {
      dispatches++;
      // step(), not tick(): this charges the head where the oracle finishes spending it, with the
      // program counter at the tail — exactly where the oracle's own jump leaves it. The rewrite
      // then runs the tail and charges that itself.
      if (cost) mm.step(TAIL, cost);
      return loc_20c3(mm);
    }]]),
  });
  const sp = recordFrameSp(m);
  const frameDumps = m.runFrames(frames);
  return { m, frameDumps, sp, dispatches };
}

test("LIVE-WIRE: loc_20c3 drives a whole attract run identical to the all-oracle baseline", () => {
  const cost = headCycleCost();
  const base = new Machine(ROM);
  const baseFrames = base.runFrames(LIVE_FRAMES);
  assert.equal(base.stoppedBy ?? null, null, `baseline run stopped early: ${base.stoppedBy}`);
  assert.equal(baseFrames.length, LIVE_FRAMES, "baseline did not reach every frame");

  const live = liveWire(LIVE_FRAMES, cost);
  assert.equal(live.m.stoppedBy ?? null, null, `live run stopped early: ${live.m.stoppedBy}`);
  assert.equal(live.frameDumps.length, LIVE_FRAMES, "live run did not reach every frame");

  // A live arm that never dispatched the routine proves nothing, so the count is asserted.
  assert.equal(live.dispatches, EXPECTED_DISPATCHES,
    `the live run dispatched 0x20C3 ${live.dispatches} times, expected ${EXPECTED_DISPATCHES}`);

  // The full dump, STACK_SCRATCH included: the unit arms must exclude it, but at frame boundaries
  // both sides have overwritten the dissolved bracket's residue identically.
  const full = firstTraceDiff(baseFrames, live.frameDumps, (i) => base.stateOffsetToAddr(i), null);
  assert.equal(full, null, full
    ? `frame ${full.frame}: ${hx(full.addr)} baseline=${full.a} live=${full.b}`
    : "");

  console.log(`  LIVE-WIRE: ${LIVE_FRAMES} attract frames byte-identical to the pure all-oracle baseline ` +
    `(stack region INCLUDED) with 0x20C3 wired live and ${cost} T-states/dispatch restored; ` +
    `${live.dispatches} dispatches`);
});

test("LIVE-WIRE CONTROL: without the cycle restoration the same rewrite DOES fork", () => {
  const base = new Machine(ROM);
  const baseSp = recordFrameSp(base);
  const baseFrames = base.runFrames(LIVE_FRAMES);
  const live = liveWire(LIVE_FRAMES, 0);
  const diff = firstTraceDiff(baseFrames, live.frameDumps, (i) => base.stateOffsetToAddr(i), frameFloors(baseSp, live.sp));
  assert.ok(diff !== null,
    "the un-restored run matched the baseline — the LIVE-WIRE comparison above is then lenient, " +
    "not sensitive, and proves much less than it claims");
  console.log(`  LIVE-WIRE/control: un-restored run forks at frame ${diff.frame} on ${hx(diff.addr)} ` +
    `(baseline=${diff.a} live=${diff.b}); dispatch count ${live.dispatches} vs ${EXPECTED_DISPATCHES}`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** The rewrite's body with one defect, so each twin is a whole routine rather than a wrapper. */
function twin(mutate) {
  return function (m) {
    const { regs, mem8 } = m;
    const reflected = loc_2407(m);
    const record = regs.ix;
    const s = { damped: reflected >>> 2, mirror: true, clearFrames: true, clearX: true, hardHigh: false, swap: false };
    mutate(s, reflected);
    const hi = s.hardHigh ? 0 : s.damped >> 8;
    mem8[record + (s.swap ? LAUNCH_VY_LO : LAUNCH_VY_HI)] = hi;
    mem8[record + (s.swap ? LAUNCH_VY_HI : LAUNCH_VY_LO)] = s.damped;
    if (s.clearFrames) mem8[record + AIRBORNE_FRAMES] = 0;
    if (s.clearX) mem8[record + X_FRAC] = 0;
    mem8[record + Y_FRAC] = 0;
    if (s.mirror) regs.hl = s.damped;
    return m.call(TAIL);
  };
}

const TEETH = [
  { name: "(a) sign-preserving shift", capturedCatches: false,
    fn: twin((s, r) => { s.damped = ((((r << 16) >> 16) >> 2) & 0xffff); }) },
  { name: "(b) rounded shift", capturedCatches: false,
    fn: twin((s, r) => { s.damped = (r + 3) >>> 2; }) },
  { name: "(c) hard-zero high byte", capturedCatches: false,
    fn: twin((s) => { s.hardHigh = true; }) },
  { name: "(d) swapped halves", capturedCatches: true,
    fn: twin((s) => { s.swap = true; }) },
  { name: "(e) no counter reset", capturedCatches: true,
    fn: twin((s) => { s.clearFrames = false; }) },
  { name: "(f) no X-fraction clear", capturedCatches: true,
    fn: twin((s) => { s.clearX = false; }) },
  { name: "(g) dropped register mirror", capturedCatches: true,
    fn: twin((s) => { s.mirror = false; }) },
  { name: "(h) swallowed tail result", capturedCatches: true,
    fn: (m) => { loc_20c3(m); return false; } },
];

/** Every capture the given candidate breaches, with the first breach it produced. */
function capturedBreaches(fn) {
  const { caps } = attractRun();
  const out = [];
  for (const c of caps) {
    let diffs;
    // A broken twin can FAULT rather than diverge; a fault is a RESULT here, not a dead run.
    try { ({ diffs } = contractDiffs(c.entry, fn)); }
    catch (e) { diffs = [`threw ${e.constructor.name}: ${e.message}`]; }
    if (diffs.length) out.push({ frame: c.frame, shape: c.shape, first: diffs[0] });
  }
  return out;
}

/** Every crafted entry the given candidate breaches (the sweep, one speed row per shape). */
function craftedBreaches(fn) {
  const out = [];
  for (const { entry, shape } of shapeBases()) {
    for (let frames = 0; frames < 256; frames += 8) {
      for (const speed of SWEPT_SPEEDS) {
        const poked = entry.clone();
        const ix = poked.regs.ix;
        poked.mem.write8(ix + AIRBORNE_FRAMES, frames);
        poked.mem.write8(ix + LAUNCH_VY_HI, speed >> 8);
        poked.mem.write8(ix + LAUNCH_VY_LO, speed & 0xff);
        let diffs;
        try { ({ diffs } = contractDiffs(poked, fn)); }
        catch (e) { diffs = [`threw ${e.constructor.name}: ${e.message}`]; }
        if (diffs.length) out.push({ shape, frames, speed, first: diffs[0] });
      }
    }
  }
  return out;
}

for (const { name, fn, capturedCatches } of TEETH) {
  test(`TEETH: a twin with ${name} is CAUGHT`, () => {
    const captured = capturedBreaches(fn);
    const crafted = craftedBreaches(fn);
    assert.ok(captured.length + crafted.length > 0,
      `NEITHER arm caught the ${name} twin — the gate proves nothing about it`);

    if (capturedCatches) {
      assert.ok(captured.length > 0,
        `${name} was expected to be caught by the CAPTURED arm and was not (crafted caught ${crafted.length})`);
    } else {
      assert.equal(captured.length, 0,
        `${name} is documented as invisible to the captured arm, but that arm caught it ` +
        `${captured.length} times — the headers' coverage-hole claim is wrong`);
      assert.ok(crafted.length > 0, `${name} was expected to be caught by the CRAFTED arm and was not`);
    }

    const where = captured.length
      ? `captured frame ${captured[0].frame} — ${captured[0].first}`
      : `crafted [${crafted[0].shape}] frames=${crafted[0].frames} speed=${hx(crafted[0].speed)} — ${crafted[0].first}`;
    console.log(`  TEETH/${name}: captured ${captured.length}, crafted ${crafted.length}; first at ${where}`);
  });
}

// -- 5. the behaviour the routine's header rests on ---------------------------

/**
 * The routine's header says this turns an object around and gives it back less speed than it
 * arrived with. That is a PREDICTION about the run, and it is checked here rather than in a
 * scratchpad, so a later reader can re-derive it and a wrong reading can fail.
 *
 * The vertical step is read straight out of the capture run's per-frame dumps — the 16-bit
 * coordinate whose high byte is OBJ_X's sibling OBJ_Y (+5) and whose fraction is +6 — one frame
 * either side of the dispatch. Nothing here consults the rewrite; it is the ORACLE's own run.
 */
test("BEHAVIOUR: every dispatch turns the object around and returns less speed than it arrived with", () => {
  const { caps, frames, host } = attractRun();

  const offOf = new Map();
  const width = frames[0].length;
  for (let i = 0; i < width; i++) {
    const a = host.stateOffsetToAddr(i);
    if (!offOf.has(a)) offOf.set(a, i);
  }
  const yAt = (f, ix) => {
    const d = frames[f];
    if (!d) return null;
    return d[offOf.get((ix + 5) & 0xffff)] * 256 + d[offOf.get((ix + 6) & 0xffff)];
  };
  const s16 = (v) => (v << 16) >> 16;

  let checked = 0, reversed = 0, damped = 0, settled = 0;
  const sample = [];
  for (const c of caps) {
    const before = yAt(c.frame - 1, c.record), before2 = yAt(c.frame - 2, c.record);
    const after = yAt(c.frame + 1, c.record), after2 = yAt(c.frame + 2, c.record);
    if (before2 === null || after2 === null) continue;
    const arrival = s16(before - before2);
    const departure = s16(after2 - after);
    checked++;
    if (Math.sign(arrival) !== 0 && Math.sign(departure) !== 0 && Math.sign(arrival) !== Math.sign(departure)) reversed++;
    else if (departure === 0) settled++;
    if (Math.abs(departure) < Math.abs(arrival)) damped++;
    if (sample.length < 6) sample.push(`${arrival}->${departure}`);
  }

  assert.equal(checked, EXPECTED_DISPATCHES, `only ${checked} of ${caps.length} dispatches had frames either side`);
  assert.equal(damped, checked,
    `the object left FASTER than it arrived on ${checked - damped} dispatch(es) — the routine's ` +
    "header calls this a damped turn-around, and that reading would be wrong");
  assert.equal(reversed + settled, checked,
    `${checked - reversed - settled} dispatch(es) neither reversed direction nor came to rest — the ` +
    "header's reflection reading would be wrong");
  assert.ok(reversed > 0 && settled >= 0, "no dispatch reversed direction at all");

  console.log(`  BEHAVIOUR: ${checked} dispatches; direction reversed on ${reversed}, already at rest on ` +
    `${settled}; the departing step was smaller than the arriving one on ${damped} of ${checked}. ` +
    `First few (1/256 px per frame, positive = downward): ${sample.join(", ")}`);
});

// -- 6. the register exclusion, pinned ----------------------------------------

test("EXCLUSION: the alternate B/C are the only registers excluded, and only ROM 0x2407 moves them", () => {
  const { caps } = attractRun();
  let moved = 0;
  for (const c of caps) {
    const ix = c.entry.regs.ix;
    const operandHi = rd(c.entry, ix, LAUNCH_VY_HI);
    const operandLo = rd(c.entry, ix, LAUNCH_VY_LO);
    const a = c.entry.clone(), b = c.entry.clone();
    oracle(a);
    loc_20c3(b);
    if (a.regs.b_ === b.regs.b_ && a.regs.c_ === b.regs.c_) continue;
    moved++;
    assert.equal(a.regs.b_, operandHi,
      `frame ${c.frame}: the oracle's alternate B is ${a.regs.b_}, not the record's +0x12 byte ` +
      `${operandHi} — the exclusion is hiding a difference that is NOT ROM 0x2407's dead operand`);
    assert.equal(a.regs.c_, operandLo,
      `frame ${c.frame}: the oracle's alternate C is ${a.regs.c_}, not the record's +0x13 byte ` +
      `${operandLo} — the exclusion is hiding a difference that is NOT ROM 0x2407's dead operand`);
  }
  assert.ok(moved > 0,
    "the alternate B/C never differed on any capture — then excluding them is unnecessary and the " +
    "comparison should include them");
  assert.equal(EXCLUDED_REGS.size, 2, "more than two register fields are being excluded");
  console.log(`  EXCLUSION: the alternate B/C differ on ${moved} of ${caps.length} captures, and on every ` +
    "one of them the oracle's value is exactly the record's +0x12/+0x13 operand — ROM 0x2407's dead " +
    `load. All ${COMPARED_REGS.length} other register fields are compared, SP included.`);
});
