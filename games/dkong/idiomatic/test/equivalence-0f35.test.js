// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for fillColumnAndContinueWalk (ROM 0x0F35) — the board-layout
 * renderer's column-fill loop body, entered with the cursor HL and fill tile (0x63B5)
 * already staged, which fills the column then resumes the walk (sub_0da7).
 *
 * The routine WRITES memory (0x63B1 extent, the tilemap VRAM, and whatever the resumed
 * walk draws) and advances DE, so it is gated by capture / clone / replay with a FRESH
 * clone per case. It is a PHANTOM standalone entry: 0x0F35 has no manifest entry and no
 * dispatch site — it is only ever reached by fall-through / loop-back inside 0x0F1B —
 * and 0x0F1B is itself UNREACHED in attract (the 25m board's records are all kind 2,
 * routed to loc_0e4f). So every case is a CRAFTED ENTRY built on a real render-walk
 * state captured at the live sibling loc_0e4f, which shares the exact render scratch
 * (0x63AB tilemap ptr, 0x63B1 column extent, DE record ptr) this routine consumes; the
 * cursor HL and fill tile 0x63B5 are then staged exactly as 0x0F1B would, identically
 * on both sides.
 *
 * The comparison is RAM − the stack scratch below the entry SP (the dead stack region the oracle's push/call/
 * ret traffic lands in; the direct-call layer drops it) plus DE (the record-pointer
 * live-out / walk-integrity cross-check).
 *
 *   1. EQUAL (fill isolated) — DE points at a 0xAA terminator so the tail walk returns
 *      at once, isolating the fill loop + `inc de`. Every real capture × the three fill
 *      tiles (0xE0/0xB0/0xFE) × several extents (a 1-row, a 2-row, and the real
 *      multi-row capture) leave identical RAM − STACK and identical DE. Also asserts the
 *      idiomatic side leaves SP and pc untouched (the dropped stack model — loc_0da7
 *      pins SP back to entry).
 *   2. WALK-INTEGRATION — DE points one before the real 25m layout table (0x3AE4), so
 *      after the fill the tail drives a WHOLE real board draw. Identical RAM − STACK and
 *      DE to the oracle (the walk loc_0da7 is itself gated on this exact table).
 *   3. TEETH — three twins: (a) a wrong column step (0x10 not 0x08 — fewer rows), caught
 *      in the tilemap / 0x63B1; (b) a dropped `inc de`, caught by the DE compare with
 *      RAM held identical (terminator on both DE and DE+1); (c) a dropped tail walk,
 *      caught at 0x63B3 (the KIND byte the walk writes on the terminator).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0f35.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0f35 as oracle } from "../../translated/loc_0f35.js";
import { fillColumnAndContinueWalk as idiomatic } from "../fillColumnAndContinueWalk.js";
import { loc_0e4f } from "../../translated/loc_0e4f.js"; // live capture sibling (kind-2 drawer)
import { drawBoardLayout as loc_0da7 } from "../drawBoardLayout.js"; // idiomatic callee, for the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const SIBLING = 0x0e4f; // the live routine we capture real render-scratch from
const TILE_PTR = 0x63ab; // converted tilemap address (the column cursor source)
const EXTENT = 0x63b1; // column height, paid down 8 px per row
const FILL_TILE = 0x63b5; // the tile-code the fill lays
const KIND = 0x63b3; // record kind — the walk writes the terminator (0xAA) here
const TERM = 0x6100; // safe scratch the draw never writes — home for the 0xAA terminator
const REAL_TABLE = 0x3ae4; // the real 25m layout table (ROM), for the walk-integration case
const FILL_TILES = [0xe0, 0xb0, 0xfe];

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/** First game-visible RAM byte that differs (EXCLUDING the stack scratch below the entry SP), or null. */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    if (!bad) { bad = { addr, a: da[i], b: db[i] }; break; }
  }
  return bad;
}

/**
 * Stage the register/memory image 0x0F1B would hand to 0x0F35: the fill tile at 0x63B5,
 * the cursor HL, the column extent, DE (the record pointer), and any 0xAA terminators.
 * Applied IDENTICALLY on both sides (a real state with a surgical nudge).
 */
function stage(mm, cfg) {
  mm.mem.write8(FILL_TILE, cfg.tile);
  mm.regs.hl = cfg.hl & 0xffff;
  if (cfg.extent != null) mm.mem.write8(EXTENT, cfg.extent & 0xff);
  mm.regs.de = cfg.de & 0xffff;
  for (const t of cfg.terminators || []) mm.mem.write8(t, 0xaa);
}

/** Clone the entry twice, stage identically, run oracle vs candidate; return RAM diff + DE. */
function replay(entry, cfg, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  stage(a, cfg);
  stage(b, cfg);
  oracle(a);
  cand(b);
  return { bad: ramDiffMinusStack(a, b, entry.regs.sp), deOracle: a.regs.de & 0xffff, deCand: b.regs.de & 0xffff };
}

/** Hook loc_0e4f (dispatched once per kind-2 record in the 25m attract draw) and clone. */
function captureWalkStates(K, maxFrames) {
  const caps = [];
  const overrides = new Map([[SIBLING, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return loc_0e4f(mm);
  }]]);
  new Machine(ROM, { overrides }).runFrames(maxFrames);
  return caps;
}

let CAPS = null;
function realCaptures() {
  if (!CAPS) CAPS = captureWalkStates(32, 2500);
  return CAPS;
}

// -- 1. EQUAL (fill isolated) -------------------------------------------------

test("EQUAL (fill isolated): fillColumnAndContinueWalk == oracle over every capture × tile × extent", () => {
  const caps = realCaptures();
  assert.ok(caps.length >= 1, "expected at least one real loc_0e4f render-scratch state during attract");

  let cases = 0;
  for (const entry of caps) {
    const cursor = entry.mem.read16(TILE_PTR);
    const realExtent = entry.mem.read8(EXTENT);
    const extents = [0x00, 0x08, realExtent]; // 1-row, 2-row, real multi-row
    for (const tile of FILL_TILES) {
      for (const extent of extents) {
        // DE -> TERM-1 so `inc de` lands on the 0xAA terminator: the tail walk returns
        // immediately (writing only KIND=0xAA on both sides), isolating the fill.
        const cfg = { tile, hl: cursor, extent, de: (TERM - 1) & 0xffff, terminators: [TERM] };
        const { bad, deOracle, deCand } = replay(entry, cfg, idiomatic);
        cases++;
        assert.equal(
          bad,
          null,
          bad && `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) tile=${hx(tile)} ` +
            `extent=${hx(extent)} cursor=${hx(cursor)}`,
        );
        assert.equal(deCand, deOracle, `DE live-out diff: oracle=${hx(deOracle)} idiomatic=${hx(deCand)}`);

        // The idiomatic side models no stack: loc_0da7 pins SP back to entry and nothing
        // touches pc, so both are unchanged from entry.
        const c = entry.clone();
        stage(c, cfg);
        const sp0 = c.regs.sp, pc0 = c.pc;
        idiomatic(c);
        assert.equal(c.regs.sp, sp0, "idiomatic must leave SP unchanged (loc_0da7 pins it back to entry)");
        assert.equal(c.pc, pc0, "idiomatic must leave pc unchanged (no jp/ret modelling)");
      }
    }
  }
  console.log(`  EQUAL/isolated: ${caps.length} captures × ${FILL_TILES.length} tiles × 3 extents = ${cases} cases — RAM (ex-stack) + DE identical`);
});

// -- 2. WALK-INTEGRATION ------------------------------------------------------

test("WALK-INTEGRATION: DE -> the real 25m table — the resumed walk draws a whole board, RAM + DE match", () => {
  const caps = realCaptures();
  const entry = caps[0];
  const cursor = entry.mem.read16(TILE_PTR);
  const realExtent = entry.mem.read8(EXTENT);
  // DE -> REAL_TABLE-1, so `inc de` lands on 0x3AE4 and the tail drives the real 25m draw.
  const cfg = { tile: 0xe0, hl: cursor, extent: realExtent, de: (REAL_TABLE - 1) & 0xffff };
  const { bad, deOracle, deCand } = replay(entry, cfg, idiomatic);
  assert.equal(bad, null, bad && `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  assert.equal(deCand, deOracle, `DE live-out diff: oracle=${hx(deOracle)} idiomatic=${hx(deCand)}`);
  console.log(`  WALK-INTEGRATION: real 25m table draw via the tail — RAM (ex-stack) + DE identical (final DE=${hx(deOracle)})`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): pays the height down by 0x10 instead of 0x08, laying fewer rows. */
function brokenColumnStep(m) {
  const { regs, mem } = m;
  const tile = mem.read8(FILL_TILE);
  let addr = regs.hl;
  for (;;) {
    mem.write8(addr, tile);
    addr = (addr + 0x20) & 0xffff;
    const h = mem.read8(EXTENT);
    mem.write8(EXTENT, (h - 0x10) & 0xff); // BUG: should be 0x08
    if (h < 0x10) break; // (matching the wrong step)
  }
  regs.de = (regs.de + 1) & 0xffff;
  loc_0da7(m);
}

/** Twin (b): forgets to advance DE before resuming the walk. */
function brokenMissingIncDe(m) {
  const { regs, mem } = m;
  const tile = mem.read8(FILL_TILE);
  let addr = regs.hl;
  for (;;) {
    mem.write8(addr, tile);
    addr = (addr + 0x20) & 0xffff;
    const h = mem.read8(EXTENT);
    mem.write8(EXTENT, (h - 0x08) & 0xff);
    if (h < 0x08) break;
  }
  // BUG: missing regs.de = (regs.de + 1) & 0xffff;
  loc_0da7(m);
}

/** Twin (c): drops the tail walk entirely. */
function brokenSkipWalk(m) {
  const { regs, mem } = m;
  const tile = mem.read8(FILL_TILE);
  let addr = regs.hl;
  for (;;) {
    mem.write8(addr, tile);
    addr = (addr + 0x20) & 0xffff;
    const h = mem.read8(EXTENT);
    mem.write8(EXTENT, (h - 0x08) & 0xff);
    if (h < 0x08) break;
  }
  regs.de = (regs.de + 1) & 0xffff;
  // BUG: missing loc_0da7(m);
}

test("TEETH (column step): the wrong height step is CAUGHT in game-visible RAM", () => {
  const entry = realCaptures()[0];
  const cursor = entry.mem.read16(TILE_PTR);
  // extent 0x08: correct step lays 2 rows, the 0x10 step lays 1 — they diverge.
  const cfg = { tile: 0xe0, hl: cursor, extent: 0x08, de: (TERM - 1) & 0xffff, terminators: [TERM] };
  const { bad } = replay(entry, cfg, brokenColumnStep);
  assert.notEqual(bad, null, "the RAM gate FAILED to catch a wrong column step — it is worthless");
  assert.equal(inStack(bad.addr), false, "the caught diff must be game-visible, not stack scratch");
  console.log(`  TEETH/step: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (missing inc de): the dropped record-pointer advance is CAUGHT by the DE compare", () => {
  const entry = realCaptures()[0];
  const cursor = entry.mem.read16(TILE_PTR);
  // Terminator on BOTH DE and DE+1, so the walk terminates identically either way and
  // RAM stays equal — only DE (0x60FF vs 0x6100) betrays the missing inc.
  const cfg = {
    tile: 0xe0, hl: cursor, extent: 0x08,
    de: (TERM - 1) & 0xffff, terminators: [TERM, (TERM - 1) & 0xffff],
  };
  const { bad, deOracle, deCand } = replay(entry, cfg, brokenMissingIncDe);
  assert.equal(bad, null, bad && `expected RAM identical (DE-only teeth), got a diff at ${hx(bad.addr)}`);
  assert.notEqual(deCand, deOracle, "the DE compare FAILED to catch a missing record-pointer advance — it is worthless");
  console.log(`  TEETH/inc-de: caught DE oracle=${hx(deOracle)} broken=${hx(deCand)} (RAM identical)`);
});

test("TEETH (skip walk): dropping the tail walk is CAUGHT at the KIND byte", () => {
  const entry = realCaptures()[0];
  const cursor = entry.mem.read16(TILE_PTR);
  const cfg = { tile: 0xe0, hl: cursor, extent: 0x08, de: (TERM - 1) & 0xffff, terminators: [TERM] };
  assert.notEqual(entry.mem.read8(KIND), 0xaa, "the captured KIND must differ from the terminator for this teeth to bite");
  const { bad } = replay(entry, cfg, brokenSkipWalk);
  assert.notEqual(bad, null, "the gate FAILED to catch a dropped tail walk — it is worthless");
  assert.equal(bad.addr, KIND, `expected the KIND byte 0x63b3 to differ, got ${hx(bad.addr)}`);
  console.log(`  TEETH/skip-walk: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});
