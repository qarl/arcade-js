// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for replicateGroupStrided (ROM 0x122a) — the "replicate one
 * 4-byte source group into B strided destination slots" struct-field initialiser.
 *
 * This routine WRITES MEMORY (and leaves live registers), so it is gated on
 * memory-equivalence, not on a returned scalar, and every case runs on a FRESH
 * clone (a reused clone is only safe for a read-only leaf):
 *
 *   1. EQUAL (real captured dispatches) — hook 0x122a in a real attract run and
 *      clone the machine at each true dispatch. Attract exercises four distinct
 *      shapes during board/sprite setup: B∈{2,5,8}, C∈{0x0c,0x1c}, DE in work RAM,
 *      HL a ROM/data template. For each capture, run the ORACLE on one clone and
 *      replicateGroupStrided on another and confirm identical RAM (minus
 *      STACK_SCRATCH) + pc + SP + declared live-out (A/B/C/D/E/H/L).
 *
 *   2. EQUAL (crafted arms + edges) — the arms attract never reaches, from real
 *      captured RAM with surgical register pokes: the B==0 → 256-pass edge, an
 *      E page-wrap (D fixed, E crosses 0xff→0x00 mid-copy — the "inc e not inc de"
 *      behaviour), and a C==0 contiguous stride. Each compared identically both sides.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a cumulative-source twin (the sub_11ec inversion: does not re-read HL,
 *          so pass N copies the wrong bytes) — caught on every real B>1 dispatch;
 *      (b) a 16-bit page-cross twin (`inc de` instead of `inc e`, so an E wrap
 *          leaks into page D+1) — caught by the crafted page-wrap entry.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling),
 * so the harness performs one m.ret() on the idiomatic clone AFTER the call to line
 * pc + SP up with the oracle (which rets internally). The oracle's transient
 * `push hl`/`push bc` land inside STACK_SCRATCH (measured: entry SP ≥ 0x6bea, so the
 * deepest push reaches 0x6be6 ≥ STACK_SCRATCH.lo), so the dead stack scratch the
 * idiomatic side never writes is excluded by the contract, exactly as intended.
 *
 * FLAGS are not compared, and that hole is deliberate: the carry out of the final `add a,c`
 * escapes through the `ret`, but every one of the 11 call sites overwrites HL/IX or returns
 * immediately, so none of them branches on it.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-122a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_122a as oracle } from "../../translated/loc_122a.js";
import { replicateGroupStrided } from "../replicateGroupStrided.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x122a;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region the standard gate excludes. The oracle pushes HL/BC into this
 * region transiently (then pops them); the idiomatic routine never writes it, so
 * excluding it is exactly the contract, not a fudge.
 */
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
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc +
 * SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP,
 * and the declared live-out registers A/B/C/D/E/H/L (every main 8-bit reg — the
 * modified E/A/B and the preserved C/D/H/L; F is dropped as dead). Returns a list
 * of human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  for (const r of ["a", "b", "c", "d", "e", "h", "l"]) {
    if (o.regs[r] !== c.regs[r]) diffs.push(`${r.toUpperCase()} oracle=${hx(o.regs[r])} cand=${hx(c.regs[r])}`);
  }
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

/**
 * Hook 0x122a in a real attract run and clone the machine at up to K real
 * dispatches. The wrapper snapshots the entry state, then runs the oracle so the
 * host game proceeds undisturbed. m.call(0x122a) resolves through the routine
 * registry the override overlays, so every call site is captured here.
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

/**
 * Broken twin (a): the sub_11ec inversion — does NOT re-read the source group each
 * pass, so HL advances cumulatively and passes past the first copy the WRONG bytes.
 * Agrees on pass 0, diverges whenever B > 1.
 */
function brokenCumulativeSource(m) {
  const { regs, mem } = m;
  const stride = regs.c;
  const page = regs.d << 8;
  const groups = regs.b === 0 ? 256 : regs.b;
  let e = regs.e;
  let src = regs.hl; // BUG: never reset to regs.hl between passes
  for (let g = 0; g < groups; g++) {
    for (let i = 0; i < 4; i++) {
      mem.write8(page | e, mem.read8(src & 0xffff));
      src = (src + 1) & 0xffff;
      e = (e + 1) & 0xff;
    }
    e = (e + stride) & 0xff;
  }
  regs.e = e;
  regs.a = e;
  regs.b = 0;
}

/**
 * Broken twin (b): steps the destination pointer 16-bit (`inc de`), so an E wrap
 * crosses into page D+1 instead of staying inside page D. Agrees unless E wraps.
 */
function brokenPageCross(m) {
  const { regs, mem } = m;
  const src = regs.hl;
  const stride = regs.c;
  const groups = regs.b === 0 ? 256 : regs.b;
  let de = regs.de;
  for (let g = 0; g < groups; g++) {
    for (let i = 0; i < 4; i++) {
      mem.write8(de, mem.read8((src + i) & 0xffff));
      de = (de + 1) & 0xffff; // BUG: 16-bit increment leaks a wrap into the next page
    }
    de = (de + stride) & 0xffff; // BUG: 16-bit stride add
  }
  regs.e = de & 0xff;
  regs.a = de & 0xff;
  regs.b = 0;
}

test("EQUAL (real dispatches): replicateGroupStrided == oracle on every captured 0x122a entry", () => {
  const caps = captureDispatches(64, 2500);
  assert.ok(caps.length >= 1, "expected at least one real 0x122a dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, replicateGroupStrided); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = caps.map((c) =>
    `B=${hx(c.regs.b)} C=${hx(c.regs.c)} DE=0x${c.regs.de.toString(16)} HL=0x${c.regs.hl.toString(16)}`);
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical\n    ` + shapes.join("\n    "));
});

test("EQUAL (crafted): the B==0/256-pass edge, an E page-wrap, and a C==0 stride match the oracle", () => {
  const caps = captureDispatches(1, 2500);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // Each craft: real captured RAM, surgical register pokes, a safe stack pointer so
  // the oracle's push/pop/ret touch only STACK_SCRATCH (excluded) bytes. Destinations
  // are chosen inside work RAM (page 0x64/0x68) so every write is in the compared dump.
  const craft = (b, c, de, hl) => {
    const e = seed.clone();
    e.regs.b = b; e.regs.c = c; e.regs.de = de; e.regs.hl = hl;
    e.regs.sp = 0x6bfe;
    return e;
  };

  const cases = [
    { name: "B==0 -> 256 passes (C=0x04, DE=0x6800, HL=0x3dec)", e: craft(0x00, 0x04, 0x6800, 0x3dec) },
    { name: "E page-wrap (B=3, C=0x1c, DE=0x64fe — inc e stays in page 0x64)", e: craft(0x03, 0x1c, 0x64fe, 0x3dec) },
    { name: "C==0 contiguous stride 4 (B=6, DE=0x6820, HL=0x3e08)", e: craft(0x06, 0x00, 0x6820, 0x3e08) },
    { name: "large stride (B=2, C=0x7f, DE=0x6900, HL=0x3e00)", e: craft(0x02, 0x7f, 0x6900, 0x3e00) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, replicateGroupStrided);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} unreached arms + edges identical to the oracle`);
});

test("TEETH: the cumulative-source twin and the page-cross twin are CAUGHT", () => {
  const caps = captureDispatches(8, 2500);
  assert.ok(caps.length >= 1, "need real captures (B>1) to catch the cumulative-source bug");

  // (a) cumulative-source: real dispatches all have B>1, so it diverges on pass 1.
  let caughtReal = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenCumulativeSource).length > 0) caughtReal++;
  }
  assert.equal(
    caughtReal, caps.length,
    `the cumulative-source twin escaped on ${caps.length - caughtReal}/${caps.length} real dispatches — the gate is worthless`,
  );

  // (b) page-cross: only an E wrap distinguishes it, so craft one (D=0x64, E=0xfe).
  const wrap = caps[0].clone();
  wrap.regs.b = 0x03; wrap.regs.c = 0x1c; wrap.regs.de = 0x64fe; wrap.regs.hl = 0x3dec; wrap.regs.sp = 0x6bfe;
  const wrapDiffs = contractDiffs(wrap, brokenPageCross);
  assert.ok(wrapDiffs.length > 0, "the page-cross twin escaped detection on the crafted E-wrap arm");

  console.log(
    `  TEETH: cumulative-source caught on all ${caps.length} real dispatches ` +
      `(e.g. ${contractDiffs(caps[0], brokenCumulativeSource)[0]}); page-cross caught on the E-wrap craft ` +
      `(${wrapDiffs[0]})`,
  );
});
