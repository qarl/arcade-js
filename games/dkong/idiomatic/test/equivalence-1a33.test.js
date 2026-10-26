// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for collectEdgeRivet (ROM 0x1A33) — the 100m edge-rivet pickup
 * handler: board-gated (rst 0x30 mask 0x08 = 100m); ARM at a screen-edge column, then
 * on a later frame DISARM + remove the rivet at the player's row/side (clear its
 * RIVET_PRESENT flag, dec RIVETS_LEFT, blank 3 VRAM tiles, raise 0x6340/0x6342/0x6225,
 * and — grounded — call loc_1d95).
 *
 * The routine WRITES memory only, so it is gated by capture / clone / replay (docs/decompiler-pipeline)
 * with a FRESH clone per case. The idiomatic form models no Z80 stack while the oracle's
 * `ret`/`rst`/`call` push+pop it, so the contract is RAM − the stack scratch below the entry SP (never the full
 * register file, never cycles), plus the requirement that idiomatic collectEdgeRivet
 * leaves SP/pc UNCHANGED.
 *
 * Reachability: attract plays level-1 25m only, where the rst 0x30 gate is CLOSED
 * (mask 0x08 selects board 4). So every real dispatch is the board-gated NO-OP, and
 * that reachable path is what the natural capture covers. The 100m arms are unreachable
 * in attract, so each is a crafted entry — a real captured state poked to BOARD == 4
 * identically on both sides:
 *
 *   1. REALISM / NATURAL — real 0x1a33 dispatches (BOARD == 1, gate closed): oracle and
 *      idiomatic both no-op; game-visible RAM identical and unchanged from entry.
 *   2. GATE (crafted) — poke BOARD 1/2/3 (closed) vs 4 (open) on a collect-ready state;
 *      1/2/3 stay no-ops, 4 collects. Pins that only board 4 acts.
 *   3. ARM (crafted) — BOARD 4 + MARIO_X on an edge (0x4B / 0xB3): oracle and idiomatic
 *      both raise EDGE_RIVET_ARMED and nothing else.
 *   4. COLLECT (crafted sweep) — BOARD 4, armed, off-edge, on-field, all rivets present,
 *      swept over X (both halves) × Y × {airborne, grounded}: full RAM identical, and
 *      the oracle provably removed a rivet (RIVETS_LEFT 8 -> 7) each time.
 *   5. OFF-FIELD / EMPTY-SLOT (crafted) — the two early-outs after the arm gate: they
 *      DISARM and change nothing else, on both sides.
 *   6. TEETH — three twins the crafts MUST catch: wrong gate mask (0x04, no-op on 100m),
 *      wrong slot bit ((Y-1) bit6 not bit7), and a missing disarm.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1a33.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a33 as oracle } from "../../translated/loc_1a33.js";
import { collectEdgeRivet as idiomatic } from "../collectEdgeRivet.js";
import { boardBitGate } from "../boardBitGate.js";
import { armEdgeRivetPickup } from "../armEdgeRivetPickup.js";
import { loc_1d95 } from "../loc_1d95.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1a33;
const BOARD = 0x6227;
const MARIO_X = 0x6203;
const MARIO_Y = 0x6205;
const MARIO_AIRBORNE = 0x6216;
const EDGE_RIVET_ARMED = 0x6291;
const RIVET_PRESENT = 0x6292; // [8] 0x6292..0x6299
const RIVETS_LEFT = 0x6290;
const COLLECT_A = 0x6340, COLLECT_B = 0x6342, COLLECT_C = 0x6225;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** First game-visible RAM difference between two machines, EXCLUDING the stack scratch below the entry SP. */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry through the oracle and a candidate on independent FRESH clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/** Assert idiomatic collectEdgeRivet models no stack: SP and pc unchanged from entry. */
function assertNoStackModel(entry) {
  const b = entry.clone();
  const sp0 = b.regs.sp, pc0 = b.pc;
  idiomatic(b);
  assert.equal(b.regs.sp, sp0, "collectEdgeRivet must leave SP unchanged (no stack modelling)");
  assert.equal(b.pc, pc0, "collectEdgeRivet must leave pc unchanged (no ret modelling)");
}

/** Clone the machine at each real 0x1a33 dispatch during attract. */
function captureNatural(K, maxFrames) {
  const caps = [];
  const base = new Machine(ROM);
  const real = base.routines.get(TARGET);
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return real(mm);
  }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}

/** A real 0x1a33 entry (BOARD == 1, gate-closed) to craft the 100m arms onto. */
function craftedBase() {
  const caps = captureNatural(1, 2600);
  assert.ok(caps.length >= 1, "expected a real 0x1a33 dispatch to craft from");
  return caps[0];
}

/**
 * Poke a captured entry into a collect-ready 100m state (BOARD 4, armed, all 8 rivets
 * present, RIVETS_LEFT = 8), then apply the caller's overrides. Applied identically to
 * every machine passed. Returns the machines for chaining.
 */
function pokeCollect(machines, over = {}) {
  for (const m of machines) {
    m.mem.write8(BOARD, over.board ?? 4);
    m.mem.write8(EDGE_RIVET_ARMED, over.armed ?? 1);
    m.mem.write8(RIVETS_LEFT, 8);
    for (let i = 0; i < 8; i++) m.mem.write8(RIVET_PRESENT + i, over.allRivets === 0 ? 0 : 1);
    if (over.x !== undefined) m.mem.write8(MARIO_X, over.x);
    if (over.y !== undefined) m.mem.write8(MARIO_Y, over.y);
    if (over.airborne !== undefined) m.mem.write8(MARIO_AIRBORNE, over.airborne);
    // Clean the sound probes so loc_1d95's queue reads unambiguously.
    m.mem.write8(0x608a, 0x00);
    m.mem.write8(0x608b, 0x00);
  }
  return machines;
}

// -- 1. REALISM / NATURAL -----------------------------------------------------

test("REALISM (natural): real 0x1a33 dispatches are the gate-closed NO-OP — RAM identical & unchanged", () => {
  const caps = captureNatural(8, 2600);
  assert.ok(caps.length >= 1, "expected at least one natural 0x1a33 dispatch during 25m attract");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract dispatches 0x1a33 on BOARD == 1 (25m), gate closed");

    // Oracle-vs-idiomatic: both no-op, game-visible RAM identical.
    const { a, bad } = replay(entry, idiomatic);
    assert.equal(
      bad, null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on a real gate-closed 0x1a33 dispatch (X=${hx(entry.mem.read8(MARIO_X))})`,
    );
    // Prove it really is the no-op path: the oracle changed no non-stack RAM from entry.
    const { bad: moved } = ramDiffMinusStack(entry, a, entry.regs.sp);
    assert.equal(moved, null, moved && `oracle wrote non-stack RAM at ${hx(moved.addr)} on the 25m gate — not a no-op`);
    assertNoStackModel(entry);
  }
  console.log(`  REALISM/natural: ${caps.length} real gate-closed 0x1a33 dispatch(es) — RAM identical & untouched`);
});

// -- 2. GATE (crafted) --------------------------------------------------------

test("GATE (crafted): only BOARD == 4 acts — boards 1/2/3 stay no-ops, board 4 collects", () => {
  const base = craftedBase();
  for (const board of [1, 2, 3, 4]) {
    const [a, b] = pokeCollect([base.clone(), base.clone()], { board, x: 0x40, y: 0x40, airborne: 1 });
    const aFloor = a.regs.sp;
    const pre = a.clone();
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `BOARD ${board}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
    // Sanity via the proven gate: closed on 1/2/3, open on 4.
    const open = board === 4;
    // A rivet was present; if the gate opened the oracle removed one (RIVETS_LEFT 8 -> 7).
    assert.equal(a.mem.read8(RIVETS_LEFT), open ? 7 : 8, `BOARD ${board}: RIVETS_LEFT ${open ? "must drop" : "must hold"}`);
    // Corroborate with boardBitGate directly.
    const probe = pre.clone(); probe.regs.a = 0x08;
    assert.equal(boardBitGate(probe), open, `boardBitGate must be ${open} on BOARD ${board}`);
  }
  console.log("  GATE/crafted: boards 1/2/3 no-op, board 4 collects — RAM identical, gate agrees");
});

// -- 3. ARM (crafted) ---------------------------------------------------------

test("ARM (crafted): on a 100m screen-edge column, both raise EDGE_RIVET_ARMED and nothing else", () => {
  const base = craftedBase();
  for (const x of [0x4b, 0xb3]) {
    // Start disarmed so the raise is observable; all-rivets present to prove nothing collects.
    const [a, b] = pokeCollect([base.clone(), base.clone()], { board: 4, armed: 0, x, y: 0x40 });
    const aFloor = a.regs.sp;
    const pre = a.clone();
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `X=${hx(x)}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
    assert.equal(a.mem.read8(EDGE_RIVET_ARMED), 1, `X=${hx(x)}: oracle must arm the latch`);
    assert.equal(b.mem.read8(EDGE_RIVET_ARMED), 1, `X=${hx(x)}: idiomatic must arm the latch`);
    assert.equal(a.mem.read8(RIVETS_LEFT), 8, `X=${hx(x)}: arming must not collect a rivet`);
    // The only non-stack change vs entry is EDGE_RIVET_ARMED 0 -> 1.
    const { bad: moved } = ramDiffMinusStack(pre, a, aFloor);
    assert.equal(moved && moved.addr, EDGE_RIVET_ARMED, `X=${hx(x)}: arm must touch only 0x6291, saw ${moved && hx(moved.addr)}`);
    assertNoStackModel(a);
  }
  console.log("  ARM/crafted: edge columns 0x4B / 0xB3 raise EDGE_RIVET_ARMED, no collect");
});

// -- 4. COLLECT (crafted sweep) -----------------------------------------------

test("COLLECT (crafted sweep): BOARD 4 armed pickup == oracle over X x Y x {air,ground}", () => {
  const base = craftedBase();
  const XS = [0x30, 0x60, 0x90, 0xc0]; // both halves, none an edge column (0x4B / 0xB3)
  const YS = [0x08, 0x18, 0x28, 0x40, 0x55, 0x66, 0x7a, 0x81, 0x99, 0xaa, 0xbb, 0xcf];
  let count = 0, collected = 0, sounded = 0, mismatch = null;

  for (const airborne of [1, 0]) {
    for (const x of XS) {
      for (const y of YS) {
        const [a, b] = pokeCollect([base.clone(), base.clone()], { board: 4, armed: 1, x, y, airborne });
        const aFloor = a.regs.sp;
        oracle(a);
        idiomatic(b);
        count++;
        const { bad } = ramDiffMinusStack(a, b, aFloor);
        if (bad) { mismatch = { x, y, airborne, bad }; break; }
        // The oracle provably collected: one rivet gone, count 8 -> 7, latch disarmed.
        assert.equal(a.mem.read8(RIVETS_LEFT), 7, `x=${hx(x)} y=${hx(y)}: oracle must remove one rivet`);
        assert.equal(a.mem.read8(EDGE_RIVET_ARMED), 0, `x=${hx(x)} y=${hx(y)}: oracle must disarm`);
        collected++;
        // Grounded pickups queue the 100m pickup sound (loc_1d95, BOARD != 1).
        if (airborne === 0 && a.mem.read8(0x608a) === 0x0d) sounded++;
        assertNoStackModel(a);
      }
      if (mismatch) break;
    }
    if (mismatch) break;
  }
  assert.equal(
    mismatch, null,
    mismatch && `mismatch at x=${hx(mismatch.x)} y=${hx(mismatch.y)} air=${mismatch.airborne}: ` +
      `RAM diff at ${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(collected, count, "every crafted collect state must have removed a rivet");
  assert.ok(sounded > 0, "grounded collects must have queued the pickup sound at least once");
  console.log(`  COLLECT/sweep: ${count} states identical to the oracle (${collected} collected, ${sounded} grounded-sounded)`);
});

// -- 5. OFF-FIELD / EMPTY-SLOT (crafted) --------------------------------------

test("OFF-FIELD (crafted): (MARIO_Y-1) >= 0xD0 disarms and changes nothing else", () => {
  const base = craftedBase();
  // Y = 0xF5 -> Y-1 = 0xF4 >= 0xD0. Armed, board 4, non-edge X.
  const [a, b] = pokeCollect([base.clone(), base.clone()], { board: 4, armed: 1, x: 0x40, y: 0xf5 });
  const aFloor = a.regs.sp;
  const pre = a.clone();
  oracle(a);
  idiomatic(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `off-field RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  assert.equal(a.mem.read8(EDGE_RIVET_ARMED), 0, "off-field must still disarm");
  assert.equal(a.mem.read8(RIVETS_LEFT), 8, "off-field must not remove a rivet");
  const { bad: moved } = ramDiffMinusStack(pre, a, aFloor);
  assert.equal(moved && moved.addr, EDGE_RIVET_ARMED, `off-field must touch only 0x6291, saw ${moved && hx(moved.addr)}`);
  console.log("  OFF-FIELD/crafted: disarm only, no collect — RAM identical");
});

test("EMPTY-SLOT (crafted): an already-removed rivet disarms and changes nothing else", () => {
  const base = craftedBase();
  // All rivets ALREADY gone (allRivets: 0); armed, board 4, on-field, non-edge X.
  const [a, b] = pokeCollect([base.clone(), base.clone()], { board: 4, armed: 1, x: 0x40, y: 0x40, allRivets: 0 });
  const aFloor = a.regs.sp;
  const pre = a.clone();
  oracle(a);
  idiomatic(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `empty-slot RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  assert.equal(a.mem.read8(EDGE_RIVET_ARMED), 0, "empty slot must still disarm");
  assert.equal(a.mem.read8(RIVETS_LEFT), 8, "empty slot must not decrement the count");
  const { bad: moved } = ramDiffMinusStack(pre, a, aFloor);
  assert.equal(moved && moved.addr, EDGE_RIVET_ARMED, `empty-slot must touch only 0x6291, saw ${moved && hx(moved.addr)}`);
  console.log("  EMPTY-SLOT/crafted: disarm only, no collect — RAM identical");
});

// -- 6. TEETH -----------------------------------------------------------------

const rotl8 = (v) => ((v << 1) | (v >> 7)) & 0xff;

/** Twin (a): wrong gate mask 0x04 (bit2 = 75m) — closes on 100m, so it never collects. */
function brokenWrongGate(m) {
  const { regs, mem } = m;
  regs.a = 0x04; // BUG: should be 0x08
  if (!boardBitGate(m)) return;
  runCollectBody(m, mem, false);
}

/** Twin (b): slot bit2 from (Y-1) bit6 instead of bit7 — wrong rivet / wrong VRAM. */
function brokenWrongSlotBit(m) {
  const { regs, mem } = m;
  regs.a = 0x08;
  if (!boardBitGate(m)) return;
  runCollectBody(m, mem, "bit6");
}

/** Twin (c): omit the disarm write — EDGE_RIVET_ARMED wrongly stays 1. */
function brokenNoDisarm(m) {
  const { regs, mem } = m;
  regs.a = 0x08;
  if (!boardBitGate(m)) return;
  runCollectBody(m, mem, false, /*disarm=*/false);
}

/** Shared collect body used by the teeth twins (the arm/gate is handled by the caller). */
function runCollectBody(m, mem, slotBug, disarm = true) {
  const x = mem.read8(MARIO_X);
  if (x === 0x4b || x === 0xb3) { armEdgeRivetPickup(m); return; }
  if (mem.read8(EDGE_RIVET_ARMED) !== 1) return;
  if (disarm) mem.write8(EDGE_RIVET_ARMED, 0x00);
  let a = (mem.read8(MARIO_Y) - 1) & 0xff;
  if (a >= 0xd0) return;
  let slot = 0;
  a = rotl8(a); if (a & 1) slot |= (slotBug === "bit6" ? 0 : 0x04);
  if (slotBug === "bit6" && ((mem.read8(MARIO_Y) - 1) & 0x40)) slot |= 0x04; // BUG source: bit6
  a = rotl8(a);
  a = rotl8(a); if (a & 1) slot |= 0x02;
  if ((a & 0x07) === 0x06) slot |= 0x02;
  a = rotl8(x); if (a & 1) slot |= 0x01;
  const slotAddr = (RIVET_PRESENT + slot) & 0xffff;
  if (mem.read8(slotAddr) === 0) return;
  mem.write8(slotAddr, 0x00);
  mem.write8(RIVETS_LEFT, (mem.read8(RIVETS_LEFT) - 1) & 0xff);
  const row = slot >> 1;
  const base = (slot & 1) ? 0x012b : 0x02cb;
  const vaddr = (0x7400 + base + 5 * row) & 0xffff;
  const page = vaddr & 0xff00, lo = vaddr & 0xff;
  mem.write8(vaddr, 0x10);
  mem.write8(page | ((lo - 1) & 0xff), 0x10);
  mem.write8(page | ((lo + 1) & 0xff), 0x10);
  mem.write8(COLLECT_A, 0x01); mem.write8(COLLECT_B, 0x01); mem.write8(COLLECT_C, 0x01);
  const airborne = mem.read8(MARIO_AIRBORNE);
  if (airborne === 0) { m.regs.a = airborne; loc_1d95(m); }
}

test("TEETH (wrong-gate): the mask-0x04 twin is CAUGHT — no-ops on 100m while the oracle collects", () => {
  const base = craftedBase();
  const { bad } = replay(...pokeCollectPair(base, { board: 4, armed: 1, x: 0x40, y: 0x40, airborne: 1 }), brokenWrongGate);
  assert.notEqual(bad, null, "the craft FAILED to catch a wrong gate mask — it is worthless");
  console.log(`  TEETH/wrong-gate: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (wrong-slot-bit): the (Y-1) bit6 twin is CAUGHT — wrong rivet removed", () => {
  const base = craftedBase();
  // Y = 0x81 -> Y-1 = 0x80: bit7 set, bit6 clear, so the buggy bit source picks a different slot.
  const { bad } = replay(...pokeCollectPair(base, { board: 4, armed: 1, x: 0x40, y: 0x81, airborne: 1 }), brokenWrongSlotBit);
  assert.notEqual(bad, null, "the craft FAILED to catch a wrong slot bit — it is worthless");
  console.log(`  TEETH/wrong-slot-bit: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (no-disarm): the missing-disarm twin is CAUGHT at 0x6291", () => {
  const base = craftedBase();
  const { bad } = replay(...pokeCollectPair(base, { board: 4, armed: 1, x: 0x40, y: 0x40, airborne: 1 }), brokenNoDisarm);
  assert.notEqual(bad, null, "the craft FAILED to catch a missing disarm — it is worthless");
  assert.equal(bad.addr, EDGE_RIVET_ARMED, `expected the caught diff at 0x6291, got ${hx(bad.addr)}`);
  assert.equal(bad.a, 0, "oracle must disarm (0)");
  assert.equal(bad.b, 1, "broken twin wrongly leaves the latch armed (1)");
  console.log(`  TEETH/no-disarm: caught at 0x6291 (oracle=${bad.a} broken=${bad.b})`);
});

/**
 * Build a single crafted entry (one machine) for the teeth: pokeCollect applied to one
 * fresh clone. replay() then clones it twice for oracle vs the broken twin.
 */
function pokeCollectPair(base, over) {
  const entry = base.clone();
  pokeCollect([entry], over);
  return [entry];
}
