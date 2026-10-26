// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for stampFixedTilePair (ROM 0x3F24) — the fixed two-tile stamp.
 *
 * sub_3f24 WRITES memory (two video-RAM tilemap cells) but takes NO INPUTS: it
 * loads HL/DE from literals and always writes 0x9F to 0x74AF and 0x9E to 0x748F,
 * with no branches. So it is a CONSTANT action, gated by capture / clone / replay
 * (docs/decompiler-pipeline) plus crafts that prove the constancy — NOT the exhaustive-leaf pattern:
 *
 *   1. EQUAL (real captured dispatches) — hook 0x3F24 in a real attract run and
 *      clone the machine at each true dispatch (loc_07cb's countdown repaint calls
 *      it via m.call; the construction-time override catches that). A FRESH clone
 *      per case (the routine mutates RAM). For each, run the ORACLE on one clone
 *      and stampFixedTilePair on another and confirm they leave IDENTICAL RAM
 *      everywhere game-visible. This routine pushes nothing, so — unlike a
 *      push/pop leaf — there is not even stack-scratch residue: the dumps match to
 *      the byte. Also confirm (a) the oracle touches ONLY 0x74AF/0x748F, which is
 *      what licenses the memory-only LIVE-OUT, and (b) the idiomatic form leaves
 *      SP and pc unchanged (the dropped `ret` model).
 *
 *   2. EQUAL (input-independence crafts) — the routine ignores all state, so it is
 *      proven so: take a real captured entry and, IDENTICALLY on both sides, poke
 *      the target cells to junk (0x00/0xFF), scramble the registers HL/DE/A/B/C the
 *      oracle's assembly touches, and dirty unrelated RAM. Oracle vs idiomatic must
 *      still match game-visible RAM, and the two cells must always end 0x9F/0x9E —
 *      catching any accidental dependence on register or memory state.
 *
 *   3. TEETH — a deliberately-broken twin that writes the second cell 0x20 ABOVE
 *      instead of below (0x74CF, a plausible `hl += 0x20` sign flip — the exact trap
 *      the oracle header warns about) MUST be caught by the captured sweep, naming
 *      the diverging tilemap cell. A gate a wrong target address slips through is
 *      worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3f24.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3f24 as oracle } from "../../translated/loc_3f24.js";
import { stampFixedTilePair } from "../stampFixedTilePair.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3f24;
const CELL_TOP = 0x74af; // <- 0x9F
const CELL_BOT = 0x748f; // <- 0x9E (0x74AF - 0x20)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus a count of any (tolerated)
 * differences inside the dead stack scratch. This routine pushes nothing, so a
 * correct rewrite yields stackDiffs === 0 too.
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** The set of game-visible addresses whose byte changed running `fn` on a clone. */
function changedAddrs(entry, fn) {
  const m = entry.clone();
  const before = m.dumpState();
  const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
  fn(m);
  const after = m.dumpState();
  const out = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const addr = m.stateOffsetToAddr(i);
    if (!dead(addr)) out.push(addr);
  }
  return out;
}

/**
 * Hook 0x3F24 in a real attract run and clone the machine at up to K true
 * dispatches. loc_07cb reaches it via m.call, so the override is installed at
 * CONSTRUCTION (which wires the routine registry m.call resolves through).
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

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): stampFixedTilePair == oracle on every real attract dispatch", () => {
  const caps = captureDispatches(64, 4500);
  assert.ok(caps.length >= 1, "expected at least one real 0x3F24 dispatch during attract");

  for (const entry of caps) {
    const a = entry.clone(); // oracle
    const b = entry.clone(); // idiomatic
    oracle(a);
    stampFixedTilePair(b);

    const { bad, stackDiffs } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    // The routine pushes nothing: no stack residue should exist either.
    assert.equal(stackDiffs, 0, "unexpected stack-scratch difference — this routine writes no stack");

    // LIVE-OUT justification: the oracle mutates ONLY the two tilemap cells.
    const touched = changedAddrs(entry, oracle).sort((x, y) => x - y);
    for (const addr of touched) {
      assert.ok(
        addr === CELL_TOP || addr === CELL_BOT,
        `oracle wrote an unexpected cell ${hx(addr)} — LIVE-OUT is not just the two tiles`,
      );
    }

    // No stack modelling: idiomatic leaves SP and pc exactly as it found them.
    const c = entry.clone();
    const sp0 = c.regs.sp, pc0 = c.pc;
    stampFixedTilePair(c);
    assert.equal(c.regs.sp, sp0, "stampFixedTilePair must leave SP unchanged (no stack modelling)");
    assert.equal(c.pc, pc0, "stampFixedTilePair must leave pc unchanged (no ret modelling)");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches — RAM byte-identical to the oracle`);
});

// -- 2. EQUAL (input-independence crafts) -------------------------------------

test("EQUAL (crafts): oracle and idiomatic agree regardless of cell/register/RAM state", () => {
  const caps = captureDispatches(1, 4500);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  // Each craft pokes state IDENTICALLY on both sides; a real state with a surgical
  // nudge (docs/decompiler-pipeline), aimed at anything the routine might wrongly read.
  const crafts = [
    ["junk-cells", (m) => { m.mem.write8(CELL_TOP, 0x00); m.mem.write8(CELL_BOT, 0xff); m.mem.write8(0x74cf, 0x55); }],
    ["prefilled", (m) => { m.mem.write8(CELL_TOP, 0x9f); m.mem.write8(CELL_BOT, 0x9e); }],
    ["scrambled-regs", (m) => { m.regs.hl = 0x1234; m.regs.de = 0x5678; m.regs.a = 0xa5; m.regs.b = 0x3c; m.regs.c = 0xd7; }],
    ["dirty-ram", (m) => { m.mem.write8(0x6010, 0xaa); m.mem.write8(0x6205, 0x42); m.mem.write8(0x7480, 0x11); }],
  ];

  for (const [label, craft] of crafts) {
    const a = entry.clone(); const b = entry.clone();
    craft(a); craft(b);
    oracle(a);
    stampFixedTilePair(b);

    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    // The output cells are constant no matter the craft.
    assert.equal(b.mem.read8(CELL_TOP), 0x9f, `${label}: 0x74AF must be 0x9F`);
    assert.equal(b.mem.read8(CELL_BOT), 0x9e, `${label}: 0x748F must be 0x9E`);
    console.log(`  EQUAL/craft ${label}: game-visible RAM identical; cells 0x9F/0x9E`);
  }
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: writes the second tile 0x20 ABOVE the first (0x74CF) instead of
 * 0x20 below (0x748F) — the sign-flip the oracle header explicitly warns about
 * ("hl -= 0x20 gets the same address"; getting the direction wrong does not). It
 * leaves 0x748F unwritten and dirties 0x74CF, so a real dispatch diverges.
 */
function brokenStampFixedTilePair(m) {
  const { mem } = m;
  mem.write8(CELL_TOP, 0x9f);
  mem.write8(0x74cf, 0x9e); // BUG: 0x74AF + 0x20, should be 0x74AF - 0x20 = 0x748F
}

test("TEETH (captured): the wrong-direction second write is CAUGHT and names 0x748F", () => {
  const caps = captureDispatches(64, 4500);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  let caught = null;
  for (const entry of caps) {
    const a = entry.clone(); const b = entry.clone();
    oracle(a);
    brokenStampFixedTilePair(b);
    const { bad } = ramDiffMinusStack(a, b, entry.regs.sp);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a wrong-direction write — it is worthless");
  assert.equal(caught.addr, CELL_BOT, `expected the caught diff at 0x748F, got ${hx(caught.addr)}`);
  console.log(`  TEETH/captured: caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
