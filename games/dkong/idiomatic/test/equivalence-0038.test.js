// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for addToSpriteObjectColumn (ROM 0x0038) — the `rst 0x38` vector
 * that fixes stride = 4 / count = 10 and falls through into addStrided (0x003d),
 * adding the delta C into one field across all ten sprite-object records.
 *
 * loc_0038 WRITES MEMORY, so it is gated on memory-equivalence, not a returned
 * scalar, and every case runs on a FRESH clone (a reused clone is only safe for a
 * read-only leaf). The contract is RAM (minus the stack scratch below the entry SP) + pc + SP + the declared
 * live-out (A/B/HL from addStrided, plus DE = 0x0004 — a genuine live-out that
 * sub_306f calls this routine for) — never the full register file, never cycles.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0038 in a real attract run and clone
 *      the machine at each true rst-0x38 dispatch. Attract's board setup drives them
 *      with HL = 0x6908/0x690b and various C (always the fixed B = 0x0A / DE = 4). For
 *      each, run the ORACLE on one clone and addToSpriteObjectColumn on another and
 *      confirm identical RAM + pc + SP + live-out.
 *
 *   2. EQUAL (crafted) — vary C over both columns (the X field 0x6908 and the Y field
 *      0x690b), an 8-bit add-wrap (target bytes poked near 0xFF), and — the point of
 *      this vector — GARBAGE incoming B/DE, to prove loc_0038 hardcodes the stride and
 *      count rather than reading them from the caller. Each compared identically on
 *      both sides.
 *
 *   3. TEETH (real + crafted) — a wrong-count twin (writes 9 records, not 10) MUST be
 *      caught: it leaves the tenth record's field unmodified and advances HL by 0x24
 *      instead of 0x28.
 *
 * The idiomatic routine models the Z80 `ret` (addStrided's shared `ret`, which serves
 * both entry points) as a JS return, so the harness performs one m.ret() on the
 * idiomatic clone AFTER the call to line pc + SP up with the oracle — the only place
 * the stack is touched.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0038.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0038 as oracle } from "../../translated/loc_0038.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { addStrided } from "../addStrided.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0038;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP — the
 * dead stack region excluded by the standard gate. loc_0038 pushes nothing of its
 * own (the caller's rst pushed the return, popped by the shared `ret`), so the
 * exclusion just follows the contract.
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

/** Run the ORACLE on a fresh clone. loc_0038 falls into sub_003d, whose `ret` runs, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc + SP
 * match the oracle's (the idiomatic routine replaces the Z80 stack with the JS call
 * stack, so it does not touch pc/SP itself — the harness supplies the single return
 * that the shared `ret` at 0x0043 performs for both entry points).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/**
 * Compare candidate vs oracle over the full contract: RAM − the stack scratch below the entry SP, pc, SP,
 * and declared live-out A/B/HL/DE. Returns a list of human-readable mismatches (empty
 * when equal), so one call proves — or disproves — equivalence on one entry.
 */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=${hx(o.regs.a)} cand=${hx(c.regs.a)}`);
  if (o.regs.b !== c.regs.b) diffs.push(`B oracle=${hx(o.regs.b)} cand=${hx(c.regs.b)}`);
  if (o.regs.hl !== c.regs.hl) diffs.push(`HL oracle=0x${o.regs.hl.toString(16)} cand=0x${c.regs.hl.toString(16)}`);
  if (o.regs.de !== c.regs.de) diffs.push(`DE oracle=0x${o.regs.de.toString(16)} cand=0x${c.regs.de.toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x0038 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game
 * proceeds undisturbed. Every rst-0x38 (m.call(0x0038)) site is captured here.
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
 * Broken twin: fixes the count to 9 records instead of 10. It leaves the tenth record's
 * field unmodified (whenever C != 0) and advances HL by 0x24 rather than 0x28 — so it
 * is caught on every real dispatch, C or no C, via the HL live-out.
 */
function brokenAddToSpriteObjectColumn(m) {
  const { regs } = m;
  regs.de = 0x0004;
  regs.b = 0x09; // BUG: should be 0x0A — one record short
  addStrided(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): addToSpriteObjectColumn == oracle on every captured 0x0038 entry", () => {
  const caps = captureDispatches(64, 1500);
  assert.ok(caps.length >= 1, "expected at least one real rst-0x38 dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, addToSpriteObjectColumn); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  // Confirm the captures really are sprite-object-block fills (HL in 0x6908–0x692F).
  const hls = new Set(caps.map((c) => c.regs.hl));
  for (const hl of hls) {
    assert.ok(
      hl >= SPRITE_OBJ_BLOCK && hl < SPRITE_OBJ_BLOCK + 0x28,
      `unexpected rst-0x38 HL 0x${hl.toString(16)} outside SPRITE_OBJ_BLOCK`,
    );
  }
  const { regs } = caps[0];
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical ` +
      `(HL set { ${[...hls].map((h) => "0x" + h.toString(16)).join(", ")} }, ` +
      `sample C=${hx(regs.c)}; B/DE fixed 0x0A/0x0004)`,
  );
});

// -- 2. EQUAL (crafted C / columns / wrap / hardcoded constants) --------------

test("EQUAL (crafted): both columns, add-wrap, and garbage B/DE all match the oracle", () => {
  const caps = captureDispatches(1, 1500);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // Each craft: real captured RAM, surgical register pokes, a safe stack pointer so the
  // oracle's `ret` pops harmless (STACK_SCRATCH, excluded) bytes. opts.poke writes
  // target bytes to exercise the 8-bit add-wrap; opts.b/opts.de force GARBAGE incoming
  // values that a correct loc_0038 must ignore (it hardcodes 0x0A / 0x0004).
  const craft = (hl, c, opts = {}) => {
    const e = seed.clone();
    e.regs.hl = hl;
    e.regs.c = c;
    e.regs.sp = 0x6bfe;
    if (opts.b !== undefined) e.regs.b = opts.b;
    if (opts.de !== undefined) e.regs.de = opts.de;
    if (opts.poke) for (const [addr, val] of opts.poke) e.mem.write8(addr, val);
    return e;
  };

  const X = 0x6908; // record field +0 — the X column
  const Y = 0x690b; // record field +3 — the Y column
  const cases = [
    { name: "X-column, C=0x44 (setup delta)", e: craft(X, 0x44) },
    { name: "Y-column, C=0xfc (−4)", e: craft(Y, 0xfc) },
    { name: "X-column, C=0x00 (RMW-writes all ten, no change)", e: craft(X, 0x00) },
    { name: "Y-column, C=0xff (−1)", e: craft(Y, 0xff) },
    {
      name: "8-bit add-wrap (records near 0xFF, C=0x05)",
      e: craft(X, 0x05, { poke: [[X, 0xfe], [X + 4, 0xff], [X + 8, 0xfd], [X + 36, 0x02]] }),
    },
    { name: "garbage incoming B=0x55/DE=0x1234 — constants hardcoded", e: craft(X, 0x10, { b: 0x55, de: 0x1234 }) },
  ];

  for (const { name, e } of cases) {
    const diffs = contractDiffs(e, addToSpriteObjectColumn);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (both columns, add-wrap, garbage B/DE) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-count twin (9 records) is CAUGHT", () => {
  const caps = captureDispatches(8, 1500);
  assert.ok(caps.length >= 1, "need a real capture (count 10) to catch the wrong-count bug");

  let caughtReal = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenAddToSpriteObjectColumn).length > 0) caughtReal++;
  }
  assert.ok(
    caughtReal === caps.length,
    `the twin escaped detection on ${caps.length - caughtReal}/${caps.length} real dispatches — the gate is worthless`,
  );

  console.log(
    `  TEETH: wrong-count twin caught on all ${caps.length} real dispatches ` +
      `(e.g. ${contractDiffs(caps[0], brokenAddToSpriteObjectColumn)[0]})`,
  );
});
