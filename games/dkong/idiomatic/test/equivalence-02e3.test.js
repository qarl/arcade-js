// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for loc_02e3 (ROM 0x02E3) — the main loop's task dispatch.
 *
 * HOW ENTRIES ARE CAPTURED, and why NOT through the override map. 0x02E3 is never reached
 * through the machine's routine registry: its only caller is the main loop, which is itself
 * reached by a fall-through from boot and which calls this routine as a direct ES import
 * (`translated/loc_02bd.js` imports `./loc_02e3.js`; `idiomatic/mainLoop.js` imports the
 * same oracle). A capturing `new Machine(rom, { overrides: { "02e3": … } })` would therefore
 * never fire. Entries are captured instead at the instruction step that ENTERS the routine —
 * the main loop's `jr nc,0x02E3`, which `grep 'step(0x02e3' translated/*.js` shows is the one
 * site in the translated layer that steps to this address — and the machine is cloned there.
 * Those are real dispatches; no entry state is hand-constructed.
 *
 * COVERAGE — two scenarios, because attract alone cannot reach every handler:
 *   • ATTRACT, 5000 frames — 248 real dispatches, reaching six of the seven handlers and
 *     the dequeue pointer's wrap back to the ring base (7 of the 248).
 *   • COIN+START, 1200 frames on the canonical tape — reaches the seventh (opcode 1,
 *     resetScoreCounter, which fires only when a credited game starts) but not opcode 0.
 * Together they cover all seven entries of the ROM 0x0307 table, which the test asserts
 * rather than claims. The replayed SAMPLE is every 20th capture plus the first at each
 * distinct handler plus the first that wraps the pointer, and the test asserts the sample
 * covers every handler either scenario reached. Neither scenario completes a board — the
 * coin+start run supplies no joystick input — so an opcode or payload that only a later
 * state enqueues is untested.
 *
 * CONTRACT — faulting or not, the work/sprite/video state dump outside the stack scratch below the entry SP, SP,
 * and the returned value. pc is excluded: the oracle's handler `ret` advances it and the rewrite's
 * direct calls do not. SP is INCLUDED because it is not free here — the oracle pushes the
 * main-loop return address for the handler to `ret` through, and the rewrite must come out
 * of every arm level with it. The returned value is the dispatched handler's, propagated;
 * it is compared to the oracle's on every arm except opcode 6, where the direct-called
 * `drawLivesAndLevel` returns nothing (its own declared live-out is memory-only) while the
 * frozen 0x06B8 returns a boolean the main loop discards — the test pins that exemption to
 * that one target instead of relaxing the comparison.
 *
 * Checks:
 *   1. EQUAL over the sampled captures of both scenarios.
 *   2. TEETH — five broken twins the gate must catch: either ring byte left un-freed, the
 *      payload taken after its byte is freed (so the handler runs on the free marker 0xFF —
 *      caught as a FAULT, because that argument walks the string-pointer table off its end),
 *      the dequeue pointer advanced one byte instead of two, and the pointer not restarted
 *      at the ring base when it runs off the end (which only the wrap captures can see).
 *   3. LIVE — the rewrite wired in for a whole 5000-frame run. Its reference is the SAME
 *      machine with the frozen 0x02E3 in place, NOT the all-oracle baseline: the six
 *      handlers this routine direct-calls are cycle-free, and wiring them alone already
 *      moves the trace (measured: first divergence at frame 4, on SPIN_COUNT, the main-loop
 *      pass counter). Holding them fixed on both sides is what isolates this routine. That
 *      the harness itself is not the variable is proved separately, with no exclusions at
 *      all, by test 3a.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-02e3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { Machine } from "../../machine.js";
import { bootOnly } from "../../translated/bootOnly.js";
import { loc_02e3 as oracle } from "../../translated/loc_02e3.js";
import { loc_02e3 as rewrite } from "../loc_02e3.js";
import { FRAME, FRAME_SEEN, SPIN_COUNT, STACK_SCRATCH, TASK_HEAD, TASK_RING } from "../names.js";
import { addToScoreTask } from "../addToScoreTask.js";
import { resetScoreCounter } from "../resetScoreCounter.js";
import { drawScoreTask } from "../drawScoreTask.js";
import { drawStringVertical } from "../drawStringVertical.js";
import { drawCreditLineInAttract } from "../drawCreditLineInAttract.js";
import { drawLivesAndLevel } from "../drawLivesAndLevel.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/dkong/rom/maincpu.bin" }, fn);

const ATTRACT_FRAMES = 5000;
const GAME_FRAMES = 1200;
const LIVE_FRAMES = 5000;
const KEEP_EVERY = 20;

const TABLE = 0x0307; //        the ROM handler table this routine indexes
const TABLE_OFFSETS = [0, 2, 4, 6, 8, 10, 12]; // its seven entries, as the offsets A carries
const RING_BASE = TASK_RING & 0xff; // the low byte the dequeue pointer restarts at
const RETURN_EXEMPT = 0x06b8; //     see CONTRACT above

// Canonical coin+start tape (tapes/coin_start.lua): pulse IN2 coin then IN2 start1 so the
// ROM's own credit/start logic begins a game.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 },
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 },
];

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- capturing real entries ---------------------------------------------------

/**
 * Run one scenario and clone the machine at every real entry to 0x02E3, keeping every
 * KEEP_EVERY'th plus the first at each distinct handler plus the first that wraps the
 * dequeue pointer. Cloning happens AFTER the entering step has been executed, so the clone
 * is the state the routine actually starts from.
 */
function captureScenario(frames, tape) {
  const kept = [];
  const seen = new Map(); // table offset -> how many entries used it
  let total = 0;
  let wrapsSeen = 0;

  const m = new Machine(ROM);
  if (tape) m.inputTape = tape;
  const baseStep = m.step.bind(m);
  m.step = (nextAddr, cycles) => {
    baseStep(nextAddr, cycles);
    if (nextAddr !== 0x02e3) return;
    const offset = m.regs.a & 0x1f;
    const head = m.mem.read8(TASK_HEAD);
    const wraps = ((head + 2) & 0xff) < RING_BASE;
    const firstAtOffset = !seen.has(offset);
    seen.set(offset, (seen.get(offset) ?? 0) + 1);
    if (wraps) wrapsSeen++;
    if (firstAtOffset || (wraps && wrapsSeen === 1) || total % KEEP_EVERY === 0) {
      kept.push({ offset, wraps, target: m.mem.read16(TABLE + offset), state: m.clone() });
    }
    total++;
  };
  m.runFrames(frames);
  return { kept, seen, total, wrapsSeen };
}

const ATTRACT = ROM_PRESENT
  ? captureScenario(ATTRACT_FRAMES, null)
  : { kept: [], seen: new Map(), total: 0, wrapsSeen: 0 };
const GAME = ROM_PRESENT
  ? captureScenario(GAME_FRAMES, COIN_START_TAPE)
  : { kept: [], seen: new Map(), total: 0, wrapsSeen: 0 };

// -- the contract -------------------------------------------------------------

/** First differing state byte outside the stack scratch below the entry SP, or null. */
function ramDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run one side, recording a fault instead of letting it escape — a fault is a RESULT here. */
function runSide(machine, fn) {
  try {
    return { returned: fn(machine), fault: null };
  } catch (e) {
    return { returned: undefined, fault: e };
  }
}

/**
 * Replay one captured entry both ways on independent clones and report the first breach of
 * the contract — a fault on one side only, a RAM byte, the stack pointer, or the returned
 * value. A handler given the wrong argument can walk a ROM table off its end, so faulting
 * where the oracle does not is itself a breach and is reported as one.
 */
function contractBreach(capture, candidate) {
  const a = capture.state.clone();
  const aFloor = a.regs.sp;
  const b = capture.state.clone();
  const sideA = runSide(a, oracle);
  const sideB = runSide(b, candidate);
  const returnedOracle = sideA.returned;
  const returnedCandidate = sideB.returned;

  if ((sideA.fault === null) !== (sideB.fault === null)) {
    return {
      kind: "fault",
      addr: null,
      a: sideA.fault ? String(sideA.fault.message) : "no fault",
      b: sideB.fault ? String(sideB.fault.message) : "no fault",
    };
  }

  const ram = ramDiff(a, b, aFloor);
  if (ram) return { kind: "ram", ...ram };
  if (a.regs.sp !== b.regs.sp) {
    return { kind: "sp", addr: null, a: a.regs.sp, b: b.regs.sp };
  }
  if (capture.target === RETURN_EXEMPT) {
    // The exemption is pinned, not a relaxation: the direct-called twin must return
    // nothing, and any OTHER value would fail here just as a mismatch would elsewhere.
    if (returnedCandidate !== undefined) {
      return { kind: "return (exempt arm)", addr: null, a: returnedOracle, b: returnedCandidate };
    }
    return null;
  }
  if (returnedOracle !== returnedCandidate) {
    return { kind: "return", addr: null, a: returnedOracle, b: returnedCandidate };
  }
  return null;
}

/** Every breach a candidate produces over both scenarios' samples. */
function breachesOver(candidate) {
  return [...ATTRACT.kept, ...GAME.kept]
    .map((c) => ({ capture: c, breach: contractBreach(c, candidate) }))
    .filter((r) => r.breach !== null);
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: loc_02e3 matches the oracle on every sampled real entry, both scenarios", () => {
  assert.ok(
    ATTRACT.total > 0 && GAME.total > 0,
    "no entry to 0x02E3 was captured in one of the scenarios — the harness never engaged",
  );

  const breaches = breachesOver(rewrite);
  assert.equal(
    breaches.length,
    0,
    breaches.length
      ? `${breaches.length} breach(es), first: offset ${breaches[0].capture.offset} ` +
        `target ${hx(breaches[0].capture.target)} ${breaches[0].breach.kind} at ` +
        `${hx(breaches[0].breach.addr ?? 0)} oracle=${breaches[0].breach.a} rewrite=${breaches[0].breach.b}`
      : "",
  );

  // These are the lines that produce the header's coverage claims.
  const sampled = new Set([...ATTRACT.kept, ...GAME.kept].map((c) => c.offset));
  const reached = new Set([...ATTRACT.seen.keys(), ...GAME.seen.keys()]);
  assert.deepEqual(
    [...sampled].sort((p, q) => p - q),
    [...reached].sort((p, q) => p - q),
    "the replayed sample misses a handler the scenarios reached",
  );
  assert.deepEqual(
    [...reached].sort((p, q) => p - q),
    TABLE_OFFSETS,
    "the two scenarios did not reach every entry of the 0x0307 table",
  );
  assert.ok(ATTRACT.wrapsSeen > 0, "no entry wrapped the dequeue pointer — the wrap arm is untested");
  assert.ok(
    [...ATTRACT.kept, ...GAME.kept].some((c) => c.wraps),
    "the wrap arm was seen but never sampled",
  );

  const byOffset = (s) => [...s.seen].sort((p, q) => p[0] - q[0]).map(([o, n]) => `${o}x${n}`).join(" ");
  console.log(
    `  EQUAL: attract ${ATTRACT.kept.length}/${ATTRACT.total} entries in ${ATTRACT_FRAMES} frames ` +
      `(offsets ${byOffset(ATTRACT)}, ${ATTRACT.wrapsSeen} wraps); ` +
      `coin+start ${GAME.kept.length}/${GAME.total} in ${GAME_FRAMES} frames (offsets ${byOffset(GAME)}); ` +
      `sample covers table offsets ${[...sampled].sort((p, q) => p - q).join(",")}`,
  );
});

// -- 2. TEETH -----------------------------------------------------------------

const slotOf = (m) => m.regs.hl;
const payloadCellOf = (m) => (m.regs.hl & 0xff00) | ((m.regs.hl + 1) & 0xff);

/** Broken twin: the opcode byte is never released, so its slot stays occupied. */
function twinKeepsOpcodeByte(m) {
  const cell = slotOf(m);
  const before = m.mem8[cell];
  const out = rewrite(m);
  m.mem8[cell] = before;
  return out;
}

/** Broken twin: the payload byte is never released, so its slot stays occupied. */
function twinKeepsPayloadByte(m) {
  const cell = payloadCellOf(m);
  const before = m.mem8[cell];
  const out = rewrite(m);
  m.mem8[cell] = before;
  return out;
}

/**
 * Broken twin: the payload is taken AFTER its byte has been released, so the handler runs
 * on the free marker 0xFF instead of the queued argument. RAM ends identical — only what
 * the handler did with the wrong argument can give this away.
 */
function twinFreesPayloadBeforeReadingIt(m) {
  m.mem8[payloadCellOf(m)] = 0xff;
  return rewrite(m);
}

/** Broken twin: the dequeue pointer advances one byte instead of two. */
function twinAdvancesHeadByOneByte(m) {
  const out = rewrite(m);
  m.mem8[TASK_HEAD] = (m.mem8[TASK_HEAD] - 1) & 0xff;
  return out;
}

/** Broken twin: past the end of the ring the pointer restarts at 0, not at the ring base. */
function twinWrapsToZero(m) {
  const head = m.mem8[TASK_HEAD];
  const out = rewrite(m);
  const advanced = (head + 2) & 0xff;
  if (advanced < RING_BASE) m.mem8[TASK_HEAD] = advanced;
  return out;
}

const TEETH = [
  { name: "opcode byte left un-freed", twin: twinKeepsOpcodeByte, cell: (c) => c.state.regs.hl },
  { name: "payload byte left un-freed", twin: twinKeepsPayloadByte, cell: (c) => payloadCellOf(c.state) },
  { name: "payload taken after its byte was freed", twin: twinFreesPayloadBeforeReadingIt, cell: null },
  { name: "dequeue pointer advanced one byte", twin: twinAdvancesHeadByOneByte, cell: () => TASK_HEAD },
  { name: "pointer wrapped to 0 instead of the ring base", twin: twinWrapsToZero, cell: () => TASK_HEAD },
];

for (const { name, twin, cell } of TEETH) {
  test(`TEETH: a twin with the ${name} is CAUGHT`, () => {
    const breaches = breachesOver(twin);
    assert.ok(
      breaches.length > 0,
      `the gate FAILED to catch the "${name}" twin on any sampled entry — it proves nothing`,
    );
    const { capture, breach } = breaches[0];
    if (cell) {
      assert.equal(
        breach.addr,
        cell(capture),
        `teeth caught the wrong cell ${hx(breach.addr ?? 0)}, expected ${hx(cell(capture))}`,
      );
    }
    console.log(
      `  TEETH/${name}: caught on ${breaches.length} sampled entries; first at offset ` +
        `${capture.offset} (${hx(capture.target)}) ${breach.kind} ` +
        `${breach.addr === null ? "" : hx(breach.addr)} oracle=${breach.a} twin=${breach.b}`,
    );
  });
}

// -- 3. LIVE ------------------------------------------------------------------

/**
 * `translated/loc_02bd.js`, copied instruction for instruction — four work-RAM addresses
 * written as their names.js names — with the one dispatch this gate is about injected. The copy
 * exists because the main loop calls 0x02E3 as a direct ES import, so there is no seam to
 * wire the rewrite into; test 3a is what proves the copy is faithful rather than assumed so.
 */
function mirroredMainLoop(m, dispatch) {
  const { regs, mem } = m;
  for (;;) {
    regs.h = 0x60;
    m.step(0x02bf, 7);
    regs.a = mem.read8(TASK_HEAD);
    m.step(0x02c2, 13);
    regs.l = regs.a;
    m.step(0x02c3, 4);
    regs.a = mem.read8(regs.hl);
    m.step(0x02c4, 7);
    regs.add(regs.a);
    m.step(0x02c5, 4);
    if (regs.fNC) {
      m.step(0x02e3, 12);
      dispatch(m);
      continue;
    }
    m.step(0x02c7, 7);
    m.push16(0x02ca);
    m.step(0x0315, 17);
    m.call(0x0315);
    m.push16(0x02cd);
    m.step(0x0350, 17);
    m.call(0x0350);
    regs.hl = SPIN_COUNT;
    m.step(0x02d0, 10);
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl)));
    m.step(0x02d1, 11);
    regs.hl = FRAME_SEEN;
    m.step(0x02d4, 10);
    regs.a = mem.read8(FRAME);
    m.step(0x02d7, 13);
    regs.cp(mem.read8(regs.hl));
    m.step(0x02d8, 7);
    if (regs.fZ) {
      m.step(0x02bd, 12);
      continue;
    }
    m.step(0x02da, 7);
    mem.write8(regs.hl, regs.a);
    m.step(0x02db, 7);
    m.push16(0x02de);
    m.step(0x037f, 17);
    m.call(0x037f);
    m.push16(0x02e1);
    m.step(0x03a2, 17);
    m.call(0x03a2);
    m.step(0x02bd, 12);
  }
}

/** A machine whose reset runs boot and then the mirrored loop with `dispatch` injected. */
function harness(dispatch, overrides) {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.reset = function reset() {
    bootOnly(this);
    mirroredMainLoop(this, dispatch);
  };
  return m;
}

/** The six handlers this routine direct-calls, wired so both live sides run the same code. */
const HANDLERS_WIRED = {
  "51c": addToScoreTask,
  "59b": resetScoreCounter,
  "5c6": drawScoreTask,
  "5e9": drawStringVertical,
  "611": drawCreditLineInAttract,
  "6b8": drawLivesAndLevel,
};

/** First differing frame byte between two traces, or null; `floors` (per frame) skips the stack below them. */
function traceDiff(a, b, host, floors) {
  for (let f = 0; f < Math.min(a.length, b.length); f++) {
    const dead = floors ? deadStackBelow(STACK_SCRATCH, floors[f]) : () => false;
    for (let i = 0; i < a[f].length; i++) {
      if (a[f][i] === b[f][i]) continue;
      const addr = host.stateOffsetToAddr(i);
      if (dead(addr)) continue;
      return { frame: f, addr, a: a[f][i], b: b[f][i] };
    }
  }
  return null;
}

test("LIVE 3a: the mirrored main loop with the ORACLE dispatch reproduces the stock run exactly", () => {
  const stock = new Machine(ROM);
  const stockTrace = stock.runFrames(LIVE_FRAMES);
  const mirror = harness(oracle, null);
  const mirrorTrace = mirror.runFrames(LIVE_FRAMES);
  assert.equal(mirrorTrace.length, stockTrace.length, "the two runs did not reach the same frame count");
  const d = traceDiff(stockTrace, mirrorTrace, stock, null);
  assert.equal(
    d,
    null,
    d && `frame ${d.frame}: ${hx(d.addr)} stock=${d.a} mirrored=${d.b}`,
  );
  console.log(
    `  LIVE 3a: ${LIVE_FRAMES} frames byte-identical, no exclusions — the harness is not the variable`,
  );
});

test("LIVE 3b: wired in for a whole run, loc_02e3 leaves the same trace as the frozen 0x02E3", () => {
  // The charge the rewrite owes is MEASURED per entry, not summed by hand: the oracle is run
  // on a clone of the very state the rewrite is about to run on, and the difference between
  // what it charged and what the rewrite charged is added back. Without it the entries under-
  // charge, the vblank NMI walks, and the trace diverges for reasons unrelated to this routine.
  const charges = new Map();
  const charged = (m) => {
    const probe = m.clone();
    const probeStart = probe.cycles;
    oracle(probe);
    const oracleCost = probe.cycles - probeStart;
    const start = m.cycles;
    const out = rewrite(m);
    const owed = oracleCost - (m.cycles - start);
    charges.set(owed, (charges.get(owed) ?? 0) + 1);
    m.cycles += owed;
    return out;
  };

  const reference = harness(oracle, HANDLERS_WIRED);
  const referenceSp = recordFrameSp(reference);
  const referenceTrace = reference.runFrames(LIVE_FRAMES);
  const live = harness(charged, HANDLERS_WIRED);
  const liveSp = recordFrameSp(live);
  const liveTrace = live.runFrames(LIVE_FRAMES);

  assert.equal(reference.stoppedBy, null, `reference run stopped early: ${reference.stoppedBy}`);
  assert.equal(live.stoppedBy, null, `live run stopped early: ${live.stoppedBy}`);
  assert.equal(liveTrace.length, referenceTrace.length, "the two runs did not reach the same frame count");
  assert.ok(charges.size > 0, "the rewrite was never dispatched in the live run — it proves nothing");

  const d = traceDiff(referenceTrace, liveTrace, reference, frameFloors(referenceSp, liveSp));
  assert.equal(d, null, d && `frame ${d.frame}: ${hx(d.addr)} reference=${d.a} live=${d.b}`);

  const entries = [...charges.values()].reduce((s, n) => s + n, 0);
  console.log(
    `  LIVE 3b: ${LIVE_FRAMES} frames, ${entries} live entries, identical outside the stack scratch below each frame's live SP; ` +
      `restored charges ${[...charges].sort((p, q) => p[0] - q[0]).map(([c, n]) => `${c}x${n}`).join(" ")} ` +
      "T-states — so C, DE, HL and the flags the rewrite drops are read back by nobody this run reaches",
  );
});
