// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stepBarrelAlongReleasePath (ROM 0x2D54) — the string renderer's per-character body:
 * emit one 4-byte sprite record for the next character (with the attribute-bit handling on
 * the record's +1 field), or, on the 0x7F terminator, hand off to activateReleasedBarrel to close the
 * object out. Advances the source cursor (RENDER_STR_PTR) by two bytes per character.
 *
 * stepBarrelAlongReleasePath WRITES MEMORY, so it is gated on memory-equivalence, not a returned scalar, and
 * every case runs on FRESH clones. The contract is RAM (minus the stack scratch below the entry SP) + pc + SP —
 * the routine's live-out is memory-only (a per-frame render call; the caller reads none of
 * the residual registers). The oracle ends on ONE terminal `ret` that pops the caller's
 * return; the idiomatic routine models that as a JS return, so the harness performs one
 * m.ret() on the candidate AFTER the call to line pc + SP up.
 *
 * On the EMIT path the oracle touches no stack at all. On the TERMINATOR path it tail-jumps
 * (`jp z,0x2d8c`) into activateReleasedBarrel, whose two dissolved internal call brackets (`call 0x004E`
 * and `rst 0x38`) push their return addresses into the dead STACK_SCRATCH region; the
 * idiomatic routine calls activateReleasedBarrel directly and touches no stack, so those bytes differ and
 * are excluded by the memory-equivalence contract.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x2D54 in a real attract run and clone the
 *      machine at each true dispatch. Each captured entry: run the ORACLE on one clone and
 *      stepBarrelAlongReleasePath on another, confirm identical RAM (minus the stack scratch below the entry SP) + pc + SP. Both the
 *      emit and terminator paths occur naturally.
 *
 *   2. EQUAL (crafted) — build entries from a real attract base with RAM source/object/
 *      destination pointers, and force: the terminator hand-off, an attribute-bit-CLEAR
 *      character (no +1 flip), and an attribute-bit-SET character (+1 flipped and written
 *      back to +7), with distinctive source bytes so every record field is observable.
 *
 *   3. TEETH — two broken twins on the emit path, each MUST be caught:
 *      (a) dropped attribute flip — writes the un-flipped +7 field; caught at record +1.
 *      (b) unstripped character — writes the raw character (attribute bit intact) at +0;
 *          caught at record +0.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2d54.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d54 as oracle } from "../../translated/loc_2d54.js";
import { stepBarrelAlongReleasePath } from "../stepBarrelAlongReleasePath.js";
import { activateReleasedBarrel } from "../activateReleasedBarrel.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, RENDER_STR_PTR, RENDER_OBJ_PTR, RENDER_DST_PTR } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2d54;
const TERMINATOR = 0x7f;
const RET_ADDR = 0x2d1a; // a plausible caller-return site (any valid ROM addr; both sides pop it)

// Crafted-entry RAM layout: source string, object record, and destination slot, all placed
// in writable work RAM clear of the named renderer pointers / STACK_SCRATCH / sprite block.
const SRC = 0x6100; // regs.hl -> source char at SRC, data byte at SRC+1
const OBJ = 0x6120; // RENDER_OBJ_PTR value -> object record (+7/+8 read; +0..+14 on terminator)
const DST = 0x6a80; // RENDER_DST_PTR value -> destination sprite record (+0..+3 written)

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs, skipping the stack scratch below the entry SP. */
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
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

// -- capture ------------------------------------------------------------------

/** Hook 0x2D54 in a real attract run and clone the machine at up to K real dispatches. */
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

// A real, self-consistent machine, cloned so the frame machinery is neutralised
// (nextNmi/nextBoundary = Infinity) — the crafted entries are seeded from it.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone();
}

/**
 * Stamp a crafted 0x2D54 dispatch onto a clone of the base: a stack with a plausible
 * caller return, the three renderer pointers, and the source/object bytes the routine reads.
 */
function craft(base, { ch, dataByte = 0x00, field7 = 0x00, field8 = 0x00 }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.hl = SRC;
  m.mem.write16(RENDER_OBJ_PTR, OBJ);
  m.mem.write16(RENDER_DST_PTR, DST);
  m.mem.write16(RENDER_STR_PTR, SRC); // realistic: cursor mirrors regs.hl
  m.mem.write8(SRC, ch);
  m.mem.write8(SRC + 1, dataByte);
  m.mem.write8(OBJ + 0x07, field7);
  m.mem.write8(OBJ + 0x08, field8);
  return m;
}

// -- broken twins (emit path) -------------------------------------------------

/** Twin (a): drops the attribute-bit flip — writes the raw +7 field to +1 and +7. */
function brokenNoFlip(m) {
  const { regs, mem } = m;
  const src = regs.hl;
  const objPtr = mem.read16(RENDER_OBJ_PTR);
  const dstPtr = mem.read16(RENDER_DST_PTR);
  const ch = mem.read8(src);
  if (ch === TERMINATOR) { regs.ix = objPtr; regs.de = dstPtr; return activateReleasedBarrel(m); }
  mem.write8(dstPtr, ch & 0x7f);
  const field = mem.read8(objPtr + 0x07); // BUG: no xor 0x03 on the attribute bit
  mem.write8(dstPtr + 1, field);
  mem.write8(objPtr + 0x07, field);
  mem.write8(dstPtr + 2, mem.read8(objPtr + 0x08));
  mem.write8(dstPtr + 3, mem.read8(src + 1));
  mem.write16(RENDER_STR_PTR, src + 2);
}

/** Twin (b): leaves the attribute bit in the +0 character (no `& 0x7f`). */
function brokenNoStrip(m) {
  const { regs, mem } = m;
  const src = regs.hl;
  const objPtr = mem.read16(RENDER_OBJ_PTR);
  const dstPtr = mem.read16(RENDER_DST_PTR);
  const ch = mem.read8(src);
  if (ch === TERMINATOR) { regs.ix = objPtr; regs.de = dstPtr; return activateReleasedBarrel(m); }
  mem.write8(dstPtr, ch); // BUG: attribute bit not stripped
  let field = mem.read8(objPtr + 0x07);
  if ((ch & 0x80) !== 0) field ^= 0x03;
  mem.write8(dstPtr + 1, field);
  mem.write8(objPtr + 0x07, field);
  mem.write8(dstPtr + 2, mem.read8(objPtr + 0x08));
  mem.write8(dstPtr + 3, mem.read8(src + 1));
  mem.write16(RENDER_STR_PTR, src + 2);
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2D54 is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.ok(count > 0, "0x2D54 should be dispatched — the string renderer calls it per character");
  console.log(`  REACHABILITY: ${count} natural 0x2D54 dispatches in 3000 frames`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): stepBarrelAlongReleasePath == oracle on every captured 0x2D54 entry", () => {
  const caps = captureDispatches(64, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2D54 dispatch during attract");
  let emit = 0, term = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, stepBarrelAlongReleasePath); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    if (cap.mem.read8(cap.regs.hl) === TERMINATOR) term++; else emit++;
  }
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical to the oracle ` +
      `(${emit} emit-a-record, ${term} terminator)`,
  );
});

// -- 2. EQUAL (crafted: terminator + both attribute arms) ---------------------

test("EQUAL (crafted): the terminator and both attribute-bit arms match the oracle", () => {
  const base = attractBase();

  const cases = [
    { name: "terminator hand-off (0x7F)", opts: { ch: 0x7f }, term: true },
    { name: "attribute-bit CLEAR (no +1 flip)", opts: { ch: 0x41, dataByte: 0x9a, field7: 0x50, field8: 0x60 }, term: false },
    { name: "attribute-bit SET (+1 flipped, +7 written back)", opts: { ch: 0xc1, dataByte: 0xa5, field7: 0x50, field8: 0x60 }, term: false },
    { name: "attribute-bit SET, distinctive bytes", opts: { ch: 0xff & 0xfe, dataByte: 0xff, field7: 0x01, field8: 0x77 }, term: false },
  ];

  for (const { name, opts, term } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, stepBarrelAlongReleasePath);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    if (term) {
      // The terminator hand-off ran activateReleasedBarrel: it rewinds RENDER_STR_PTR to the string start.
      assert.equal(after.mem.read16(RENDER_STR_PTR), 0x39c3, `${name}: terminator did not reach activateReleasedBarrel`);
    } else {
      // The emit body ran: the 4-byte record and the advanced cursor are observable.
      const expectField = ((opts.ch & 0x80) !== 0) ? (opts.field7 ^ 0x03) : opts.field7;
      assert.equal(after.mem.read8(DST + 0), opts.ch & 0x7f, `${name}: +0 stripped char`);
      assert.equal(after.mem.read8(DST + 1), expectField, `${name}: +1 attribute field`);
      assert.equal(after.mem.read8(OBJ + 0x07), expectField, `${name}: +7 write-back`);
      assert.equal(after.mem.read8(DST + 2), opts.field8, `${name}: +2 object field`);
      assert.equal(after.mem.read8(DST + 3), opts.dataByte, `${name}: +3 source data byte`);
      assert.equal(after.mem.read16(RENDER_STR_PTR), (SRC + 2) & 0xffff, `${name}: cursor advanced by two`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (terminator, both attribute arms, distinctive bytes) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the dropped-attribute-flip twin and the unstripped-character twin are CAUGHT", () => {
  const base = attractBase();
  // An attribute-bit-SET character makes both bugs manifest.
  const entry = craft(base, { ch: 0xc1, dataByte: 0xa5, field7: 0x50, field8: 0x60 });

  // (a) dropped flip — corrupts both the +7 write-back and record +1; the address-ordered
  // scan reports the lower one (the +7 write-back) first.
  const flipDiffs = contractDiffs(entry, brokenNoFlip);
  assert.ok(flipDiffs.length > 0, "the dropped-attribute-flip twin escaped — the gate is worthless");
  const flipAt = [`RAM@0x${(OBJ + 0x07).toString(16)}`, `RAM@0x${(DST + 1).toString(16)}`];
  assert.ok(
    flipAt.some((p) => flipDiffs[0].startsWith(p)),
    `expected the dropped-flip diff at the +7 write-back (0x${(OBJ + 0x07).toString(16)}) or record +1 ` +
      `(0x${(DST + 1).toString(16)}), got ${flipDiffs[0]}`,
  );

  // (b) unstripped character — caught at record +0.
  const stripDiffs = contractDiffs(entry, brokenNoStrip);
  assert.ok(stripDiffs.length > 0, "the unstripped-character twin escaped — the gate is worthless");
  assert.ok(
    stripDiffs[0].startsWith(`RAM@0x${(DST + 0).toString(16)}`),
    `expected the unstripped-char diff at record +0 (0x${(DST + 0).toString(16)}), got ${stripDiffs[0]}`,
  );

  console.log(`  TEETH: dropped-attribute-flip caught (${flipDiffs[0]}); unstripped-character caught (${stripDiffs[0]})`);
});
