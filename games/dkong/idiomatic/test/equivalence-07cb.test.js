// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_07cb (ROM 0x07cb) — the timed animation sub-state step.
 *
 * loc_07cb WRITES memory (the animation timer/pattern pair 0x638a/0x638b, tile-0xb0
 * fills across ~49 VRAM spans from the ROM table at 0x3d08, two queued tasks, the
 * reloaded 40-byte sprite-object block at 0x6908 + its two shifted columns, sub_3f24's
 * two VRAM bytes, and — on expiry — SUBSTATE_TIMER=2 + GAME_SUBSTATE++). It also drives
 * two WRITE-ONLY ls259 latch cells (0x7d86/0x7d87), which are NOT readable (a read
 * throws UnmappedAccess) and so are NOT part of dumpState() — the memory-equivalence
 * contract cannot see them via the RAM image. So it is validated two ways, each with
 * teeth, on a FRESH clone per case (a memory-writing routine demands it):
 *
 *   1. REALISM — hook 0x07cb in a real attract run (state-1 sub-state 6). It dispatches
 *      ~97x per attract cycle; the naturally-captured states span all three arms (arm =
 *      timer 0 at entry, tick = timer running, finish = the tick that lands on 0). For
 *      each real dispatch, run oracle vs loc_07cb on two fresh clones and confirm
 *      identical RAM (ex-stack) — this covers the fills, tasks, sprite block/columns,
 *      sub_3f24, the rotated-pattern save (0x638b), and the finish sub-state advance.
 *
 *   2. LATCH DECODE (write-trace) — because 0x7d86/0x7d87 are unreadable, capture the
 *      FINAL value written to each latch by hooking mem.write8, and compare oracle vs
 *      loc_07cb. Run over the real captures AND crafted pattern entries that drive all
 *      four (bit7,bit6) combinations, so the two-bit-per-frame decode is pinned.
 *
 *   3. CRAFTED — one start state per case, poked identically on both sides:
 *      (a) FINISH: timer 0x638a := 1 so the tick lands on 0 — pins SUBSTATE_TIMER=2 and
 *          the GAME_SUBSTATE increment on the finish arm.
 *      (b) PATTERN sweep: timer := 0x40 (a plain animation frame) with 0x638b swept over
 *          {0x00,0x40,0x80,0xc0,0x5f,0xff,0x3f} — pins the rotated-pattern save via RAM
 *          (0x638b IS in dumpState) and, together with test 2, the two latch bits.
 *
 *   4. TEETH — three deliberately-broken twins MUST be caught:
 *      (a) FINISH-ADVANCE twin (GAME_SUBSTATE += 2) — caught by the RAM diff at 0x600a.
 *      (b) FILL-TILE twin (stamps 0xb1) — caught by the RAM diff in the first VRAM span.
 *      (c) LATCH-BIT twin (0x7d87 fed bit 7 instead of bit 6) — caught by the write-trace
 *          on a pattern where bit7 != bit6; the RAM diff alone is blind to it.
 *
 * COVERAGE HOLE, stated plainly. This gate compares RAM ex-stack ONLY — it never compares pc
 * or SP — so it is structurally blind to a guest-stack delta. That matters at exactly one
 * site: loc_07cb reaches the fixed tilemap-pair stamp (0x3F24) through the frozen oracle
 * rather than the idiomatic twin stampFixedTilePair, because the oracle is a pure leaf ending
 * in `ret` and so consumes one guest-stack word the twin's JS return does not. That 2-byte
 * delta was INJECTED at this site and this gate did not catch it; neither did the full-flip
 * gate, because the site is in the NMI subtree where perFrame's epilogue overwrites SP before
 * the frame boundary the flip gate samples. So the choice of callee at that call site is
 * covered by no gate, and must not be "tidied" on the strength of a green run here.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-07cb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_07cb as oracle } from "../../translated/loc_07cb.js";
import { loc_07cb as candidate } from "../loc_07cb.js";
import { Machine } from "../../machine.js";
import { GAME_SUBSTATE, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x07cb;
const ANIM_TIMER = 0x638a;
const ANIM_PATTERN = 0x638b;
const LATCH_BIT7 = 0x7d86;
const LATCH_BIT6 = 0x7d87;
const FIRST_FILL = 0x7788; // dest of the first ROM fill record (tile 0xb0 lands here)

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
function firstRamDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
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
 * Run oracle and a candidate on two FRESH clones of `entry` (a memory-writing routine
 * demands a fresh clone per side) and diff RAM outside the dead stack.
 */
function diffAgainstOracle(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * Run `runFn` on a fresh clone of `entry` with mem.write8 hooked, and return the FINAL
 * value written to each write-only latch cell (undefined if never written — e.g. the
 * finish/no-animation arms write no latch). The final value is what the hardware latch
 * holds; the oracle writes each latch 0-then-maybe-1 while loc_07cb writes the bit once,
 * so only the FINAL value is comparable, not the raw write sequence.
 */
function finalLatchWrites(entry, runFn) {
  const c = entry.clone();
  const last = new Map();
  const orig = c.mem.write8.bind(c.mem);
  c.mem.write8 = (addr, val) => {
    if (addr === LATCH_BIT7 || addr === LATCH_BIT6) last.set(addr & 0xffff, val & 0xff);
    return orig(addr, val);
  };
  runFn(c);
  return { b7: last.get(LATCH_BIT7), b6: last.get(LATCH_BIT6) };
}

/**
 * Hook `addr` in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the ORACLE so the host game proceeds
 * undisturbed. 0x07cb first dispatches ~frame 2000-3000 (state-1 sub-state 6), so the
 * caller passes a ~3200-frame window.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

let CACHED_CAPS = null;
function realCaptures() {
  if (!CACHED_CAPS) CACHED_CAPS = captureDispatches(48, 3200);
  return CACHED_CAPS;
}

/** A real captured dispatch to derive crafted entries from (any is fine — we overwrite
 *  the timer/pattern bytes; everything else stays a real, valid mid-attract state). */
function craftedBase() {
  const caps = realCaptures();
  assert.ok(caps.length >= 1, "need one real 0x07cb dispatch to derive crafted entries from");
  return caps[0];
}

function craft(base, timer, pattern) {
  const w = base.clone();
  w.mem.write8(ANIM_TIMER, timer & 0xff);
  w.mem.write8(ANIM_PATTERN, pattern & 0xff);
  return w;
}

// -- 1. REALISM (captured dispatches) -----------------------------------------

test("REALISM: real captured 0x07cb dispatches — RAM (ex-stack) matches the oracle", () => {
  const caps = realCaptures();
  assert.ok(caps.length >= 1, "expected at least one real 0x07cb dispatch during attract");

  let arm = 0, finish = 0, anim = 0;
  for (const cap of caps) {
    assert.equal(cap.mem.read8(GAME_SUBSTATE), 6, "0x07cb dispatches at state-1 sub-state 6");
    const t = cap.mem.read8(ANIM_TIMER);
    if (t === 0) arm++;
    else if (t === 1) finish++;
    else anim++;
    const ram = diffAgainstOracle(cap, candidate);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  assert.ok(anim >= 1, "expected animation-arm captures (timer running)");
  console.log(
    `  REALISM: ${caps.length} real 0x07cb dispatches — identical RAM (ex-stack); ` +
      `arms seen: arm(timer0)=${arm} finish(timer1)=${finish} anim=${anim}`,
  );
});

// -- 2. LATCH DECODE (write-trace) --------------------------------------------

test("LATCH DECODE: final ls259 latch writes (0x7d86/0x7d87) match the oracle", () => {
  const base = craftedBase();
  // Real captures + crafted patterns covering all four (bit7,bit6) combinations.
  const PATTERNS = [0x00, 0x40, 0x80, 0xc0, 0x5f, 0xff, 0x3f, 0x01, 0xbe];
  const cases = [
    ...realCaptures(),
    ...PATTERNS.map((p) => craft(base, 0x40, p)),
  ];

  let n = 0;
  for (const cap of cases) {
    const want = finalLatchWrites(cap, oracle);
    const got = finalLatchWrites(cap, candidate);
    assert.deepEqual(
      got,
      want,
      `latch mismatch (timer=${hx(cap.mem.read8(ANIM_TIMER))} pattern=${hx(cap.mem.read8(ANIM_PATTERN))}): ` +
        `oracle=${JSON.stringify(want)} cand=${JSON.stringify(got)}`,
    );
    n++;
  }
  console.log(`  LATCH DECODE: ${n} cases — final 0x7d86/0x7d87 latch values identical to the oracle`);
});

// -- 3. CRAFTED (finish arm + pattern sweep, via RAM) -------------------------

test("CRAFTED: finish arm + pattern sweep match the oracle on RAM (ex-stack)", () => {
  const base = craftedBase();

  // (a) FINISH: timer := 1 so the decrement lands on 0 -> finish arm.
  const fin = craft(base, 0x01, base.mem.read8(ANIM_PATTERN));
  const finPre = fin.mem.read8(GAME_SUBSTATE);
  const finRam = diffAgainstOracle(fin, candidate);
  assert.equal(finRam, null, finRam && `finish-arm RAM diff at ${hx(finRam.addr)}: oracle=${finRam.a} cand=${finRam.b}`);
  // Sanity: the oracle really took the finish arm (advanced the sub-state).
  const finAfter = fin.clone();
  oracle(finAfter);
  assert.equal(finAfter.mem.read8(GAME_SUBSTATE), (finPre + 1) & 0xff, "finish arm must advance GAME_SUBSTATE by 1");
  assert.equal(finAfter.mem.read8(0x6009), 0x02, "finish arm must set SUBSTATE_TIMER=2");

  // (b) PATTERN sweep on a plain animation frame — pins the rotated-pattern save (0x638b
  //     is in dumpState) and the fill/tail.
  const PATTERNS = [0x00, 0x40, 0x80, 0xc0, 0x5f, 0xff, 0x3f, 0x01, 0xbe];
  let n = 0;
  for (const p of PATTERNS) {
    const w = craft(base, 0x40, p);
    const ram = diffAgainstOracle(w, candidate);
    assert.equal(ram, null, ram && `pattern ${hx(p)} RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
    n++;
  }
  console.log(`  CRAFTED: finish arm + ${n} pattern entries — identical RAM (ex-stack)`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin A: on the finish arm, advances GAME_SUBSTATE by TWO (wrong sub-state). */
function brokenFinishAdvance(m) {
  const { mem } = m;
  let t = mem.read8(ANIM_TIMER);
  if (t !== 0) { t = (t - 1) & 0xff; mem.write8(ANIM_TIMER, t); }
  else { t = 0x60; mem.write8(ANIM_TIMER, 0x60); }
  if (t === 0) {
    mem.write8(0x6009, 0x02);
    mem.write8(GAME_SUBSTATE, (mem.read8(GAME_SUBSTATE) + 2) & 0xff); // BUG: +2
    mem.write8(ANIM_TIMER, 0x00);
    mem.write8(ANIM_PATTERN, 0x00);
  }
  // (does not run the animation body — sufficient for the finish-arm entry)
}

/** Broken twin B: the animation runs, but a fill span lands the wrong tile (0xb1). */
function brokenFillTile(m) {
  candidate(m); // everything correct...
  m.mem.write8(FIRST_FILL, 0xb1); // ...except the first fill span holds 0xb1, not 0xb0
}

/** Broken twin C: correct in every readable respect, but feeds 0x7d87 bit 7 instead of
 *  bit 6 (a plausible off-by-one-bit). Because the routine is otherwise identical, the
 *  RAM image is untouched — only the write-only latch differs, so ONLY the write-trace
 *  can catch it. */
function brokenLatchBit(m) {
  const pat = m.mem.read8(ANIM_PATTERN); // the animation frame's pattern (timer != 0 here)
  candidate(m); // everything correct, including 0x7d87 = bit 6...
  m.mem.write8(LATCH_BIT6, (pat >> 7) & 1); // ...then re-drive it with bit 7 (the bug)
}

test("TEETH: finish-advance, fill-tile, and latch-bit twins are all CAUGHT", () => {
  const base = craftedBase();

  // (a) finish-advance: caught by the RAM diff at GAME_SUBSTATE on the finish entry.
  const fin = craft(base, 0x01, base.mem.read8(ANIM_PATTERN));
  const dFin = diffAgainstOracle(fin, brokenFinishAdvance);
  assert.notEqual(dFin, null, "the RAM gate FAILED to catch a double sub-state advance — it is worthless");
  assert.equal(dFin.addr, GAME_SUBSTATE, "the double-advance must diverge exactly at GAME_SUBSTATE (0x600a)");

  // (b) fill-tile: caught by the RAM diff in a fill span.
  const anim = craft(base, 0x40, 0x5f);
  const dFill = diffAgainstOracle(anim, brokenFillTile);
  assert.notEqual(dFill, null, "the RAM gate FAILED to catch a wrong fill tile — it is worthless");
  assert.equal(dFill.addr, FIRST_FILL, "the wrong-tile diff must land in the first fill span");
  assert.equal(dFill.a, 0xb0, "oracle stamps 0xb0");
  assert.equal(dFill.b, 0xb1, "broken twin stamped 0xb1");

  // (c) latch-bit: RAM diff is BLIND (write-only latch); ONLY the write-trace catches it.
  //     Use pattern 0x80 (bit7=1, bit6=0) so the oracle sets 0x7d87=0 but the twin=1.
  const latchCase = craft(base, 0x40, 0x80);
  const ramBlind = diffAgainstOracle(latchCase, brokenLatchBit);
  assert.equal(ramBlind, null, "the latch twin must be RAM-identical — the bug lives only in a write-only latch");
  const want = finalLatchWrites(latchCase, oracle);
  const got = finalLatchWrites(latchCase, brokenLatchBit);
  assert.notDeepEqual(got, want, "the write-trace FAILED to catch a wrong latch bit — it is worthless");
  assert.equal(want.b6, 0, "oracle feeds 0x7d87 = bit 6 of 0x80 = 0");
  assert.equal(got.b6, 1, "broken twin feeds 0x7d87 = bit 7 of 0x80 = 1");

  console.log(
    `  TEETH: finish-advance caught at ${hx(dFin.addr)}; fill-tile caught at ${hx(dFill.addr)} ` +
      `(oracle=${dFill.a} broken=${dFill.b}); latch-bit RAM-invisible (diff=null) but caught by ` +
      `write-trace (oracle 0x7d87=${want.b6} broken=${got.b6})`,
  );
});
