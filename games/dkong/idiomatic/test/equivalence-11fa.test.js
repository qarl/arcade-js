// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_11fa (ROM 0x11fa) — the "scatter a 6-byte source record
 * into a fixed IX record + a 4-byte array" struct initialiser.
 *
 * The routine WRITES MEMORY and leaves NO live registers (both callers reload HL/DE
 * and never read A/IX/flags — live-out is memory-only), so it is gated on
 * memory-equivalence over RAM (minus the stack scratch below the entry SP) + pc + SP, and every case runs
 * on a FRESH clone (a reused clone is only safe for a read-only leaf):
 *
 *   1. EQUAL (real captured dispatches) — hook 0x11fa in a real attract run and
 *      clone the machine at each true dispatch. Attract dispatches it from loc_0fd7
 *      (HL=0x3DF4). For each capture, run the ORACLE on one clone and loc_11fa on
 *      another and confirm identical RAM (minus the stack scratch below the entry SP) + pc + SP.
 *
 *   2. EQUAL (crafted arms + edges) — the source the real run never reaches, from
 *      real captured RAM with a surgical HL poke: (a) the second caller's real ROM
 *      template (loc_101f, HL=0x3DFA — its byte 4 is non-zero, so the +0x09 field is
 *      genuinely exercised, unlike the all-zero tail of the 0x3DF4 template), and
 *      (b) a six-distinct-byte pattern staged in work RAM that pins every scattered
 *      field (+0x03/+0x07/+0x08/+0x05/+0x09/+0x0A and 0x6A28..0x6A2B) independently.
 *      Each compared identically both sides.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a field-swap twin (writes byte 3 to +0x08 and byte 2 to +0x05 — the ROM's
 *          load-bearing out-of-order pair inverted); caught whenever byte2 != byte3,
 *          i.e. on the real dispatch (0x01 vs 0xE0) and the distinct-byte craft;
 *      (b) a wrong-tag twin (writes 0x00 to +0x00 instead of 0x01); caught on every
 *          case since both sides write +0x00 and 0x01 != 0x00.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling),
 * so the harness performs one m.ret() on the idiomatic clone AFTER the call to line
 * pc + SP up with the oracle (which rets internally). The oracle only READS the
 * stack (the ret pop), never writes it, and the popped bytes live in STACK_SCRATCH
 * (real entry SP >= 0x6bea; crafts use SP=0x6bfe), so the stack region is byte-equal
 * on both sides regardless and is excluded by the contract exactly as intended.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-11fa.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_11fa as oracle } from "../../translated/loc_11fa.js";
import { loc_11fa } from "../loc_11fa.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x11fa;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region the standard gate excludes.
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
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP.
 * Live-out is memory-only (no live registers), so the register file is deliberately
 * NOT compared — that is the whole point of the memory-equivalence gate. Returns a
 * list of human-readable mismatches (empty when equal).
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

/**
 * Hook 0x11fa in a real attract run and clone the machine at up to K real
 * dispatches. The wrapper snapshots the entry state, then runs the oracle so the
 * host game proceeds undisturbed.
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
 * Broken twin (a): the ROM's load-bearing out-of-order pair inverted — writes byte 3
 * to +0x08 and byte 2 to +0x05. Since those two source bytes differ on the real
 * dispatch (0x01 vs 0xE0) and on the distinct-byte craft, the swap changes final
 * memory and is caught.
 */
function brokenFieldSwap(m) {
  const { regs, mem } = m;
  const src = regs.hl;
  const b = (i) => mem.read8((src + i) & 0xffff);
  mem.write8(0x66a0, 0x01);
  mem.write8(0x66a3, b(0));
  mem.write8(0x66a7, b(1));
  mem.write8(0x66a8, b(3)); // BUG: byte 3 should go to +0x05
  mem.write8(0x66a5, b(2)); // BUG: byte 2 should go to +0x08
  mem.write8(0x66a9, b(4));
  mem.write8(0x66aa, b(5));
  mem.write8(0x6a28, b(0));
  mem.write8(0x6a29, b(1));
  mem.write8(0x6a2a, b(2));
  mem.write8(0x6a2b, b(3));
}

/**
 * Broken twin (b): a mis-transcribed constant — writes 0x00 to the +0x00 tag instead
 * of 0x01. Both sides write +0x00, so 0x01 != 0x00 is caught on every case.
 */
function brokenWrongTag(m) {
  const { regs, mem } = m;
  const src = regs.hl;
  const b = (i) => mem.read8((src + i) & 0xffff);
  mem.write8(0x66a0, 0x00); // BUG: should be 0x01
  mem.write8(0x66a3, b(0));
  mem.write8(0x66a7, b(1));
  mem.write8(0x66a8, b(2));
  mem.write8(0x66a5, b(3));
  mem.write8(0x66a9, b(4));
  mem.write8(0x66aa, b(5));
  mem.write8(0x6a28, b(0));
  mem.write8(0x6a29, b(1));
  mem.write8(0x6a2a, b(2));
  mem.write8(0x6a2b, b(3));
}

test("EQUAL (real dispatches): loc_11fa == oracle on every captured 0x11fa entry", () => {
  const caps = captureDispatches(64, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x11fa dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_11fa); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = caps.map((c) => `HL=0x${c.regs.hl.toString(16)} SP=0x${c.regs.sp.toString(16)}`);
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical\n    ` + shapes.join("\n    "));
});

test("EQUAL (crafted): the unreached loc_101f source + a distinct-byte pattern match the oracle", () => {
  const caps = captureDispatches(1, 4000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // (a) second caller's real ROM template — HL=0x3DFA (byte 4 = 0x02, so +0x09 is
  // written non-zero, which the 0x3DF4 template's all-zero tail never exercises).
  const romSrc = seed.clone();
  romSrc.regs.hl = 0x3dfa;
  romSrc.regs.sp = 0x6bfe;

  // (b) six distinct bytes staged in work RAM (0x6100, unused scratch, untouched by
  // the routine), so every scattered field is pinned to a unique value.
  const pat = seed.clone();
  const PATTERN = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
  for (let i = 0; i < PATTERN.length; i++) pat.mem.write8(0x6100 + i, PATTERN[i]);
  pat.regs.hl = 0x6100;
  pat.regs.sp = 0x6bfe;

  const cases = [
    { name: "loc_101f ROM template (HL=0x3DFA)", e: romSrc },
    { name: "six-distinct-byte pattern (HL=0x6100)", e: pat },
  ];
  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, loc_11fa);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms identical to the oracle (incl. non-zero +0x09 and full-field pin)`);
});

test("TEETH: the field-swap twin and the wrong-tag twin are CAUGHT", () => {
  const caps = captureDispatches(8, 4000);
  assert.ok(caps.length >= 1, "need real captures to run the teeth");

  // (a) field-swap: real dispatches have byte2=0x01, byte3=0xE0 (distinct), so it
  // diverges at +0x05/+0x08 on every one.
  let caughtSwap = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenFieldSwap).length > 0) caughtSwap++;
  }
  assert.equal(
    caughtSwap, caps.length,
    `the field-swap twin escaped on ${caps.length - caughtSwap}/${caps.length} real dispatches — the gate is worthless`,
  );

  // Also confirm it on the distinct-byte craft (byte2=0x33, byte3=0x44).
  const pat = caps[0].clone();
  for (let i = 0; i < 6; i++) pat.mem.write8(0x6100 + i, [0x11, 0x22, 0x33, 0x44, 0x55, 0x66][i]);
  pat.regs.hl = 0x6100; pat.regs.sp = 0x6bfe;
  assert.ok(contractDiffs(pat, brokenFieldSwap).length > 0, "field-swap twin escaped on the distinct-byte craft");

  // (b) wrong-tag: caught on every case (0x01 != 0x00 at +0x00).
  let caughtTag = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenWrongTag).length > 0) caughtTag++;
  }
  assert.equal(
    caughtTag, caps.length,
    `the wrong-tag twin escaped on ${caps.length - caughtTag}/${caps.length} real dispatches — the gate is worthless`,
  );

  console.log(
    `  TEETH: field-swap caught on all ${caps.length} real dispatches + the craft ` +
      `(e.g. ${contractDiffs(caps[0], brokenFieldSwap)[0]}); wrong-tag caught on all ${caps.length} ` +
      `(e.g. ${contractDiffs(caps[0], brokenWrongTag)[0]})`,
  );
});
