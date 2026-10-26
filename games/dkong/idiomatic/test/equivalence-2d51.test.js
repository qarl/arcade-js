// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2d51 (ROM 0x2D51) — the string renderer's per-character loop
 * entry: reload the source cursor from RENDER_STR_PTR (0x62A8) and fall into the
 * per-character body (stepBarrelAlongReleasePath). loc_2d51 IGNORES the register it is handed on entry and
 * always re-reads the cursor from RAM; proving that reload is the whole point of this gate.
 *
 * loc_2d51 WRITES MEMORY (through stepBarrelAlongReleasePath / activateReleasedBarrel downstream), so it is gated on
 * memory-equivalence, not a returned scalar, and every case runs on FRESH clones. The
 * contract is RAM (minus the stack scratch below the entry SP) + pc + SP — the live-out is memory-only (a
 * per-frame render call; the caller reads none of the residual registers). The oracle nets
 * ONE terminal `ret` (handed up through stepBarrelAlongReleasePath's emit-path `ret`, or activateReleasedBarrel's on the
 * terminator path); the idiomatic routine models that as a JS return, so the harness
 * performs one m.ret() on the candidate AFTER the call to line pc + SP up.
 *
 * On the EMIT path the oracle touches no stack. On the TERMINATOR path (a 0x7F source byte)
 * stepBarrelAlongReleasePath hands off to activateReleasedBarrel, whose two dissolved internal call brackets (`call 0x004E`
 * and `rst 0x38`) push their return addresses into the dead STACK_SCRATCH region; the
 * idiomatic chain calls directly and touches no stack, so those bytes differ and are
 * excluded by the memory-equivalence contract.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x2D51 in a real attract run and clone the
 *      machine at each true dispatch (advanceBarrelRelease tail-jumps here per character). Run the
 *      ORACLE on one clone and loc_2d51 on another; confirm identical RAM (minus
 *      STACK_SCRATCH) + pc + SP. Both the emit and terminator paths occur naturally.
 *
 *   2. EQUAL (crafted) — build entries from a real attract base with RENDER_STR_PTR pointed
 *      at a crafted source string but the INCOMING cursor register set to a DECOY that reads
 *      a different character, then force: the terminator hand-off, an attribute-bit-CLEAR
 *      character, and an attribute-bit-SET character. The advanced cursor lands at
 *      RENDER_STR_PTR's target + 2 (not the decoy + 2), proving the reload.
 *
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) skip-reload — uses the incoming (decoy) cursor instead of re-reading
 *          RENDER_STR_PTR; renders the wrong character.
 *      (b) wrong-pointer — reloads from RENDER_OBJ_PTR instead of RENDER_STR_PTR.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2d51.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d51 as oracle } from "../../translated/loc_2d51.js";
import { loc_2d51 } from "../loc_2d51.js";
import { stepBarrelAlongReleasePath } from "../stepBarrelAlongReleasePath.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, RENDER_STR_PTR, RENDER_OBJ_PTR, RENDER_DST_PTR } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2d51;
const TERMINATOR = 0x7f;
const RET_ADDR = 0x2d3e; // a plausible caller-return site (any valid ROM addr; both sides pop it)
const STRING_RESTART = 0x39c3; // where activateReleasedBarrel rewinds RENDER_STR_PTR on the terminator path

// Crafted-entry RAM layout, all in writable work RAM clear of the named renderer pointers,
// STACK_SCRATCH, and the sprite block.
const SRC = 0x6100; // RENDER_STR_PTR target -> source char at SRC, data byte at SRC+1
const OBJ = 0x6120; // RENDER_OBJ_PTR value -> object record (+7/+8 read; +0..+14 on terminator)
const DST = 0x6a80; // RENDER_DST_PTR value -> destination sprite record (+0..+3 written)
const DECOY = 0x6180; // the incoming cursor register points HERE (a wrong source) on entry
const DECOY_CH = 0x55; // a distinctive non-terminator char at the decoy position
const DECOY_DATA = 0xee; // its data byte
const OBJ_CH = 0x33; // a distinctive non-terminator char at OBJ+0 (read only by the wrong-pointer twin)

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

/** Run the ORACLE on a fresh clone. Its chain performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so pc + SP match the oracle's
 *  (the idiomatic chain replaces the Z80 stack with the JS call stack, so it does not touch pc/SP itself). */
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

/** Hook 0x2D51 in a real attract run and clone the machine at up to K real dispatches. */
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
 * Stamp a crafted 0x2D51 dispatch onto a clone of the base: a stack with a plausible caller
 * return, the three renderer pointers, the source/object/decoy bytes, and a DECOY incoming
 * cursor that reads a different character (so the reload from RENDER_STR_PTR is exercised).
 */
function craft(base, { ch, dataByte = 0x00, field7 = 0x00, field8 = 0x00 }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.regs.hl = DECOY; // deliberately NOT the real cursor — loc_2d51 must ignore this
  m.mem.write16(RENDER_STR_PTR, SRC); // the real cursor the reload picks up
  m.mem.write16(RENDER_OBJ_PTR, OBJ);
  m.mem.write16(RENDER_DST_PTR, DST);
  m.mem.write8(SRC, ch);
  m.mem.write8(SRC + 1, dataByte);
  m.mem.write8(OBJ, OBJ_CH); // read only by the wrong-pointer twin
  m.mem.write8(OBJ + 0x07, field7);
  m.mem.write8(OBJ + 0x08, field8);
  m.mem.write8(DECOY, DECOY_CH); // read only by the skip-reload twin
  m.mem.write8(DECOY + 1, DECOY_DATA);
  return m;
}

// -- broken twins -------------------------------------------------------------

/** Twin (a): never reloads the cursor from RAM — renders from the stale incoming register. */
function brokenSkipReload(m) {
  // BUG: missing `regs.hl = mem.read16(RENDER_STR_PTR)` — uses the decoy cursor as-is.
  return stepBarrelAlongReleasePath(m);
}

/** Twin (b): reloads the WRONG pointer (the object pointer, not the string cursor). */
function brokenWrongPointer(m) {
  const { regs, mem } = m;
  regs.hl = mem.read16(RENDER_OBJ_PTR); // BUG: should be RENDER_STR_PTR
  return stepBarrelAlongReleasePath(m);
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2D51 is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.ok(count > 0, "0x2D51 should be dispatched — the string renderer loops through it per character");
  console.log(`  REACHABILITY: ${count} natural 0x2D51 dispatches in 3000 frames`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_2d51 == oracle on every captured 0x2D51 entry", () => {
  const caps = captureDispatches(64, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2D51 dispatch during attract");
  let emit = 0, term = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_2d51); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    // Classify by the character the RELOADED cursor points at (what the routine renders).
    const cursor = cap.mem.read16(RENDER_STR_PTR);
    if (cap.mem.read8(cursor) === TERMINATOR) term++; else emit++;
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
  ];

  for (const { name, opts, term } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_2d51);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    const after = runOracle(entry);
    if (term) {
      // The terminator hand-off ran activateReleasedBarrel: it rewinds RENDER_STR_PTR to the string start.
      assert.equal(after.mem.read16(RENDER_STR_PTR), STRING_RESTART, `${name}: terminator did not reach activateReleasedBarrel`);
    } else {
      // The emit body ran on the RELOADED cursor: the record and the advanced cursor prove
      // the source was SRC (from RENDER_STR_PTR), not the decoy the register held on entry.
      const expectField = ((opts.ch & 0x80) !== 0) ? (opts.field7 ^ 0x03) : opts.field7;
      assert.equal(after.mem.read8(DST + 0), opts.ch & 0x7f, `${name}: +0 stripped char (reload used SRC)`);
      assert.equal(after.mem.read8(DST + 1), expectField, `${name}: +1 attribute field`);
      assert.equal(after.mem.read8(DST + 2), opts.field8, `${name}: +2 object field`);
      assert.equal(after.mem.read8(DST + 3), opts.dataByte, `${name}: +3 source data byte`);
      assert.equal(after.mem.read16(RENDER_STR_PTR), (SRC + 2) & 0xffff, `${name}: cursor advanced from SRC, not the decoy`);
    }
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (terminator, both attribute arms) identical; reload proven via the advanced cursor`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the skip-reload twin and the wrong-pointer twin are CAUGHT", () => {
  const base = attractBase();
  // An attribute-bit-SET character on the emit path; the decoy points at a different char.
  const entry = craft(base, { ch: 0xc1, dataByte: 0xa5, field7: 0x50, field8: 0x60 });

  // (a) skip-reload — renders the decoy char instead of SRC's, so the record and the advanced cursor diverge.
  const skipDiffs = contractDiffs(entry, brokenSkipReload);
  assert.ok(skipDiffs.length > 0, "the skip-reload twin escaped — the gate is worthless");

  // (b) wrong-pointer — reloads from RENDER_OBJ_PTR, rendering OBJ+0's char instead.
  const wrongDiffs = contractDiffs(entry, brokenWrongPointer);
  assert.ok(wrongDiffs.length > 0, "the wrong-pointer twin escaped — the gate is worthless");

  console.log(`  TEETH: skip-reload caught (${skipDiffs[0]}); wrong-pointer caught (${wrongDiffs[0]})`);
});
