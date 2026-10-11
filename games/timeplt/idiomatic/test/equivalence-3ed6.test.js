// SPDX-License-Identifier: GPL-3.0-only
/**
 * fireCraftShotWhenAimedNearPlayer vs its frozen oracle, at the frogger memory-eq standard. A leaf whose every ROM call
 * is dissolved into a direct import, so the rewrite pushes no return address and omits its own ret.
 * Entries are captured at the real dispatch over both tapes; each is replayed on both sides and the
 * whole RAM compared with the dead stack scratch masked out and the +2 SP re-seat asserted. The two
 * entry pointers ride in on ix/iy and the routine never disturbs them, and the sprite/steer callees
 * downstream read only those two off the register file — so ix and iy are the only genuine register
 * live-outs pinned, and every other register is dead-after-return scratch left unpinned. A
 * scratch-not-pinned control proves the RAM measurement still bites while a register-only scribble
 * is deliberately ignored. HOLES: neither tape arms the guard cell (skip-guard is invisible here)
 * nor forces a busy first slot (the strided scan's later steps go unexercised).
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3ed6.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { fireCraftShotWhenAimedNearPlayer as candidate } from "../fireCraftShotWhenAimedNearPlayer.js";
import { loc_3ed6 as oracle } from "../../translated/loc_3ed6.js";
import { headingToward } from "../headingToward.js";
import { requestEraKeyedLaunchSound } from "../requestEraKeyedLaunchSound.js";
import { loc_59cb } from "../loc_59cb.js";
import { loc_59d1 } from "../loc_59d1.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x3ed6;
const DATA_TOP = 0xadff;
const SCRIBBLE_CELL = 0xa814; // a compared (non-stack) cell the teeth flip to prove the RAM measurement bites

/** The frogger standard: RAM (masked over the frozen side's stack scratch) is the contract, and only
 *  genuine named register live-outs are pinned beside it. This routine leaves both entry pointers
 *  untouched on ix/iy and the downstream sprite/steer callees read them off the register file, so
 *  the two are pinned; every other register is dead-after-return scratch and unpinned. */
const GENUINE_LIVE_OUTS = ["ix", "iy"];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

function captureTape(opts) {
  let collecting = true;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (collecting) entries.push(mm.clone());
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
  return entries;
}

let corpusCache = null;
function corpus() {
  if (!corpusCache) corpusCache = [...captureTape({}), ...captureTape({ tape: [] })];
  return corpusCache;
}

/** Oracle vs candidate on independent clones: the whole dump outside [low, seat), then only the
 * genuine register live-outs. The frozen side pushes below its seat and rets; the window is masked,
 * low watched off its own pushes. Returns a descriptor, or a clean report when identical. */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => { push(v); if (a.regs.sp < low) low = a.regs.sp; };
  const retA = oracle(a);
  let retB, threw = null;
  try { retB = cand(b); } catch (e) { threw = String(e).slice(0, 60); }
  if (threw) return { threw };
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && !escaped; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, a: da[i], b: db[i] };
  }
  let liveOut = null;
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) { liveOut = { k, a: a.regs[k], b: b.regs[k] }; break; }
  }
  return { escaped, liveOut, low, seat, spDiff: a.regs.sp - b.regs.sp, retA, retB };
}

const caught = (r) => Boolean(r.threw || r.escaped || r.liveOut);

/** Cells the oracle moves from a state, ignoring the stack scratch — a turn's footprint. */
function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  }
  return n;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every knob matches fireCraftShotWhenAimedNearPlayer by default. */
function twin(o = {}) {
  const { noop = false, store = true, c1 = 0x4d, selectFlip = false, dec = true } = o;
  return function (m) {
    if (noop) return;
    const { regs, mem8, mem } = m;
    regs.a = mem8[0xa980]; regs.and(0x07); regs.add(0x05); regs.cp(mem8[u16(regs.ix + 0x0f)]);
    if (regs.fNZ) return;
    if (mem8[0xa817] !== 0) return;
    regs.hl = 0xa810; regs.de = 0xaa12; if (mem8[0xa844] === 0) return; regs.b = mem8[0xa844];
    let free = false;
    do {
      if (mem8[regs.hl] === 0) { free = true; break; }
      regs.l = u8(regs.l + 0x10); regs.e = u8(regs.e + 1); regs.e = u8(regs.e + 1); regs.djnz();
    } while (regs.b !== 0);
    if (!free) return;
    if (store) { mem.write16(0xa991, regs.hl); mem.write16(0xa993, regs.de); }
    regs.a = mem8[0xa827]; regs.b = regs.a; regs.add(regs.a); regs.c = regs.a;
    regs.a = 0x78; regs.sub(mem8[u16(regs.iy + 0x31)]); regs.add(regs.b); regs.cp(regs.c);
    if (!regs.fNC) {
      regs.a = 0x84; regs.sub(mem8[regs.iy]); regs.add(regs.b); regs.cp(regs.c); if (regs.fC) return;
    }
    regs.a = mem8[0xa837]; regs.b = regs.a; regs.add(regs.a); regs.c = regs.a;
    regs.a = mem8[0xa802]; regs.sub(mem8[u16(regs.ix + 0x02)]); regs.add(regs.b); regs.cp(regs.c);
    if (regs.fNC) return;
    if (regs.d === 0x02) {
      regs.a = mem8[0xa8e6]; regs.b = regs.a; regs.add(regs.a); regs.c = regs.a;
      regs.a = 0x84; regs.sub(mem8[regs.iy]); regs.add(regs.b); regs.cp(regs.c); if (regs.fNC) return;
    }
    regs.hl = 0xac7f; const heading = headingToward(m);
    regs.sub(mem8[u16(regs.ix + 0x02)]); regs.add(0x10); regs.cp(0x20);
    if (regs.fNC) return;
    requestEraKeyedLaunchSound(m);
    const six = regs.ix, siy = regs.iy;
    regs.d = mem8[u16(siy + 0x31)]; regs.e = mem8[siy];
    regs.ix = mem.read16(0xa991); regs.iy = mem.read16(0xa993);
    mem8[u16(regs.iy + 0x31)] = regs.d; mem8[regs.iy] = regs.e;
    regs.a = heading;
    const hi = mem8[0xad04] !== 0;
    if (selectFlip ? !hi : hi) loc_59d1(m); else loc_59cb(m);
    mem8[u16(regs.ix + 0x0a)] = regs.e; mem8[u16(regs.ix + 0x0b)] = regs.d;
    mem8[u16(regs.ix + 0x0c)] = regs.c; mem8[u16(regs.ix + 0x0d)] = regs.b;
    mem8[u16(regs.iy + 0x01)] = c1; mem8[u16(regs.iy + 0x30)] = 0x62;
    regs.a = mem8[0xa814]; mem8[0xa817] = regs.a;
    if (dec) mem8[regs.ix] = u8(mem8[regs.ix] - 1);
    regs.iy = siy; regs.ix = six;
  };
}

const TWINS = [
  ["no-op", twin({ noop: true }), 110],
  ["skip-pointer-store", twin({ store: false }), 110],
  ["wrong-entry-const", twin({ c1: 0x4e }), 2],
  ["select-flip", twin({ selectFlip: true }), 2],
  ["skip-dec", twin({ dec: false }), 2],
];

function sweep(cand) {
  let n = 0;
  for (const e of corpus()) if (caught(compare(cand, e))) n++;
  return n;
}

// ── scratch-not-pinned controls: a register-only twin passes by design; RAM still bites ──────────
const scribbleScratchReg = (m) => { candidate(m); m.regs.b = (m.regs.b + 1) & 0xff; };
const scribbleData = (m) => { candidate(m); m.mem8[SCRIBBLE_CELL] ^= 0xff; };

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("CORPUS: every real dispatch of both tapes replays identically, and it is not all no-ops",
  { skip }, () => {
    for (const e of corpus()) {
      const r = compare(candidate, e);
      assert.ok(!r.threw, `${hex4(e.regs.ix)}: candidate threw — ${r.threw}`);
      assert.equal(r.escaped, null, r.escaped && `${hex4(e.regs.ix)}: escaped at ${hex4(r.escaped.addr)}`);
      assert.equal(r.liveOut, null, r.liveOut && `${hex4(e.regs.ix)}: live-out ${r.liveOut && r.liveOut.k} diverged`);
      assert.equal(r.retA, r.retB, "the return value diverged");
    }
    const writing = corpus().filter((e) => footprint(e) > 0).length;
    const spawning = corpus().filter((e) => footprint(e) > 4).length;
    assert.ok(writing > 0, "no captured turn makes the oracle write, so the corpus is all no-ops");
    // ★ the precise teeth below fire only on the full spawn tail; prove some turn reaches it.
    assert.ok(spawning > 0, "no captured turn reaches the spawn tail, so the tail teeth are vacuous");
    console.log(`  CORPUS: ${corpus().length} turns identical, ${writing} write, ${spawning} spawn`);
  });

test("SP AND MASK: the drift is exactly two bytes and the mask floor sits above the data",
  { skip }, () => {
    const e = corpus().find((x) => footprint(x) > 4);
    const r = compare(candidate, e);
    assert.equal(r.spDiff, 2, `the frozen side no longer re-seats two bytes higher (${r.spDiff})`);
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
    console.log(`  SP AND MASK: spDiff ${r.spDiff}; window floor ${hex4(r.low)} over a spawn turn`);
  });

test("SCRATCH NOT PINNED: a register-only twin passes; a RAM scribble is caught", { skip }, () => {
  // Only ix and iy are genuine register live-outs, so a twin that only scribbles a scratch register
  // after the routine is DELIBERATELY not flagged — and the same measurement must still catch a
  // scribbled RAM cell, or the clean read on the register twin would be worthless.
  let checked = 0;
  for (const e of corpus()) {
    assert.ok(!caught(compare(scribbleScratchReg, e)),
      "a scratch-register scribble was flagged, but only ix and iy are genuine register live-outs");
    const r = compare(scribbleData, e);
    assert.ok(caught(r), "the RAM measurement missed a scribbled cell, so it has no teeth");
    assert.notEqual(r.escaped, null, "the RAM scribble must be caught on a cell, not a register");
    checked++;
  }
  assert.ok(checked > 0, "vacuous: no corpus turns");
  console.log(`  SCRATCH NOT PINNED: register twin ignored; RAM twin caught on all ${checked}`);
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of turns`, { skip }, () => {
    const n = sweep(brokenTwin);
    assert.ok(expected > 0 && n > 0, `the ${label} twin is not caught at all`);
    assert.equal(n, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${n} of ${corpus().length} turns`);
  });
}
