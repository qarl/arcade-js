// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0030 — memory-equivalent to the frozen oracle at ROM 0x0030.
 *
 * ★ READ THIS FIRST: THIS ENTRY'S ARGUMENT IS ON THE STACK, and the rewrite therefore contains the
 *   one stack read in its batch. The transfer that reaches 0x0030 is one byte and leaves the
 *   address of the caller's inline table where a return address would go; taking it is the entry's
 *   whole purpose, and there is no other channel it could arrive by. Two consequences this gate is
 *   built to pin:
 *     - THE POP IS LOAD-BEARING AND MEASURED, though NOT in the way a reader would guess. One arm
 *       removes it and shows what actually changes: the selected arm is the SAME, and what goes
 *       wrong is that the slot is never spent, so the stack pointer ends two bytes low every
 *       dispatch. That is why the comparison watches the stack pointer and not just the jump.
 *     - THE COUPLING IS TO A STILL-FROZEN CALLER. Every caller of this entry that has already been
 *       decompiled dissolved the dispatch into its own body instead of calling here, so the
 *       rewrite runs only underneath callers that still push. One arm asserts that, by resolving
 *       the registry and checking no idiomatic module transfers to this address.
 *
 * GATE: unit-capture over a real corpus with a four-byte scratch exclusion, in two forms — a
 *   TRANSFER form that stops at the jump and compares where it goes, and a FULL form that lets the
 *   arm run — plus an exhaustive crafted sweep of the index.
 *
 * What it exercises, holes stated:
 *   1. TRANSFER FORM — at every top-level dispatch of two tapes, both sides run against a routine
 *      map that records the transfer instead of taking it, and the arm address, the registers at
 *      the jump and the stack pointer are compared. This is the contract this entry actually has.
 *   2. FULL FORM — the first sixty top-level dispatches with the arms really running, so the
 *      transfer is shown equivalent end to end and not merely at the jump. Bounded because each
 *      comparison runs a whole arm twice; the transfer form carries the rest.
 *   3. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, pinned to [SP-2, SP+2) around the ENTRY stack
 *      pointer. Two of those bytes are the slot this entry pops, which is dead the moment it is
 *      taken; the other two are the frozen path's own bracketing push. Every arm walks the whole
 *      dump and asserts nothing escapes it.
 *   4. REGISTERS ARE COMPARED, NOT EXCLUDED, at the moment of the jump — the arm reads them.
 *   5. EXHAUSTIVE — all 256 indices at a captured entry, which is the only coverage of the
 *      doubling that wraps at eight bits and folds a large index back onto the head of the table.
 *   6. THE POP, MEASURED — the arm described above.
 *   7. TEETH — six twins, each asserted caught on an exact count of the crafted indices.
 *
 * HOLE: pc is excluded. The frozen path steps it to the arm before transferring and the rewrite
 * does not, which is the ordinary memory-equivalence drop.
 *
 * HOLE: the FULL form is bounded at sixty dispatches, so end-to-end agreement is shown for the
 * arms those dispatches select and no others. The transfer form covers every dispatch, but it
 * stops at the jump by construction.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0030.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_0030 } from "../loc_0030.js";
import { loc_0030 as oracle } from "../../translated/loc_0030.js";
import { fetchTableWord } from "../fetchTableWord.js";
import { u16, u8 } from "../../../../core/int.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildRoutines } from "../../routines.js";
import { ROUTINES } from "../names.js";

const TARGET = 0x0030;

/** The two page-zero helpers the frozen path leans on; the recorder must let them through. */
const PASS_THROUGH = [0x0010, 0x0018];

/** [SP-2, SP+2) around the entry stack pointer: the popped slot, and the frozen bracketing push. */
const SCRATCH_BELOW = 2;
const SCRATCH_ABOVE = 2;

const FULL_FORM_LIMIT = 60;

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const TAPES = [
  ["attract", { tape: [] }],
  ["coin-start", {}],
];

/** Top-level dispatches each tape produces in the entry budget. Measured; a move is a finding. */
const DISPATCHES = { attract: 4283, "coin-start": 4451 };

function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BELOW && addr < sp + SCRATCH_ABOVE;
}

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/**
 * A routine map that RECORDS the first transfer instead of taking it, letting only the two
 * page-zero helpers through. `m.call` asks it for a function by address, which is all it needs.
 */
function recorder(real) {
  const seen = { addr: null, regs: null, sp: null };
  const map = {
    get(addr) {
      if (PASS_THROUGH.includes(addr)) return real.get(addr);
      return (mm) => {
        if (seen.addr !== null) return undefined;
        seen.addr = addr;
        seen.sp = mm.regs.sp;
        seen.regs = Object.fromEntries(REG_FIELDS.map((k) => [k, mm.regs[k]]));
        return undefined;
      };
    },
  };
  return { map, seen };
}

/** Where the transfer goes, and in what state, without taking it. */
function transferDiff(candidate, machine, real) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  const ra = recorder(real);
  const rb = recorder(real);
  a.routines = ra.map;
  b.routines = rb.map;
  oracle(a);
  candidate(b);

  if (ra.seen.addr !== rb.seen.addr) {
    return { addr: null, a: hex4(ra.seen.addr ?? 0), b: hex4(rb.seen.addr ?? 0) };
  }
  if (ra.seen.addr === null) return { addr: null, a: "no transfer", b: "no transfer" };
  for (const k of REG_FIELDS) {
    if (k === "f") continue; // the flag byte is dropped, like everywhere in this layer
    if (ra.seen.regs[k] !== rb.seen.regs[k]) {
      return { addr: null, a: `${k}=${ra.seen.regs[k]}`, b: `${k}=${rb.seen.regs[k]}` };
    }
  }
  if (ra.seen.sp !== rb.seen.sp) return { addr: null, a: hex4(ra.seen.sp), b: hex4(rb.seen.sp) };
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

/** The whole thing, arm included. */
function fullDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.sp !== b.regs.sp) return { addr: null, a: hex4(a.regs.sp), b: hex4(b.regs.sp) };
  return null;
}

// ── replaying a session ─────────────────────────────────────────────────────────────────────

let entry = null;

/**
 * Replay a tape, comparing at every TOP-LEVEL dispatch. The guard is not cosmetic: a compared
 * clone runs its own arm, that arm reaches this address again, and the clone's routine map is the
 * host's — so without the guard the comparisons nest and the dispatch count is not the game's.
 */
function replaySession(opts, candidate, { form = transferDiff, limit = Infinity } = {}) {
  const real = buildRoutines();
  const original = real.get(TARGET);
  let depth = 0;
  let dispatches = 0;
  let compared = 0;
  let caught = 0;
  const tables = new Set();
  const indices = new Set();
  const arms = new Set();
  const overrides = new Map([[TARGET, (mm, ...args) => {
    if (depth === 0) {
      dispatches++;
      if (entry === null) entry = mm.clone();
      if (compared < limit) {
        depth++;
        try {
          tables.add(mm.mem16[mm.regs.sp]);
          indices.add(mm.regs.a);
          arms.add(mm.mem16[mm.mem16[mm.regs.sp] + 2 * u8(mm.regs.a + mm.regs.a)]);
          if (form(candidate, mm, real)) caught++;
          compared++;
        } finally {
          depth--;
        }
      }
    }
    return original(mm, ...args);
  }]]);
  const m = makeMachine(overrides, opts);
  const frames = m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "session ran short");
  return { dispatches, compared, caught, tables, indices, arms };
}

let cache = null;
function sessions() {
  if (!cache) cache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, loc_0030) }));
  return cache;
}

function entryState() {
  if (entry === null) sessions();
  assert.notEqual(entry, null, "vacuous: neither tape reached the routine");
  return entry;
}

/** A real captured machine with the index forced; the table address stays the caller's. */
function craft(index) {
  const m = entryState().clone();
  m.regs.a = index;
  return m;
}

const INDICES = Array.from({ length: 256 }, (_unused, i) => i);

function sweepCaught(candidate) {
  const real = buildRoutines();
  return INDICES.filter((i) => transferDiff(candidate, craft(i), real)).length;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("TRANSFER FORM: every top-level dispatch of two tapes jumps to the same place", { skip: SKIP }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} tape never reached the routine`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.compared, s.dispatches, "a dispatch went uncompared");
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  const tables = new Set(sessions().flatMap((s) => [...s.tables]));
  const indices = new Set(sessions().flatMap((s) => [...s.indices]));
  const arms = new Set(sessions().flatMap((s) => [...s.arms]));
  assert.ok(tables.size > 1, "only one caller reaches this entry, so the table address is fixed");
  console.log(
    `  TRANSFER: ${total} dispatches over two tapes; ${tables.size} table addresses ` +
      `(${[...tables].map(hex4).join(" ")}), ${indices.size} indices, ${arms.size} distinct arms`,
  );
});

test("FULL FORM: the first sixty dispatches agree with the arms really running", { skip: SKIP }, () => {
  let compared = 0;
  for (const [label, opts] of TAPES) {
    const r = replaySession(opts, loc_0030, { form: fullDiff, limit: FULL_FORM_LIMIT });
    assert.equal(r.compared, FULL_FORM_LIMIT, `the ${label} tape produced too few dispatches to compare`);
    assert.equal(r.caught, 0, `the rewrite diverged on ${r.caught} ${label} full-form dispatches`);
    compared += r.compared;
  }
  console.log(`  FULL FORM: ${compared} dispatches with the arms executed, identical on each`);
});

test("THE POP IS LOAD-BEARING, and what it is load-bearing FOR is the stack pointer", { skip: SKIP }, () => {
  const e = entryState();
  const real = buildRoutines();
  const a = e.clone();
  const b = e.clone();
  const ra = recorder(real);
  const rb = recorder(real);
  a.routines = ra.map;
  b.routines = rb.map;
  oracle(a);
  brokenNoPop(b);

  // READING THE SLOT WITHOUT TAKING IT PICKS THE SAME ARM. That is the point of this arm: the
  // difference the pop makes is not WHERE the jump goes, it is that the slot is spent — so an eye
  // on the arm address alone would pass a rewrite that leaks two bytes of stack per dispatch, and
  // the comparison has to watch the stack pointer to see it. It does, and it catches this twin on
  // every crafted index below.
  assert.equal(ra.seen.addr, rb.seen.addr, "reading the slot without taking it now picks a " +
    "different arm, so this arm's account of what the pop does has to be re-derived");
  assert.equal(a.regs.sp - b.regs.sp, 2, "dropping the pop must leave the stack pointer two low");
  assert.notEqual(transferDiff(brokenNoPop, e, real), null, "the comparison missed the leak");
  console.log(
    `  POP: both pick ${hex4(ra.seen.addr)}; with the pop the stack pointer ends ${hex4(a.regs.sp)}, ` +
      `without it ${hex4(b.regs.sp)} — two bytes leaked per dispatch, and it is caught`,
  );
});

test("THE COUPLING IS TO FROZEN CALLERS ONLY: no idiomatic module transfers here", { skip: SKIP }, () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const layer = join(here, "..");
  const modules = readdirSync(layer).filter((f) => f.endsWith(".js") && f !== "names.js");
  assert.ok(modules.length > 1, "vacuous: the idiomatic layer scanned empty");

  const offenders = modules.filter(
    (f) => f !== "loc_0030.js" && /0x0030|0x30\s*\)/.test(readFileSync(join(layer, f), "utf8")),
  );
  assert.deepEqual(
    offenders,
    [],
    "an idiomatic module now names this address, so the pop can meet a caller that did not push",
  );
  assert.ok(Object.keys(ROUTINES).length > 0, "vacuous: the registry resolved empty");
  console.log(
    `  COUPLING: ${modules.length} idiomatic modules scanned, none transfers here; every ` +
      "already-decompiled caller inlines the dispatch, so the pop only ever meets a frozen push",
  );
});

test("EXHAUSTIVE: all 256 indices, where the doubling wraps at eight bits", { skip: SKIP }, () => {
  assert.equal(sweepCaught(loc_0030), 0, "the rewrite diverged somewhere in the index sweep");

  // THE WRAP IS REAL: index 128 doubles to zero, so it selects the head of the table.
  const real = buildRoutines();
  const low = craft(0);
  const high = craft(128);
  const rl = recorder(real);
  const rh = recorder(real);
  low.routines = rl.map;
  high.routines = rh.map;
  loc_0030(low);
  loc_0030(high);
  assert.equal(rh.seen.addr, rl.seen.addr, "index 128 no longer folds onto the head of the table");
  console.log(`  EXHAUSTIVE: 256 indices identical; 128 folds onto 0 at ${hex4(rl.seen.addr)}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: reads the table address without consuming it, which is the whole of what the entry does. */
function brokenNoPop(m) {
  const { regs } = m;
  regs.hl = m.mem16[regs.sp];
  const arm = fetchTableWord(m);
  regs.de = regs.hl;
  regs.hl = arm;
  return m.call(arm);
}

/** The rewrite's own shape with the index arithmetic spelled out, so a twin can change only that. */
function stamp(m, offset) {
  const { regs } = m;
  regs.hl = m.pop16();
  const entryAddress = u16(regs.hl + offset(regs.a));
  regs.a = u8(entryAddress);
  const arm = m.mem16[entryAddress];
  regs.de = u16(entryAddress + 2);
  regs.hl = arm;
  return m.call(arm);
}

/** BUG: indexes the table by bytes rather than by two-byte entries. */
function brokenSingleWidth(m) {
  return stamp(m, (index) => index);
}

/** BUG: the doubling is allowed to carry past eight bits, so a large index runs off the table. */
function brokenWideIndex(m) {
  return stamp(m, (index) => 2 * index);
}

/** BUG: leaves the address pairs the arm reads holding the wrong way round. */
function brokenSwapsPairs(m) {
  const { regs } = m;
  regs.hl = m.pop16();
  const arm = fetchTableWord(m);
  regs.hl = regs.hl;
  regs.de = arm;
  return m.call(arm);
}

/** BUG: takes the entry one slot along, so every index selects its neighbour. */
function brokenOffByOneEntry(m) {
  const { regs } = m;
  regs.hl = m.pop16() + 2;
  const arm = fetchTableWord(m);
  regs.de = regs.hl;
  regs.hl = arm;
  return m.call(arm);
}

/**
 * Per twin: how many of the 256 crafted indices catch it. Measured and asserted as equalities.
 * `single-width` and `wide-index` fall short of the whole sweep, and the shortfalls are
 * arithmetic rather than luck: `single-width` agrees at index 0, where doubling changes nothing,
 * and `wide-index` agrees on every index whose doubling does not carry, which is the lower half.
 * Both are written through the same body as the rewrite with only the index arithmetic changed,
 * so they are not caught by some unrelated register they forgot to touch.
 */
const TWINS = [
  ["no-op", brokenNoOp, 256],
  ["no-pop", brokenNoPop, 256],
  ["single-width", brokenSingleWidth, 255],
  ["wide-index", brokenWideIndex, 128],
  ["swaps-pairs", brokenSwapsPairs, 256],
  ["off-by-one-entry", brokenOffByOneEntry, 256],
];


for (const [label, twin, caught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted indices`, { skip: SKIP }, () => {
    assert.equal(sweepCaught(twin), caught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${INDICES.length} crafted indices`);
  });
}
