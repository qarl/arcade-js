// SPDX-License-Identifier: GPL-3.0-only
/**
 * checkTheCopyrightLineColoursOrDerail — memory-equivalent to the frozen oracle at ROM 0x19DA.
 *
 * GATE: every dispatch of both sessions; an exhaustive crafted sweep of all thirteen cells over all
 *   256 colour values; a two-bad-cells sweep that pins WHICH cell ends the walk; a raise-site probe
 *   that holds the rewrite's fault to the cell the oracle's walk stopped at; both real callers run
 *   end to end with the rewrite seamed in; a whole-session swap; and a bench of broken twins with
 *   measured catch counts.
 *
 * ★ THE DERAIL NOW RAISES IN THE REWRITE, and the contract is re-expressed around that. The frozen
 *   form transfers into a caption record that runs as code: it steps SP by one, pops misaligned
 *   words, and in this port raises NotImplemented at a call into unmapped space (RAW DERAIL shows
 *   it). There is no faithful routine to transcribe there, so the rewrite raises NotImplemented
 *   where the transfer would land. The registers the frozen form hands that landing are therefore
 *   no longer part of the contract — nothing runs to read them — and the four twins that only
 *   mis-handed registers went with that arm. What stays is WHERE the walk stops: the oracle is run
 *   with a probe at the landing and its offending cell read off the pointer it hands over, and the
 *   rewrite's fault must name that same cell (RAISE SITE, FIRST BAD CELL, and every sweep). A twin
 *   that still jumps to the landing, and one that raises a plain error, are both on the bench.
 *
 * ★ THE DERAIL IS DEAD ON A GENUINE IMAGE: every cell of the line holds one of the two colours the
 *   line is painted and flashed in at every real dispatch of both sessions, which CORPUS asserts
 *   with the dispatch count as its positive control.
 *
 * ★ THE CORPUS PRESENTS ONE COLOUR AND ONE PATH. Measured: at every dispatch of both sessions all
 *   thirteen cells read 0x10, so the taped evidence covers the clean walk and NOTHING of the
 *   derail. Every derail arm below is crafted, and CRAFTED-MATTERS records that the corpus alone
 *   passes a twin that never derails at all.
 *
 * ★ THE CLEAN PATH'S REGISTERS ARE DEAD, AND THAT IS MEASURED RATHER THAN ASSUMED. A, F, B, HL
 *   and DE sit in the ceiling: the rewrite leaves none of them on a clean walk, and the gate does
 *   not demand them. CONTINUATION runs both real callers to
 *   completion with the rewrite seamed in over the registry and finds no difference in memory OR in
 *   any register, which is what licenses those four sitting in the ceiling.
 *
 * What it exercises, holes stated:
 *   1. WINDOW — the oracle's stack footprint, measured, and pinned at zero: nothing is masked.
 *   2. CORPUS — every dispatch of both sessions, whole-dump identical.
 *   3. NOT VACUOUS — a candidate that does nothing fails on a crafted derail.
 *   4. EXCLUDED — no register outside the measured ceiling moves, with a control twin.
 *   5. EXHAUSTIVE — thirteen cells by 256 colours, derail and clean walk alike, plus both flanking
 *      cells by 256 colours, where the walk must never derail (the extent, measured).
 *   6. FIRST BAD CELL — two bad cells at once; the walk must stop at the nearer one.
 *   7. RAISE SITE — the rewrite's fault names the cell the oracle's walk stopped at.
 *   8. RAW DERAIL — the real destination raises NotImplemented too, with no state written but the
 *      one stack word it pushes on its way into unmapped space.
 *   9. CONTINUATION — both real callers run whole with the rewrite seamed in.
 *  10. SESSION — a whole session swapped, differing only inside the measured stack band.
 *  11. CRAFTED-MATTERS — the twin the corpus alone cannot see.
 *  12. TEETH — a bench of broken twins, each with its measured catch counts.
 *
 * HOLE: the derail's own effects are never compared: the rewrite raises at the boundary by design
 * and RAW DERAIL stops where the port raises.
 * HOLE: no tape reaches the derail, so its arms rest entirely on crafted colour values.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-19da.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { assertDeadAtExit, TAPE_SESSIONS } from "./_deadAtExit.js";
import { checkTheCopyrightLineColoursOrDerail } from "../checkTheCopyrightLineColoursOrDerail.js";
import { loc_19da as oracle } from "../../translated/loc_19da.js";
import { loc_176a as caller176a } from "../../translated/loc_176a.js";
import { loc_178c as caller178c } from "../../translated/loc_178c.js";
import { withOmittedRet } from "../../machine.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { NotImplemented } from "../../../../boards/timeplt/io.js";
import { recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x19da;
const FRAMES = 3200;
const DISPATCHES = 2;

/** Derived here independently of the module, so an edit to its constants cannot pass unnoticed. */
const FIRST_CELL = 0xa2bc;
const CELLS = 13;
const STRIDE_BACK = 0xffe0;
const EITHER_COLOUR = [0x10, 0x05];
const DERAIL = 0x49fa;
const WALK = Array.from({ length: CELLS }, (_u, i) => (FIRST_CELL + i * STRIDE_BACK) & 0xffff);

/** Measured by the WINDOW arm: this oracle pushes nothing, so nothing is masked anywhere here. */
const SCRATCH_BYTES = 0;

/**
 * The ceiling on register divergence on the CLEAN walk, measured over the corpus and the sweep.
 *   a — the oracle leaves the last colour it compared in A; the rewrite keeps it in a local.
 *   f — the comparisons and the counter's decrements set flags nothing reads.
 *   b — the oracle counts the walk down in B; the rewrite counts in a local.
 *   h,l — the oracle walks HL across the cells; the rewrite indexes from a base.
 *   d,e — the oracle adds its stride through DE (0xFFE0); the rewrite keeps the stride a constant.
 *         Read off the oracle's two callers: 0x178C reloads DE (ld de,0xab43) and 0x176A reloads it
 *         (ld de,0x0113) before any read; the one landing that read D from this walk, 0x15CA on
 *         0x178C's wrong-glyph arm, is now a raise in that caller, so nothing is left to read it.
 *         Measured too, by the DEAD AT EXIT arm below: d/e complemented where this entry hands back
 *         are heard nowhere over every tape session (attract and game-over reach it).
 *   sp — the oracle takes its own return and the rewrite leaves that to the seam.
 * CONTINUATION is what makes this safe rather than merely declared: both real callers run to
 * completion with the rewrite in place and no register survives to be read.
 * A ceiling, not a demand — a rewrite that diverged on fewer of these still passes.
 */
const MOVED = ["a", "f", "b", "d", "e", "h", "l", "sp"];

const VALUES = 256;
const STACK_SEAT = 0xb000;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/**
 * Run `body` with the derail destination replaced by a probe that records what it was handed and
 * returns without doing it. Everything past the boundary is out of scope; the arguments are not.
 */
function throughProbe(body, machine) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  let handed = null;
  c.routines.set(DERAIL, (mm) => {
    const { a, hl, b, de, d, c: cReg, sp } = mm.regs;
    handed = { a, hl, b, de, d, c: cReg, sp };
  });
  body(c);
  return { machine: c, handed };
}

/** The cell index a fault names, or -1 when it names none. */
function raisedCell(e) {
  const hit = /cell (\d+) of the copyright line/.exec(String(e.message ?? e));
  return hit ? Number(hit[1]) : -1;
}

/**
 * Where a side's walk ENDS: null on a clean walk; the cell index on a derail. The oracle derails by
 * reaching the probe, and its offending cell is the pointer it hands over. The candidate derails by
 * raising NotImplemented naming the cell; reaching the landing, or raising anything else, is its own
 * outcome and never matches the oracle's.
 */
function outcome(body, machine) {
  const c = machine.clone();
  c.routines = new Map(c.routines);
  let handed = null;
  c.routines.set(DERAIL, (mm) => { handed = { hl: mm.regs.hl }; });
  let raised = null;
  try {
    body(c);
  } catch (e) {
    // A JavaScript fault is a bug in THIS file, not a divergence — swallowing one reports a
    // broken twin as a caught twin. Only a machine-level raise counts as an outcome here.
    if (e instanceof ReferenceError || e instanceof TypeError) throw e;
    raised = e instanceof NotImplemented ? `raise@${raisedCell(e)}` : `other:${String(e).slice(0, 40)}`;
  }
  let end = null;
  if (handed !== null) end = body === oracle ? `raise@${WALK.indexOf(handed.hl)}` : "reached-the-landing";
  if (raised !== null) end = end === null ? raised : `${end}+${raised}`;
  return { machine: c, end };
}

/** Oracle vs candidate on independent clones: where the walk ends, then memory. */
function unitDiff(candidate, machine) {
  const a = outcome(oracle, machine);
  const b = outcome(candidate, machine);
  if (a.end !== b.end) return { addr: null, a: a.end ?? "clean", b: b.end ?? "clean" };
  const mem = allDiffs(a.machine, b.machine).find((d) => d.addr !== null) ?? null;
  if (mem) return mem;
  return null;
}

/** How far below its seat the oracle's own pushes reach, on one entry state. */
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
  c.routines = new Map(c.routines);
  c.routines.set(DERAIL, () => {});
  oracle(c);
  return (seat - deepest) & 0xffff;
}

// ── the captured entries ────────────────────────────────────────────────────────────────

let captured = null;

function capture() {
  if (captured) return captured;
  const out = [];
  for (const opts of [{}, { tape: [] }]) {
    const seen = [];
    const m = makeMachine(new Map([[TARGET, (mm) => {
      seen.push(mm.clone());
      return oracle(mm);
    }]]), opts);
    const frames = m.runFrames(FRAMES);
    assert.equal(m.stoppedBy, null, `capture run stopped early: ${m.stoppedBy}`);
    assert.equal(frames.length, FRAMES, "capture run ran short");
    assert.equal(seen.length, DISPATCHES, "the dispatch count moved");
    out.push(...seen);
  }
  captured = out;
  return captured;
}

function entryState() {
  const e = capture()[0] ?? null;
  assert.notEqual(e, null, "vacuous: the tape never reached the routine");
  return e;
}

/** The real entry with chosen cells forced to a chosen colour. */
function craft(cells, colour) {
  const m = entryState().clone();
  for (const index of cells) m.mem8[WALK[index]] = colour;
  return m;
}

/** The two cells flanking the walk: one stride before its head, one past its tail. Neither is read. */
const FLANKS = [(FIRST_CELL - STRIDE_BACK) & 0xffff, (FIRST_CELL + CELLS * STRIDE_BACK) & 0xffff];

/** The real entry with one address forced to a chosen colour. */
function craftAt(addr, colour) {
  const m = entryState().clone();
  m.mem8[addr] = colour;
  return m;
}

/** Every cell, every colour: the derailing values and the two that let the walk carry on — and
 *  both flanking cells over every colour, where a walk of the right extent never derails. */
function sweepCells(candidate) {
  let caught = 0;
  for (let index = 0; index < CELLS; index++) {
    for (let colour = 0; colour < VALUES; colour++) {
      if (unitDiff(candidate, craft([index], colour))) caught++;
    }
  }
  for (const flank of FLANKS) {
    for (let colour = 0; colour < VALUES; colour++) {
      if (unitDiff(candidate, craftAt(flank, colour))) caught++;
    }
  }
  return caught;
}

/** Two bad cells at once — the walk must stop at whichever comes first. */
function sweepPairs(candidate) {
  let caught = 0;
  for (let i = 0; i < CELLS; i++) {
    for (let j = i + 1; j < CELLS; j++) {
      if (unitDiff(candidate, craft([i, j], 0xaa))) caught++;
    }
  }
  return caught;
}

const SWEEP_RUNS = { cells: (CELLS + FLANKS.length) * VALUES, pairs: (CELLS * (CELLS - 1)) / 2 };

// ── broken twins ────────────────────────────────────────────────────────────────────────

/** BUG: does nothing — never derails, and the clean walk hides it. */
function brokenNoOp() {}

/** The fault a twin raises, in the rewrite's own form, naming the cell its walk stopped at. */
function derail(index, colour) {
  throw new NotImplemented(`twin: cell ${index} of the copyright line holds colour ${colour}`);
}

/** BUG: derails on every entry, whatever the colours say. */
function brokenAlwaysDerails(m) {
  derail(0, m.mem8[FIRST_CELL]);
}

/** BUG: reads only the first cell and calls the line clean. */
function brokenOnlyFirstCell(m) {
  const colour = m.mem8[FIRST_CELL];
  if (EITHER_COLOUR.includes(colour)) return undefined;
  derail(0, colour);
}

/** Shared body for the twins that differ only in one parameter of the walk. */
function walker(m, { cells = CELLS, stride = STRIDE_BACK, allowed = EITHER_COLOUR, namedCell, form = "raise" }) {
  let cell = FIRST_CELL;
  for (let owed = cells; owed > 0; owed--) {
    const colour = m.mem8[cell];
    if (!allowed.includes(colour)) {
      if (form === "landing") { m.regs.hl = cell; return m.call(DERAIL); }
      if (form === "plain") throw new Error(`cell ${cells - owed} of the copyright line`);
      derail(namedCell === undefined ? cells - owed : namedCell, colour);
    }
    cell = (cell + stride) & 0xffff;
  }
  return undefined;
}

/** BUG: walks forward along the line instead of back. */
const brokenWalksForward = (m) => walker(m, { stride: 0x0020 });
/** BUG: reads one cell too few. */
const brokenTwelveCells = (m) => walker(m, { cells: CELLS - 1 });
/** BUG: reads one cell too many. */
const brokenFourteenCells = (m) => walker(m, { cells: CELLS + 1 });
/** BUG: admits a third colour. */
const brokenExtraColour = (m) => walker(m, { allowed: [...EITHER_COLOUR, 0x00] });
/** BUG: admits only one of the two colours. */
const brokenOneColour = (m) => walker(m, { allowed: [EITHER_COLOUR[0]] });
/** BUG: names the head of the line instead of the offending cell. */
const brokenWrongCellNamed = (m) => walker(m, { namedCell: 0 });
/** BUG: the pre-fault form — still jumps to the landing instead of raising. */
const brokenStillLands = (m) => walker(m, { form: "landing" });
/** BUG: refuses with a plain error rather than the untranscribed-code fault. */
const brokenPlainError = (m) => walker(m, { form: "plain" });

/** BUG: scribbles on an index register — the in-arm control for the register ceiling. */
function brokenMovesIndex(m) {
  checkTheCopyrightLineColoursOrDerail(m);
  m.regs.ix = (m.regs.ix + 1) & 0xffff;
}

/** Each twin's exact catch counts over the two sweeps. Measured; a move is a finding. */
const TWINS = [
  ["no-op", brokenNoOp],
  ["always-derails", brokenAlwaysDerails],
  ["only-first-cell", brokenOnlyFirstCell],
  ["walks-forward", brokenWalksForward],
  ["twelve-cells", brokenTwelveCells],
  ["fourteen-cells", brokenFourteenCells],
  ["extra-colour", brokenExtraColour],
  ["one-colour", brokenOneColour],
  ["wrong-cell-named", brokenWrongCellNamed],
  ["still-lands", brokenStillLands],
  ["plain-error", brokenPlainError],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("WINDOW: the oracle pushes nothing, measured over corpus and sweep", { skip }, () => {
  let deepest = 0;
  for (const e of capture()) deepest = Math.max(deepest, oracleDepth(e));
  for (let index = 0; index < CELLS; index++) {
    deepest = Math.max(deepest, oracleDepth(craft([index], 0xaa)));
  }
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat, so the ` +
    "whole dump is compared with nothing masked");
  assert.equal(deepest, SCRATCH_BYTES, "the oracle now pushes, so a masked window is owed and " +
    "every arm here is comparing bytes it has no right to");
});

test("CORPUS: every dispatch of both sessions replays identically", { skip }, () => {
  const entries = capture();
  const colours = new Set();
  for (const e of entries) {
    for (const cell of WALK) colours.add(e.mem8[cell]);
    const d = unitDiff(checkTheCopyrightLineColoursOrDerail, e);
    assert.equal(d, null, show(d));
  }
  // GENUINE: at every real dispatch every cell holds one of the two colours, so the raise is dead
  // on a genuine image. The dispatch count asserted in capture() is the positive control.
  assert.deepEqual([...colours].filter((v) => !EITHER_COLOUR.includes(v)), [],
    "a genuine session presented a colour outside the two, so the raise is reachable");
  console.log(`  CORPUS: ${entries.length} dispatches identical; the colours present across all ` +
    `${CELLS} cells are ${[...colours].map((v) => hex4(v).slice(4)).join(", ")}`);
});

test("NOT VACUOUS: a no-op candidate FAILS on a crafted derail", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft([0], 0xaa));
  assert.notEqual(d, null, "the comparison passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — oracle=${d.a} candidate=${d.b}`);
});

/** Which registers a candidate parts company with the oracle on, over corpus and sweep. */
function movedOver(candidate) {
  const moved = new Set();
  const machines = [...capture(), ...WALK.map((_u, i) => craft([i], 0x05))];
  for (const machine of machines) {
    const a = throughProbe(oracle, machine).machine;
    const o = outcome(candidate, machine);
    if (o.end !== null) continue;
    const b = o.machine;
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

/** Frames each TAPE_SESSIONS session runs for the DEAD AT EXIT arm. */
const DEAD_FRAMES = 2500;

test("DEAD AT EXIT: on the frozen game, d, e are dead where this entry hands back", { skip }, () => {
  assertDeadAtExit({ at: TARGET, poison: ["d", "e"], sessions: TAPE_SESSIONS, frames: DEAD_FRAMES });
});

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(checkTheCopyrightLineColoursOrDerail);
  const control = movedOver(brokenMovesIndex);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
    "the measurement reports nothing outside the ceiling even for a twin that scribbles on an " +
      "index register, so a clean reading below proves nothing");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${MOVED.join(", ")}; the control twin also moves ` +
    `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
  // A CEILING, not a demand: deepEqual against MOVED would go RED on a rewrite that became
  // register-exact, which is a gate refusing the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register diverged outside the excluded set");
});

test("EXHAUSTIVE: thirteen cells by 256 colours", { skip }, () => {
  assert.equal(sweepCells(checkTheCopyrightLineColoursOrDerail), 0, "a cell-and-colour combination diverged");
  let derailed = 0;
  for (let index = 0; index < CELLS; index++) {
    for (let colour = 0; colour < VALUES; colour++) {
      if (throughProbe(oracle, craft([index], colour)).handed !== null) derailed++;
    }
  }
  assert.ok(derailed > 0 && derailed < SWEEP_RUNS.cells,
    "the sweep is one-sided: it reaches only the derail or only the clean walk, and either way it " +
      "is not the two-armed sweep this arm claims to be");
  console.log(`  EXHAUSTIVE: ${SWEEP_RUNS.cells} combinations identical; ${derailed} of them derail`);
});

test("FIRST BAD CELL: two bad cells, and the walk stops at the nearer one", { skip }, () => {
  assert.equal(sweepPairs(checkTheCopyrightLineColoursOrDerail), 0, "a two-bad-cell case diverged");
  for (let i = 0; i < CELLS; i++) {
    for (let j = i + 1; j < CELLS; j++) {
      const { end } = outcome(checkTheCopyrightLineColoursOrDerail, craft([i, j], 0xaa));
      assert.equal(end, `raise@${i}`, `with cells ${i} and ${j} bad the walk stopped at the wrong one`);
    }
  }
  console.log(`  FIRST BAD CELL: ${SWEEP_RUNS.pairs} pairs identical, every one stopping at the nearer cell`);
});

test("RAISE SITE: the rewrite raises NotImplemented naming the cell the oracle's walk stopped at", { skip }, () => {
  let compared = 0;
  for (let index = 0; index < CELLS; index++) {
    for (const colour of [0x00, 0x04, 0x06, 0x11, 0x8f, 0xff]) {
      const m = craft([index], colour);
      const a = throughProbe(oracle, m).handed;
      assert.notEqual(a, null, "this crafted colour does not derail, so the arm measures nothing");
      assert.equal(a.hl, WALK[index], `the oracle's walk did not stop at cell ${index}`);
      let e = null;
      try {
        checkTheCopyrightLineColoursOrDerail(m.clone());
      } catch (x) {
        e = x;
      }
      assert.ok(e instanceof NotImplemented, `cell ${index} colour ${colour}: the rewrite did not raise NotImplemented`);
      assert.equal(raisedCell(e), index, `cell ${index} colour ${colour}: the fault names cell ${raisedCell(e)}`);
      compared++;
    }
  }
  // Control: a twin that names the wrong cell is seen here.
  assert.notEqual(outcome(brokenWrongCellNamed, craft([3], 0xaa)).end, outcome(oracle, craft([3], 0xaa)).end,
    "the wrong-cell twin agrees with the oracle, so the site is not being compared");
  console.log(`  RAISE SITE: ${compared} derails, each raising NotImplemented at the oracle's stopping cell`);
});

test("RAW DERAIL: the real destination raises NotImplemented in the port, as the rewrite does", { skip }, () => {
  let compared = 0;
  for (const index of [0, 1, 6, 12]) {
    const m = craft([index], 0xaa);
    const a = m.clone();
    const b = m.clone();
    const seat = m.regs.sp;
    let ea = null;
    let eb = null;
    try {
      oracle(a);
    } catch (e) {
      ea = e;
    }
    try {
      checkTheCopyrightLineColoursOrDerail(b);
    } catch (e) {
      eb = e;
    }
    assert.ok(ea instanceof NotImplemented, `the frozen derail at cell ${index} no longer raises NotImplemented in the port`);
    assert.ok(eb instanceof NotImplemented, `the rewrite did not raise NotImplemented at cell ${index}`);
    // The only bytes the frozen landing writes before it raises: the return word it pushes on its way
    // into unmapped space, a few bytes either side of the seat after its misaligned pops.
    const stray = allDiffs(a, b).filter((d) => d.addr === null || Math.abs(d.addr - seat) > 4);
    assert.deepEqual(stray, [], `the state at the raise differs away from the seat at cell ${index}`);
    compared++;
    if (index === 0) {
      console.log(`  RAW DERAIL: frozen raises "${String(ea).slice(0, 80)}"; rewrite raises NotImplemented`);
    }
  }
  console.log(`  RAW DERAIL: ${compared} cells, both raise NotImplemented; state identical away from the seat`);
});

test("CONTINUATION: both real callers run whole with the rewrite seamed in", { skip }, () => {
  const callers = [["176a", 0x176a, caller176a], ["178c", 0x178c, caller178c]];
  const counts = [];
  for (const [label, addr, body] of callers) {
    const entries = [];
    const host = makeMachine(new Map([[addr, (mm) => {
      entries.push(mm.clone());
      return body(mm);
    }]]), { tape: [] });
    host.runFrames(FRAMES);
    assert.ok(entries.length > 0, `vacuous: ${label} was never dispatched, so this arm ran nothing`);
    for (const e of entries) {
      const a = e.clone();
      const b = e.clone();
      b.routines = new Map(b.routines);
      b.routines.set(TARGET, withOmittedRet(checkTheCopyrightLineColoursOrDerail, TARGET));
      body(a);
      body(b);
      assert.deepEqual(allDiffs(a, b), [], `${label} parted company with the rewrite seamed in`);
      const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
      assert.deepEqual(moved, [], `${label} left a register different, so the clean walk's registers ` +
        "are NOT dead after all and the ceiling above is wrong");
    }
    counts.push(`${label}: ${entries.length}`);
  }
  console.log(`  CONTINUATION: ${counts.join(", ")} dispatches, memory and every register identical`);
});

test("SESSION: a whole session swapped, differing only inside the measured stack band", { skip }, () => {
  const run = (fn) => {
    const m = makeMachine(fn ? new Map([[TARGET, withOmittedRet(fn, TARGET)]]) : null, { tape: [] });
    const floors = recordFrameFloors(m);
    let deepest = STACK_SEAT;
    const push = m.push16.bind(m);
    m.push16 = (v) => {
      const r = push(v);
      if (m.regs.sp < deepest) deepest = m.regs.sp;
      return r;
    };
    return { frames: m.runFrames(FRAMES), floors, deepest, m };
  };
  const differing = (base, swap) => {
    const out = new Set();
    const live = new Set(); // at or above the base sample's SP: a live frame, never the band
    for (let i = 0; i < base.frames.length; i++) {
      const x = base.frames[i];
      const y = swap.frames[i];
      for (let j = 0; j < x.length; j++) {
        if (x[j] === y[j]) continue;
        const a = base.m.stateOffsetToAddr(j);
        out.add(a);
        if (a >= base.floors[i]) live.add(a);
      }
    }
    return Object.assign([...out], { live });
  };
  // The control changes ONE byte of the line it guards, on each dispatch: the smallest thing a
  // wrong rewrite could do that the stack band must not be able to swallow.
  const scribbler = (m) => {
    checkTheCopyrightLineColoursOrDerail(m);
    m.mem8[WALK[0]] = m.mem8[WALK[0]] ^ 0x01;
  };
  const base = run(null);
  const swap = run(checkTheCopyrightLineColoursOrDerail);
  const floor = Math.min(base.deepest, swap.deepest);
  const inBand = (a, d) => a >= floor && a < STACK_SEAT && !d.live.has(a);
  const ours = differing(base, swap);
  const control = differing(base, run(scribbler));
  console.log(`  SESSION: ${FRAMES} frames, stack band [${hex4(floor)}, ${hex4(STACK_SEAT)}); the ` +
    `rewrite differs at ${ours.length} address(es), all inside it; the control twin differs at ` +
    `${control.length}, ${control.filter((a) => !inBand(a, control)).length} of them outside`);
  // The band is only evidence if something can escape it. A twin that accepts a third colour
  // changes what the line-guard does, and that has to show up outside the stack.
  assert.ok(control.some((a) => !inBand(a, control)),
    "a twin that changes one byte of the guarded line differs nowhere outside the stack band " +
      "either, so this arm cannot tell a transparent swap from a broken one");
  assert.deepEqual(ours.filter((a) => !inBand(a, ours)).map(hex4), [],
    "the swapped session differs outside the stack band");
  assert.equal(swap.m.regs.sp, base.m.regs.sp, "the swapped session left the stack somewhere else");
});

test("CRAFTED-MATTERS: the corpus alone cannot see the derail", { skip }, () => {
  const blind = capture().every((e) => unitDiff(brokenNoOp, e) === null);
  const caught = unitDiff(brokenNoOp, craft([0], 0xaa)) !== null;
  console.log("  CRAFTED-MATTERS: a candidate that never derails is invisible at every real " +
    "dispatch and caught at once on a crafted bad colour");
  assert.ok(blind, "the do-nothing twin is ALREADY caught at a real dispatch, so the corpus has " +
    "started reaching the derail — re-measure rather than deleting this arm");
  assert.ok(caught, "the do-nothing twin is not caught on a crafted derail either, so the crafted " +
    "arms are not buying what this says they buy");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const cells = sweepCells(twin);
    const pairs = sweepPairs(twin);
    console.log(`  TEETH/${label}: caught on ${cells}/${SWEEP_RUNS.cells} cell-colour combinations, ` +
      `${pairs}/${SWEEP_RUNS.pairs} pairs`);
    assert.ok(cells + pairs > 0, `both sweeps PASSED the ${label} twin`);
  });
}
