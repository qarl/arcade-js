// SPDX-License-Identifier: GPL-3.0-only
/**
 * armWholePlaneWipeThenDerailOnATamperedImage — memory-equivalent to the frozen oracle at ROM 0x019A.
 *
 * ★ IT IS DISPATCHED ONCE PER SESSION, and that is why the crafted arms carry this file. One
 *   `call 0x019A` exists in the image, at 0x15E2, on the boot path; measured over both tapes the
 *   entry runs exactly once. A gate resting on that single entry would be testing one prior value
 *   of two cells and one program image. CORPUS records the entry and guards vacuity; CELLS,
 *   ENTRY-STATE, BLOCK and TAMPER are what actually cover the input space.
 *
 * ★ THE TAMPER ARM IS THE ONLY WAY TO REACH THE FAILING BRANCH, so it is built rather than
 *   reasoned about. On a genuine image the check passes and the trap call is dead code, which
 *   means a rewrite that got the total, the run length, the start or the expected value wrong
 *   would be INVISIBLE to every arm that runs the real image. TAMPER clones a captured entry onto
 *   a PRIVATE copy of the program image with one byte changed and a probe standing in for the
 *   trap address, so the branch is exercised without executing the junk it lands in — and BLOCK
 *   walks the tamper to the first byte of the checked run, the last, and the bytes either side,
 *   so the run's extent is measured and not declared.
 *
 * ★ THE TRAP TARGET IS CAPTION TEXT, NOT DEBRIS. 0x0167 is a caption record — live bytes a table
 *   points at — which happens to decode as instructions and falls into the interrupt epilogue.
 *   The epilogue then unwinds a frame that WAS laid down, but ONE WORD OUT OF STEP, because the
 *   arm's own return word is never spent; it returns to a value that is not an address. That is
 *   the intent — a tampered image is derailed, not reported — and it is why the arms here replace
 *   the address with a probe instead of letting it run.
 *
 * What it exercises, holes stated:
 *   1. CORPUS — the real dispatch, whole state dump plus a register-ceiling check. Vacuity guarded.
 *   2. WINDOW — the oracle pushes nothing on the passing path, measured, with a control.
 *   3. CELLS — the two seeded cells over every prior byte value they could hold.
 *   4. ENTRY-STATE — crafted register entries, including the one that makes the loop counter move.
 *   5. BLOCK — the checked run's first and last byte trip the check; the bytes either side do not.
 *   6. TAMPER — a changed image sends both sides to the trap, the genuine one sends neither.
 *   7. EXCLUDED — nothing outside the declared ceiling moves, with a control twin.
 *   8. DRIVEN — the rewrite wired live for a whole session; divergence confined to dead stack.
 *   9. TEETH — six twins, each caught, with the arm that caught it named.
 *
 * HOLE: the wipe this entry arms is never run here. What the cursor and the counter mean is the
 * business of the routine that paints; this file only fixes what is written into them.
 * HOLE: TAMPER changes one byte at a time. A pair of changes that cancel in an eight-bit sum is
 * exactly what the check cannot see, and nothing here pretends otherwise.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-019a.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { armWholePlaneWipeThenDerailOnATamperedImage } from "../armWholePlaneWipeThenDerailOnATamperedImage.js";
import { loc_019a as oracle } from "../../translated/loc_019a.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { BLANK_LINES_LEFT, BLANK_LINE_CURSOR } from "../names.js";

const TARGET = 0x019a;
const TRAP = 0x0167;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const PLANE_FIRST_CELL = 0xa400;
const WHOLE_PLANE = 0x20;
const CHECKED_BLOCK = 0x4ba5;
const CHECKED_BYTES = 0xf0;

/** Measured by WINDOW: on the passing path the oracle pushes nothing at all. */
const SCRATCH_BYTES = 0;
/** The oracle DOES push a return address on the failing path, so TAMPER masks that much. */
const TRAP_SCRATCH_BYTES = 2;

const STACK_SEAT = 0xb000;
const DRIVEN_FRAMES = 700;
const VALUES = 256;

/**
 * The ceiling on register divergence. The oracle leaves the running total in the accumulator with
 * the expected value already taken off it, the flags that subtraction set, a spent loop counter,
 * the cursor one past the checked run, and a stack pointer two higher for the return it takes.
 * The rewrite hands none of that on. Every caller-side read is covered: the one call site reloads
 * the accumulator, the counter's partner and the cursor before touching any of them, and sets its
 * own flags. A subset check, so a rewrite diverging on fewer still passes.
 */
const MOVED = ["a", "f", "b", "h", "l", "sp"];

// Read at import, so it must be guarded by romsPresent(): the ROMs
// are gitignored, and an unguarded read throws before `skip` can spare a single test.
const ROM_IMAGE = romsPresent() ? readFileSync(new URL("../../rom/maincpu.bin", import.meta.url)) : null;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function lean(mm) {
  mm.assets = {};
  mm.video = null;
  return mm;
}

// ── the captured machine ────────────────────────────────────────────────────────────────

let captured = null;
function capture() {
  if (captured) return captured;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    entries.push(lean(mm.clone()));
    return oracle(mm);
  }]]));
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "capture run ran short");
  assert.notEqual(entries.length, 0, "vacuous: the tape never reached the routine");
  captured = entries;
  return captured;
}

const entry = () => capture()[0];

/**
 * A clone whose trap address answers with a COUNTER instead of the debris that lives there.
 * Every comparison below runs on one of these: the real target is thirteen bytes of table read as
 * code, and letting a twin fall into it makes the failure a wild transfer rather than a diff.
 */
function armed(machine) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  const hits = { n: 0 };
  c.routines.set(TRAP, () => { hits.n++; });
  return { c, hits };
}

/** Oracle vs candidate on independent clones: the whole dump, then the register ceiling. */
function unitDiff(candidate, machine) {
  const seat = machine.regs.sp;
  const { c: a, hits: ha } = armed(machine);
  const { c: b, hits: hb } = armed(machine);
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: String(e).slice(0, 50) };
  }
  if (ha.n !== hb.n) return { addr: null, a: `trapped ${ha.n}x`, b: `trapped ${hb.n}x` };
  // The oracle pushes a return address on the way to the trap and the rewrite does not, so the
  // masked window is wider on the arm where it traps and zero on the arm where it does not.
  const mask = ha.n > 0 ? TRAP_SCRATCH_BYTES : SCRATCH_BYTES;
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr < seat - mask || addr >= seat) return { addr, a: da[i], b: db[i] };
  }
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: `${k}=${a.regs[k]}`, b: `${k}=${b.regs[k]}` };
  }
  return null;
}

function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

// ── a machine over a private, editable program image ────────────────────────────────────

/**
 * A clone of the captured entry reading a PRIVATE copy of the image with one byte changed. The
 * image is copied rather than shared: the harness caches one across every gate in the suite, and
 * editing it in place would poison the rest of the run.
 */
function tampered(at, delta) {
  const image = Uint8Array.from(ROM_IMAGE);
  if (delta !== 0) image[at] = (image[at] + delta) & 0xff;
  const c = entry().clone();
  c.mem.rom = image;
  return c;
}

/**
 * Whether each side takes the derail when one image byte is changed. The dissolved arm calls the
 * derail directly rather than through a dispatch a probe could count, so it is let run: its tail
 * stores through a mis-stepped pointer into the image and faults on the write to non-RAM, and a
 * genuine image never enters it — so the fault IS the signal, 1 when it faults, 0 when it returns.
 */
function trapHits(candidate, at, delta) {
  const took = (fn) => {
    try {
      fn(tampered(at, delta));
      return 0;
    } catch {
      return 1;
    }
  };
  return { oracle: took(oracle), candidate: took(candidate) };
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

const sum = (m, base, n) => {
  let t = 0;
  for (let i = 0; i < n; i++) t = (t + m.mem8[(base + i) & 0xffff]) & 0xff;
  return t;
};

/** BUG: does nothing — the tell that a gate is measuring an idle entry. */
function brokenNoOp() {}

/** BUG: seats the cursor but forgets the count, so the wipe stops after whatever was left. */
function brokenNoCount(m) {
  m.mem16[BLANK_LINE_CURSOR] = PLANE_FIRST_CELL;
  if (sum(m, CHECKED_BLOCK, CHECKED_BYTES) !== 0x11) return m.call(TRAP);
}

/** BUG: writes only the cursor's low half, leaving the high half wherever it was. */
function brokenHalfCursor(m) {
  m.mem8[BLANK_LINE_CURSOR] = PLANE_FIRST_CELL & 0xff;
  m.mem8[BLANK_LINES_LEFT] = WHOLE_PLANE;
  if (sum(m, CHECKED_BLOCK, CHECKED_BYTES) !== 0x11) return m.call(TRAP);
}

/** BUG: the check runs one byte short, so the last byte of the run is never covered. */
function brokenShortRun(m) {
  m.mem16[BLANK_LINE_CURSOR] = PLANE_FIRST_CELL;
  m.mem8[BLANK_LINES_LEFT] = WHOLE_PLANE;
  if (sum(m, CHECKED_BLOCK, CHECKED_BYTES - 1) !== 0x11) return m.call(TRAP);
}

/** BUG: the check starts one byte early, so it covers a byte outside the run. */
function brokenOffByOneStart(m) {
  m.mem16[BLANK_LINE_CURSOR] = PLANE_FIRST_CELL;
  m.mem8[BLANK_LINES_LEFT] = WHOLE_PLANE;
  if (sum(m, CHECKED_BLOCK - 1, CHECKED_BYTES) !== 0x11) return m.call(TRAP);
}

/** BUG: the total is never held against anything, so a tampered image sails through. */
function brokenNeverTraps(m) {
  m.mem16[BLANK_LINE_CURSOR] = PLANE_FIRST_CELL;
  m.mem8[BLANK_LINES_LEFT] = WHOLE_PLANE;
}

/** BUG: seats the cursor one cell into the plane, so the wipe misses its first cell. */
function brokenCursorOffByOne(m) {
  m.mem16[BLANK_LINE_CURSOR] = PLANE_FIRST_CELL + 1;
  m.mem8[BLANK_LINES_LEFT] = WHOLE_PLANE;
  if (sum(m, CHECKED_BLOCK, CHECKED_BYTES) !== 0x11) return m.call(TRAP);
}

/** BUG: scribbles on an index register — the control for the register ceiling. */
function brokenMovesIndex(m) {
  armWholePlaneWipeThenDerailOnATamperedImage(m);
  m.regs.ix = (m.regs.ix + 1) & 0xffff;
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["no-count", brokenNoCount],
  ["half-cursor", brokenHalfCursor],
  ["short-run", brokenShortRun],
  ["off-by-one-start", brokenOffByOneStart],
  ["cursor-off-by-one", brokenCursorOffByOne],
];
/** Invisible to every arm that runs the genuine image; TAMPER is the only thing that sees it. */
const TAMPER_ONLY_TWIN = ["never-traps", brokenNeverTraps];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: the real dispatch replays identically", { skip }, () => {
  const entries = capture();
  for (const e of entries) {
    const d = unitDiff(armWholePlaneWipeThenDerailOnATamperedImage, e);
    assert.equal(d, null, show(d));
  }
  // Flavour: an entry whose cells already hold the right values would make a no-op twin
  // invisible right here. Measured, not assumed.
  const before = entry();
  assert.ok(before.mem16[BLANK_LINE_CURSOR] !== PLANE_FIRST_CELL ||
    before.mem8[BLANK_LINES_LEFT] !== WHOLE_PLANE,
  "the captured entry already holds what this routine writes, so the CORPUS arm is degenerate " +
    "and only the crafted arms below are load-bearing");
  console.log(`  CORPUS: ${entries.length} real dispatch(es) identical; entry held cursor ` +
    `${hex4(before.mem16[BLANK_LINE_CURSOR])} count ${before.mem8[BLANK_LINES_LEFT]}`);
});

test("WINDOW: the oracle pushes nothing on the passing path", { skip }, () => {
  let deepest = 0;
  for (const e of capture()) deepest = Math.max(deepest, oracleDepth(e));
  for (let v = 0; v < VALUES; v += 17) {
    const c = entry().clone();
    c.mem8[BLANK_LINES_LEFT] = v;
    c.mem16[BLANK_LINE_CURSOR] = v * 0x0101;
    deepest = Math.max(deepest, oracleDepth(c));
  }
  const probe = entry().clone();
  const seat = probe.regs.sp;
  let seen = seat;
  const push = probe.push16.bind(probe);
  probe.push16 = (v) => { const r = push(v); if (probe.regs.sp < seen) seen = probe.regs.sp; return r; };
  probe.push16(0x1234);
  assert.equal(seat - seen, 2, "the depth instrument does not notice a push it was handed, so " +
    "the number below means nothing");
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle now pushes on the passing path, so the whole " +
    "dump is being compared over bytes it has a right to move");
});

test("CELLS: both seeded cells land whatever they held before", { skip }, () => {
  let compared = 0;
  for (let v = 0; v < VALUES; v++) {
    const c = entry().clone();
    c.mem8[BLANK_LINES_LEFT] = v;
    c.mem8[BLANK_LINE_CURSOR] = v;
    c.mem8[BLANK_LINE_CURSOR + 1] = (v * 7) & 0xff;
    const d = unitDiff(armWholePlaneWipeThenDerailOnATamperedImage, c);
    assert.equal(d, null, `prior value ${v} diverged — ${show(d)}`);
    const after = c.clone();
    armWholePlaneWipeThenDerailOnATamperedImage(after);
    assert.equal(after.mem16[BLANK_LINE_CURSOR], PLANE_FIRST_CELL, `prior ${v}: cursor wrong`);
    assert.equal(after.mem8[BLANK_LINES_LEFT], WHOLE_PLANE, `prior ${v}: count wrong`);
    compared++;
  }
  console.log(`  CELLS: ${compared} prior values identical, cursor and count landing every time`);
});

test("ENTRY-STATE: crafted register entries, the loop counter included", { skip }, () => {
  let compared = 0;
  for (const b of [0, 1, 7, 0x80, 0xff]) {
    for (const hl of [0x0000, 0x4ba5, 0xffff]) {
      const c = entry().clone();
      c.regs.b = b;
      c.regs.hl = hl;
      c.regs.a = (b ^ 0x5a) & 0xff;
      c.regs.de = 0x9876;
      const d = unitDiff(armWholePlaneWipeThenDerailOnATamperedImage, c);
      assert.equal(d, null, `entry b=${b} hl=${hex4(hl)} diverged — ${show(d)}`);
      compared++;
    }
  }
  // The counter is in the ceiling only because it really moves: shown here rather than assumed.
  const withCounter = entry().clone();
  withCounter.regs.b = 0x33;
  const a = withCounter.clone();
  const bb = withCounter.clone();
  oracle(a);
  armWholePlaneWipeThenDerailOnATamperedImage(bb);
  assert.notEqual(a.regs.b, bb.regs.b, "the loop counter no longer moves, so listing it in the " +
    "excluded set is dead weight nothing would catch");
  console.log(`  ENTRY-STATE: ${compared} crafted entries identical; the counter moves ` +
    `${bb.regs.b} -> ${a.regs.b} on the oracle side`);
});

test("BLOCK: the checked run's extent, measured at both ends", { skip }, () => {
  const cases = [
    ["one byte before the run", CHECKED_BLOCK - 1, false],
    ["the run's first byte", CHECKED_BLOCK, true],
    ["the run's last byte", CHECKED_BLOCK + CHECKED_BYTES - 1, true],
    ["one byte after the run", CHECKED_BLOCK + CHECKED_BYTES, false],
  ];
  for (const [label, at, shouldTrap] of cases) {
    const r = trapHits(armWholePlaneWipeThenDerailOnATamperedImage, at, 1);
    assert.equal(r.oracle, shouldTrap ? 1 : 0, `${label}: the oracle disagrees with this file's ` +
      "idea of where the checked run starts and ends");
    assert.equal(r.candidate, r.oracle, `${label}: the rewrite reached the trap ${r.candidate} ` +
      `time(s) and the oracle ${r.oracle}`);
  }
  console.log("  BLOCK: both ends of the run trip the check, both neighbours do not, on both sides");
});

test("TAMPER: a changed image sends both sides to the trap", { skip }, () => {
  const clean = trapHits(armWholePlaneWipeThenDerailOnATamperedImage, CHECKED_BLOCK, 0);
  assert.equal(clean.oracle, 0, "the genuine image already fails the check");
  assert.equal(clean.candidate, 0, "the rewrite traps on a genuine image");

  let caught = 0;
  const offsets = [0, 1, 37, 128, CHECKED_BYTES - 2, CHECKED_BYTES - 1];
  for (const off of offsets) {
    for (const delta of [1, 0x40, 0xff]) {
      const r = trapHits(armWholePlaneWipeThenDerailOnATamperedImage, CHECKED_BLOCK + off, delta);
      assert.equal(r.candidate, r.oracle, `offset ${off} delta ${delta}: trap counts differ`);
      if (r.oracle > 0) caught++;
    }
  }
  assert.equal(caught, offsets.length * 3, "a changed byte failed to trip the check, so the " +
    "instrument cannot see the tamper it exists to see");

  // The whole point of the arm: a twin with no check at all is invisible everywhere else.
  const blind = trapHits(brokenNeverTraps, CHECKED_BLOCK, 1);
  assert.equal(blind.oracle, 1, "the tampered oracle stopped trapping");
  assert.equal(blind.candidate, 0, "the never-traps twin reached the trap, so it is not the " +
    "control this arm needs");
  console.log(`  TAMPER: ${caught} single-byte changes trapped on both sides, the genuine image ` +
    "on neither, and the check-free twin is seen sailing through");
});

function movedOver(candidate) {
  const moved = new Set();
  const machines = [...capture()];
  for (const b of [0, 0x33, 0xff]) {
    const c = entry().clone();
    c.regs.b = b;
    c.regs.hl = 0x1234;
    machines.push(c);
  }
  for (const m of machines) {
    const a = m.clone();
    const bb = m.clone();
    oracle(a);
    try {
      candidate(bb);
    } catch {
      continue;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== bb.regs[k]) moved.add(k);
  }
  return moved;
}

test("EXCLUDED, deliberately: the total, the flags, the counter, the cursor, the stack pointer",
  { skip }, () => {
    const moved = movedOver(armWholePlaneWipeThenDerailOnATamperedImage);
    const control = movedOver(brokenMovesIndex);
    assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
      "the measurement reports nothing outside the ceiling even for a twin that scribbles on an " +
        "index register, so a clean reading below proves nothing");
    console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
      `ceiling ${MOVED.join(", ")}; the control twin also moves ` +
      `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
    // A ceiling, not a demand: deepEqual here would go RED on a rewrite that became exact.
    assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
      "a register diverged outside the excluded set");
  });

// ── the driven run ──────────────────────────────────────────────────────────────────────

function driven(candidate, baseline) {
  let calls = 0;
  let lowSp = 0xffff;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    calls++;
    if (mm.regs.sp < lowSp) lowSp = mm.regs.sp;
    return candidate(mm);
  }]]));
  let frames = [];
  let threw = null;
  try {
    frames = m.runFrames(DRIVEN_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 60);
    frames = m.frames;
  }
  const differing = new Set();
  const compared = baseline === null ? 0 : Math.min(baseline.frames.length, frames.length);
  for (let f = 0; f < compared; f++) {
    const a = baseline.frames[f];
    const b = frames[f];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing.add(m.stateOffsetToAddr(i));
  }
  return { frames, calls, lowSp, threw, compared, stopped: m.stoppedBy ? String(m.stoppedBy) : null,
    differing: [...differing].sort((x, y) => x - y) };
}

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    baselineRun = driven(oracle, null);
    assert.equal(baselineRun.threw, null, `the baseline itself threw: ${baselineRun.threw}`);
    assert.equal(baselineRun.stopped, null, `the baseline stopped early: ${baselineRun.stopped}`);
  }
  return baselineRun;
}

test("DRIVEN: wired live for a whole session, divergence confined to dead stack", { skip }, () => {
  const base = baseline();
  const r = driven(withOmittedRet(armWholePlaneWipeThenDerailOnATamperedImage, TARGET), base);
  assert.equal(r.threw, null, `the driven run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the driven run stopped early: ${r.stopped}`);
  assert.equal(r.compared, DRIVEN_FRAMES, "the driven run did not reach the frames asked for");
  assert.ok(r.calls > 0, "vacuous: the rewrite was never dispatched in the driven run");

  const floor = base.lowSp - TRAP_SCRATCH_BYTES;
  const escaped = r.differing.filter((a) => a < floor || a >= STACK_SEAT);
  assert.deepEqual(escaped.map(hex4), [], "a divergence reached memory outside the dead stack " +
    "region, so this rewrite is not a transparent swap after all");
  console.log(`  DRIVEN: ${r.calls} dispatch(es) over ${DRIVEN_FRAMES} frames; ` +
    `${r.differing.length} byte(s) differ, all dead stack: ${r.differing.map(hex4).join(" ")}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin] of [...TWINS, TAMPER_ONLY_TWIN]) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const spaces = [];
    spaces.push(["corpus", capture().filter((e) => unitDiff(twin, e) !== null).length, capture().length]);

    const cells = [];
    for (let v = 0; v < VALUES; v += 5) {
      const c = entry().clone();
      c.mem8[BLANK_LINES_LEFT] = v;
      c.mem8[BLANK_LINE_CURSOR] = v;
      c.mem8[BLANK_LINE_CURSOR + 1] = (v * 7) & 0xff;
      cells.push(c);
    }
    spaces.push(["cells", cells.filter((c) => unitDiff(twin, c) !== null).length, cells.length]);

    // The discriminating positions, not just any one: a twin whose run is SHIFTED sums the same
    // bytes as the real one on a genuine image, because the byte before the run and the byte
    // after it happen to be equal. Only a change at one END separates the two.
    const spots = [CHECKED_BLOCK - 1, CHECKED_BLOCK, CHECKED_BLOCK + CHECKED_BYTES - 1,
      CHECKED_BLOCK + CHECKED_BYTES];
    const tamperCaught = spots.filter((at) => {
      const r = trapHits(twin, at, 1);
      return r.candidate !== r.oracle;
    }).length;
    spaces.push(["tamper", tamperCaught, spots.length]);

    const driverCaught = spaces.reduce((n, s) => n + s[1], 0);
    console.log(`  TEETH/${label}: caught on ${spaces.map((s) => `${s[0]} ${s[1]}/${s[2]}`).join(", ")}`);
    assert.ok(driverCaught > 0, `every arm PASSED the ${label} twin — no teeth against it`);
  });
}

test("TEETH: the driven arm catches a twin too", { skip }, () => {
  const r = driven(withOmittedRet(brokenNoOp, TARGET), baseline());
  const floor = baseline().lowSp - TRAP_SCRATCH_BYTES;
  const escaped = r.differing.filter((a) => a < floor || a >= STACK_SEAT);
  assert.ok(r.threw !== null || r.stopped !== null || escaped.length > 0,
    "the driven arm PASSED a no-op twin, so its confinement result is vacuous");
  console.log(`  TEETH/driven: no-op twin — reached frame ${r.frames.length}, ` +
    `${escaped.length} escaped byte(s), ${r.threw ?? r.stopped ?? "ran clean"}`);
});
