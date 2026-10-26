// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearStridedBytes (ROM 0x30e4) — the stride-4, low-byte-only
 * memory clear.
 *
 * sub_30e4 WRITES memory (B bytes of 0x00 at stride 4, the low address byte wrapping
 * 8-bit within its page) and reads HL + B. Its declared LIVE-OUT is memory + A / HL /
 * B (A = final low byte, HL = page carrying it with H preserved, B = 0); flags are
 * dead. So it is validated on RAM (minus the stack scratch below the entry SP) + pc + SP + those three
 * registers via capture/clone/replay — NEVER the full register file, NEVER cycles.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so
 * the harness performs ONE m.ret() on the idiomatic clone AFTER the call to line pc +
 * SP up with the oracle (which rets internally). The oracle only READS the stack (the
 * ret pop, no write) and every clear target is in the 0x6900 sprite buffer, far from
 * the 0x6bxx stack, so the stack region is byte-equal on both sides regardless and is
 * excluded by the contract exactly as intended. Every case runs on a FRESH clone (a
 * reused clone is only safe for a read-only leaf; this routine writes memory).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x30e4 in a real attract run and clone
 *      the machine at each true dispatch. Attract reaches it via sub_30bd (four runs:
 *      HL=0x6950/0x6980/0x69b8/0x6a0c, B=2/10/11/5) and entry_30db's fallthrough
 *      (HL=0x6958, B=6) — all five caller shapes. Oracle vs candidate on fresh clones.
 *
 *   2. EQUAL (call-site shapes) — the five real shapes reposed explicitly on a real
 *      captured base, so the gate covers every one deterministically regardless of
 *      capture timing.
 *
 *   3. EQUAL (crafted edges) — the arms attract never reaches: the B=0 → 256-pass
 *      `djnz` edge, and the in-page L-wrap (HL=0x69f8: 0x69fc wraps to 0x6900, NOT
 *      0x6a00) that pins the low-byte-only walk. Both on sentinel-filled pages so any
 *      missed/extra/misplaced write bites the RAM gate.
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) wrong-stride: steps +2 instead of +4 — caught on a footprint-pin entry
 *          (sentinel page), where its extra writes land on bytes the oracle leaves.
 *      (b) 16-bit-carry: advances HL as a full 16-bit pointer, so an L overflow carries
 *          into H (crosses the page) instead of wrapping 8-bit — the exact bug the
 *          oracle's `ld l,a` guards against — caught on the L-wrap entry (the twin
 *          writes into page 0x6a and leaves HL in 0x6a; the oracle stays in 0x69).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-30e4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_30e4 as oracle } from "../../translated/loc_30e4.js";
import { clearStridedBytes } from "../clearStridedBytes.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x30e4;
const CAP_FRAMES = 4500; // first 0x30e4 dispatch lands ~frame 3000; 4500 covers one full set of 5
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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
 * stack, so it does not touch pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP, and
 * the declared live-out registers A / HL / B. The rest of the register file and the
 * flags are deliberately NOT compared — that is the memory-equivalence gate. Returns a
 * list of human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if ((o.regs.a & 0xff) !== (c.regs.a & 0xff)) diffs.push(`A oracle=${hx(o.regs.a & 0xff)} cand=${hx(c.regs.a & 0xff)}`);
  if ((o.regs.hl & 0xffff) !== (c.regs.hl & 0xffff)) diffs.push(`HL oracle=${hx(o.regs.hl)} cand=${hx(c.regs.hl)}`);
  if ((o.regs.b & 0xff) !== (c.regs.b & 0xff)) diffs.push(`B oracle=${hx(o.regs.b & 0xff)} cand=${hx(c.regs.b & 0xff)}`);
  return diffs;
}

/**
 * Hook 0x30e4 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Single runFrames() call — frame-by-frame stepping shifts NMI timing and
 * takes a different attract branch (see docs/decompiler-pipeline).
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

/** Clone `base` and pose HL/B — a real state with a surgical register nudge. */
function poseRegs(base, { hl, b }) {
  const w = base.clone();
  w.regs.hl = hl & 0xffff;
  w.regs.b = b & 0xff;
  return w;
}

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x69) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

/** BUG: steps +2 instead of +4 — writes 0 to the wrong (denser) set of addresses. */
function teethStride2(m) {
  const { regs, mem } = m;
  const page = regs.hl & 0xff00;
  let lo = regs.hl & 0xff;
  const count = regs.b === 0 ? 256 : regs.b;
  for (let i = 0; i < count; i++) {
    mem.write8(page | lo, 0x00);
    lo = (lo + 2) & 0xff; // BUG: stride should be 4
  }
  regs.a = lo;
  regs.hl = page | lo;
  regs.b = 0;
}

/** BUG: advances HL as a full 16-bit pointer, so an L overflow carries into H. */
function teeth16bitCarry(m) {
  const { regs, mem } = m;
  let ptr = regs.hl;
  const count = regs.b === 0 ? 256 : regs.b;
  for (let i = 0; i < count; i++) {
    mem.write8(ptr, 0x00);
    ptr = (ptr + 4) & 0xffff; // BUG: should be 8-bit on L only, staying in-page
  }
  regs.a = ptr & 0xff;
  regs.hl = ptr;
  regs.b = 0;
}

test("EQUAL (real dispatches): clearStridedBytes == oracle on every captured 0x30e4 entry", () => {
  const caps = captureDispatches(64, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x30e4 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, clearStridedBytes);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = [...new Set(caps.map((c) => `HL=${hx(c.regs.hl)} B=${c.regs.b}`))];
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical; distinct shapes:\n    ` + shapes.join("\n    "));
});

test("EQUAL (call-site shapes): all five real caller shapes match the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  const shapes = [
    { name: "sub_30bd #1 (0x30C2)", hl: 0x6950, b: 0x02 },
    { name: "sub_30bd #2 (0x30C9)", hl: 0x6980, b: 0x0a },
    { name: "sub_30bd #3 (0x30D0)", hl: 0x69b8, b: 0x0b },
    { name: "sub_30bd tail jump (0x30D8)", hl: 0x6a0c, b: 0x05 },
    { name: "entry_30db fallthrough", hl: 0x6958, b: 0x06 },
  ];
  for (const s of shapes) {
    const w = poseRegs(base, s);
    const diffs = contractDiffs(w, clearStridedBytes);
    assert.equal(diffs.length, 0, `${s.name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/shapes: ${shapes.length} caller shapes — identical RAM + pc + SP + A/HL/B`);
});

test("EQUAL (crafted edges): B=0 256-pass and the in-page L-wrap match the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) B=0 -> 256 passes (djnz decrements then tests). Stride 4 over a full page
  //     clears the stride-4 column (64 distinct bytes, each hit 4x). Sentinel page so
  //     the exact cleared set is pinned.
  {
    const w = poseRegs(base, { hl: 0x6900, b: 0x00 });
    paintPage(w, 0x69, 0xee);
    const diffs = contractDiffs(w, clearStridedBytes);
    assert.equal(diffs.length, 0, `B=0 256-pass: ${diffs.join("; ")}`);
  }

  // (b) In-page L-wrap: HL=0x69f8, B=6 — the low byte crosses 0xFF (0x69fc -> 0x6900),
  //     wrapping WITHIN page 0x69, never into 0x6a. Both pages sentinel-filled so a
  //     stray write into 0x6a (the classic 16-bit-carry bug) would show immediately.
  {
    const w = poseRegs(base, { hl: 0x69f8, b: 0x06 });
    paintPage(w, 0x69, 0xdd);
    paintPage(w, 0x6a, 0xdd);
    const diffs = contractDiffs(w, clearStridedBytes);
    assert.equal(diffs.length, 0, `L-wrap: ${diffs.join("; ")}`);
  }

  console.log("  EQUAL/edges: B=0 256-pass and the in-page L-wrap — identical to the oracle");
});

test("TEETH: the wrong-stride twin and the 16-bit-carry twin are CAUGHT", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // (a) wrong-stride (+2) caught on a footprint pin: HL=0x6950, B=6, sentinel page.
  //     Oracle clears 0x6950/54/58/5c/60/64; the twin also clears 0x6952/56/... so
  //     0x6952 differs (oracle leaves the sentinel, twin writes 0).
  const pin = poseRegs(base, { hl: 0x6950, b: 0x06 });
  paintPage(pin, 0x69, 0xee);
  const dStride = contractDiffs(pin, teethStride2);
  assert.notEqual(dStride.length, 0, "the gate FAILED to catch the wrong-stride (+2) twin — it is worthless");

  // (b) 16-bit-carry caught on the L-wrap entry: the twin writes into page 0x6a
  //     (0x69fc -> 0x6a00) and leaves HL in 0x6a; the oracle wraps to 0x6900, HL in 0x69.
  const wrap = poseRegs(base, { hl: 0x69f8, b: 0x06 });
  paintPage(wrap, 0x69, 0xdd);
  paintPage(wrap, 0x6a, 0xdd);
  const dCarry = contractDiffs(wrap, teeth16bitCarry);
  assert.notEqual(dCarry.length, 0, "the gate FAILED to catch the 16-bit-carry twin — it is worthless");

  console.log(
    `  TEETH: wrong-stride caught (${dStride[0]}); 16-bit-carry caught (${dCarry[0]})`,
  );
});
