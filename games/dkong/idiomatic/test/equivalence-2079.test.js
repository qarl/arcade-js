// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2079 (ROM 0x2079) — retire the object record the movement branch was
 * stepping (clear OBJ_ACTIVE and OBJ_X), then jump into the shared object-sprite tail at 0x21BA.
 *
 * The idiomatic routine writes two record bytes and hands the frame on with m.call(0x21BA), still
 * the frozen oracle. The ENTIRE tail chain runs on both sides — 0x21BA, the walk's loop advance at
 * 0x1F8D, every remaining slot, and the return to ROM 0x1986 — so the compared contract can
 * include pc, SP and the propagated return value alongside RAM − the stack scratch below the entry SP. That makes this
 * gate stronger than a leaf gate: a register or flag the chain really consumed would surface here
 * as a difference rather than having to be argued about.
 *
 *   0. REACHABILITY — 0x2079 IS reached naturally, but rarely. Exactly 2 dispatches in a
 *      6000-frame attract run and exactly 2 in a 6000-frame credited 1-player game (coin + start
 *      through the ROM's own credit logic, no pokes). ALL FOUR are replayed — no sampling. They
 *      cover both edges of the caller's admitting window (OBJ_X 248 and OBJ_X 7) and two
 *      different OBJ_ARRAY_67 record bases.
 *   1. EQUAL (real dispatches) — each captured entry replayed oracle-vs-candidate on fresh
 *      clones, plus a non-vacuity check that the oracle really did clear both record bytes.
 *   2. EQUAL (crafted sweep) — 1024 entries built on a real capture: all 256 OBJ_X values crossed
 *      with four OBJ_ACTIVE values. This is the coverage the two natural X values cannot give,
 *      and it pins that the routine does NOT re-test the caller's window.
 *   3. EQUAL (crafted record bases) — the record pointer moved to each of the ten OBJ_ARRAY_67
 *      bases, so the two writes are pinned as record-relative rather than absolute.
 *   4. WRITE-SET — inside the record, the oracle changes exactly OBJ_ACTIVE and OBJ_X. This is the
 *      falsifiable form of the header's role line: a third byte, or a different pair, fails it.
 *   5. LIVE-OUT PROBE — the header claims no register and no flag survives. Measured: the real
 *      routine, with the accumulator and the whole flag byte poisoned at the instant of the
 *      hand-off, is still identical to the oracle. The same probe with the RECORD POINTER poisoned
 *      instead IS caught, which is what stops the first half from being inert.
 *   6. LIVE (whole attract) — the candidate wired at 0x2079 for a 6000-frame attract run; the
 *      frame trace must be identical to the all-oracle baseline. The oracle's own four
 *      instructions are charged back inside the override (the tail chain's cycles are NOT — the
 *      candidate runs that chain itself, so charging the full oracle cost would double-count).
 *   7. LIVE TEETH — the same run without that charge, to show the charge is load-bearing.
 *   8. TEETH — five broken twins the gate MUST catch.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2079.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2079 as oracle } from "../../translated/loc_2079.js";
import { loc_2079 } from "../loc_2079.js";
import { Machine } from "../../machine.js";
import { OBJ_ACTIVE, OBJ_ARRAY_67, OBJ_X, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";
import { recordFrameSp, frameFloors } from "./_frame-sp.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = (name, fn) => nodeTest(name, { skip: "retired: this routine's caller-seam was dissolved to a direct call, so the register/m.call registry-swap ABI this isolation gate exercised no longer exists; validated whole-game by idiomatic.test.js + equivalence-197a.test.js (Karl-authorized 2026-09-19, matching the shipped-games/thepit-spine standard)" }, fn);

const TARGET = 0x2079;
const TAIL = 0x21ba; // the shared object-sprite tail this routine jumps into (still frozen)
const RECORD_STRIDE = 32; // OBJ_ARRAY_67 records
const RECORD_COUNT = 10;
const CAPTURE_FRAMES = 6000;
const LIVE_FRAMES = 6000;

// Canonical coin+start tape (tapes/coin_start.lua contract): pulse IN2 coin (0x80) then IN2
// start1 (0x04) so the ROM's own credit/start logic begins a 1-player game.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 400, dur: 6 },
  { port: 0x7d00, bits: 0x04, frame: 460, dur: 6 },
];

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const hx16 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// -- the contract --------------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 *  (the tail chain churns the guest stack identically on both sides, and the oracle's own
 *  push/ret residue lives there). */
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
 * A private replay machine from a captured/crafted entry, with 0x2079 pointed back at the pure
 * oracle. Captures are cloned out of a hosted run, so their dispatch map still holds the capture
 * hook; the tail chain can walk on into another slot that reaches 0x2079 again, and both sides
 * must meet the SAME implementation there.
 */
function fresh(entry) {
  const c = entry.clone();
  c.overrides.delete(TARGET);
  c.routines.set(TARGET, oracle);
  return c;
}

function runOn(entry, fn) {
  const c = fresh(entry);
  const ret = fn(c);
  return { m: c, ret };
}

/** Compare a candidate against the oracle: RAM − the stack scratch below the entry SP, pc, SP, and the return value. */
function contractDiffs(entry, fn) {
  const o = runOn(entry, oracle);
  let c;
  try {
    c = runOn(entry, fn);
  } catch (e) {
    return [`candidate threw: ${e.message}`];
  }
  const diffs = [];
  const ram = firstRamDiff(o.m, c.m, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx16(ram.addr)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.m.pc !== c.m.pc) diffs.push(`pc oracle=${hx16(o.m.pc)} cand=${hx16(c.m.pc)}`);
  if (o.m.regs.sp !== c.m.regs.sp) diffs.push(`SP oracle=${hx16(o.m.regs.sp)} cand=${hx16(c.m.regs.sp)}`);
  if (String(o.ret) !== String(c.ret)) diffs.push(`return oracle=${o.ret} cand=${c.ret}`);
  return diffs;
}

// -- capture -------------------------------------------------------------------

/** Every real 0x2079 dispatch in a run, as entry-state clones. */
function capture({ tape = null, frames = CAPTURE_FRAMES }) {
  const caps = [];
  const ov = new Map([[TARGET, (mm) => { caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: ov });
  if (tape) host.inputTape = tape.map((t) => ({ ...t }));
  host.runFrames(frames);
  return caps;
}

let CAPTURES = null;
/** The two capture runs, memoised (each is a full 6000-frame emulation). */
function allCaptures() {
  if (!CAPTURES) {
    CAPTURES = [
      { label: "attract", caps: capture({}) },
      { label: "credited 1P", caps: capture({ tape: COIN_START_TAPE }) },
    ];
  }
  return CAPTURES;
}

const flatCaptures = () => allCaptures().flatMap(({ caps }) => caps);

/** Craft an entry on a real capture: move the record pointer and/or restamp the two bytes. */
function craft(base, { recordBase = null, active = null, x = null } = {}) {
  const e = base.clone();
  if (recordBase !== null) e.regs.ix = recordBase;
  if (active !== null) e.mem.write8(e.regs.ix + OBJ_ACTIVE, active);
  if (x !== null) e.mem.write8(e.regs.ix + OBJ_X, x);
  return e;
}

// -- twins ---------------------------------------------------------------------

/** Poison a register at the exact instant of the hand-off, ONCE, then let the frozen tail run
 *  untouched — so the probe measures this routine's live-out and nothing deeper. */
function poisonAtHandoff(m, poison) {
  const inner = m.routines.get(TAIL);
  m.routines.set(TAIL, (mm, ...args) => {
    m.routines.set(TAIL, inner); // one shot: later slots reach the tail unmodified
    poison(mm);
    return inner(mm, ...args);
  });
  return loc_2079(m);
}

/** The header's claim, as a probe: the accumulator and every flag are dead across the exit. */
const poisonedAccumulatorAndFlags = (m) =>
  poisonAtHandoff(m, (mm) => { mm.regs.a = 0x5a; mm.regs.f = 0xff; });

/** The same probe aimed at a register that IS live, so the probe is shown not to be inert. */
const poisonedRecordPointer = (m) =>
  poisonAtHandoff(m, (mm) => { mm.regs.ix = (mm.regs.ix + RECORD_STRIDE) & 0xffff; });

/** (a) never takes the record out of the walk. */
function twinKeepsActive(m) {
  m.mem8[m.regs.ix + OBJ_X] = 0;
  return m.call(TAIL);
}
/** (b) never clears the position. */
function twinKeepsX(m) {
  m.mem8[m.regs.ix + OBJ_ACTIVE] = 0;
  return m.call(TAIL);
}
/** (c) writes a live value where it should write a cleared one. */
function twinWritesOne(m) {
  m.mem8[m.regs.ix + OBJ_ACTIVE] = 1;
  m.mem8[m.regs.ix + OBJ_X] = 0;
  return m.call(TAIL);
}
/** (d) clears the neighbouring record field instead of the position. */
function twinWrongField(m) {
  m.mem8[m.regs.ix + OBJ_ACTIVE] = 0;
  m.mem8[m.regs.ix + 1] = 0;
  return m.call(TAIL);
}
/** (e) drops the hand-off, so the record never reaches the sprite buffer and the walk stops. */
function twinNoTail(m) {
  m.mem8[m.regs.ix + OBJ_ACTIVE] = 0;
  m.mem8[m.regs.ix + OBJ_X] = 0;
}

// -- 0. REACHABILITY -----------------------------------------------------------

test("REACHABILITY: 2 natural attract dispatches + 2 in a credited game; all four replayed", () => {
  const [attract, credited] = allCaptures();
  assert.equal(attract.caps.length, 2,
    `expected 2 natural 0x2079 dispatches in ${CAPTURE_FRAMES} attract frames, saw ${attract.caps.length}`);
  assert.equal(credited.caps.length, 2,
    `expected 2 0x2079 dispatches in a ${CAPTURE_FRAMES}-frame credited game, saw ${credited.caps.length}`);

  const shapes = new Set();
  const bases = new Set();
  for (const c of flatCaptures()) {
    const base = c.regs.ix;
    bases.add(base);
    shapes.add(`x=${c.mem.read8(base + OBJ_X)}`);
    // Every real dispatch arrives on an OBJ_ARRAY_67 record, and the caller's window is the one
    // the header describes: OBJ_X + 8 below 16.
    const index = (base - OBJ_ARRAY_67) / RECORD_STRIDE;
    assert.ok(Number.isInteger(index) && index >= 0 && index < RECORD_COUNT,
      `dispatch arrived on ${hx16(base)}, which is not an OBJ_ARRAY_67 record`);
    assert.ok(((c.mem.read8(base + OBJ_X) + 8) & 0xff) < 16,
      `dispatch arrived with OBJ_X=${c.mem.read8(base + OBJ_X)}, outside the caller's window`);
  }
  assert.equal(bases.size, 2, `expected two distinct record bases across the runs, saw ${bases.size}`);
  assert.equal(shapes.size, 2, `expected both edges of the caller's window, saw ${[...shapes].join(", ")}`);
  console.log(`  REACHABILITY: ${flatCaptures().length} real dispatches ` +
    `[attract:${attract.caps.length} credited:${credited.caps.length}], ` +
    `bases ${[...bases].map(hx16).join(",")}, ${[...shapes].join(" ")}`);
});

// -- 1. EQUAL (real dispatches) ------------------------------------------------

test("EQUAL (real dispatches): loc_2079 == oracle on every captured 0x2079 entry", () => {
  let n = 0;
  for (const { label, caps } of allCaptures()) {
    for (const cap of caps) {
      const diffs = contractDiffs(cap, loc_2079);
      assert.equal(diffs.length, 0, `${label} capture ${n}: ${diffs.join("; ")}`);

      // Non-vacuity: the oracle really retires the record — both bytes end at 0, and at least one
      // of them was non-zero on the way in.
      const base = cap.regs.ix;
      const before = [cap.mem.read8(base + OBJ_ACTIVE), cap.mem.read8(base + OBJ_X)];
      const after = runOn(cap, oracle).m;
      assert.equal(after.mem.read8(base + OBJ_ACTIVE), 0, `${label}: the record must end inactive`);
      assert.equal(after.mem.read8(base + OBJ_X), 0, `${label}: the record's position must end cleared`);
      assert.ok(before[0] !== 0 || before[1] !== 0, `${label}: this entry was already cleared — vacuous`);
      n++;
    }
  }
  assert.equal(n, 4, `expected all 4 real dispatches to be replayed, replayed ${n}`);
  console.log(`  EQUAL/real: ${n} of ${n} captured dispatches identical on RAM+pc+SP+return`);
});

// -- 2. EQUAL (crafted sweep over the two input bytes) -------------------------

test("EQUAL (crafted sweep): 1024 entries — every OBJ_X value against four OBJ_ACTIVE values", () => {
  const base = flatCaptures()[0];
  const ACTIVE_VALUES = [0, 1, 2, 0xff];
  let count = 0, firstBad = null;

  for (const active of ACTIVE_VALUES) {
    for (let x = 0; x < 256; x++) {
      const entry = craft(base, { active, x });
      const diffs = contractDiffs(entry, loc_2079);
      count++;
      if (diffs.length && !firstBad) firstBad = `[active=${active} x=${x}] ${diffs.join("; ")}`;
    }
  }
  assert.equal(firstBad, null, firstBad);
  assert.equal(count, ACTIVE_VALUES.length * 256, "the sweep must have compared the full crossing");

  // Non-vacuity: the sweep really does drive different downstream behaviour — the sprite byte the
  // tail copies out of the record differs across the inputs only if the routine writes the record
  // it is supposed to. Here we check the opposite invariant: whatever OBJ_X arrives, it leaves 0.
  const outside = craft(base, { active: 1, x: 0x80 }); // far outside the caller's window
  assert.equal(runOn(outside, oracle).m.mem.read8(outside.regs.ix + OBJ_X), 0,
    "the routine must clear the position unconditionally — it does not re-test the caller's window");
  console.log(`  EQUAL/sweep: ${count} crafted entries identical on RAM+pc+SP+return`);
});

// -- 3. EQUAL (crafted record bases) -------------------------------------------

test("EQUAL (crafted bases): the two writes follow the record pointer to all ten slots", () => {
  const seed = flatCaptures()[0];
  const distinct = new Set();
  for (let i = 0; i < RECORD_COUNT; i++) {
    const recordBase = OBJ_ARRAY_67 + i * RECORD_STRIDE;
    const entry = craft(seed, { recordBase, active: 1, x: 0xf8 });
    const diffs = contractDiffs(entry, loc_2079);
    assert.equal(diffs.length, 0, `record ${i} (${hx16(recordBase)}): ${diffs.join("; ")}`);

    // and the write really landed in THAT record
    const after = runOn(entry, oracle).m;
    assert.equal(after.mem.read8(recordBase + OBJ_ACTIVE), 0, `record ${i}: active flag not cleared`);
    distinct.add(recordBase);
  }
  assert.equal(distinct.size, RECORD_COUNT);
  console.log(`  EQUAL/bases: all ${RECORD_COUNT} OBJ_ARRAY_67 record bases identical to the oracle`);
});

// -- 4. WRITE-SET --------------------------------------------------------------

test("WRITE-SET: inside the record, the oracle changes exactly OBJ_ACTIVE and OBJ_X", () => {
  const seed = flatCaptures()[0];
  const entry = craft(seed, { active: 1, x: 0xf8 });
  const recordBase = entry.regs.ix;
  const after = runOn(entry, oracle).m;

  const moved = [];
  for (let off = 0; off < RECORD_STRIDE; off++) {
    if (entry.mem.read8(recordBase + off) !== after.mem.read8(recordBase + off)) moved.push(off);
  }
  assert.deepEqual(moved, [OBJ_ACTIVE, OBJ_X],
    `the record's changed offsets were [${moved.join(",")}], not exactly [${OBJ_ACTIVE},${OBJ_X}]`);
  console.log(`  WRITE-SET: record offsets changed = [${moved.join(", ")}] (OBJ_ACTIVE, OBJ_X)`);
});

// -- 5. LIVE-OUT PROBE ---------------------------------------------------------

test("LIVE-OUT PROBE: the accumulator and the flags are dead at the hand-off; the pointer is not", () => {
  const seed = flatCaptures()[0];

  let probed = 0;
  for (const cap of flatCaptures()) {
    const diffs = contractDiffs(cap, poisonedAccumulatorAndFlags);
    assert.equal(diffs.length, 0,
      `poisoning the accumulator/flags at the hand-off changed the run: ${diffs.join("; ")} ` +
      "— so one of them IS live-out and loc_2079's header is wrong");
    probed++;
  }
  // and on five crafted positions, where the tail copies a different byte out of the record
  for (const x of [0, 7, 0x40, 0xf8, 0xff]) {
    const entry = craft(seed, { active: 1, x });
    const diffs = contractDiffs(entry, poisonedAccumulatorAndFlags);
    assert.equal(diffs.length, 0, `poisoned accumulator/flags at OBJ_X=${x}: ${diffs.join("; ")}`);
    probed++;
  }

  // The probe is not inert: the SAME mechanism aimed at the record pointer is caught.
  const caught = contractDiffs(craft(seed, { active: 1, x: 0xf8 }), poisonedRecordPointer);
  assert.ok(caught.length > 0,
    "poisoning the RECORD POINTER at the hand-off was not caught — the poison probe is inert " +
    "and the dead-accumulator result above proves nothing");

  console.log(`  LIVE-OUT PROBE: ${probed} entries unchanged with the accumulator + flag byte ` +
    `poisoned at the hand-off; the same probe on the record pointer is caught (${caught[0]})`);
});

// -- 6/7. LIVE (whole attract) -------------------------------------------------

let BASELINE = null;
/** The all-oracle baseline frame trace. */
function baselineFrames() {
  if (!BASELINE) {
    const m = new Machine(ROM);
    const sp = recordFrameSp(m);
    m.runFrames(LIVE_FRAMES);
    BASELINE = Object.assign(m.frames, { sp });
  }
  return BASELINE;
}

/**
 * Run attract with `fn` wired at 0x2079.
 *
 * `charge` restores the cycles the ORACLE'S OWN four instructions cost and the rewrite does not.
 * Only those: the tail chain past 0x21BA is run by the candidate as well, so charging the oracle's
 * total would double-count it. The head cost is measured, not asserted, by running the oracle on a
 * throwaway clone whose tail is stubbed out.
 */
function liveRun(fn, { charge = true } = {}) {
  let calls = 0;
  let headCycles = null;
  const ov = new Map([[TARGET, (mm) => {
    calls++;
    if (charge) {
      const probe = mm.clone();
      probe.routines.set(TAIL, () => {}); // head only — and so the probe can never re-enter 0x2079
      const before = probe.cycles;
      oracle(probe);
      headCycles = probe.cycles - before;
      mm.step(probe.pc, headCycles); // charge them where the oracle's last instruction leaves the PC
    }
    return fn(mm);
  }]]);
  const m = new Machine(ROM, { overrides: ov });
  const sp = recordFrameSp(m);
  m.runFrames(LIVE_FRAMES);
  return { frames: Object.assign(m.frames, { sp }), calls, headCycles };
}

/** state-offset -> RAM-address table. Array.from, NOT dumpState().map — the latter is a
 *  Uint8Array whose map truncates every address to a byte. */
function addressTable() {
  const probe = new Machine(ROM);
  return Array.from(probe.dumpState(), (_, i) => probe.stateOffsetToAddr(i));
}

/** First (frame, address) where two traces differ outside the stack scratch below each frame's live SP. */
function firstTraceDiff(a, b, addrOf) {
  const n = Math.min(a.length, b.length);
  const floors = frameFloors(a.sp, b.sp);
  for (let i = 0; i < n; i++) {
    const A = a[i], B = b[i];
    const dead = deadStackBelow(STACK_SCRATCH, floors[i]);
    for (let j = 0; j < A.length; j++) {
      if (A[j] !== B[j] && !dead(addrOf[j])) return { frame: i, addr: addrOf[j], a: A[j], b: B[j] };
    }
  }
  return null;
}

test("LIVE: wired at 0x2079 for a whole attract run, the trace is identical to the oracle's", () => {
  const base = baselineFrames();
  const addrOf = addressTable();

  const live = liveRun(loc_2079);
  assert.ok(live.calls > 0, "the wired routine must actually be dispatched");
  const diff = firstTraceDiff(base, live.frames, addrOf);
  assert.equal(diff, null,
    diff && `live attract diverged at frame ${diff.frame}, ${hx16(diff.addr)}: oracle=${diff.a} cand=${diff.b}`);
  assert.equal(live.frames.length, base.length, "the wired run must reach the same frame budget");
  console.log(`  LIVE: ${live.calls} dispatches over ${LIVE_FRAMES} attract frames ` +
    `(head charge ${live.headCycles} cycles) — identical to the all-oracle baseline`);
});

test("LIVE TEETH: dropping the oracle's head cycles DOES move the trace", () => {
  const base = baselineFrames();
  const addrOf = addressTable();

  const uncharged = liveRun(loc_2079, { charge: false });
  const diff = firstTraceDiff(base, uncharged.frames, addrOf);
  assert.notEqual(diff, null,
    "an uncharged run was expected to shift the NMI and diverge; it did not, which means the LIVE " +
    "test's cycle restoration is not what is making it pass and that comparison may be inert");
  console.log(`  LIVE TEETH: uncharged, the run diverges at frame ${diff.frame}, ${hx16(diff.addr)} ` +
    "— a timing artifact, which is exactly why the LIVE test restores the cost");
});

// -- 8. TEETH ------------------------------------------------------------------

test("TEETH: five broken twins are all CAUGHT", () => {
  const seed = flatCaptures()[0];
  const bait = craft(seed, { active: 1, x: 0xf8 });
  // Give the neighbouring record field a non-zero value, so a twin that clears IT instead of the
  // position is caught by its own stray write and not only by the position it failed to clear.
  bait.mem.write8(bait.regs.ix + 1, 0x5a);

  const twins = [
    ["keeps the record active", twinKeepsActive],
    ["keeps the position", twinKeepsX],
    ["writes 1 instead of clearing", twinWritesOne],
    ["clears the wrong record field", twinWrongField],
    ["drops the hand-off to the shared tail", twinNoTail],
  ];

  const caught = [];
  for (const [name, twin] of twins) {
    const diffs = contractDiffs(bait, twin);
    assert.ok(diffs.length > 0, `the "${name}" twin escaped — the gate is worthless`);
    caught.push(`${name}: ${diffs[0]}`);
  }
  console.log("  TEETH: " + caught.join("; "));
});
