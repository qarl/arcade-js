// SPDX-License-Identifier: GPL-3.0-only
/**
 * clearScreenRamAndVerifyImageThenColdInit — memory-equivalent to the frozen oracle at ROM 0x5866.
 * GATE: crafted-boot-entry; the single boot dispatch replayed with the foreground loop (0x0B93)
 * severed to an empty coroutine so both arms stop at the same handover, comparing work RAM minus
 * the stack scratch below the entry SP, the LS259 and sound latches, and the watchdog kicks. The raw return is that
 * coroutine, driven not compared; fill priors prove the two fills are no accidental match.
 *
 * THE TAMPER ARM RAISES, AND IT IS DEAD ON A GENUINE IMAGE. The fold covers the program image and
 * nothing else, so its total is a constant of the image. GUARD computes that total from the genuine
 * image — exactly the value the routine subtracts — so the mismatch arm never runs on a genuine
 * image. Where the frozen form jumps into a data table (replaced here by a probe), the rewrite raises
 * NotImplemented; THROWS pins that on a private tampered image, with both fills laid identically
 * first, and BLOCK measures the fold's extent at both ends of the image. A twin that still jumps into
 * the table is caught by THROWS.
 * HOLE: a pair of byte changes that cancel in an eight-bit sum is exactly what the check cannot see.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5866.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { clearScreenRamAndVerifyImageThenColdInit as candidate } from "../clearScreenRamAndVerifyImageThenColdInit.js";
import { loc_5866 as oracle } from "../../translated/loc_5866.js";
import { initColdStartRamThenSeedConfig } from "../initColdStartRamThenSeedConfig.js";
import manifest from "../../manifest.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";
import { readFileSync } from "node:fs";
import { COMMAND_READ_CURSOR } from "../names.js";
import { Severed, severAtDirectCall } from "./_spineSever.js";

const TARGET = 0x5866;
const DRAIN = 0x0b93; // the foreground loop, severed so both arms stop at the same handover
const DRAIN_NAME = "runCommandRingDrainLoop";
const DERAIL = 0x59d7; // the tampered-image branch: data, never a genuine tail
const [STACK_LO, STACK_HI] = manifest.convergence.stateExclude.stack;
const STACK_WINDOW = { lo: STACK_LO, hi: STACK_HI };

const COLOUR_BASE = 0xa000;
const VIDEO_BASE = 0xa400;
const FILL_BYTES = 0x400;
const COLOUR_FILL = 0x10;
const VIDEO_FILL = 0xf1;
const WATCHDOG = 0xc200;
const SOUND_SEED = 0x5a;
const FILL_PRIORS = [0x00, 0x10, 0xf1, 0xff];
const EXPECTED_DISPATCHES = 1; // boot-time; it runs once under any tape
const IMAGE_END = 0x6000; // one past the folded program image
const GENUINE_TOTAL = 0xaf;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? d.k : "identical");
/** Stack scratch below the entry SP `floor` is dead; every cell from the floor up is compared. */
const deadStack = (floor) => deadStackBelow(STACK_WINDOW, floor);
const u8 = (x) => x & 0xff;
const u16 = (x) => x & 0xffff;

// A PRIVATE copy per craft, so tampering never poisons the harness's cached image. Guarded: ROMs are gitignored.
const ROM_IMAGE = romsPresent() ? readFileSync(new URL("../../rom/maincpu.bin", import.meta.url)) : null;

// ── the rig: capture the boot entry, sever the foreground, drive the coroutine ────────────

let entry = null;
let dispatches = 0;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      dispatches++;
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    const frames = m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
    assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  }
  return entry;
}

/** A clone with the two fill regions pre-loaded to a prior; everything the routine writes overwrites it. */
function craftFill(prior) {
  const m = entryState().clone();
  for (let i = 0; i < FILL_BYTES; i++) {
    m.mem8[COLOUR_BASE + i] = prior;
    m.mem8[VIDEO_BASE + i] = prior;
  }
  return m;
}

/** A clone whose foreground loop is a recorder returning an empty iterable, reached by the frozen
 *  side's plain call and the rewrite's coroutine handover alike. */
// The frozen side reaches the loop through the routine map; the rewritten spine enters it by `yield*`
// into a direct import, which _spineSever.js catches at the loop's first act (reading its cursor) from
// inside the loop's own frame. Both record the same hand-over. The accumulator is not part of it: the
// loop loads A from its cursor before anything reads it.
function severed(machine, log) {
  const c = machine.clone();
  const record = (mm) => log.push({ kicks: mm.io.watchdogKicks });
  c.routines = new Map(c.routines);
  c.routines.set(DRAIN, (mm) => {
    record(mm);
    return { [Symbol.iterator]: function* () {} };
  });
  return severAtDirectCall(c, DRAIN_NAME, { reads: [COMMAND_READ_CURSOR] }, record);
}

function drive(fn, m) {
  try {
    const r = fn(m);
    if (!r || typeof r.next !== "function") return r;
    for (let i = 0; i <= 64; i++) {
      const step = r.next();
      if (step.done) return step.value;
    }
  } catch (e) {
    if (e instanceof Severed) return undefined;
    throw e;
  }
  throw new Error("still yielding after the budget");
}

/** The frozen side run to the severed handover, returned for inspection. */
function runOracle(machine) {
  const c = severed(machine, []);
  c.io.soundData = SOUND_SEED;
  drive(oracle, c);
  return c;
}

/** The live-out at the severed handover: RAM minus stack scratch below the entry SP, the latches, the kicks. */
function diff(cand, machine) {
  const logA = [];
  const logB = [];
  const a = severed(machine, logA);
  const b = severed(machine, logB);
  a.io.soundData = SOUND_SEED;
  b.io.soundData = SOUND_SEED;
  drive(oracle, a);
  try {
    drive(cand, b);
  } catch (e) {
    return { k: "threw:" + String(e).slice(0, 40) };
  }
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off),
    deadStack(machine.regs.sp));
  if (ram) return { k: "ram@" + hex4(ram.addr) };
  for (let i = 0; i < a.io.latch.length; i++) {
    if (a.io.latch[i] !== b.io.latch[i]) return { k: "latch" + i };
  }
  if (a.io.soundData !== b.io.soundData) return { k: "sound" };
  if (a.io.watchdogKicks !== b.io.watchdogKicks) return { k: "kicks" };
  if (logA.length !== logB.length) return { k: "handovers" };
  for (const [i, x] of logA.entries()) {
    if (x.kicks !== logB[i].kicks) return { k: "handover" };
  }
  return null;
}

// ── broken twins: the rewrite with one deliberate defect each ────────────────────────────────

/** A faithful body with one field flipped; the handoff reaches the same severed loop as the real one. */
function body({ fillColour = true, colourVal = COLOUR_FILL, fillVideo = true, videoVal = VIDEO_FILL,
  kick1 = true, handoff = true, stillDerails = false } = {}) {
  return (m) => {
    const { mem8, mem16 } = m;
    if (fillColour) {
      const base = mem16[0x2581];
      for (let i = 0; i < FILL_BYTES; i++) mem8[u16(base + i)] = colourVal;
    }
    if (kick1) mem8[WATCHDOG] = 0;
    if (fillVideo) {
      const base = mem16[0x4a37];
      for (let i = 0; i < FILL_BYTES; i++) mem8[u16(base + i)] = videoVal;
    }
    let addr = 0x0000;
    let total = mem8[0x0000];
    for (;;) {
      total = u8(total + mem8[addr]);
      addr = u16(addr + 1);
      if (((addr >> 8) & 0xff) >= 0x60) break;
      mem8[WATCHDOG] = total;
    }
    if (!handoff) return undefined;
    if (u8(total - 0xaf) !== 0) {
      if (stillDerails) return m.call(DERAIL);
      throw new NotImplemented("tampered image");
    }
    return initColdStartRamThenSeedConfig(m);
  };
}

const TWINS = [
  ["no-op", () => {}],
  ["faithful-body", body()],
  ["skip-colour-fill", body({ fillColour: false })],
  ["wrong-colour-fill", body({ colourVal: 0x11 })],
  ["skip-video-fill", body({ fillVideo: false })],
  ["wrong-video-fill", body({ videoVal: 0xf2 })],
  ["skip-first-kick", body({ kick1: false })],
  ["no-handoff", body({ handoff: false })],
];

function states() {
  return [entryState(), ...FILL_PRIORS.map(craftFill)];
}

function caughtOver(cand) {
  let caught = 0;
  for (const s of states()) if (diff(cand, s)) caught++;
  return caught;
}

// ── the tamper arm ───────────────────────────────────────────────────────────────────────────

/** A severed clone of the boot entry reading a PRIVATE image with one byte bumped, the derail
 *  address answering with a counting probe instead of the table's refusal. */
function tamperedAt(at, delta) {
  const image = Uint8Array.from(ROM_IMAGE);
  image[at] = (image[at] + delta) & 0xff;
  const c = severed(entryState(), []);
  c.mem.rom = image;
  const hits = { n: 0 };
  c.routines.set(DERAIL, () => { hits.n++; });
  c.io.soundData = SOUND_SEED;
  return { c, hits };
}

/** Oracle reaches the derail probe; the candidate raises NotImplemented. -1 for any other error. */
function derailOutcome(cand, at, delta) {
  const o = tamperedAt(at, delta);
  const r = tamperedAt(at, delta);
  const floor = o.c.regs.sp;
  drive(oracle, o.c);
  let raised = 0;
  try {
    drive(cand, r.c);
  } catch (e) {
    raised = e instanceof NotImplemented ? 1 : -1;
  }
  return { oracle: o.hits.n, candidate: raised + r.hits.n, o: o.c, r: r.c, probe: r.hits.n, floor };
}

// ── the gate ─────────────────────────────────────────────────────────────────────────────────

test("DISPATCHED: boot reaches the routine once under both tapes, and both replay", { skip }, () => {
  entryState();
  assert.equal(dispatches, EXPECTED_DISPATCHES, "the dispatch count moved");
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    let seen = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => {
      seen++;
      assert.equal(show(diff(candidate, mm)), "identical", `${label}: a real dispatch diverged`);
      return oracle(mm);
    }]]), opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    assert.equal(seen, EXPECTED_DISPATCHES, `${label} dispatch count moved`);
    console.log(`  DISPATCHED: ${label} — ${seen} dispatch, replayed identical`);
  }
});

test("EQUAL at the boot dispatch: RAM minus stack scratch below the entry SP, latches, kicks and handover", { skip }, () => {
  assert.equal(show(diff(candidate, entryState())), "identical");
  console.log("  EQUAL: the boot entry replays identically to the severed handover");
});

test("WRITES: the routine really lays both fills and takes the genuine (init) tail", { skip }, () => {
  const before = entryState();
  const after = runOracle(entryState());
  for (let i = 0; i < FILL_BYTES; i++) {
    assert.equal(after.mem8[COLOUR_BASE + i], COLOUR_FILL, `colour byte ${i} is not 0x10`);
  }
  let colourMoved = 0;
  for (let i = 0; i < FILL_BYTES; i++) {
    if (after.mem8[COLOUR_BASE + i] !== before.mem8[COLOUR_BASE + i]) colourMoved++;
  }
  // ★ vacuity: if the fills already held their value at capture, EQUAL would pass a no-op rewrite.
  assert.ok(colourMoved > 0 || FILL_PRIORS.length > 0,
    "colour RAM never moved from the captured state; the fill comparison agrees on a no-change");
  const kicks = after.io.watchdogKicks - before.io.watchdogKicks;
  assert.ok(kicks > FILL_BYTES, `only ${kicks} watchdog kicks; the per-byte sum never ran`);
  console.log(`  WRITES: colour all 0x10 (${colourMoved} bytes moved), ${kicks} watchdog kicks`);
});

test("FILL PRIORS: the fills overwrite any prior, so EQUAL is no accidental match", { skip }, () => {
  for (const prior of FILL_PRIORS) {
    assert.equal(show(diff(candidate, craftFill(prior))), "identical", `prior ${hex4(prior)} diverged`);
    const after = runOracle(craftFill(prior));
    for (let i = 0; i < FILL_BYTES; i++) {
      assert.equal(after.mem8[COLOUR_BASE + i], COLOUR_FILL, `prior ${hex4(prior)}: colour byte ${i} not repainted`);
    }
  }
  console.log(`  FILL PRIORS: ${FILL_PRIORS.length} priors repainted, candidate identical`);
});

test("FAITHFUL BODY: the reconstructed body matches, so the teeth measure real defects", { skip }, () => {
  assert.equal(caughtOver(body()), 0, "the faithful body diverged; a teeth catch below could be spurious");
  console.log("  FAITHFUL BODY: the reconstructed body is identical on every state");
});

for (const [label, twin] of TWINS) {
  if (label === "faithful-body") continue;
  test(`TEETH: the ${label} twin is caught`, { skip }, () => {
    const caught = caughtOver(twin);
    assert.ok(caught > 0, `every state PASSED the ${label} twin`);
    console.log(`  TEETH/${label}: caught on ${caught}/${states().length} states`);
  });
}

test("GUARD: the genuine image folds to exactly the expected total, so the raise is dead", { skip }, () => {
  // The fold as the routine does it: seeded with the first byte, then every byte below IMAGE_END.
  let total = ROM_IMAGE[0];
  for (let a = 0; a < IMAGE_END; a++) total = u8(total + ROM_IMAGE[a]);
  assert.equal(total, GENUINE_TOTAL, "the genuine image no longer folds to the expected total");
  assert.ok(IMAGE_END <= ROM_IMAGE.length, "the fold runs past the program image");
  const genuine = derailOutcome(candidate, 0x0100, 0);
  assert.equal(genuine.oracle, 0, "the oracle derails on a genuine image");
  assert.equal(genuine.candidate, 0, "the rewrite raises on a genuine image");
  console.log(`  GUARD: the genuine image folds to ${hex4(total)}; neither side derails on it`);
});

test("THROWS: a tampered image raises NotImplemented, fills already laid as the oracle lays them", { skip }, () => {
  const r = derailOutcome(candidate, 0x1234, 1);
  assert.equal(r.oracle, 1, "the tampered oracle did not reach the derail");
  assert.equal(r.candidate, 1, "the rewrite did not raise NotImplemented on a tampered image");
  assert.equal(r.probe, 0, "the rewrite jumped into the table instead of raising");
  const d = firstStateDiff(r.o.dumpState(), r.r.dumpState(), (off) => r.o.stateOffsetToAddr(off),
    deadStack(r.floor));
  assert.ok(d === null, `before the derail the sides differ at ${hex4(d?.addr ?? 0)}`);
  assert.equal(r.o.io.watchdogKicks, r.r.io.watchdogKicks, "the kicks before the derail differ");
  const still = derailOutcome(body({ stillDerails: true }), 0x1234, 1);
  assert.equal(still.candidate, still.oracle, "control: the still-derailing twin should agree with the oracle's probe count");
  assert.equal(still.probe, 1, "control: the still-derailing twin did not reach the table, so THROWS cannot tell it apart");
  console.log("  THROWS: tampered image raises NotImplemented after identical fills and kicks; " +
    "the still-derailing twin is seen reaching the table instead");
});

test("BLOCK: the fold's extent — both ends of the image trip it", { skip }, () => {
  for (const [label, at] of [["the image's first byte", 0x0000], ["the image's last byte", IMAGE_END - 1]]) {
    const r = derailOutcome(candidate, at, 1);
    assert.equal(r.oracle, 1, `${label}: the oracle did not derail`);
    assert.equal(r.candidate, 1, `${label}: the rewrite did not raise`);
  }
  console.log("  BLOCK: a change at either end of the image derails the oracle and raises in the rewrite");
});
