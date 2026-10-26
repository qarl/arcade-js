// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for gatherSpriteRecords (ROM 0x11d3) — the permuting gather that
 * builds hardware sprite records from object records (read IX+3/+7/+8/+5 into four
 * consecutive dest bytes at HL, then add ix,de; repeat B times).
 *
 * sub_11d3 WRITES memory (4·B bytes at HL) and reads implicit inputs (IX record
 * contents), so it is validated by capture/clone/replay on a FRESH clone per case —
 * never by reusing one machine, and never on the full register file or cycles. The
 * contract compared is RAM (minus the stack scratch below the entry SP) + the declared live-out registers
 * A/B/HL/IX:
 *
 *   1. REALISM — hook 0x11d3 in a real attract run and clone the machine at each real
 *      dispatch (the 25m board build reaches it via sub_11a6, B=2 DE=0x10 HL=0x6A18).
 *      For each, run oracle vs gatherSpriteRecords on two fresh clones and confirm
 *      identical RAM (ex-stack) + A/B/HL/IX.
 *
 *   2. CRAFTED — attract only exercises one call site, so poke a real capture into the
 *      arms it never reaches (identically on both sides): the other counts and strides
 *      (B=6/0x0A, DE=0x20), arbitrary source content, the L-wrap edge (L near a page
 *      end), and the B==0 256-pass edge. Proves the gather is faithful for the full
 *      call-site range, not just the one attract hits.
 *
 *   3. TEETH — a deliberately-broken twin (a NON-permuting gather that reads +3,+4,+5,+6
 *      sequentially instead of the true +3,+7,+8,+5) MUST be caught, on a crafted entry
 *      rigged so all nine record bytes differ (so the RAM gate itself bites), and also
 *      on the real captures.
 *
 * NOT COMPARED, deliberately: SP and PC. The oracle's terminal `ret` pops the stack
 * (SP += 2) and vectors PC to the return address; the idiomatic layer drops that
 * stack/PC bookkeeping (the JS call stack replaces it), so those are dead ABI here.
 * Cycles and the full register file are likewise never compared (docs/decompiler-pipeline). FLAGS are
 * dropped as dead — the final add-ix carry the oracle preserves propagates up through
 * the rets but is overwritten (at a later `add a,c`) before any reader consumes it.
 * A/B/HL/IX are compared even though all five call sites overwrite HL or `ret` without
 * reading any of them: they are cheap plain arithmetic, three sites tail-return into
 * callers not exhaustively traced, and comparing them gives this gate more teeth.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-11d3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_11d3 as oracle } from "../../translated/loc_11d3.js";
import { gatherSpriteRecords } from "../gatherSpriteRecords.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x11d3;
const LIVE_REGS = ["a", "b", "hl", "ix"]; // the gather's terminal register outputs

const hx = (v) => "0x" + (v & 0xffff).toString(16);

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

/** First declared-live-out register that differs, or null. */
function firstLiveRegDiff(a, b) {
  for (const k of LIVE_REGS) {
    if (a.regs[k] !== b.regs[k]) return { reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/**
 * Run the oracle and a candidate on two FRESH clones of `entry` (a memory-writing,
 * stateful routine demands a fresh clone per side) and diff the contract.
 */
function diffAgainstOracle(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { ram: firstRamDiffOutsideStack(a, b, entry.regs.sp), reg: firstLiveRegDiff(a, b) };
}

/**
 * Hook 0x11d3 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop.
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
 * Seed B object records of `stride` bytes each, based at `ix`, with distinctive
 * per-record content so a wrong gather (permutation or offset) is visible: byte
 * (record r, offset d) := base(r) + d, giving all nine offsets +0..+8 distinct within
 * a record and distinct across records. Returns a clone with IX/HL/B/DE set.
 */
function craftEntry(cap, { ix, hl, b, stride, base = 0x10 }) {
  const w = cap.clone();
  w.regs.ix = ix;
  w.regs.hl = hl;
  w.regs.b = b;
  w.regs.de = stride;
  const passes = b === 0 ? 256 : b;
  for (let r = 0; r < passes; r++) {
    const recBase = (ix + r * stride) & 0xffff;
    for (let d = 0; d <= 8; d++) {
      w.mem.write8((recBase + d) & 0xffff, (base + r * 0x11 + d) & 0xff);
    }
  }
  return w;
}

test("REALISM: real captured 0x11d3 dispatches — RAM (ex-stack) + A/B/HL/IX match the oracle", () => {
  const caps = captureDispatches(64, 1200);
  assert.ok(caps.length >= 1, "expected at least one real 0x11d3 dispatch during attract");

  for (const cap of caps) {
    const { ram, reg } = diffAgainstOracle(cap, gatherSpriteRecords);
    assert.equal(
      ram,
      null,
      ram && `RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b} ` +
        `(IX=${hx(cap.regs.ix)} HL=${hx(cap.regs.hl)} B=${cap.regs.b} DE=${hx(cap.regs.de)})`,
    );
    assert.equal(
      reg,
      null,
      reg && `reg ${reg && reg.reg} diff: oracle=${hx(reg.a)} cand=${hx(reg.b)} ` +
        `(IX=${hx(cap.regs.ix)} HL=${hx(cap.regs.hl)} B=${cap.regs.b} DE=${hx(cap.regs.de)})`,
    );
  }
  console.log(`  REALISM: ${caps.length} real 0x11d3 dispatches — identical RAM (ex-stack) + A/B/HL/IX`);
});

test("CRAFTED: the arms attract never reaches (other B/DE, arbitrary content, L-wrap, B==0) match", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // IX at a work-RAM scratch source, HL inside the sprite buffer (a real destination
  // page). Every entry is seeded identically on both sides, so any divergence is the
  // rewrite's fault. Covers the counts/strides of the four non-attract call sites,
  // the L-wrap (L = 0xFE so `inc l` wraps within the page), and the B==0 256-pass edge.
  const cases = [
    { name: "B=6 DE=0x10 (loc_1087/loc_101f shape)", ix: 0x6200, hl: 0x6958, b: 0x06, stride: 0x10 },
    { name: "B=0x0A DE=0x10 (sub_1186 shape)", ix: 0x6200, hl: 0x6980, b: 0x0a, stride: 0x10 },
    { name: "B=2 DE=0x20 (loc_1131 shape)", ix: 0x6400, hl: 0x6950, b: 0x02, stride: 0x20 },
    { name: "L-wrap: HL low byte 0xFE, 2 records", ix: 0x6200, hl: 0x69fe, b: 0x02, stride: 0x10 },
    // B==0 -> 256 passes; stride 0 keeps every read in mapped work RAM (256 records at a
    // real stride would span 4KB and cross the unmapped 0x6C00 gap), while still forcing
    // the 256-vs-0 count path and the full L wrap-around (1024 `inc l`).
    { name: "B==0 -> 256 passes (stride 0)", ix: 0x6300, hl: 0x6100, b: 0x00, stride: 0x00 },
  ];

  for (const c of cases) {
    const w = craftEntry(base, c);
    const { ram, reg } = diffAgainstOracle(w, gatherSpriteRecords);
    assert.equal(ram, null, ram && `[${c.name}] RAM diff at ${hx(ram.addr)}: oracle=${ram.a} cand=${ram.b}`);
    assert.equal(reg, null, reg && `[${c.name}] reg ${reg && reg.reg} diff: oracle=${hx(reg.a)} cand=${hx(reg.b)}`);
  }
  console.log(`  CRAFTED: ${cases.length} non-attract arms (counts, strides, L-wrap, B==0) identical to the oracle`);
});

/**
 * Broken twin: a NON-permuting gather — reads +3,+4,+5,+6 sequentially instead of the
 * true +3,+7,+8,+5. It looks like an entirely reasonable block copy (exactly the trap
 * the oracle warns about) and agrees with the oracle wherever obj+4==obj+7 and
 * obj+6==obj+8, so only distinctive record content catches it.
 */
function brokenSequentialGather(m) {
  const { regs, mem } = m;
  const stride = regs.de;
  const count = regs.b === 0 ? 256 : regs.b;
  const hi = regs.h << 8;
  let l = regs.l;
  let ix = regs.ix;
  let a = 0;
  for (let i = 0; i < count; i++) {
    for (const disp of [0x03, 0x04, 0x05, 0x06]) { // BUG: should be 0x03,0x07,0x08,0x05
      a = mem.read8((ix + disp) & 0xffff);
      mem.write8(hi | l, a);
      l = (l + 1) & 0xff;
    }
    ix = (ix + stride) & 0xffff;
  }
  regs.a = a;
  regs.l = l;
  regs.ix = ix;
  regs.b = 0;
}

test("TEETH: the non-permuting (+3,+4,+5,+6) twin is CAUGHT — by RAM on a rigged entry and on real captures", () => {
  const [base] = captureDispatches(1, 1200);
  assert.ok(base, "need one real capture to rig a teeth entry from");

  // Rigged so the RAM gate itself bites: distinctive record bytes make dest+1 (obj+7 vs
  // obj+4) and dest+2 (obj+8 vs obj+5) guaranteed to differ oracle-vs-broken.
  const w = craftEntry(base, { ix: 0x6200, hl: 0x6958, b: 0x06, stride: 0x10 });
  const { ram, reg } = diffAgainstOracle(w, brokenSequentialGather);
  assert.notEqual(ram, null, "the RAM gate FAILED to catch the non-permuting twin — it is worthless");
  console.log(`  TEETH/rigged: caught by RAM at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);

  // Also catch it on real captures (real object records have distinct field values).
  const caps = captureDispatches(64, 1200);
  let caughtOnCapture = false;
  for (const cap of caps) {
    const d = diffAgainstOracle(cap, brokenSequentialGather);
    if (d.ram || d.reg) { caughtOnCapture = true; break; }
  }
  assert.ok(caughtOnCapture, "the gate FAILED to catch the non-permuting twin on any real capture");
  console.log(`  TEETH/captures: non-permuting twin also caught on real 0x11d3 dispatches`);
});
