// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_26a6 (ROM 0x26a6) — step a mirrored pair of animation
 * counters (the +1 sprite-code cells at P = HL+1 and P+4) one frame in OPPOSITE
 * directions, each wrapped within a 3-value ring; direction = bit 7 of mem[DE].
 *
 * The routine WRITES MEMORY, so it is gated on memory-equivalence — RAM (minus
 * STACK_SCRATCH) + pc + SP + the one live register A — never a scalar and never the
 * full register file. Every case runs on FRESH clones (a reused clone is only safe for
 * a read-only leaf; this one is not). LIVE-OUT is memory + A: A is the P+4 result and
 * loc_264c reads it (`and 0x7f` → 0x69ED); flags/HL/L are dead, so they are NOT
 * compared. The idiomatic routine models the Z80 `ret` as a JS return (no stack
 * modelling), so the harness does one m.ret() on the candidate clone AFTER the call to
 * line pc + SP up with the oracle (which rets internally) — the only stack touch.
 *
 *   1. EQUAL (exhaustive value grid) — the output is a total function of the arm
 *      (mem[DE] bit 7) and the two counter bytes. Sweep BOTH arms × all 256×256
 *      (mem[P],mem[P+4]) = 131,072 combos at a fixed base; each must match the oracle
 *      on the full contract. This exercises every ring value in every arm, including
 *      all four wrap seams and every non-wrapping step (it is where a dropped inc↔dec
 *      flip or a wrong guard constant is caught).
 *
 *   2. EQUAL (real captured dispatches) — plain attract never reaches 0x26a6 (0×): it
 *      is a non-executing frontier under sub_25f2's object cascade. So real dispatch
 *      states are reproduced by running the TRANSLATED callers loc_2602 / loc_262f /
 *      loc_2679 on clones of a booted machine with 0x26a6 hooked to snapshot each true
 *      entry — yielding the exact (HL,DE,select-byte,counters,SP-with-pushed-return)
 *      the routine meets in play. These span all three HL bases (0x69E4/0x69EC/0x69F4)
 *      and BOTH arms (loc_262f's select byte has bit 7 set; the others clear).
 *
 *   3. EQUAL (crafted addressing edges) — arms the value grid's single base does not
 *      cover: an L-wrap base (HL low byte 0xFF, so `inc l` wraps 0xFF→0x00 while H is
 *      held) and the four wrap seams placed at a live base. Real captured RAM, surgical
 *      pokes, a safe (excluded) stack pointer.
 *
 *   4. TEETH — a deliberately-broken twin that drops the inc↔dec flip on the count-up
 *      arm's P+4 step (uses +1 where the oracle uses −1, the exact byte-plausible
 *      3C/3D confusion the oracle warns about) MUST be caught. Shown caught on crafted
 *      entries where the two directions provably differ (and the correct routine still
 *      passes them), and corroborated on the real count-up dispatches.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-26a6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_26a6 as oracle } from "../../translated/loc_26a6.js";
import { loc_2602 } from "../../translated/loc_2602.js";
import { loc_262f } from "../../translated/loc_262f.js";
import { loc_2679 } from "../../translated/loc_2679.js";
import { loc_26a6 } from "../loc_26a6.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x26a6;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it never touches pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP, and the
 * live register A. HL/L/flags are intentionally NOT compared (dead at every caller).
 * Returns a list of human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  if ((o.regs.a & 0xff) !== (c.regs.a & 0xff)) diffs.push(`A oracle=${hx(o.regs.a)} cand=${hx(c.regs.a)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/** A realistic booted machine, a few hundred attract frames in. */
function bootedMachine(maxFrames) {
  const m = new Machine(ROM);
  m.runFrames(maxFrames);
  return m;
}

/**
 * Reproduce REAL 0x26a6 dispatches by running each translated caller on a clone of the
 * booted machine, with the frame counter (0x601A) set to pass the caller's "every 32nd
 * frame" gate and 0x26a6 hooked to snapshot each true entry. loc_2602 fires at HL=0x69E4
 * (select bit7=0), loc_2679 at 0x69F4 (bit7=0), loc_262f at 0x69EC (select 0xFF, bit7=1);
 * each pushes a genuine return address, so the captured SP is real.
 */
function captureRealDispatches(booted) {
  const caps = [];
  const hook = (mm) => { caps.push(mm.clone()); return oracle(mm); };

  // loc_2602: gate is (0x601A) & 0x1F == 1.
  const a = booted.clone();
  a.mem.write8(0x601a, 0x01);
  a.regs.sp = 0x6bfe;
  a.routines.set(TARGET, hook);
  loc_2602(a);

  // loc_2679: gate is (0x601A) & 0x1F == 2.
  const b = booted.clone();
  b.mem.write8(0x601a, 0x02);
  b.regs.sp = 0x6bfe;
  b.routines.set(TARGET, hook);
  loc_2679(b);

  // loc_262f: needs Y (0x6205) >= 0xC0 to take the counting path, even frame, count==0.
  const c = booted.clone();
  c.mem.write8(0x601a, 0x00);
  c.mem.write8(0x6205, 0xc0);
  c.regs.sp = 0x6bfe;
  c.routines.set(TARGET, hook);
  loc_262f(c);

  return caps;
}

/**
 * Broken twin: on the count-up arm (select bit7=0) it steps P+4 with +1 instead of −1
 * — the byte-plausible inc↔dec (3C/3D) flip the oracle warns about, which inverts that
 * counter's direction. Everything else identical.
 */
function brokenLoc26a6(m) {
  const { regs, mem } = m;
  const page = regs.hl & 0xff00;
  const p = page | ((regs.l + 1) & 0xff);
  const p4 = page | ((regs.l + 5) & 0xff);
  const countUpAtP = (mem.read8(regs.de) & 0x80) === 0;
  const step = (addr, delta, hit, wrap) => {
    let v = (mem.read8(addr) + delta) & 0xff;
    if (v === hit) v = wrap;
    mem.write8(addr, v);
    return v;
  };
  let result;
  if (countUpAtP) {
    step(p, +1, 0x53, 0x50);
    result = step(p4, +1, 0xcf, 0xd2); // BUG: +1 should be −1
  } else {
    step(p, -1, 0x4f, 0x52);
    result = step(p4, +1, 0xd3, 0xd0);
  }
  regs.a = result;
}

// -- 1. EQUAL (exhaustive value grid) -----------------------------------------

test("EQUAL (exhaustive): loc_26a6 == oracle over both arms × all 256×256 counter combos", () => {
  const seed = bootedMachine(400).clone();
  seed.regs.hl = 0x69e4; // base → P=0x69E5, P+4=0x69E9
  seed.regs.de = 0x62a1; // the select byte lives here
  seed.regs.sp = 0x6bfe; // deep, excluded stack

  let count = 0, mismatch = null;
  for (const sel of [0x00, 0x80]) { // arm select: bit7 clear (count-up) / set (count-down)
    for (let vp = 0; vp < 256 && !mismatch; vp++) {
      for (let vp4 = 0; vp4 < 256; vp4++) {
        const e = seed.clone();
        e.mem.write8(0x62a1, sel);
        e.mem.write8(0x69e5, vp);
        e.mem.write8(0x69e9, vp4);
        const diffs = contractDiffs(e, loc_26a6);
        count++;
        if (diffs.length) { mismatch = { sel, vp, vp4, diffs }; break; }
      }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch sel=${hx(mismatch.sel)} mem[P]=${hx(mismatch.vp)} mem[P+4]=${hx(mismatch.vp4)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 256 * 2, "must have compared the full 131,072-combo grid");
  console.log(`  EQUAL/exhaustive: ${count} (arm × mem[P] × mem[P+4]) combos identical to the oracle`);
});

// -- 2. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_26a6 == oracle on every captured 0x26a6 entry", () => {
  const caps = captureRealDispatches(bootedMachine(500));
  assert.ok(caps.length >= 3, "expected real 0x26a6 dispatches from loc_2602/262f/2679");

  const arms = new Set();
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_26a6); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    arms.add((cap.mem.read8(cap.regs.de) & 0x80) !== 0);
  }
  assert.equal(arms.size, 2, "real dispatches must cover BOTH arms (select bit7 clear and set)");
  const hls = [...new Set(caps.map((c) => c.regs.hl.toString(16)))].join(",");
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical (HL bases: ${hls}; both arms seen)`);
});

// -- 3. EQUAL (crafted addressing edges) --------------------------------------

test("EQUAL (crafted): L-wrap base and the four wrap seams match the oracle", () => {
  const seed = bootedMachine(400).clone();

  // craft(base, sel, vp, vp4): pokes the select byte at 0x62a1 and the counters at the
  // base-derived P / P+4, with a safe excluded stack.
  const craft = (base, sel, vp, vp4) => {
    const e = seed.clone();
    e.regs.hl = base;
    e.regs.de = 0x62a1;
    e.regs.sp = 0x6bfe;
    e.mem.write8(0x62a1, sel);
    const page = base & 0xff00;
    e.mem.write8(page | ((base + 1) & 0xff), vp); // P
    e.mem.write8(page | ((base + 5) & 0xff), vp4); // P+4
    return e;
  };

  const cases = [
    // L-wrap base: HL=0x69FF → inc l wraps to 0x6900 (H held); P=0x6900, P+4=0x6904.
    { name: "L-wrap base, count-up  (P 0x69FF→wrap, P+4)", e: craft(0x69ff, 0x00, 0x51, 0xd1) },
    { name: "L-wrap base, count-down",                     e: craft(0x69ff, 0x80, 0x51, 0xd1) },
    // The four wrap seams at a live base (0x69E4): each RMW lands on its guard value.
    { name: "count-up  P seam    (0x52→0x53⇒0x50)",  e: craft(0x69e4, 0x00, 0x52, 0x40) },
    { name: "count-up  P+4 seam  (0xD0→0xCF⇒0xD2)",  e: craft(0x69e4, 0x00, 0x40, 0xd0) },
    { name: "count-down P seam   (0x50→0x4F⇒0x52)",  e: craft(0x69e4, 0x80, 0x50, 0x40) },
    { name: "count-down P+4 seam (0xD2→0xD3⇒0xD0)",  e: craft(0x69e4, 0x80, 0x40, 0xd2) },
    // Non-seam ordinary steps at both bases the grid does not use.
    { name: "ordinary step at base 0x69EC",          e: craft(0x69ec, 0x00, 0x50, 0xd2) },
    { name: "ordinary step at base 0x69F4",          e: craft(0x69f4, 0x80, 0x51, 0xd1) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, loc_26a6);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} addressing / wrap-seam edges identical to the oracle`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the inc↔dec-flip twin (count-up P+4) is CAUGHT", () => {
  const seed = bootedMachine(400).clone();
  const craft = (sel, vp, vp4) => {
    const e = seed.clone();
    e.regs.hl = 0x69e4;
    e.regs.de = 0x62a1;
    e.regs.sp = 0x6bfe;
    e.mem.write8(0x62a1, sel);
    e.mem.write8(0x69e5, vp);
    e.mem.write8(0x69e9, vp4);
    return e;
  };

  // Count-up arm, P+4 values chosen so −1 and +1 provably differ and neither hits the
  // 0xCF guard — the twin's inverted direction cannot coincide away.
  const guaranteed = [craft(0x00, 0x40, 0x80), craft(0x00, 0x40, 0x10), craft(0x00, 0x51, 0xa0)];
  for (const e of guaranteed) {
    assert.ok(
      contractDiffs(e, brokenLoc26a6).length > 0,
      "the inc↔dec-flip twin escaped a guaranteed-diff entry — the gate is worthless",
    );
    assert.equal(contractDiffs(e, loc_26a6).length, 0, "loc_26a6 must still pass the same entry");
  }

  // Corroboration on the real count-up dispatches (loc_2602/2679) — caught wherever the
  // captured counter makes the two directions differ (a subset, but must be non-empty).
  const caps = captureRealDispatches(bootedMachine(500)).filter(
    (c) => (c.mem.read8(c.regs.de) & 0x80) === 0,
  );
  const caughtReal = caps.filter((c) => contractDiffs(c, brokenLoc26a6).length > 0).length;
  assert.ok(caughtReal > 0, "the twin was not caught on ANY real count-up dispatch — corroboration failed");

  console.log(
    `  TEETH: inc↔dec-flip twin caught on all ${guaranteed.length} guaranteed entries ` +
      `and on ${caughtReal}/${caps.length} real count-up dispatches`,
  );
});
