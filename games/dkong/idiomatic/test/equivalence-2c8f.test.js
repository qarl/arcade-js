// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for driveBarrelRelease (ROM 0x2C8F) — the 25m barrel-release entry: a board gate, an
 * alive gate, two scratch-bit gates, and a ten-record scan of OBJ_ARRAY_67 for a free barrel
 * slot, ending in one of two tail hand-offs (advanceBarrelRelease / releaseBarrelIntoFreeSlot).
 *
 * The oracle reaches its callees through the machine's address registry (`m.call`), which
 * resolves each to its frozen translated copy; those subtrees push return brackets and thread
 * multi-way `ret`s. driveBarrelRelease DIRECT-calls the four idiomatic callees (each memory-equivalent to
 * its own oracle, gated separately) and models no stack. Both sides reach identical work RAM;
 * the only residual difference is the dead STACK_SCRATCH the oracle's push/ret churn writes,
 * excluded by the memory-equivalence contract.
 *
 * WHY NOT pc/SP: cycle-free idiomatic code models the Z80 `ret` as the JS return, so pc/SP
 * cannot match by construction and comparing them would measure the absent `ret`, not the
 * routine. The contract here is RAM − the stack scratch below the entry SP, the return value, and the two registers
 * the routine hands to the slot claim.
 *
 *   0. REACHABILITY — how many real 0x2C8F dispatches a plain attract run produces, and which
 *      arms they land on.
 *   1. EQUAL (captured) — hook 0x2C8F in a real attract run and clone at each dispatch under a
 *      stated sampling policy: EVERY 20th dispatch PLUS the first at each distinct entry shape
 *      (board / alive / the two gate bits / the arm the scan takes). The test asserts in-run
 *      that the replayed sample covers every shape the run saw. Each sample is replayed oracle
 *      vs driveBarrelRelease on byte-identical fresh clones.
 *   2. EQUAL (crafted) — the arms a 25m attract run cannot reach, poked identically on both
 *      sides onto a REAL captured entry: the board gate closed on 50m/75m/100m, a full
 *      ten-record scan that finds nothing free, claims at slots 8 and 9 (attract reached only
 *      0..7), and two records that must be SKIPPED for being already claimed (bit 1) rather
 *      than in motion (bit 0).
 *   3. TEETH — three broken twins, each MUST be caught: one that drops the "already claimed"
 *      bit-1 test, one that hands the slot claim the walked index instead of the countdown, and
 *      one that swaps the two gate bytes.
 *
 * COVERAGE THIS DOES NOT CLAIM: attract only, plus pokes on top of attract state. No credited
 * game, no 50m/75m/100m play (those boards are reached only by poking BOARD, which closes the
 * routine's own gate — which is exactly the arm being tested).
 *
 * MEASURED (these numbers used to sit in the routine's own header, which R21 no longer allows to
 * state them):
 *   • 2614 real 0x2C8F dispatches in 6000 attract frames, across 11 DISTINCT entry shapes.
 *   • 141 of them replayed — every 20th dispatch plus the first of each shape — with the test
 *     asserting in-run that the sample covers every shape the run saw.
 *   • Attract reaches the renderer hand-off, the not-armed return, the Mario-dead skip, and claims
 *     at slots 0..7 ONLY; slots 8 and 9, the nothing-free scan and the already-claimed skip are
 *     crafted on real captures.
 *
 * OBSERVED FAILING AGAINST THIS FILE, not only against the twins — recorded because a gate nobody
 * has watched fail is not known to work:
 *   • dropping the bit-1 (already claimed) test fails the crafted occupied-record arm
 *     (`skip an occupied record (bit 1 only): RAM@0x62aa oracle=32 cand=0`). The captured replay
 *     does NOT catch that one: attract never parked an occupied record in front of a free one.
 *   • handing the claim `remaining + 1` fails the captured replay (`captured dispatch
 *     [board=1 alive=1 gate=0 armed=1 claim@0]: RAM@0x62ac oracle=128 cand=124`).
 *
 * THE LIVE-OUT DERIVATION, cross-file and therefore here rather than in the routine: ROM 0x197A is
 * the only call site of 0x2C8F anywhere in the tree, and it discards the return value; its next
 * act is scheduleBarrelRelease, which loads the accumulator before its first read, so no register
 * or flag this routine leaves is read back. The record base and the countdown handed to
 * releaseBarrelIntoFreeSlot are internal to that direct call and land in RAM anyway (the record
 * base in RENDER_OBJ_PTR, the count-derived sprite slot in RENDER_DST_PTR), which is where this
 * gate pins them. The live-out is DERIVED; there is no live-wire arm in this file.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2c8f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2c8f as oracle } from "../../translated/loc_2c8f.js";
import { driveBarrelRelease } from "../driveBarrelRelease.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH, BOARD, MARIO_ACTIVE, OBJ_ARRAY_67, OBJ_ACTIVE, RENDER_OBJ_PTR, RENDER_DST_PTR,
  ACTOR_SPRITES,
} from "../names.js";
// The twins reuse the real callees — their faithfulness is proven by their own gates, not here —
// so only the driveBarrelRelease-level logic error is what diverges.
import { boardBitGate } from "../boardBitGate.js";
import { marioActiveGuard } from "../marioActiveGuard.js";
import { advanceBarrelRelease } from "../advanceBarrelRelease.js";
import { releaseBarrelIntoFreeSlot } from "../releaseBarrelIntoFreeSlot.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2c8f;
const FRAMES = 6000;      // the attract window the reachability numbers in the routine header quote
const SAMPLE_EVERY = 20;  // the sampling policy's stride, on top of first-of-each-shape

// The routine's constants, restated here rather than imported from it, so the test asserts
// against an independent statement of the contract.
const BOARD_MASK = 1;
const EVENT_GATE = 0x6393;    // bit0 SET -> a barrel is already going out this pass
const RELEASE_ARMED = 0x6392; // bit0 SET -> a release is armed
const BARREL_SLOTS = 10;
const RECORD_STRIDE = 32;
const SLOT_ACTIVE = 0x01;
const SLOT_OCCUPIED = 0x02;

const SPRITE_RECORD_BYTES = 4; // the claim scales the countdown by this to pick a sprite slot

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const recordAddr = (k) => OBJ_ARRAY_67 + k * RECORD_STRIDE;
const slotAddr = (k) => ACTOR_SPRITES + k * SPRITE_RECORD_BYTES;

/** Ten record flag bytes, all taken by a moving barrel except slot `k`, which is free. */
const freeAt = (k) => {
  const r = Array(BARREL_SLOTS).fill(SLOT_ACTIVE);
  r[k] = 0;
  return r;
};

/**
 * The register hand-off this routine owns, read back out of RAM: the claim writes the free
 * record it was handed to RENDER_OBJ_PTR and the sprite slot it derives from the countdown to
 * RENDER_DST_PTR, so asserting those two words pins both values a wrong scan would corrupt.
 */
function assertClaimLandedAt(machine, index, label) {
  assert.equal(machine.mem.read16(RENDER_OBJ_PTR), recordAddr(index),
    `${label}: the claim published the wrong record`);
  assert.equal(machine.mem.read16(RENDER_DST_PTR), slotAddr(index),
    `${label}: the claim aimed at the wrong sprite slot`);
  assert.notEqual(machine.mem.read8(recordAddr(index) + OBJ_ACTIVE), 0,
    `${label}: the claimed record was not marked`);
}

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Every non-stack RAM address that changed between two machines. */
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/**
 * Run oracle and candidate on two FRESH, byte-identical clones of `entry` and report the
 * contract: RAM − the stack scratch below the entry SP plus the RETURN VALUE (a dropped or mis-forwarded tail hands
 * back a different value while leaving RAM alone, so the RAM diff alone would not see it).
 *
 * Registers are NOT compared after the call. The two tails run whole subtrees whose own gates
 * declare their residual registers dead — the idiomatic renderer chain keeps the object pointer
 * in a local where the oracle keeps it in the index register, so an IX comparison here would
 * measure loc_2d51's contract, not this routine's. The one register hand-off that IS this
 * routine's (the free record and the countdown) is pinned instead where the claim writes it to
 * RAM: RENDER_OBJ_PTR and RENDER_DST_PTR, asserted per claim below.
 */
function contractDiffs(entry, fn) {
  const a = entry.clone();
  const b = entry.clone();
  const retA = oracle(a);
  const retB = fn(b);

  const diffs = [];
  const ram = firstRamDiff(a, b, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (retA !== retB) diffs.push(`return oracle=${String(retA)} cand=${String(retB)}`);
  return { diffs, a, b };
}

// -- entry-shape classifier (sampling + coverage reporting ONLY) ---------------

/**
 * A label for the entry state's SHAPE: the four gate inputs plus the arm the scan would take.
 * This re-derives the routine's decision independently so the sampling policy can guarantee one
 * capture per shape; nothing is ASSERTED from it — every verdict below is a RAM/return/register
 * diff against the oracle.
 */
function shapeOf(mm) {
  const board = mm.mem.read8(BOARD);
  const alive = mm.mem.read8(MARIO_ACTIVE) & 1;
  const gate = mm.mem.read8(EVENT_GATE) & 1;
  const armed = mm.mem.read8(RELEASE_ARMED) & 1;
  const boardOpen = ((BOARD_MASK >> (((board || 256) - 1) & 7)) & 1) === 1;

  let arm;
  if (!boardOpen) arm = "board-closed";
  else if (!alive) arm = "mario-dead";
  else if (gate) arm = "render-handoff";
  else if (!armed) arm = "not-armed";
  else {
    let slot = null;
    for (let k = 0; k < BARREL_SLOTS; k++) {
      const flags = mm.mem.read8(recordAddr(k) + OBJ_ACTIVE);
      if ((flags & (SLOT_ACTIVE | SLOT_OCCUPIED)) === 0) { slot = k; break; }
    }
    arm = slot === null ? "scan-exhausted" : `claim@${slot}`;
  }
  return `board=${board} alive=${alive} gate=${gate} armed=${armed} ${arm}`;
}

// -- capture ------------------------------------------------------------------

/**
 * ONE attract run serves every test below: it hooks 0x2C8F, censuses every dispatch, and clones
 * the machine at the sampled ones (every 20th, plus the first of each shape). Memoised — the
 * Machine run is the expensive part and the clones are read-only here.
 */
let ATTRACT = null;
function attractRun() {
  if (ATTRACT) return ATTRACT;
  const caps = [];
  const seen = new Map();      // shape -> how many dispatches had it
  const captured = new Set();  // shape -> at least one clone kept
  let n = 0;
  const snapshot = new Map([[TARGET, (mm) => {
    const shape = shapeOf(mm);
    seen.set(shape, (seen.get(shape) ?? 0) + 1);
    if (!captured.has(shape) || n % SAMPLE_EVERY === 0) {
      const c = mm.clone();
      c.nextNmi = Infinity;
      c.nextBoundary = Infinity;
      caps.push({ entry: c, shape });
      captured.add(shape);
    }
    n++;
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(FRAMES);
  ATTRACT = { caps, seen, captured, total: n };
  return ATTRACT;
}

/** A crafted dispatch: a REAL captured entry with surgical pokes, applied to a clone. */
function craft(entry, { board, alive, gate, armed, records } = {}) {
  const m = entry.clone();
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
  if (board !== undefined) m.mem.write8(BOARD, board);
  if (alive !== undefined) m.mem.write8(MARIO_ACTIVE, alive);
  if (gate !== undefined) m.mem.write8(EVENT_GATE, gate);
  if (armed !== undefined) m.mem.write8(RELEASE_ARMED, armed);
  if (records !== undefined) {
    for (let k = 0; k < BARREL_SLOTS; k++) m.mem.write8(recordAddr(k) + OBJ_ACTIVE, records[k]);
  }
  return m;
}

/** A real captured entry that reaches the SCAN (both gates open) — the base the crafted arms sit on. */
function scanEntry() {
  const { caps } = attractRun();
  const hit = caps.find(({ shape }) => shape.includes("claim@"));
  assert.ok(hit, "expected at least one real dispatch that reached the scan");
  return hit.entry;
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x2c8f is dispatched during 25m attract", () => {
  const { total, seen, caps } = attractRun();
  assert.ok(total > 0, "0x2c8f should be dispatched — the per-frame update cascade calls it");
  console.log(`  REACHABILITY: ${total} natural 0x2c8f dispatches in ${FRAMES} frames, ` +
    `${seen.size} distinct entry shapes, ${caps.length} sampled`);
  for (const [shape, count] of [...seen.entries()].sort((x, y) => y[1] - x[1])) {
    console.log(`    ${String(count).padStart(5)}  ${shape}`);
  }
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): driveBarrelRelease == oracle on every sampled real dispatch", () => {
  const { caps, seen, captured, total } = attractRun();
  assert.ok(caps.length >= 1, "expected at least one real 0x2c8f dispatch during attract");

  // The sampling policy is only honest if the sample covers every shape the run produced.
  for (const shape of seen.keys()) {
    assert.ok(captured.has(shape), `sampling missed the entry shape: ${shape}`);
  }

  let claims = 0;
  for (const { entry, shape } of caps) {
    const { diffs, b } = contractDiffs(entry, driveBarrelRelease);
    assert.deepEqual(diffs, [], `captured dispatch [${shape}]: ${diffs.join("; ")}`);

    // On a claim, pin the hand-off itself, not just its equality with the oracle.
    const claimed = /claim@(\d+)/.exec(shape);
    if (claimed) {
      assertClaimLandedAt(b, Number(claimed[1]), `captured dispatch [${shape}]`);
      claims++;
    }
  }
  console.log(`  EQUAL/captured: ${caps.length} of ${total} real dispatches replayed identical ` +
    `(all ${seen.size} entry shapes covered; ${claims} of them slot claims, hand-off pinned)`);
});

// -- 2. EQUAL (crafted, the arms attract cannot reach) ------------------------

test("EQUAL (crafted): the arms 25m attract never reaches match the oracle", () => {
  const base = scanEntry();

  const allTaken = Array(BARREL_SLOTS).fill(SLOT_ACTIVE);

  const cases = [
    // The board gate: attract is 25m only, so these three arms never occur naturally.
    { name: "board gate closed (50m)", opts: { board: 2 }, writes: [] },
    { name: "board gate closed (75m)", opts: { board: 3 }, writes: [] },
    { name: "board gate closed (100m)", opts: { board: 4 }, writes: [] },
    // A full scan that finds nothing — attract always had a free record.
    {
      name: "scan exhausted (ten taken records)",
      opts: { board: 1, alive: 1, gate: 0x00, armed: 0x01, records: allTaken },
      writes: [],
    },
    // Slots 8 and 9: attract's claims stopped at 7.
    { name: "claim at slot 8", opts: { board: 1, alive: 1, gate: 0x00, armed: 0x01, records: freeAt(8) }, claim: 8 },
    { name: "claim at slot 9", opts: { board: 1, alive: 1, gate: 0x00, armed: 0x01, records: freeAt(9) }, claim: 9 },
    // The bit-1 test: a record that is CLAIMED but not moving must be skipped just the same.
    {
      name: "skip an occupied record (bit 1 only)",
      opts: { board: 1, alive: 1, gate: 0x00, armed: 0x01, records: [SLOT_OCCUPIED, 0, ...Array(8).fill(SLOT_ACTIVE)] },
      claim: 1,
    },
    {
      name: "skip an active+occupied record (both bits)",
      opts: {
        board: 1, alive: 1, gate: 0x00, armed: 0x01,
        records: [SLOT_ACTIVE | SLOT_OCCUPIED, 0, ...Array(8).fill(SLOT_ACTIVE)],
      },
      claim: 1,
    },
  ];

  for (const { name, opts, writes, claim } of cases) {
    const entry = craft(base, opts);
    const { diffs, a } = contractDiffs(entry, driveBarrelRelease);
    assert.deepEqual(diffs, [], `${name}: ${diffs.join("; ")}`);

    if (writes) {
      // Exact non-stack write set — proves the path really was the skip / exhausted one.
      assert.deepEqual(changedAddrs(entry, a, entry.regs.sp).sort(), [...writes].sort(),
        `${name}: unexpected non-stack write set`);
    }
    // Non-vacuity: the claim genuinely landed on the record the scan should have stopped at.
    if (claim !== undefined) assertClaimLandedAt(a, claim, name);
  }
  console.log(`  EQUAL/crafted: ${cases.length} unreached arms (3 board-closed, scan-exhausted, ` +
    `slots 8/9, 2 occupied-skips) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): tests only the "in motion" bit and ignores "already claimed" — so it claims a record
 *  the real scan skips. */
function brokenIgnoresOccupied(m) {
  const { regs, mem8 } = m;
  regs.a = BOARD_MASK;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  if ((mem8[EVENT_GATE] & 0x01) !== 0) return advanceBarrelRelease(m);
  if ((mem8[RELEASE_ARMED] & 0x01) === 0) return;
  let record = OBJ_ARRAY_67;
  for (let remaining = BARREL_SLOTS; remaining > 0; remaining--) {
    if ((mem8[record + OBJ_ACTIVE] & SLOT_ACTIVE) === 0) { // BUG: drops the occupied test
      regs.ix = record;
      regs.b = remaining;
      return releaseBarrelIntoFreeSlot(m);
    }
    record += RECORD_STRIDE;
  }
}

/** Twin (b): hands the slot claim the WALKED INDEX instead of the countdown, so the claim derives
 *  the mirrored sprite slot. */
function brokenCountUp(m) {
  const { regs, mem8 } = m;
  regs.a = BOARD_MASK;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  if ((mem8[EVENT_GATE] & 0x01) !== 0) return advanceBarrelRelease(m);
  if ((mem8[RELEASE_ARMED] & 0x01) === 0) return;
  let record = OBJ_ARRAY_67;
  for (let remaining = BARREL_SLOTS; remaining > 0; remaining--) {
    if ((mem8[record + OBJ_ACTIVE] & (SLOT_ACTIVE | SLOT_OCCUPIED)) === 0) {
      regs.ix = record;
      regs.b = BARREL_SLOTS - remaining; // BUG: the index, not the countdown
      return releaseBarrelIntoFreeSlot(m);
    }
    record += RECORD_STRIDE;
  }
}

/** Twin (c): swaps the two gate bytes — reads the armed flag where the "already going out" latch
 *  belongs and vice versa. */
function brokenSwappedGates(m) {
  const { regs, mem8 } = m;
  regs.a = BOARD_MASK;
  if (!boardBitGate(m)) return;
  if (!marioActiveGuard(m)) return;
  if ((mem8[RELEASE_ARMED] & 0x01) !== 0) return advanceBarrelRelease(m); // BUG: swapped
  if ((mem8[EVENT_GATE] & 0x01) === 0) return;                            // BUG: swapped
  let record = OBJ_ARRAY_67;
  for (let remaining = BARREL_SLOTS; remaining > 0; remaining--) {
    if ((mem8[record + OBJ_ACTIVE] & (SLOT_ACTIVE | SLOT_OCCUPIED)) === 0) {
      regs.ix = record;
      regs.b = remaining;
      return releaseBarrelIntoFreeSlot(m);
    }
    record += RECORD_STRIDE;
  }
}

test("TEETH: three broken twins are CAUGHT", () => {
  const base = scanEntry();

  // (a) an occupied record in front of a free one: the twin claims the occupied one.
  const occupied = craft(base, {
    board: 1, alive: 1, gate: 0x00, armed: 0x01,
    records: [SLOT_OCCUPIED, 0, ...Array(8).fill(SLOT_ACTIVE)],
  });
  const aDiffs = contractDiffs(occupied, brokenIgnoresOccupied).diffs;
  assert.ok(aDiffs.length > 0, "the ignores-occupied twin escaped — the gate is worthless");
  assert.ok(aDiffs.some((d) => d.startsWith(`RAM@${hx(RENDER_OBJ_PTR)}`)),
    `expected the ignores-occupied twin to publish the wrong record at ${hx(RENDER_OBJ_PTR)}, got ${aDiffs.join("; ")}`);

  // (b) a claim at a slot where index != countdown, so the mirrored slot is a different address.
  const slot8 = craft(base, { board: 1, alive: 1, gate: 0x00, armed: 0x01, records: freeAt(8) });
  const bDiffs = contractDiffs(slot8, brokenCountUp).diffs;
  assert.ok(bDiffs.length > 0, "the count-up twin escaped — the gate is worthless");
  assert.ok(bDiffs.some((d) => d.startsWith(`RAM@${hx(RENDER_DST_PTR)}`)),
    `expected the count-up twin to aim at the wrong sprite slot at ${hx(RENDER_DST_PTR)}, got ${bDiffs.join("; ")}`);

  // (c) gates swapped, on a REAL captured claim dispatch — the one natural shape where the two
  // bytes disagree (latch clear, armed set), so the twin steps the renderer instead of claiming.
  // A render-handoff capture cannot catch it: attract's renderer passes have BOTH bytes set, so
  // the swap is invisible there.
  const cDiffs = contractDiffs(base, brokenSwappedGates).diffs;
  assert.ok(cDiffs.length > 0, "the swapped-gate twin escaped — the gate is worthless");

  console.log(`  TEETH: ignores-occupied caught (${aDiffs[0]}); count-up caught (${bDiffs[0]}); ` +
    `swapped-gates caught (${cDiffs[0]})`);
});
