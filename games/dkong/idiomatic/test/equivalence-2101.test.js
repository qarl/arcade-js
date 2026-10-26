// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2101 (ROM 0x2101) — call the object retirement gate at ROM 0x24B4 and
 * fall through into the left-edge check at ROM 0x2104 only when that gate returns. Both
 * destinations are the frozen oracle on BOTH sides here and are therefore NOT under test. What
 * this gate has to prove is the protocol: the return-address bracket is placed, the gate is
 * called, and the fall-through runs if and only if the gate answered that control came back.
 *
 *   0. REACHABILITY — how many real dispatches a 1200-frame attract run produces, how many
 *      distinct entry shapes they cover, and — measured with the GATE'S OWN ORACLE, not with the
 *      rewrite — which branch each one takes. Every one takes the same branch, which is why arm 2
 *      exists.
 *
 *   1. EQUAL (captured) — replayed INLINE AT THE DISPATCH: at each one the host clones twice, runs
 *      the oracle on one clone and the rewrite on the other, compares, and discards. Every
 *      dispatch is replayed; nothing is sampled. The comparison is the FULL state dump, split so
 *      it reports whether the byte that differs is a live cell or one in the dead stack scratch,
 *      plus SP, the program counter and the RETURN VALUE. pc and SP are compared because this
 *      rewrite keeps every stack operation the oracle performs and therefore legitimately holds
 *      them — and SP is the ONLY check that sees a dropped bracket (twin c below).
 *
 *   2. EQUAL (crafted: the retirement arm attract never takes) — the branch this routine exists
 *      for is never taken during attract, so it is reached by poking a REAL captured entry: the
 *      record's vertical position to the gate's firing threshold and its horizontal position to
 *      three places inside the gate's firing band, on every capture. The arm is asserted to have
 *      actually flipped by running the gate's own frozen oracle, so the craft cannot silently
 *      degenerate into more of arm 1.
 *
 *   3. PROTOCOL (stubbed destinations) — both destinations are replaced, on each fresh clone, by
 *      stubs that record their invocation and let the harness DICTATE the gate's answer. The
 *      expected call sequence is taken from the ORACLE run through the same stubs, so it is not
 *      circular. This pins "call the gate first, then the fall-through if and only if the answer
 *      was true", and the value pushed as the return address, against a verdict this file chooses
 *      rather than one attract happens to produce. The stubs are installed per clone — a stub set
 *      on a parent machine does NOT survive clone(), which rebuilds its routine table — and their
 *      liveness is asserted rather than assumed.
 *
 *   4. LIVE-WIRE — the rewrite drives a whole 1400-frame attract run as a registered override and
 *      every frame of the state trace must match the all-oracle baseline on the FULL dump,
 *      including the stack scratch (this rewrite has no stack traffic of its own to lose). Both
 *      sides run under the CYCLE-FREE engine at the manifest's vblank poll PC, which is what makes
 *      the 17 T-states the rewrite does not charge for the dropped call instruction a non-issue:
 *      the NMI is timed by control flow there, not by the clock, so there is no deficit to repay
 *      and no PRNG to reseed. The dispatch count is asserted non-zero and pinned, because a live
 *      arm that never executes the routine passes green while proving nothing.
 *
 *   5. LIVE-WIRE CONTROL — the same run wired with a broken twin MUST fork, so arm 4 is shown to
 *      be sensitive rather than lenient; and the twin that only arm 2 can see is confirmed to slip
 *      through arm 4 untouched, which is the measured reason arm 2 is not optional.
 *
 *   6. TEETH — four broken twins. The three replay arms catch DISJOINT sets, which is the point:
 *        (a) no guard        — continues inline after the gate retired the object. INVISIBLE to
 *                              arms 1 and 4 (attract never takes that branch); caught only by
 *                              arm 2, mostly as a FAULT rather than a diff, so the harness treats
 *                              a thrown error as a result.
 *        (b) wrong tail      — falls into ROM 0x2118 instead of ROM 0x2104. Caught by arm 1;
 *                              invisible to arm 2, where the tail is never reached at all.
 *        (c) no bracket      — drops the pushed return address. Leaves every LIVE cell identical;
 *                              caught only by the SP comparison.
 *        (d) swallowed result— correct control flow, answers false instead of handing back the
 *                              tail's result. Invisible to RAM, SP and pc; caught only by the
 *                              return assertion. Not hypothetical: a false answer from an address
 *                              that is not in machine.js's SEAM_CALLER_SKIP makes the seam consume
 *                              a stack word the routine does not owe.
 *
 * COVERAGE THIS DOES NOT CLAIM: attract only, plus pokes and stubs on top of attract state. No
 * credited game and no board past 25m. The gate's third early-return arm is never exercised —
 * that is ROM 0x24B4's business, not this routine's, whose only branch is covered on both sides.
 *
 * Isolated replays use clone(), whose frame machinery is neutralised (nextNmi / nextBoundary =
 * Infinity), so an m.step inside the oracle cannot trip a live NMI whose handler would write RAM
 * and masquerade as an oracle side effect. A clone DOES inherit the capturing override, and this
 * routine's tail chain re-enters the object loop that dispatches it — so a replay would re-enter
 * the capture and recurse. The `busy` latch below is what stops that; while it is set the hook is
 * a pass-through to the oracle, so nested dispatches inside a replay run pure oracle on both sides.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2101.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2101 as oracle } from "../../translated/loc_2101.js";
import { loc_24b4 as oracleGate } from "../../translated/loc_24b4.js";
import { loc_2101 } from "../loc_2101.js";
import { Machine } from "../../machine.js";
import manifest from "../../manifest.js";
import { runCycleFree } from "../../../../core/frame-stepped.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const TARGET = 0x2101;
const GATE = 0x24b4; //        the retirement gate this routine calls
const FALLTHROUGH = 0x2104; // the left-edge check it falls into, and the return address it pushes
const OTHER_TAIL = 0x2118; //  NOT reached from here — twin (b) goes there instead

const CAPTURE_FRAMES = 1200; // the attract run arms 1-3 replay
const LIVE_FRAMES = 1400; //   the live-wire run and its baseline

// The census this file's header and the routine's GATE: line both quote. Asserted, not merely
// printed, so neither header can go stale without a test failure naming the new numbers.
const EXPECTED_DISPATCHES = 31;
const EXPECTED_SHAPES = 25;
const EXPECTED_LIVE_DISPATCHES = 47;

// Record offsets and the gate's firing window, restated here rather than imported, so the crafted
// arm sits on an independent statement of what makes the gate fire. Taken from the frozen oracle
// at ROM 0x24B4: it retires the object when +5 has reached RETIRE_Y and +3 is inside [BAND_LO,
// BAND_HI). loc_2101 itself touches neither.
const REC_X = 3;
const REC_Y = 5;
const RETIRE_Y = 0xe8;
const BAND = [0x20, 0x24, 0x29]; // three positions inside the firing band [0x20, 0x2A)

const hx = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// -- the contract -------------------------------------------------------------

/**
 * Run the oracle and `fn` on two FRESH byte-identical clones of `entry` and report the first
 * contract breach, or null. A thrown error from the candidate IS a result — hand a broken twin a
 * state it cannot handle and it walks into ROM and faults rather than diverging, and a harness
 * that lets that escape dies instead of reporting.
 *
 * Checked, in this order: live RAM, SP, pc, the return value, then the dead stack scratch. The
 * split is reported so the teeth arm can assert WHICH check caught which twin.
 */
function breach(entry, fn) {
  const a = entry.clone();
  const b = entry.clone();
  let retOracle;
  try {
    retOracle = oracle(a);
  } catch (e) {
    return `HARNESS: the oracle itself faulted on this entry — ${e.name}: ${e.message}`;
  }
  let retCandidate;
  try {
    retCandidate = fn(b);
  } catch (e) {
    return `fault: ${e.name}: ${e.message}`;
  }

  const da = a.dumpState();
  const db = b.dumpState();
  let live = null;
  let stack = null;
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) stack ??= `RAM(stack)@${hx(addr)} oracle=${da[i]} cand=${db[i]}`;
    else return `RAM(live)@${hx(addr)} oracle=${da[i]} cand=${db[i]}`;
  }
  if (a.regs.sp !== b.regs.sp) return `SP oracle=${hx(a.regs.sp)} cand=${hx(b.regs.sp)}`;
  if (a.pc !== b.pc) return `pc oracle=${hx(a.pc)} cand=${hx(b.pc)}`;
  if (String(retOracle) !== String(retCandidate)) {
    return `return oracle=${String(retOracle)} cand=${String(retCandidate)}`;
  }
  return stack;
}

/** Ask the GATE'S OWN frozen oracle which branch an entry state takes. Not the rewrite's opinion. */
function gateReturns(entry) {
  const probe = entry.clone();
  probe.push16(FALLTHROUGH);
  return probe.call(GATE) !== false;
}

/** A capture with the record poked into the gate's firing band at horizontal position `x`. */
function crafted(entry, x) {
  const e = entry.clone();
  e.mem.write8((e.regs.ix + REC_Y) & 0xffff, RETIRE_Y);
  e.mem.write8((e.regs.ix + REC_X) & 0xffff, x);
  return e;
}

// -- the attract run: inline replay AND capture, in one pass -------------------

/**
 * ONE attract run serves every replay arm. At each real dispatch it replays the EQUAL contract
 * inline (clone twice, run both sides, compare, discard) and also keeps the entry clone for the
 * crafted and stubbed arms — 31 of them, which is not a memory concern; nothing is sampled either
 * way. `busy` is the re-entrancy latch described in the file header.
 */
let ATTRACT = null;
function attractRun() {
  if (ATTRACT) return ATTRACT;
  const caps = [];
  const shapes = new Map();
  const inlineBreaches = [];
  let dispatches = 0;
  let replayed = 0;
  let busy = false;

  const host = new Machine(ROM, {
    overrides: {
      "2101": (mm) => {
        dispatches++;
        if (busy) return oracle(mm); // nested dispatch inside a replay — pure oracle, no capture
        busy = true;
        try {
          const entry = mm.clone();
          const shape = `record ${hx(mm.regs.ix)} +${REC_X}=${hx(mm.mem.read8((mm.regs.ix + REC_X) & 0xffff))}` +
            ` +${REC_Y}=${hx(mm.mem.read8((mm.regs.ix + REC_Y) & 0xffff))}`;
          shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
          const b = breach(entry, loc_2101); // the inline EQUAL replay, at the dispatch
          replayed++;
          if (b) inlineBreaches.push(`[${shape}] ${b}`);
          caps.push({ entry, shape, gateReturned: gateReturns(entry) });
        } finally {
          busy = false;
        }
        return oracle(mm);
      },
    },
  });
  host.runFrames(CAPTURE_FRAMES);
  ATTRACT = { caps, shapes, dispatches, replayed, inlineBreaches, host };
  return ATTRACT;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2101 is dispatched during 25m attract, always on the same branch", () => {
  const { caps, shapes, dispatches, host } = attractRun();
  assert.equal(host.stoppedBy ?? null, null, `capture run stopped early: ${host.stoppedBy}`);
  assert.ok(caps.length > 0, "0x2101 should be dispatched — the object update cascade reaches it");

  // The census both headers quote. If these move, the headers are stale — update them together.
  assert.equal(
    dispatches,
    EXPECTED_DISPATCHES,
    `the dispatch count changed (${dispatches}); loc_2101.js's GATE: line and this file quote ${EXPECTED_DISPATCHES}`,
  );
  assert.equal(
    shapes.size,
    EXPECTED_SHAPES,
    `the entry-shape count changed (${shapes.size}); both headers quote ${EXPECTED_SHAPES}`,
  );

  // The premise of arm 2, measured with the gate's own oracle: attract NEVER retires an object
  // here, so the captured arm cannot tell the guard from an unconditional fall-through.
  const retired = caps.filter((c) => !c.gateReturned);
  assert.equal(
    retired.length,
    0,
    `attract took the retirement branch ${retired.length} times after all — arm 2's premise, and ` +
      "the routine header's claim that the branch is crafted-only, both need rechecking",
  );

  console.log(
    `  REACHABILITY: ${dispatches} natural 0x2101 dispatches in ${CAPTURE_FRAMES} attract frames, ` +
      `${shapes.size} distinct entry shapes, 0 of them on the retirement branch`,
  );
});

// -- 1. EQUAL (captured, replayed inline at the dispatch) ----------------------

test("EQUAL (captured): loc_2101 == oracle on EVERY real dispatch, replayed inline", () => {
  const { dispatches, replayed, inlineBreaches } = attractRun();
  assert.ok(replayed > 0, "no dispatch was replayed — this arm would prove nothing");
  assert.equal(
    replayed,
    dispatches,
    `${replayed} of ${dispatches} dispatches were replayed — every one must be, nothing is sampled here`,
  );
  assert.deepEqual(inlineBreaches, [], `inline replay breach: ${inlineBreaches[0] ?? ""}`);

  console.log(
    `  EQUAL/captured: ALL ${replayed} of ${dispatches} real dispatches replayed inline and identical ` +
      "on the full state dump, SP, pc and the return value",
  );
});

// -- 2. EQUAL (crafted: the retirement branch attract never takes) -------------

test("EQUAL (crafted): the retirement branch matches the oracle on every capture", () => {
  const { caps } = attractRun();
  let compared = 0;
  for (const { entry, shape } of caps) {
    for (const x of BAND) {
      const e = crafted(entry, x);
      // Non-vacuity: the poke must actually have flipped the branch, judged by the gate's oracle.
      assert.equal(
        gateReturns(e),
        false,
        `[${shape}] poking +${REC_Y}=${hx(RETIRE_Y)} +${REC_X}=${hx(x)} did NOT reach the retirement ` +
          "branch — this arm has degenerated into more of arm 1",
      );
      const b = breach(e, loc_2101);
      assert.equal(b, null, `[${shape}] crafted +${REC_X}=${hx(x)}: ${b}`);
      compared++;
    }
  }
  console.log(
    `  EQUAL/crafted: ${compared} replays (${BAND.length} band positions x ${caps.length} real captures) ` +
      "on the retirement branch, all identical to the oracle",
  );
});

// -- 3. PROTOCOL (stubbed destinations, harness-dictated verdict) --------------

const SENTINEL = 0xc0de; // no real routine returns this, so seeing it back proves the stub ran

/**
 * Run `fn` on a fresh clone whose two destinations are STUBS. Returns the observable protocol:
 * the call sequence, the value handed back, the net stack movement, and the word left at the
 * bracket slot. Stubs are installed on THIS clone — clone() rebuilds the routine table from
 * assets, so a stub set on a parent would silently vanish here.
 *
 * pc is deliberately not part of this comparison: the oracle sets it as part of its cycle
 * accounting and the stub does not carry it onward, which is an artifact of the stub, not a
 * contract. Arms 1 and 2 are where pc is compared, against the real destinations.
 */
function protocol(entry, fn, verdict) {
  const m = entry.clone();
  const log = [];
  m.routines.set(GATE, () => {
    log.push("gate");
    return verdict;
  });
  m.routines.set(FALLTHROUGH, () => {
    log.push("fallthrough");
    return SENTINEL;
  });
  const spEntry = m.regs.sp;
  const ret = fn(m);
  const slot = (spEntry - 2) & 0xffff;
  return {
    log: log.join(","),
    ret: String(ret),
    spDelta: ((m.regs.sp - spEntry) << 16) >> 16,
    bracket: m.mem.read8(slot) | (m.mem.read8((slot + 1) & 0xffff) << 8),
  };
}

test("PROTOCOL: the call sequence and the pushed bracket match the oracle on BOTH verdicts", () => {
  const { caps } = attractRun();
  let compared = 0;
  const seen = new Set();
  for (const { entry, shape } of caps) {
    for (const verdict of [true, false]) {
      const want = protocol(entry, oracle, verdict); // expectation from the ORACLE, not from us
      const got = protocol(entry, loc_2101, verdict);
      assert.deepEqual(got, want, `[${shape}] verdict=${verdict}: protocol differs from the oracle`);
      seen.add(`${verdict}:${want.log}`);
      compared++;
    }
  }

  // The stubs are live and are what produced these observations — a stub nobody can see fire is
  // indistinguishable from no stub at all.
  const first = caps[0].entry;
  const onTrue = protocol(first, oracle, true);
  const onFalse = protocol(first, oracle, false);
  assert.equal(onTrue.log, "gate,fallthrough", "the stubs did not record the true-verdict sequence");
  assert.equal(onFalse.log, "gate", "the stubs did not record the false-verdict sequence");
  assert.equal(onTrue.ret, String(SENTINEL), "the fall-through stub's value did not come back out");
  assert.equal(onFalse.ret, "undefined", "the retirement branch handed something back");
  assert.equal(onTrue.bracket, FALLTHROUGH, "the pushed return address is not the fall-through");

  console.log(
    `  PROTOCOL: ${compared} stubbed replays (${caps.length} captures x 2 dictated verdicts); ` +
      `sequences observed: ${[...seen].join(" | ")}; bracket word ${hx(onTrue.bracket)}`,
  );
});

// -- 4/5. LIVE-WIRE -----------------------------------------------------------

/**
 * A cycle-free attract run at the manifest's vblank poll PC, optionally with `candidate` wired
 * live at 0x2101. Returns the per-frame state trace and the dispatch count.
 *
 * The cycle-free engine is what makes the missing T-states harmless: it fires the vblank NMI when
 * control reaches the poll PC rather than when a clock says so, so the 17 T-states this rewrite
 * does not charge move nothing. Under the cycle-accurate scheduler they would shift the NMI and
 * fork the run for reasons unrelated to the contract.
 */
function cycleFreeRun(candidate) {
  let dispatches = 0;
  const overrides = candidate
    ? { overrides: { "2101": (mm) => { dispatches++; return candidate(mm); } } }
    : {};
  const m = new Machine(ROM, overrides);
  const trace = [];
  const r = runCycleFree(m, {
    pollPCs: manifest.convergence.pollPCs,
    maxFrames: LIVE_FRAMES,
    stepBudget: LIVE_FRAMES * 200000,
    onFrame: (mm) => trace.push(Buffer.from(mm.dumpState())),
  });
  return { m, trace, run: r, dispatches };
}

/** First frame+byte where two traces differ, over the FULL dump. */
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
  if (!BASELINE) BASELINE = cycleFreeRun(null);
  return BASELINE;
}

test("LIVE-WIRE: loc_2101 drives a whole attract run identical to the all-oracle baseline", () => {
  const base = baseline();
  assert.equal(base.run.stopError, null, `baseline run errored: ${base.run.stop}`);
  assert.equal(base.run.frames, LIVE_FRAMES, `baseline reached only ${base.run.frames} frames`);

  const live = cycleFreeRun(loc_2101);
  assert.equal(live.run.stopError, null, `live-wire run errored: ${live.run.stop}`);
  assert.equal(live.run.frames, LIVE_FRAMES, `live-wire run reached only ${live.run.frames} frames`);

  // A live arm that never executes the routine passes green and proves nothing. Pin the count.
  assert.ok(live.dispatches > 0, "the override was never dispatched — this arm would be vacuous");
  assert.equal(
    live.dispatches,
    EXPECTED_LIVE_DISPATCHES,
    `the live dispatch count changed (${live.dispatches}); both headers quote ${EXPECTED_LIVE_DISPATCHES}`,
  );
  assert.equal(base.trace.length, live.trace.length, "the two runs did not reach the same frame count");

  const d = firstTraceDiff(base.trace, live.trace, (o) => base.m.stateOffsetToAddr(o));
  assert.equal(
    d,
    null,
    d && `frame ${d.frame} diverged at ${hx(d.addr)}: baseline=${d.a} live-wire=${d.b}`,
  );

  console.log(
    `  LIVE-WIRE: ${live.dispatches} dispatches over ${LIVE_FRAMES} cycle-free attract frames — all ` +
      `${live.trace.length} sampled states (power-on plus ${LIVE_FRAMES} boundaries) identical to the ` +
      "all-oracle baseline on the FULL dump, stack included",
  );
});

test("LIVE-WIRE CONTROL: a broken twin DOES fork the run, and the crafted-only twin does not", () => {
  const base = baseline();
  const off = (o) => base.m.stateOffsetToAddr(o);

  // Sensitivity: if this did not fork, the arm above could not be distinguishing anything.
  const bad = cycleFreeRun(twinWrongTail);
  const d = firstTraceDiff(base.trace, bad.trace, off);
  assert.notEqual(d, null, "the wrong-tail twin matched the baseline — the live arm is not sensitive");

  // And the measured reason arm 2 is not optional: the twin that ignores the gate's answer runs a
  // whole attract sequence without ever being wrong, because attract never takes that branch.
  const blind = cycleFreeRun(twinNoGuard);
  assert.ok(blind.dispatches > 0, "the no-guard twin was never dispatched — nothing was measured");
  const dBlind = firstTraceDiff(base.trace, blind.trace, off);
  assert.equal(
    dBlind,
    null,
    dBlind &&
      "the live run caught the no-guard twin, so attract IS taking the retirement branch — the " +
        "routine header's crafted-only claim needs rechecking",
  );

  console.log(
    `  CONTROL: wrong-tail forks at frame ${d.frame}, ${hx(d.addr)} (baseline=${d.a} twin=${d.b}); ` +
      `no-guard survives all ${blind.trace.length} frames over ${blind.dispatches} dispatches — ` +
      "only the crafted arm sees it",
  );
});

// -- 6. TEETH -----------------------------------------------------------------

/** Twin (a): ignores the gate's answer and continues inline even after the object was retired. */
function twinNoGuard(m) {
  m.push16(FALLTHROUGH);
  m.call(GATE);
  return m.call(FALLTHROUGH);
}

/** Twin (b): falls into the wrong neighbour. */
function twinWrongTail(m) {
  m.push16(FALLTHROUGH);
  if (!m.call(GATE)) return undefined;
  return m.call(OTHER_TAIL);
}

/** Twin (c): drops the return-address bracket the gate's oracle consumes. */
function twinNoBracket(m) {
  if (!m.call(GATE)) return undefined;
  return m.call(FALLTHROUGH);
}

/** Twin (d): correct control flow, but swallows the tail's result and answers false. */
function twinSwallowResult(m) {
  m.push16(FALLTHROUGH);
  if (!m.call(GATE)) return undefined;
  m.call(FALLTHROUGH);
  return false;
}

/** Replay every real capture against `twin`; report how many breached and the first breach. */
function overCaptures(twin) {
  const { caps } = attractRun();
  const hits = [];
  for (const { entry, shape } of caps) {
    const b = breach(entry, twin);
    if (b) hits.push(`[${shape}] ${b}`);
  }
  return { caught: hits.length, total: caps.length, first: hits[0] ?? null };
}

/** Replay every crafted retirement entry against `twin`. */
function overCrafted(twin) {
  const { caps } = attractRun();
  const hits = [];
  for (const { entry, shape } of caps) {
    for (const x of BAND) {
      const b = breach(crafted(entry, x), twin);
      if (b) hits.push(`[${shape}] +${REC_X}=${hx(x)} ${b}`);
    }
  }
  return { caught: hits.length, total: caps.length * BAND.length, first: hits[0] ?? null };
}

test("TEETH: four broken twins are CAUGHT, each by the arm that must catch it", () => {
  // Sanity: the real routine passes both replay arms, so a caught twin is a real defect signal.
  assert.equal(overCaptures(loc_2101).caught, 0, "the correct routine must pass the captured arm");
  assert.equal(overCrafted(loc_2101).caught, 0, "the correct routine must pass the crafted arm");

  // (a) no guard — attract never retires an object here, so the captures CANNOT see this.
  const aCaps = overCaptures(twinNoGuard);
  const aCraft = overCrafted(twinNoGuard);
  assert.equal(
    aCaps.caught,
    0,
    `the captured arm caught the no-guard twin (${aCaps.first}) — attract IS taking the retirement ` +
      "branch, so the crafted arm's premise needs rechecking",
  );
  assert.ok(aCraft.caught > 0, "the no-guard twin escaped the crafted arm — the guard is unproven");

  // (b) wrong tail — a live-RAM defect on the states attract really produces, and invisible on the
  // crafted arm because the retirement branch never reaches the tail at all.
  const b = overCaptures(twinWrongTail);
  assert.ok(b.caught > 0, "the wrong-tail twin escaped — the fall-through target is unproven");
  assert.ok(b.first.includes("RAM(live)"), `expected a live-RAM breach, got: ${b.first}`);
  assert.equal(
    overCrafted(twinWrongTail).caught,
    0,
    "the crafted arm caught the wrong-tail twin, so it is reaching the tail — recheck the craft",
  );

  // (c) no bracket — every live cell is identical; only SP sees it.
  const c = overCaptures(twinNoBracket);
  assert.ok(c.caught > 0, "the no-bracket twin escaped — the pushed return address is unproven");
  assert.ok(c.first.includes("SP"), `expected the SP comparison to catch it, got: ${c.first}`);

  // (d) swallowed result — identical RAM, SP and pc; only the return assertion sees it.
  const d = overCaptures(twinSwallowResult);
  assert.ok(d.caught > 0, "the swallowed-result twin escaped — the return value is unasserted");
  assert.ok(d.first.includes("return"), `expected the RETURN assertion to catch it, got: ${d.first}`);

  console.log(
    `  TEETH: no-guard ${aCraft.caught}/${aCraft.total} crafted (${aCaps.caught}/${aCaps.total} captures, ` +
      `as expected — ${aCraft.first}); wrong-tail ${b.caught}/${b.total} (${b.first}); ` +
      `no-bracket ${c.caught}/${c.total} (${c.first}); swallowed-result ${d.caught}/${d.total} (${d.first})`,
  );
});
