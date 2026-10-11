// SPDX-License-Identifier: GPL-3.0-only
/**
 * stepDriftingCountdownObjectByEraFrames — memory-equivalent to the frozen oracle at ROM 0x413C. GATE: neither tape reaches it,
 * so entries are CRAFTED on a captured mid-game base — the object countdown swept 0..255 across
 * both mode halves, world-scroll forced nonzero so the drift is live. RAM is compared with the
 * dead stack scratch below the seat masked out (the oracle pops a return the dissolved rewrite
 * never pushes); the caller's live-out ix/iy/b is asserted, the +2 sp drift pinned, and the ROM
 * register dance (a/d/e/f/h) left uncompared. Run:
 * node --test games/timeplt/idiomatic/test/equivalence-413c.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { stepDriftingCountdownObjectByEraFrames as candidate } from "../stepDriftingCountdownObjectByEraFrames.js";
import { loc_413c as oracle } from "../../translated/loc_413c.js";
import { clampOneShotCountdownThenRequestSound } from "../clampOneShotCountdownThenRequestSound.js";
import { driftWithWorldScroll } from "../driftWithWorldScroll.js";
import { retireSlot } from "../retireSlot.js";
import { fetchTableByte } from "../fetchTableByte.js";

const TARGET = 0x413c;
const SWEEP_ENTRY = 0x40d6;
const LOOP_HEAD = 0x40ea;
const CALL_SITE = 0x4108;

const OBJECT = 0xa8c0;
const SPRITE = 0xaa28;
const MODE = 0xad04;
const SCROLL_Y = 0xa808;
const SCROLL_X = 0xa80a;
const DATA_TOP = 0xadff;

const RESET_MARK = 0x3c;
const WINDOW_FLOOR = 0x1c;
const NEAR_TABLE = 0x416e;
const FAR_TABLE = 0x4183;
const NEAR_STATE = 0x0d;
const FAR_STATE = 0x02;
const LIVE_OUT = ["ix", "iy", "b"];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the captured base and the crafted entries ─────────────────────────────────────────────

let base = null;
function baseState() {
  if (base === null) {
    const m = makeMachine(new Map([[SWEEP_ENTRY, (mm) => {
      if (base === null) base = mm.clone();
      return TRANSLATED.get(SWEEP_ENTRY)(mm);
    }]]));
    m.runFrames(ENTRY_FRAMES);
  }
  return base;
}

/** One crafted entry: the pair seated on the first slot, a chosen countdown and mode, the world
 * scrolling so the drift moves real bytes. */
function craft(count, mode) {
  const m = baseState().clone();
  m.regs.ix = OBJECT;
  m.regs.iy = SPRITE;
  m.mem8[OBJECT] = count;
  m.mem8[MODE] = mode;
  m.mem8[SCROLL_Y] = 0x01; m.mem8[SCROLL_Y + 1] = 0x80;
  m.mem8[SCROLL_X] = 0x00; m.mem8[SCROLL_X + 1] = 0x40;
  return m;
}

function* everyCase() {
  for (const mode of [0x00, 0x04]) for (let count = 0; count < 256; count++) yield craft(count, mode);
}

/**
 * Oracle vs candidate on clones. The oracle pops one return the rewrite never pushes, so the diff
 * excludes [low, seat) — low watched off the oracle's own pushes. Anything outside has escaped.
 */
function compare(fn, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  oracle(a);
  fn(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  const liveOut = LIVE_OUT.find((k) => a.regs[k] !== b.regs[k]) ?? null;
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, liveOut };
}

/** Cells at or below the data top the oracle moves from a state — a branch's footprint. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  oracle(a);
  const now = a.dumpState();
  const cells = [];
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr <= DATA_TOP) cells.push(addr);
  }
  return cells.join(",");
}

// ── broken twins ──────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every switch matches stepDriftingCountdownObjectByEraFrames by default. */
function twin({ reset = true, drift = true, window = true, retire = true,
  nearTbl = NEAR_TABLE, farTbl = FAR_TABLE, nearSt = NEAR_STATE, farSt = FAR_STATE } = {}) {
  return (m) => {
    const { regs, mem8 } = m;
    const o = regs.ix;
    if (reset && mem8[o] >= RESET_MARK) clampOneShotCountdownThenRequestSound(m);
    if (drift) driftWithWorldScroll(m);
    const cnt = (mem8[o] - 1) & 0xff;
    mem8[o] = cnt;
    if (retire && cnt === 0) return retireSlot(m);
    if (window && cnt < WINDOW_FLOOR) return;
    const frame = ((cnt - WINDOW_FLOOR) >> 2) & 0x07;
    const far = mem8[MODE] >= 0x04;
    regs.hl = far ? farTbl : nearTbl;
    regs.a = frame;
    mem8[regs.iy + 1] = fetchTableByte(m);
    mem8[regs.iy + 0x30] = far ? farSt : nearSt;
  };
}

/** BUG: scribbles the sweep counter the caller reads back; the control for the live-out check. */
function brokenMovesLiveOut(m) {
  candidate(m);
  m.regs.b = (m.regs.b + 1) & 0xff;
}

const TWINS = [
  ["no-op", () => {}, 512],
  ["skip-drift", twin({ drift: false }), 512],
  ["skip-reset", twin({ reset: false }), 392],
  ["state-swap", twin({ nearSt: FAR_STATE, farSt: NEAR_STATE }), 456],
  ["table-swap", twin({ nearTbl: FAR_TABLE, farTbl: NEAR_TABLE }), 446],
  ["no-window-guard", twin({ window: false }), 54],
  ["no-retire", twin({ retire: false }), 2],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: neither tape reaches this address, with a live positive control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["undriven", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [LOOP_HEAD]: 0, [CALL_SITE]: 0, [SWEEP_ENTRY]: 0 };
    const map = new Map();
    for (const s of [TARGET, LOOP_HEAD, CALL_SITE, SWEEP_ENTRY]) {
      const real = TRANSLATED.get(s);
      map.set(s, (mm) => { seen[s]++; return real(mm); });
    }
    const m = makeMachine(map, opts);
    m.runFrames(ENTRY_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // ★ The zeros mean something only because the SAME taps counted the sweep entry firing; the
    // sweep runs every frame but rets before the loop body, so nothing ever calls this address.
    assert.ok(seen[SWEEP_ENTRY] > 0, `${label}: the sweep-entry tap never fired, so the instrument is dead`);
    assert.equal(seen[TARGET], 0, `${label} now dispatches this address; capture plain entries`);
    assert.equal(seen[LOOP_HEAD], 0, `${label} now enters the sweep loop; the reason above is stale`);
    assert.equal(seen[CALL_SITE], 0, `${label} now reaches the site that calls this address`);
    console.log(`  UNREACHED: ${label} — ${hex4(TARGET)} ${seen[TARGET]}, loop ${seen[LOOP_HEAD]}, ` +
      `call-site ${seen[CALL_SITE]}, control ${hex4(SWEEP_ENTRY)} ${seen[SWEEP_ENTRY]}`);
  }
});

test("SWEEP: every countdown across both mode halves is memory-equivalent", { skip }, () => {
  let n = 0;
  let low = 0xffff;
  for (const m of everyCase()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
    if (r.low < low) low = r.low;
    n++;
  }
  // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
  assert.ok(low > DATA_TOP, `the stack window ${hex4(low)} reached down into game data`);
  console.log(`  SWEEP: ${n} crafted cases identical; window floor ${hex4(low)} above data`);
});

test("LIVE-OUT and SP: ix/iy/b preserved, and the oracle re-seats two bytes higher", { skip }, () => {
  for (const m of [craft(0x40, 0x04), craft(0x30, 0x00), craft(0x01, 0x00), craft(0x1d, 0x00)]) {
    const r = compare(candidate, m);
    assert.equal(r.liveOut, null, `the caller's live-out ${r.liveOut} diverged`);
    assert.equal(r.spDiff, 2, "the oracle pops a return and the rewrite does not");
  }
  // ★ Vacuity guard on the live-out check: a twin that bumps the sweep counter MUST be seen.
  assert.equal(compare(brokenMovesLiveOut, craft(0x30, 0x00)).liveOut, "b",
    "the live-out check misses a scribbled counter, so its passes prove nothing");
  console.log("  LIVE-OUT: ix/iy/b identical on every branch; sp drift +2");
});

test("BRANCHES DIFFER: the five paths move different cells", { skip }, () => {
  const prints = {
    resetFar: footprint(craft(0x40, 0x04)),
    near: footprint(craft(0x30, 0x00)),
    retire: footprint(craft(0x01, 0x00)),
    belowWindow: footprint(craft(0x1d, 0x00)),
  };
  assert.notEqual(prints.resetFar, prints.near, "the reset path moves the same cells as a plain one");
  assert.notEqual(prints.retire, prints.near, "the retire path moves the same cells as a plain one");
  assert.notEqual(prints.belowWindow, prints.retire, "below-window and retire move the same cells");
  console.log(`  BRANCHES: reset+far ${prints.resetFar.split(",").length} cells, ` +
    `near ${prints.near.split(",").length}, retire ${prints.retire.split(",").length}`);
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of cases`, { skip }, () => {
    let caught = 0;
    for (const m of everyCase()) if (compare(brokenTwin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught}/512 cases`);
  });
}
