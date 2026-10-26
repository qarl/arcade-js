// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence gate for advanceFallingBarrel (ROM 0x20EC) — swap to the shadow register set, step one airborne
 * object along its arc, and pick one of three continuations from the object's OBJ_Y against the
 * snapshot in record byte +25. The two callees it invokes (ROM 0x239C the ballistic step, ROM
 * 0x2A2F the girder probe) are already idiomatic and are wired on BOTH sides of every comparison
 * here, so they are not what is under test; the three continuations are still frozen and run as the
 * same oracle on both sides. What this gate has to prove is the head: the register-bank swap, the
 * re-arm comparison including its 8-bit wrap, which continuation is chosen, and that the
 * continuation's result travels back out.
 *
 *   0. REACHABILITY — how many real dispatches a 1200-frame attract run produces, how many distinct
 *      entry shapes, and which continuation each one takes. The arm label is derived from the
 *      GATE'S OWN ORACLE (by watching which address the oracle's registry dispatch reaches first),
 *      never from the rewrite, so nothing here is circular. Attract turns out to reach ALL THREE
 *      continuations unaided, which is why arm 2 is about frontiers rather than about arms.
 *
 *   1. EQUAL (captured) — replayed INLINE AT THE DISPATCH: at each one the host rehosts the entry
 *      state into a FRESH override-free Machine, clones it twice, runs the oracle on one and the
 *      rewrite on the other, compares, and discards. EVERY dispatch is replayed; nothing is sampled.
 *      Rehosting rather than cloning the host is what makes that affordable and correct — this
 *      routine's continuation re-enters the object loop that dispatches it, so a clone of the host
 *      would carry the capturing override back into the replay and recurse.
 *      Compared: WHICH continuation was entered, every live cell of the state dump, SP, the program
 *      counter and the return value. The continuation is compared explicitly because the three
 *      RECONVERGE — ROM 0x2101's gate hands most states straight on to ROM 0x2104 — so choosing the
 *      wrong one can leave live RAM identical, which is measured to happen on the crafted entries
 *      of arm 2. The dead stack scratch is EXCLUDED and reported separately: the rewrite dissolves
 *      the two call brackets the oracle places around its callees, so the oracle's transient return
 *      addresses have no counterpart there. That is the expected difference, not a defect, and the
 *      count of captures showing it is printed.
 *
 *   2. EQUAL (crafted: two frontiers attract does not provide) — every capture is re-run with
 *      record byte +25 poked to the exact re-arm boundary and to one past it, which pins the
 *      comparison in both directions; and with the record poked to a sub-26 OBJ_Y, where the 8-bit
 *      subtraction wraps, in both a passing and a blocking configuration. Each craft asserts, using
 *      the oracle, that it really reached the intended continuation, so it cannot silently
 *      degenerate into more of arm 1.
 *
 *   3. PROTOCOL (stubbed continuations) — all three continuations are replaced, on each fresh clone,
 *      by stubs that record their invocation and hand back a sentinel. The expected sequence and
 *      value come from the ORACLE driven through the same stubs. This is the arm with teeth on the
 *      RETURN VALUE, and it is not optional: the oracle returns `undefined` on all 177 real
 *      dispatches, so a rewrite that swallowed its continuation's result would be invisible
 *      everywhere else. Stubbing the continuations also strips the enormous downstream chain out of
 *      the RAM comparison, which is what makes this arm able to point at the head's own writes.
 *
 *   4. LIVE-WIRE — the rewrite drives a whole 1400-frame attract run as a registered override, and
 *      every frame of the state trace must match a baseline that differs in EXACTLY ONE THING. The
 *      baseline is not an all-oracle machine: it wires the same two idiomatic callees this rewrite
 *      direct-calls and swaps only ROM 0x20EC back to its oracle. Both sides run under the
 *      cycle-free engine at the manifest's vblank poll PC, so the T-states the rewrite does not
 *      charge move nothing — the NMI is timed by control flow there, not by a clock. The comparison
 *      is the FULL dump INCLUDING the stack scratch: the brackets the rewrite dissolves are
 *      transient and the main loop has overwritten those bytes by the time a frame is sampled, so
 *      they legitimately hold here even though they cannot hold per-dispatch. The dispatch count is
 *      asserted non-zero and pinned, because a live arm that never runs the routine passes green.
 *
 *   5. LIVE-WIRE CONTROL — the same run wired with a broken twin must fork, so arm 4 is shown to be
 *      sensitive; and the wrap twin is confirmed to survive arm 4 untouched, which is the measured
 *      reason arm 2 is not optional.
 *
 *   6. TEETH — four broken twins, caught by disjoint arms:
 *        (a) no bank swap   — drops the `exx`. Caught by the captures, and it takes the live run
 *                             down 794 frames early rather than diverging, so the harness treats a
 *                             thrown fault as a result.
 *        (b) swapped tails  — contact and no-contact continuations exchanged. Caught by the
 *                             captures on live RAM, and by the live run.
 *        (c) signed compare — drops the 8-bit wrap on the re-arm subtraction. INVISIBLE to the
 *                             captures and to the whole live run (attract never presents an OBJ_Y
 *                             under 26); caught ONLY by the crafted wrap entries, and there only by
 *                             the continuation check — on those entries the two arms reconverge and
 *                             leave identical live RAM, SP, pc and return value.
 *        (d) swallowed result — correct control flow, hands back nothing. Invisible to RAM, SP, pc
 *                             and even to the captured return comparison, because the oracle also
 *                             returns undefined there; caught ONLY by the stubbed protocol arm.
 *
 * COVERAGE THIS DOES NOT CLAIM: attract only, plus pokes and stubs on top of attract state. No
 * credited game, no board past 25m, and one record base only (0x6700) — attract activates no other
 * slot through this branch.
 *
 * LIVE-OUT, DERIVED — cross-file, and therefore recorded here rather than in the routine. The
 * oracle leaves the accumulator holding the gate's difference and the shadow B holding the +25
 * snapshot; both are dead. Every continuation overwrites the accumulator with its first instruction
 * (ROM 0x2104 and 0x2118 load it from the record, ROM 0x2101 reaches ROM 0x24B4 which does the
 * same), and every routine reachable before ROM 0x21BA swaps the banks back either never touches B
 * or writes B/BC before reading it (ROM 0x1FE5, 0x1FEF, 0x215F, 0x2407) — the one genuine read, the
 * loop's own slot counter at ROM 0x1F8D, runs after that swap and so reads the main-set copy, not
 * this one. The flags are dead for the same reason as the accumulator. Arm 4 is the measurement:
 * the live-wire run reproduces the baseline byte-for-byte over its 1400 frames with the shadow-B
 * write dropped.
 *
 * ALSO CROSS-FILE, so it lives here: ROM 0x32D6 zeroes a +25 as well, but on the record family
 * reached through 0x63C8, not through the slot array this branch walks. And record byte +25 has
 * exactly one writer in this object cascade — ROM 0x2146, on the arm the CONTACT continuation leads
 * to — which stores a copy of the record's own OBJ_Y there. That is what makes +25 a snapshot of
 * the last registered contact, and the comparison a re-arm distance.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-20ec.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_20ec as oracle } from "../../translated/loc_20ec.js";
import { loc_239c as gravityOracle } from "../../translated/loc_239c.js";
import { advanceFallingBarrel } from "../advanceFallingBarrel.js";
import { loc_2a2f } from "../loc_2a2f.js";
import { stepBallisticMotion } from "../stepBallisticMotion.js";
import { Machine } from "../../machine.js";
import manifest from "../../manifest.js";
import { runCycleFree } from "../../../../core/frame-stepped.js";
import { STACK_SCRATCH } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const TARGET = 0x20ec;
const REARM_TAIL = 0x2104; //  the off-the-edge check, taken while the probe is still suppressed
const CONTACT_TAIL = 0x2118; // taken when the probe reports the object touching a slope
const CLEAR_TAIL = 0x2101; //  taken when the probe reports no contact
const TAILS = [REARM_TAIL, CONTACT_TAIL, CLEAR_TAIL];

const CAPTURE_FRAMES = 1200; // the attract run arms 1-3 replay
const LIVE_FRAMES = 1400; //   the live-wire run and its baseline

// The census this file's header quotes. Asserted, not merely
// printed, so neither header can go stale without a test failure naming the new numbers.
const EXPECTED_DISPATCHES = 177;
const EXPECTED_SHAPES = 136;
const EXPECTED_ARMS = { "0x2104": 140, "0x2118": 6, "0x2101": 31 };
const EXPECTED_LIVE_DISPATCHES = 279;

// Record offsets, restated here rather than imported from the routine, so the crafted arm rests on
// an independent statement of the layout. +5/+6 and +18/+19 and +20 are the ballistic step's own
// fields (ROM 0x239C); +25 is the field this routine reads.
const REC_Y = 5;
const REC_Y_FRAC = 6;
const REC_VY_HI = 0x12;
const REC_VY_LO = 0x13;
const REC_AIR_FRAMES = 0x14;
const REC_CONTACT_Y = 25;
const REARM_DISTANCE = 26;
const WRAP_Y = 5; // a sub-26 OBJ_Y: attract never produces one, so the wrap is crafted-only

const hx = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// -- rehosting ----------------------------------------------------------------

/**
 * Copy a machine's observable state into a FRESH, override-free Machine.
 *
 * clone() reruns the constructor with the source's own assets, so a clone of the capturing host
 * carries the capturing override with it — and this routine's continuation re-enters the object
 * loop that dispatches it, so that override would fire again DURING a replay and the replay would
 * recurse into itself. Rehosting is the fix: the replay machines have no overrides at all, so a
 * nested dispatch inside a replay runs the pure oracle on both sides, which is exactly the
 * isolation the unit comparison wants. Clones taken FROM a rehosted machine inherit its empty
 * assets and stay override-free, so one rehost per dispatch is enough.
 *
 * The frame machinery is neutralised exactly as clone() does it, so running the routine in
 * isolation cannot trip a frame sample or fire an NMI whose handler would write RAM and masquerade
 * as a side effect of the routine.
 */
function rehost(src) {
  const c = new Machine(ROM);
  c.mem.workRam.set(src.mem.workRam);
  c.mem.spriteRam.set(src.mem.spriteRam);
  c.mem.videoRam.set(src.mem.videoRam);
  c.mem.discardedWrites = src.mem.discardedWrites;
  c.regs.copyFrom(src.regs);
  c.io.loadStateFrom(src.io);
  c.cycles = src.cycles;
  c.pc = src.pc;
  c.pcKnown = src.pcKnown;
  c.frame = src.frame;
  c.nmiCount = src.nmiCount;
  c.booted = src.booted;
  c.nextBoundary = Infinity;
  c.nextNmi = Infinity;
  c.maxFrames = Infinity;
  c.maxCycles = Infinity;
  return c;
}

// -- the contract -------------------------------------------------------------

/**
 * Run `fn` on `machine` and report both what it returned and WHICH continuation it entered — the
 * first of the three continuation addresses its registry dispatch reaches. Both sides enter their
 * continuation through the registry (the rewrite direct-calls only the two idiomatic callees, and
 * nothing in either of those subtrees reaches a continuation), so this observes the same decision
 * on both without knowing anything about how either was written.
 *
 * A thrown error IS a result: hand a broken twin a state its continuation cannot handle and it
 * walks into ROM and faults rather than diverging, and a harness that lets that escape dies instead
 * of reporting.
 */
function runObserved(machine, fn) {
  let tail = null;
  const base = machine.call.bind(machine);
  machine.call = (addr, ...args) => {
    if (tail === null && TAILS.includes(addr)) tail = addr;
    return base(addr, ...args);
  };
  try {
    return { ret: String(fn(machine)), tail, fault: null };
  } catch (e) {
    return { ret: null, tail, fault: `${e.name}: ${e.message}` };
  }
}

/**
 * Run the oracle and `fn` on two byte-identical clones of `entry` and report the first contract
 * breach, or null.
 *
 * Checked in this order: the continuation entered, live RAM, SP, pc, the return value. The dead
 * stack scratch is reported separately and never fails — the rewrite dissolves the oracle's two
 * call brackets, so the oracle's transient return addresses have no counterpart there.
 */
function breach(entry, fn) {
  const a = entry.clone();
  const b = entry.clone();
  const oa = runObserved(a, oracle);
  if (oa.fault) return { fail: `HARNESS: the oracle itself faulted on this entry — ${oa.fault}` };
  const ob = runObserved(b, fn);
  if (ob.fault) return { fail: `fault: ${ob.fault}`, stack: null };

  // The continuation is part of the contract and is NOT a redundant restatement of the RAM diff:
  // the three continuations RECONVERGE — ROM 0x2101's gate hands most states straight on to ROM
  // 0x2104 — so a rewrite can pick the wrong one and still leave identical live RAM. Measured: that
  // is exactly what happens on the crafted wrap entries, where the only difference between the two
  // arms is one extra probe that writes nothing.
  if (oa.tail !== ob.tail) {
    return { fail: `continuation oracle=${hx(oa.tail)} cand=${hx(ob.tail)}`, stack: null };
  }

  const da = a.dumpState();
  const db = b.dumpState();
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  let stack = null;
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) {
      stack ??= `RAM(stack)@${hx(addr)} oracle=${da[i]} cand=${db[i]}`;
      continue;
    }
    return { fail: `RAM(live)@${hx(addr)} oracle=${da[i]} cand=${db[i]}`, stack };
  }
  if (a.regs.sp !== b.regs.sp) return { fail: `SP oracle=${hx(a.regs.sp)} cand=${hx(b.regs.sp)}`, stack };
  if (a.pc !== b.pc) return { fail: `pc oracle=${hx(a.pc)} cand=${hx(b.pc)}`, stack };
  if (oa.ret !== ob.ret) return { fail: `return oracle=${oa.ret} cand=${ob.ret}`, stack };
  return { fail: null, stack };
}

/**
 * Which continuation does the ORACLE take from this entry state? Answered by wrapping the registry
 * dispatch for the duration of the oracle's own run and taking the first of the three continuation
 * addresses it reaches. Not the rewrite's opinion, so using it to label coverage is not circular.
 */
function armOf(entry) {
  return runObserved(entry.clone(), oracle).tail;
}

/**
 * The OBJ_Y the ballistic step will leave for the comparison, measured with THAT step's own frozen
 * oracle on a throwaway clone. The crafted entries are calibrated against this, so they are aimed
 * by the oracle rather than by the rewrite.
 */
function steppedY(entry) {
  const p = entry.clone();
  p.regs.exx(); // the step reads no register but the record pointer; the swap keeps the model exact
  gravityOracle(p);
  return p.regs.h;
}

// -- the attract run: inline replay AND capture, in one pass -------------------

/**
 * ONE attract run serves every replay arm. At each real dispatch the host rehosts the entry state,
 * replays the EQUAL contract inline on two clones of it, records the shape and the oracle's arm,
 * and keeps the rehosted entry for the crafted and stubbed arms. 177 entries is not a memory
 * concern and nothing is sampled.
 */
let ATTRACT = null;
function attractRun() {
  if (ATTRACT) return ATTRACT;
  const caps = [];
  const shapes = new Map();
  const arms = new Map();
  const inlineBreaches = [];
  let dispatches = 0;
  let replayed = 0;
  let stackOnly = 0;

  const host = new Machine(ROM, {
    overrides: {
      "20ec": (mm) => {
        dispatches++;
        const entry = rehost(mm); // fresh, override-free: a replay cannot re-enter this hook
        const arm = armOf(entry);
        const y = steppedY(entry);
        const ref = entry.mem.read8((entry.regs.ix + REC_CONTACT_Y) & 0xffff);
        const shape = `${hx(entry.regs.ix)} y=${hx(y)} +25=${hx(ref)} -> ${hx(arm)}`;
        shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
        arms.set(hx(arm), (arms.get(hx(arm)) ?? 0) + 1);

        const b = breach(entry, advanceFallingBarrel); // the inline EQUAL replay, at the dispatch
        replayed++;
        if (b.fail) inlineBreaches.push(`[${shape}] ${b.fail}`);
        if (b.stack) stackOnly++;

        caps.push({ entry, shape, arm, y, ref });
        return oracle(mm);
      },
    },
  });
  host.runFrames(CAPTURE_FRAMES);
  ATTRACT = { caps, shapes, arms, dispatches, replayed, stackOnly, inlineBreaches, host };
  return ATTRACT;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x20EC is dispatched during 25m attract, and attract reaches all three arms", () => {
  const { caps, shapes, arms, dispatches, host } = attractRun();
  assert.equal(host.stoppedBy ?? null, null, `capture run stopped early: ${host.stoppedBy}`);
  assert.ok(caps.length > 0, "0x20EC should be dispatched — the object update cascade reaches it");

  // The census both headers quote. If these move, the headers are stale — update them together.
  assert.equal(
    dispatches,
    EXPECTED_DISPATCHES,
    `the dispatch count changed (${dispatches}); this file quotes ${EXPECTED_DISPATCHES}`,
  );
  assert.equal(
    shapes.size,
    EXPECTED_SHAPES,
    `the entry-shape count changed (${shapes.size}); both headers quote ${EXPECTED_SHAPES}`,
  );
  assert.deepEqual(
    Object.fromEntries([...arms].sort()),
    Object.fromEntries(Object.entries(EXPECTED_ARMS).sort()),
    "the per-arm dispatch counts changed; both headers quote them",
  );

  // The premise of the crafted wrap entries, measured: attract never presents a sub-26 OBJ_Y here,
  // so no captured dispatch can distinguish an 8-bit subtraction from a signed one.
  const low = caps.filter((c) => c.y < REARM_DISTANCE);
  assert.equal(
    low.length,
    0,
    `attract produced ${low.length} dispatches with OBJ_Y under ${REARM_DISTANCE} after all — the ` +
      "routine header's crafted-only claim about the wrap needs rechecking",
  );

  const bases = new Set(caps.map((c) => hx(c.entry.regs.ix)));
  console.log(
    `  REACHABILITY: ${dispatches} natural dispatches in ${CAPTURE_FRAMES} attract frames, ` +
      `${shapes.size} distinct entry shapes on ${bases.size} record base(s) ${[...bases].join(",")}; ` +
      `arms ${[...arms].map(([k, v]) => `${k}x${v}`).join(" ")}; lowest OBJ_Y seen ` +
      `${Math.min(...caps.map((c) => c.y))}`,
  );
});

// -- 1. EQUAL (captured, replayed inline at the dispatch) ----------------------

test("EQUAL (captured): advanceFallingBarrel == oracle on EVERY real dispatch, replayed inline", () => {
  const { dispatches, replayed, inlineBreaches, stackOnly } = attractRun();
  assert.ok(replayed > 0, "no dispatch was replayed — this arm would prove nothing");
  assert.equal(
    replayed,
    dispatches,
    `${replayed} of ${dispatches} dispatches were replayed — every one must be, nothing is sampled here`,
  );
  assert.deepEqual(inlineBreaches, [], `inline replay breach: ${inlineBreaches[0] ?? ""}`);

  console.log(
    `  EQUAL/captured: ALL ${replayed} of ${dispatches} real dispatches replayed inline and identical ` +
      `on every live cell, SP, pc and the return value; ${stackOnly} of them differ inside the dead ` +
      "stack scratch, which is the two dissolved call brackets and is expected",
  );
});

// -- 2. EQUAL (crafted: the two frontiers attract does not provide) ------------

/** A capture with record byte +25 poked to `ref`. */
function withRef(entry, ref) {
  const e = entry.clone();
  e.mem.write8((e.regs.ix + REC_CONTACT_Y) & 0xffff, u8(ref));
  return e;
}

/**
 * A capture forced to a sub-26 OBJ_Y, where the re-arm subtraction wraps. The vertical velocity and
 * the airborne-frame counter are zeroed so the ballistic step's own arithmetic is pinned too — the
 * step then adds only its base gravity slice, which cannot carry out of the fraction byte, so the
 * stepped OBJ_Y is exactly what is poked here. That is asserted rather than assumed below.
 */
function withLowY(entry, ref) {
  const e = entry.clone();
  const at = (d) => (e.regs.ix + d) & 0xffff;
  e.mem.write8(at(REC_Y), WRAP_Y);
  e.mem.write8(at(REC_Y_FRAC), 0);
  e.mem.write8(at(REC_VY_HI), 0);
  e.mem.write8(at(REC_VY_LO), 0);
  e.mem.write8(at(REC_AIR_FRAMES), 0);
  e.mem.write8(at(REC_CONTACT_Y), u8(ref));
  return e;
}

test("EQUAL (crafted): the re-arm boundary and the 8-bit wrap match the oracle on every capture", () => {
  const { caps } = attractRun();
  let compared = 0;
  const armsSeen = new Map();

  for (const { entry, shape, y } of caps) {
    // The exact boundary, both directions. +25 == steppedY - 26 must NOT suppress the probe;
    // one more must. Which arm each produces is read off the oracle, so the craft cannot
    // silently degenerate into more of arm 1.
    const crafts = [
      { label: "boundary-armed", e: withRef(entry, y - REARM_DISTANCE), want: null },
      { label: "boundary-suppressed", e: withRef(entry, y - REARM_DISTANCE + 1), want: REARM_TAIL },
      { label: "wrap-armed", e: withLowY(entry, WRAP_Y + 5), want: null },
      { label: "wrap-suppressed", e: withLowY(entry, u8(WRAP_Y - REARM_DISTANCE) + 5), want: REARM_TAIL },
    ];

    for (const { label, e, want } of crafts) {
      if (label.startsWith("wrap")) {
        assert.ok(
          steppedY(e) < REARM_DISTANCE,
          `[${shape}] ${label}: the poked record does not step to a sub-${REARM_DISTANCE} OBJ_Y ` +
            `(got ${steppedY(e)}) — this craft is not exercising the wrap`,
        );
      }
      const arm = armOf(e);
      armsSeen.set(`${label}:${hx(arm)}`, (armsSeen.get(`${label}:${hx(arm)}`) ?? 0) + 1);
      if (want === null) {
        assert.notEqual(
          arm,
          REARM_TAIL,
          `[${shape}] ${label}: expected the probe to be ARMED, but the oracle suppressed it`,
        );
      } else {
        assert.equal(
          arm,
          want,
          `[${shape}] ${label}: expected the oracle to reach ${hx(want)}, it reached ${hx(arm)}`,
        );
      }
      const b = breach(e, advanceFallingBarrel);
      assert.equal(b.fail, null, `[${shape}] ${label}: ${b.fail}`);
      compared++;
    }
  }

  console.log(
    `  EQUAL/crafted: ${compared} replays (4 crafted entries x ${caps.length} real captures) all ` +
      `identical to the oracle; arms reached: ${[...armsSeen].map(([k, v]) => `${k}x${v}`).join(" ")}`,
  );
});

// -- 3. PROTOCOL (stubbed continuations, harness-dictated result) --------------

const SENTINEL = 0xc0de; // no real routine returns this, so seeing it back proves the stub ran

/**
 * Run `fn` on a fresh clone whose three continuations are STUBS, and report the observable
 * protocol: which continuation was entered, the value handed back, the net stack movement, and the
 * live RAM the head itself wrote. Stubs are installed on THIS clone — clone() rebuilds the routine
 * table from assets, so a stub set on a parent machine would silently vanish here.
 *
 * With the continuations stubbed the enormous downstream chain is gone from the dump, so this is
 * the only comparison that can point at the head's own memory effects. The dead stack scratch stays
 * out of it for the same reason as everywhere else: the rewrite dissolves the oracle's brackets.
 */
function protocol(entry, fn) {
  const m = entry.clone();
  const log = [];
  for (const t of TAILS) {
    m.routines.set(t, () => {
      log.push(hx(t));
      return SENTINEL;
    });
  }
  const spEntry = m.regs.sp;
  let ret;
  try {
    ret = fn(m);
  } catch (e) {
    return { log: log.join(","), ret: `fault: ${e.name}`, spDelta: 0, live: [] };
  }
  const dump = m.dumpState();
  const live = [];
  const dead = deadStackBelow(STACK_SCRATCH, spEntry);
  for (let i = 0; i < dump.length; i++) {
    const addr = m.stateOffsetToAddr(i);
    if (!dead(addr)) live.push(dump[i]);
  }
  return { log: log.join(","), ret: String(ret), spDelta: ((m.regs.sp - spEntry) << 16) >> 16, live };
}

/** Compare two protocol observations and name the first thing that differs, or null. */
function protocolDiff(want, got) {
  if (want.log !== got.log) return `call sequence oracle=[${want.log}] cand=[${got.log}]`;
  if (want.ret !== got.ret) return `return oracle=${want.ret} cand=${got.ret}`;
  if (want.spDelta !== got.spDelta) return `SP delta oracle=${want.spDelta} cand=${got.spDelta}`;
  for (let i = 0; i < want.live.length; i++) {
    if (want.live[i] !== got.live[i]) return `live RAM byte ${i} oracle=${want.live[i]} cand=${got.live[i]}`;
  }
  return null;
}

test("PROTOCOL: the continuation entered and the value handed back match the oracle", () => {
  const { caps } = attractRun();
  let compared = 0;
  const seen = new Map();

  for (const { entry, shape } of caps) {
    const want = protocol(entry, oracle); // expectation from the ORACLE, not from us
    const got = protocol(entry, advanceFallingBarrel);
    const d = protocolDiff(want, got);
    assert.equal(d, null, `[${shape}] ${d}`);
    seen.set(want.log, (seen.get(want.log) ?? 0) + 1);
    compared++;
  }

  // The stubs are live and are what produced these observations — a stub nobody can see fire is
  // indistinguishable from no stub at all, and would make this arm green and empty.
  const probe = protocol(caps[0].entry, oracle);
  assert.ok(TAILS.map(hx).includes(probe.log), `the continuation stubs did not fire: log=[${probe.log}]`);
  assert.equal(probe.ret, String(SENTINEL), "the stub's sentinel did not come back out of the oracle");
  assert.equal(probe.spDelta, 0, `the oracle's head is not stack-neutral with the tails stubbed: ${probe.spDelta}`);

  // Every continuation must have been exercised through the stubs, or this arm silently covers one.
  assert.deepEqual(
    [...seen.keys()].sort(),
    TAILS.map(hx).sort(),
    `the stubbed arm did not reach all three continuations: ${[...seen.keys()].join(",")}`,
  );

  console.log(
    `  PROTOCOL: ${compared} stubbed replays; sequences observed ` +
      `${[...seen].map(([k, v]) => `${k}x${v}`).join(" ")}; sentinel ${hx(SENTINEL)} forwarded, ` +
      "head stack-neutral, head live RAM identical",
  );
});

// -- 4/5. LIVE-WIRE -----------------------------------------------------------

/**
 * A cycle-free attract run at the manifest's vblank poll PC with `candidate` wired live at 0x20EC.
 *
 * THE BASELINE DIFFERS IN EXACTLY ONE THING. Both sides wire the two idiomatic callees this rewrite
 * direct-calls (ROM 0x239C and 0x2A2F); only the routine at 0x20EC changes. An all-oracle baseline
 * would be the wrong control — wiring those callees moves the trace on its own, and that would read
 * as a defect in this rewrite.
 *
 * The cycle-free engine is what makes the missing T-states harmless: it fires the vblank NMI when
 * control reaches the poll PC rather than when a clock says so, so the head instructions this
 * rewrite does not charge for move nothing. Under the cycle-accurate scheduler they would shift the
 * NMI and fork the run for reasons unrelated to the contract.
 */
function cycleFreeRun(candidate) {
  let dispatches = 0;
  const m = new Machine(ROM, {
    overrides: {
      "239c": stepBallisticMotion,
      "2a2f": loc_2a2f,
      "20ec": (mm) => {
        dispatches++;
        return candidate(mm);
      },
    },
  });
  const trace = [];
  const r = runCycleFree(m, {
    pollPCs: manifest.convergence.pollPCs,
    maxFrames: LIVE_FRAMES,
    stepBudget: LIVE_FRAMES * 200000,
    onFrame: (mm) => trace.push(Buffer.from(mm.dumpState())),
  });
  return { m, trace, run: r, dispatches };
}

/** First frame+byte where two traces differ, over the FULL dump (stack scratch included). */
function firstTraceDiff(base, other, offToAddr) {
  for (let f = 0; f < Math.min(base.length, other.length); f++) {
    for (let i = 0; i < base[f].length; i++) {
      if (base[f][i] === other[f][i]) continue;
      return { frame: f, addr: offToAddr(i), a: base[f][i], b: other[f][i] };
    }
  }
  return null;
}

let BASELINE = null;
function baseline() {
  if (!BASELINE) BASELINE = cycleFreeRun(oracle);
  return BASELINE;
}

test("LIVE-WIRE: advanceFallingBarrel drives a whole attract run identical to the one-thing-different baseline", () => {
  const base = baseline();
  assert.equal(base.run.stopError, null, `baseline run errored: ${base.run.stop}`);
  assert.equal(base.run.frames, LIVE_FRAMES, `baseline reached only ${base.run.frames} frames`);

  const live = cycleFreeRun(advanceFallingBarrel);
  assert.equal(live.run.stopError, null, `live-wire run errored: ${live.run.stop}`);
  assert.equal(live.run.frames, LIVE_FRAMES, `live-wire run reached only ${live.run.frames} frames`);

  // A live arm that never executes the routine passes green and proves nothing. Pin the count.
  assert.ok(live.dispatches > 0, "the override was never dispatched — this arm would be vacuous");
  assert.equal(
    live.dispatches,
    EXPECTED_LIVE_DISPATCHES,
    `the live dispatch count changed (${live.dispatches}); both headers quote ${EXPECTED_LIVE_DISPATCHES}`,
  );
  assert.equal(base.dispatches, live.dispatches, "the two runs did not dispatch the routine equally often");
  assert.equal(base.trace.length, live.trace.length, "the two runs did not reach the same frame count");

  const d = firstTraceDiff(base.trace, live.trace, (o) => base.m.stateOffsetToAddr(o));
  assert.equal(d, null, d && `frame ${d.frame} diverged at ${hx(d.addr)}: baseline=${d.a} live-wire=${d.b}`);

  console.log(
    `  LIVE-WIRE: ${live.dispatches} dispatches over ${LIVE_FRAMES} cycle-free attract frames — all ` +
      `${live.trace.length} sampled states identical to the baseline on the FULL dump, stack scratch ` +
      "included (the dissolved brackets are transient and overwritten before a frame is sampled)",
  );
});

test("LIVE-WIRE CONTROL: a broken twin DOES fork the run, and the wrap twin does not", () => {
  const base = baseline();
  const off = (o) => base.m.stateOffsetToAddr(o);

  // Sensitivity: if this did not fork, the arm above could not be distinguishing anything.
  const bad = cycleFreeRun(twinSwappedTails);
  const d = firstTraceDiff(base.trace, bad.trace, off);
  assert.notEqual(d, null, "the swapped-tails twin matched the baseline — the live arm is not sensitive");

  // And the measured reason the crafted arm is not optional: the signed-compare twin runs a whole
  // attract sequence without ever being wrong, because attract never presents a sub-26 OBJ_Y.
  const blind = cycleFreeRun(twinSignedCompare);
  assert.ok(blind.dispatches > 0, "the signed-compare twin was never dispatched — nothing was measured");
  assert.equal(blind.run.frames, LIVE_FRAMES, "the signed-compare twin did not complete the run");
  const dBlind = firstTraceDiff(base.trace, blind.trace, off);
  assert.equal(
    dBlind,
    null,
    dBlind &&
      "the live run caught the signed-compare twin, so attract IS presenting a sub-26 OBJ_Y — the " +
        "routine header's crafted-only claim needs rechecking",
  );

  console.log(
    `  CONTROL: swapped-tails forks at frame ${d.frame}, ${hx(d.addr)} (baseline=${d.a} twin=${d.b}); ` +
      `signed-compare survives all ${blind.trace.length} frames over ${blind.dispatches} dispatches — ` +
      "only the crafted wrap entries see it",
  );
});

// -- 6. TEETH -----------------------------------------------------------------

/** Twin (a): never swaps to the shadow register set, so the object loop's own state is clobbered. */
function twinNoBankSwap(m) {
  const { regs, mem8 } = m;
  const record = regs.ix;
  stepBallisticMotion(m);
  const objectY = regs.h;
  if (u8(objectY - REARM_DISTANCE) < mem8[record + REC_CONTACT_Y]) return m.call(REARM_TAIL);
  if (loc_2a2f(m)) return m.call(CONTACT_TAIL);
  return m.call(CLEAR_TAIL);
}

/** Twin (b): contact and no-contact continuations exchanged. */
function twinSwappedTails(m) {
  const { regs, mem8 } = m;
  const record = regs.ix;
  regs.exx();
  stepBallisticMotion(m);
  const objectY = regs.h;
  if (u8(objectY - REARM_DISTANCE) < mem8[record + REC_CONTACT_Y]) return m.call(REARM_TAIL);
  if (loc_2a2f(m)) return m.call(CLEAR_TAIL);
  return m.call(CONTACT_TAIL);
}

/** Twin (c): a signed subtraction, so the re-arm comparison loses its 8-bit wrap. */
function twinSignedCompare(m) {
  const { regs, mem8 } = m;
  const record = regs.ix;
  regs.exx();
  stepBallisticMotion(m);
  const objectY = regs.h;
  if (objectY - REARM_DISTANCE < mem8[record + REC_CONTACT_Y]) return m.call(REARM_TAIL);
  if (loc_2a2f(m)) return m.call(CONTACT_TAIL);
  return m.call(CLEAR_TAIL);
}

/** Twin (d): correct control flow, but swallows the continuation's result. */
function twinSwallowResult(m) {
  advanceFallingBarrel(m);
}

/** Replay every real capture against `twin`; report how many breached and the first breach. */
function overCaptures(twin) {
  const { caps } = attractRun();
  const hits = [];
  for (const { entry, shape } of caps) {
    const b = breach(entry, twin);
    if (b.fail) hits.push(`[${shape}] ${b.fail}`);
  }
  return { caught: hits.length, total: caps.length, first: hits[0] ?? null };
}

/** Replay every crafted WRAP entry against `twin` — the frontier attract does not provide. */
function overWrapCrafted(twin) {
  const { caps } = attractRun();
  const hits = [];
  for (const { entry, shape } of caps) {
    for (const ref of [WRAP_Y + 5, u8(WRAP_Y - REARM_DISTANCE) + 5]) {
      const b = breach(withLowY(entry, ref), twin);
      if (b.fail) hits.push(`[${shape}] +25=${hx(u8(ref))} ${b.fail}`);
    }
  }
  return { caught: hits.length, total: caps.length * 2, first: hits[0] ?? null };
}

/** Replay every capture through the stubbed protocol against `twin`. */
function overProtocol(twin) {
  const { caps } = attractRun();
  const hits = [];
  for (const { entry, shape } of caps) {
    const d = protocolDiff(protocol(entry, oracle), protocol(entry, twin));
    if (d) hits.push(`[${shape}] ${d}`);
  }
  return { caught: hits.length, total: caps.length, first: hits[0] ?? null };
}

test("TEETH: four broken twins are CAUGHT, each by the arm that must catch it", () => {
  // Sanity: the real routine passes every arm, so a caught twin is a real defect signal.
  assert.equal(overCaptures(advanceFallingBarrel).caught, 0, "the correct routine must pass the captured arm");
  assert.equal(overWrapCrafted(advanceFallingBarrel).caught, 0, "the correct routine must pass the crafted wrap arm");
  assert.equal(overProtocol(advanceFallingBarrel).caught, 0, "the correct routine must pass the stubbed protocol arm");

  // (a) no bank swap — the captures see it, mostly as a fault rather than a diff.
  const a = overCaptures(twinNoBankSwap);
  assert.ok(a.caught > 0, "the no-bank-swap twin escaped — the register-bank contract is unproven");

  // (b) swapped tails — caught on the states attract really produces. The continuation check sees
  // it first; the live-wire control above is the independent confirmation that it also moves real
  // live RAM (frame 607 at 0x6706), so this is not a harness-only signal.
  const b = overCaptures(twinSwappedTails);
  assert.ok(b.caught > 0, "the swapped-tails twin escaped — the continuation choice is unproven");
  assert.ok(b.first.includes("continuation"), `expected a continuation breach, got: ${b.first}`);

  // (c) signed compare — INVISIBLE to the captures (attract has no sub-26 OBJ_Y); only the wrap
  // craft sees it. This asymmetry is the whole reason the crafted arm exists.
  const cCaps = overCaptures(twinSignedCompare);
  const cWrap = overWrapCrafted(twinSignedCompare);
  assert.equal(
    cCaps.caught,
    0,
    `the captured arm caught the signed-compare twin (${cCaps.first}) — attract IS presenting a ` +
      "sub-26 OBJ_Y, so the crafted arm's premise needs rechecking",
  );
  assert.ok(cWrap.caught > 0, "the signed-compare twin escaped the crafted wrap arm — the wrap is unproven");
  assert.ok(
    cWrap.first.includes("continuation"),
    `expected the CONTINUATION check to catch the wrap twin (the arms reconverge in RAM), got: ${cWrap.first}`,
  );

  // (d) swallowed result — invisible to RAM, SP, pc, and even to the captured return comparison
  // (the oracle returns undefined on every real dispatch). Only the sentinel sees it.
  const dCaps = overCaptures(twinSwallowResult);
  const dProto = overProtocol(twinSwallowResult);
  assert.equal(
    dCaps.caught,
    0,
    `the captured arm caught the swallowed-result twin (${dCaps.first}) — the oracle is returning ` +
      "something after all, so the protocol arm's premise needs rechecking",
  );
  assert.ok(dProto.caught > 0, "the swallowed-result twin escaped — the return value is unasserted");
  assert.ok(dProto.first.includes("return"), `expected the RETURN check to catch it, got: ${dProto.first}`);

  console.log(
    `  TEETH: no-bank-swap ${a.caught}/${a.total} captures (${a.first}); swapped-tails ${b.caught}/${b.total} ` +
      `(${b.first}); signed-compare ${cWrap.caught}/${cWrap.total} crafted-wrap, ${cCaps.caught}/${cCaps.total} ` +
      `captures as expected (${cWrap.first}); swallowed-result ${dProto.caught}/${dProto.total} protocol, ` +
      `${dCaps.caught}/${dCaps.total} captures as expected (${dProto.first})`,
  );
});
