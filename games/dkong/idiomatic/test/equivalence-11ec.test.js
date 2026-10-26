// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for copyBytePairsStrided (ROM 0x11ec) — the strided byte-pair scatter.
 *
 * sub_11ec WRITES memory (2*B destination bytes at record offsets +0 and +2, stride
 * C+2, low byte wrapping 8-bit within the destination page) and reads its source (HL)
 * plus the DE/B/C registers. Its declared LIVE-OUT is memory-only: all three callers
 * reload HL, DE and BC right after the call and read no flag (verified in loc_1087,
 * loc_1131, sub_11a6), so A/B/C/HL/E and the terminal `add a,c` carry are dead ABI. So
 * it is validated on RAM (minus the stack scratch below the entry SP) via capture/clone/replay — never the
 * full register file, never cycles. SP/PC are not compared: the oracle's terminal
 * `ret` pops the stack and vectors PC, which the idiomatic layer drops (the JS call
 * stack replaces it), and any popped bytes live in the excluded stack scratch.
 *
 *   1. REALISM — hook 0x11ec in a real attract run and clone the machine at each real
 *      dispatch. Attract reaches it exactly once, via sub_11a6 (HL=0x3e0c, DE=0x6683,
 *      B=2, C=0x0e). Oracle vs candidate on fresh clones → identical RAM (ex-stack).
 *
 *   2. CRAFTED (call-site shapes) — attract exercises only sub_11a6's shape, so the
 *      other two call sites are reproduced by poking HL/DE/BC identically on both
 *      sides: loc_1087's 0x10C0 (HL=0x3e64, DE=0x6603, B=6, C=0x0e) and loc_1131's
 *      0x1157 (HL=0x1182, DE=0x64a3, B=2, C=0x1e).
 *
 *   3. CRAFTED (edges) — the behaviours attract's single shape never reaches: the 8-bit
 *      E-wrap (dest low byte crosses 0xFF and wraps WITHIN its page, not into D), the
 *      16-bit HL page-cross (source `inc hl` carries into H), and the B=0 → 256-pass
 *      `djnz` edge. Plus a distinct-source footprint pin (source poked ascending, dest
 *      sentinel-filled) that makes any missed/extra/misplaced write bite the RAM gate.
 *
 *   4. TEETH — two deliberately-broken twins, each CAUGHT:
 *      (a) 16-bit-carry: advances the destination as a full 16-bit pointer, so E's
 *          overflow carries into D (crosses the page) instead of wrapping 8-bit —
 *          caught on the E-wrap entry (oracle writes the wrapped 0x6600, the twin
 *          writes 0x6700 and leaves 0x6600 at the sentinel).
 *      (b) re-read-source: re-reads the SAME source pair every pass (sub_122a's
 *          broadcast semantics — the exact confusion the oracle header warns against)
 *          instead of advancing HL cumulatively — caught on the distinct-source entry.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-11ec.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_11ec as oracle } from "../../translated/loc_11ec.js";
import { copyBytePairsStrided } from "../copyBytePairsStrided.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x11ec;
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
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing
 * routine demands a fresh clone per side) and diff RAM outside the dead stack.
 */
function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffOutsideStack(a, b, entry.regs.sp);
}

/**
 * Hook 0x11ec in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop. Single runFrames() call — frame-by-frame stepping
 * shifts NMI timing and takes a different attract branch (see docs/decompiler-pipeline).
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

// -- crafted-entry builders ---------------------------------------------------

/** Clone `base` and pose HL/DE/B/C — a real state with a surgical register nudge. */
function poseRegs(base, { hl, de, b, c }) {
  const w = base.clone();
  w.regs.hl = hl & 0xffff;
  w.regs.de = de & 0xffff;
  w.regs.b = b & 0xff;
  w.regs.c = c & 0xff;
  return w;
}

/** Paint `len` ascending, distinct, non-zero bytes (1,2,3,…) at `addr`. */
function paintSource(w, addr, len) {
  for (let i = 0; i < len; i++) w.mem.write8((addr + i) & 0xffff, (i + 1) & 0xff);
}

/** Sentinel-fill a whole 256-byte destination page (page = high byte, e.g. 0x66). */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

/**
 * A fully-controlled entry: source RAM poked ascending-distinct, the destination page
 * sentinel-filled, and HL/DE/B/C posed. Because the source bytes are distinct and the
 * sentinel differs from them, ANY misplaced/missed/extra write, or any wrong source
 * byte, differs from the oracle and bites the RAM gate.
 */
function controlledEntry(base, { srcAddr, srcLen, destPage, destE, b, c, sentinel }) {
  const w = poseRegs(base, { hl: srcAddr, de: (destPage << 8) | destE, b, c });
  paintPage(w, destPage, sentinel);
  paintSource(w, srcAddr, srcLen);
  return w;
}

// -- 1. REALISM ---------------------------------------------------------------

test("REALISM: real captured 0x11ec dispatch (sub_11a6 shape) — RAM (ex-stack) matches oracle", () => {
  const caps = captureDispatches(64, 1000);
  assert.ok(caps.length >= 1, "expected at least one real 0x11ec dispatch during attract");
  for (const cap of caps) {
    // Sanity: attract's only shape is sub_11a6's (documented), used as the crafted base.
    const ram = diffAgainstOracle(cap, copyBytePairsStrided);
    assert.equal(ram, null, ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  REALISM: ${caps.length} real 0x11ec dispatch(es) — identical RAM (ex-stack)`);
});

// -- 2. CRAFTED (call-site shapes) --------------------------------------------

test("CRAFTED: the other two call-site shapes (0x10C0, 0x1157) match the oracle", () => {
  const [base] = captureDispatches(1, 1000);
  assert.ok(base, "need one real capture to derive crafted entries from");

  const shapes = [
    { name: "0x10C0 loc_1087", hl: 0x3e64, de: 0x6603, b: 0x06, c: 0x0e },
    { name: "0x1157 loc_1131", hl: 0x1182, de: 0x64a3, b: 0x02, c: 0x1e },
    { name: "0x11AC sub_11a6", hl: 0x3e0c, de: 0x6683, b: 0x02, c: 0x0e }, // the real shape, explicit
  ];
  for (const s of shapes) {
    const w = poseRegs(base, s);
    const ram = diffAgainstOracle(w, copyBytePairsStrided);
    assert.equal(ram, null, ram && `${s.name}: RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }
  console.log(`  CRAFTED: ${shapes.length} call-site shapes — identical RAM (ex-stack)`);
});

// -- 3. CRAFTED (edges) -------------------------------------------------------

test("CRAFTED: edges — 8-bit E-wrap, 16-bit HL page-cross, B=0 256-pass, footprint pin", () => {
  const [base] = captureDispatches(1, 1000);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) 8-bit E-wrap: D=0x66, E=0xFE, B=4, C=0x08 — the dest low byte crosses 0xFF and
  //     wraps within page 0x66 (0x66FE -> 0x6600), never into D. Distinct source pins it.
  {
    const w = controlledEntry(base, { srcAddr: 0x6100, srcLen: 8, destPage: 0x66, destE: 0xfe, b: 4, c: 0x08, sentinel: 0xee });
    const ram = diffAgainstOracle(w, copyBytePairsStrided);
    assert.equal(ram, null, ram && `E-wrap: RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }

  // (b) 16-bit HL page-cross: source at ROM 0x3EFE so `inc hl` carries into H mid-run.
  {
    const w = poseRegs(base, { hl: 0x3efe, de: (0x6a << 8) | 0x00, b: 4, c: 0x10 });
    paintPage(w, 0x6a, 0xdd);
    const ram = diffAgainstOracle(w, copyBytePairsStrided);
    assert.equal(ram, null, ram && `HL page-cross: RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }

  // (c) B=0 -> 256 passes (djnz decrements then tests). Stride C+2 = 2, so the pairs
  //     wrap around page 0x66 repeatedly — a heavy stress of the 8-bit low-byte wrap.
  {
    const w = poseRegs(base, { hl: 0x3000, de: (0x66 << 8) | 0x00, b: 0x00, c: 0x00 });
    paintPage(w, 0x66, 0x99);
    const ram = diffAgainstOracle(w, copyBytePairsStrided);
    assert.equal(ram, null, ram && `B=0 256-pass: RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }

  // (d) Footprint pin: distinct ascending source, sentinel dest, no wrap — any missed,
  //     extra, or misplaced write shows a sentinel/source mismatch against the oracle.
  {
    const w = controlledEntry(base, { srcAddr: 0x6100, srcLen: 16, destPage: 0x66, destE: 0x00, b: 8, c: 0x0e, sentinel: 0xee });
    const ram = diffAgainstOracle(w, copyBytePairsStrided);
    assert.equal(ram, null, ram && `footprint pin: RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
  }

  console.log("  CRAFTED: E-wrap, HL page-cross, B=0 256-pass, and footprint pin — all identical to the oracle");
});

// -- 4. TEETH -----------------------------------------------------------------

/** BUG: advances the destination 16-bit, so E's overflow carries into D (page cross). */
function teeth16bitCarry(m) {
  const { regs, mem } = m;
  let src = regs.hl;
  let de = regs.de;
  const stride = regs.c;
  const passes = regs.b === 0 ? 256 : regs.b;
  for (let i = 0; i < passes; i++) {
    mem.write8(de, mem.read8(src)); src = (src + 1) & 0xffff;
    de = (de + 2) & 0xffff; // BUG: should be 8-bit on E only
    mem.write8(de, mem.read8(src)); src = (src + 1) & 0xffff;
    de = (de + stride) & 0xffff; // BUG: should be 8-bit on E only
  }
}

/** BUG: re-reads the SAME source pair every pass (sub_122a's broadcast, not a scatter). */
function teethReReadSource(m) {
  const { regs, mem } = m;
  const src = regs.hl; // BUG: never advanced across passes
  const page = regs.de & 0xff00;
  let lo = regs.de & 0xff;
  const stride = regs.c;
  const passes = regs.b === 0 ? 256 : regs.b;
  for (let i = 0; i < passes; i++) {
    mem.write8(page | lo, mem.read8(src));
    lo = (lo + 2) & 0xff;
    mem.write8(page | lo, mem.read8((src + 1) & 0xffff));
    lo = (lo + stride) & 0xff;
  }
}

test("TEETH: both broken twins are CAUGHT by the RAM gate", () => {
  const [base] = captureDispatches(1, 1000);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) 16-bit-carry caught on the E-wrap entry: oracle writes the wrapped 0x6600, the
  //     twin writes 0x6700 and leaves 0x6600 holding the sentinel.
  const wrap = controlledEntry(base, { srcAddr: 0x6100, srcLen: 8, destPage: 0x66, destE: 0xfe, b: 4, c: 0x08, sentinel: 0xee });
  const d16 = diffAgainstOracle(wrap, teeth16bitCarry);
  assert.notEqual(d16, null, "the RAM gate FAILED to catch the 16-bit-carry twin — it is worthless");

  // (b) re-read-source caught on the distinct-source entry: later records get the wrong
  //     (first) source pair instead of their own.
  const distinct = controlledEntry(base, { srcAddr: 0x6100, srcLen: 16, destPage: 0x66, destE: 0x00, b: 8, c: 0x0e, sentinel: 0xee });
  const dRR = diffAgainstOracle(distinct, teethReReadSource);
  assert.notEqual(dRR, null, "the RAM gate FAILED to catch the re-read-source (sub_122a) twin — it is worthless");

  console.log(
    `  TEETH: 16-bit-carry caught at ${hx(d16.addr)} (oracle=${d16.a} twin=${d16.b}); ` +
      `re-read-source caught at ${hx(dRR.addr)} (oracle=${dRR.a} twin=${dRR.b})`,
  );
});
