// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2d83 (ROM 0x2D83) — aim the string renderer at the fixed
 * source string at 0x39CC (stamp RENDER_STR_PTR and hand the cursor to the per-character
 * body in the cursor register), then tail into stepBarrelAlongReleasePath to emit the first character's
 * 4-byte record.
 *
 * loc_2d83 WRITES MEMORY (via the tail into stepBarrelAlongReleasePath), so it is gated on memory-
 * equivalence, not a returned scalar, and every case runs on FRESH clones. The contract
 * is RAM (minus the stack scratch below the entry SP) + pc + SP — the live-out is memory-only.
 *
 * The oracle tail-jumps (`jp 0x2d54`, no push) into stepBarrelAlongReleasePath, which ends on ONE terminal
 * `ret` that returns on loc_2d83's behalf. The idiomatic routine calls stepBarrelAlongReleasePath directly
 * (a plain JS return), so the harness performs one m.ret() on the candidate AFTER the
 * call to line pc + SP up with the oracle — identical to the sibling equivalence-2d54.
 *
 * The 0x39CC string's first byte is 0xBB (attribute bit set, never the 0x7F terminator),
 * so loc_2d83 always drives stepBarrelAlongReleasePath's EMIT path — the terminator hand-off (activateReleasedBarrel,
 * which is what pushes into STACK_SCRATCH) is unreachable from here. On the emit path
 * neither side writes STACK_SCRATCH, so the standard STACK_SCRATCH exclusion masks nothing
 * on this routine's reachable path; it is kept for the dissolved tail-call bracket and to
 * mirror the contract.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x2D83 in a real attract run and clone the
 *      machine at each true dispatch. Run the ORACLE on one clone and loc_2d83 on another;
 *      confirm identical RAM (minus the stack scratch below the entry SP) + pc + SP.
 *
 *   2. EQUAL (crafted) — from a real attract base, place the renderer's object and
 *      destination pointers in writable RAM (loc_2d83 forces the source cursor to the ROM
 *      string itself) so the emitted 4-byte record is observable, and confirm loc_2d83 ==
 *      oracle. Also assert the record the oracle produces: the stripped character at +0,
 *      the attribute-flipped object field at +1 (written back to the object record), the
 *      object's +8 field at +2, the source data byte at +3, and RENDER_STR_PTR advanced
 *      by two.
 *
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) wrong string cursor — hands stepBarrelAlongReleasePath the string start 0x39C3 instead of 0x39CC,
 *          so a different character is rendered and RENDER_STR_PTR advances differently.
 *      (b) dropped render — does the setup writes but never tails into stepBarrelAlongReleasePath, so no
 *          record is emitted and RENDER_STR_PTR is never advanced.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2d83.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d83 as oracle } from "../../translated/loc_2d83.js";
import { loc_2d83 } from "../loc_2d83.js";
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

const TARGET = 0x2d83;
const STRING_START = 0x39cc; // the source string loc_2d83 renders (ROM)
const ADVANCED = STRING_START + 2; // where stepBarrelAlongReleasePath leaves the cursor after one emit
const RET_ADDR = 0x2d1a; // a plausible caller-return site (any valid ROM addr; both sides pop it)

// Crafted-entry RAM layout: object record and destination slot in writable work RAM, clear
// of the named renderer pointers / STACK_SCRATCH / sprite block. (The source cursor is the
// ROM string at STRING_START, so it is not crafted.)
const OBJ = 0x6120; // RENDER_OBJ_PTR value -> object record (+7/+8 read; +7 written back)
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

/** Run the ORACLE on a fresh clone. stepBarrelAlongReleasePath's terminal `ret` runs on its behalf. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model the net terminal `ret` with one m.ret() so
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

/** Set of non-stack RAM addresses where the candidate diverges from the oracle. */
function changedAddrs(entry, fn) {
  const o = runOracle(entry), c = runCandidate(entry, fn);
  const da = o.dumpState(), db = c.dumpState();
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  const out = new Set();
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = o.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.add(addr);
  }
  return out;
}

// -- capture ------------------------------------------------------------------

/** Hook 0x2D83 in a real attract run and clone the machine at up to K real dispatches. */
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
 * Stamp a crafted 0x2D83 dispatch onto a clone of the base: a stack with a plausible caller
 * return, and the renderer's object/destination pointers plus the object record's read
 * fields. (loc_2d83 supplies the source cursor itself, so it is not set here.)
 */
function craft(base, { field7 = 0x00, field8 = 0x00 }) {
  const m = base.clone();
  m.regs.sp = 0x6c00;
  m.push16(RET_ADDR);
  m.mem.write16(RENDER_OBJ_PTR, OBJ);
  m.mem.write16(RENDER_DST_PTR, DST);
  m.mem.write8(OBJ + 0x07, field7);
  m.mem.write8(OBJ + 0x08, field8);
  return m;
}

// -- broken twins -------------------------------------------------------------

/** Twin (a): hands stepBarrelAlongReleasePath the WRONG string start (0x39C3), so a different char renders. */
function brokenWrongCursor(m) {
  const { regs, mem } = m;
  regs.hl = 0x39c3; // BUG: wrong string cursor
  mem.write16(RENDER_STR_PTR, 0x39c3);
  return stepBarrelAlongReleasePath(m);
}

/** Twin (b): does the setup writes but never renders (drops the tail into stepBarrelAlongReleasePath). */
function brokenNoRender(m) {
  const { regs, mem } = m;
  regs.hl = STRING_START;
  mem.write16(RENDER_STR_PTR, STRING_START); // BUG: no stepBarrelAlongReleasePath emit, cursor never advances
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2D83 is dispatched during attract", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(3000);
  assert.ok(count > 0, "0x2D83 should be dispatched — advanceBarrelRelease branches here to start the string render");
  console.log(`  REACHABILITY: ${count} natural 0x2D83 dispatches in 3000 frames`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_2d83 == oracle on every captured 0x2D83 entry", () => {
  const caps = captureDispatches(64, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2D83 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_2d83); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    // Confirm it is genuinely the emit path (the 0x39CC string's first byte is never 0x7F).
    assert.notEqual(cap.mem.read8(STRING_START), 0x7f, "0x39CC unexpectedly the terminator");
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle`);
});

// -- 2. EQUAL (crafted, observable record) ------------------------------------

test("EQUAL (crafted): loc_2d83 == oracle and the emitted record is as expected", () => {
  const base = attractBase();
  const ch = base.mem.read8(STRING_START); // 0xBB (ROM) — attribute bit set
  const data = base.mem.read8(STRING_START + 1); // the source data byte (ROM)

  const cases = [
    { name: "field7/field8 = 0x50/0x60", opts: { field7: 0x50, field8: 0x60 } },
    { name: "field7/field8 = 0x01/0x77", opts: { field7: 0x01, field8: 0x77 } },
    { name: "field7/field8 = 0xFF/0x00", opts: { field7: 0xff, field8: 0x00 } },
  ];

  for (const { name, opts } of cases) {
    const entry = craft(base, opts);
    const diffs = contractDiffs(entry, loc_2d83);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Observe the record the oracle emitted (the char is attribute-bit-set, so +1 is flipped).
    const after = runOracle(entry);
    const expectField = ((ch & 0x80) !== 0) ? (opts.field7 ^ 0x03) : opts.field7;
    assert.equal(after.mem.read8(DST + 0), ch & 0x7f, `${name}: +0 stripped char`);
    assert.equal(after.mem.read8(DST + 1), expectField, `${name}: +1 attribute field`);
    assert.equal(after.mem.read8(OBJ + 0x07), expectField, `${name}: +7 write-back`);
    assert.equal(after.mem.read8(DST + 2), opts.field8, `${name}: +2 object field`);
    assert.equal(after.mem.read8(DST + 3), data, `${name}: +3 source data byte`);
    assert.equal(after.mem.read16(RENDER_STR_PTR), ADVANCED, `${name}: cursor advanced past the character`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms identical, emitted record observable`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-cursor twin and the dropped-render twin are CAUGHT", () => {
  const base = attractBase();
  const entry = craft(base, { field7: 0x50, field8: 0x60 });

  // (a) wrong string cursor — a different character renders and the cursor advances
  // differently. Caught, and the cursor cell (loc_2d83's own job) is among the divergences.
  const wrongDiffs = contractDiffs(entry, brokenWrongCursor);
  assert.ok(wrongDiffs.length > 0, "the wrong-cursor twin escaped — the gate is worthless");
  assert.ok(
    changedAddrs(entry, brokenWrongCursor).has(RENDER_STR_PTR),
    `expected the wrong-cursor twin to diverge at RENDER_STR_PTR (0x${RENDER_STR_PTR.toString(16)})`,
  );

  // (b) dropped render — no record emitted and RENDER_STR_PTR never advanced.
  const noRenderDiffs = contractDiffs(entry, brokenNoRender);
  assert.ok(noRenderDiffs.length > 0, "the dropped-render twin escaped — the gate is worthless");
  assert.ok(
    changedAddrs(entry, brokenNoRender).has(RENDER_STR_PTR),
    `expected the dropped-render twin to diverge at RENDER_STR_PTR (0x${RENDER_STR_PTR.toString(16)})`,
  );

  console.log(`  TEETH: wrong-cursor caught (${wrongDiffs[0]}); dropped-render caught (${noRenderDiffs[0]})`);
});
