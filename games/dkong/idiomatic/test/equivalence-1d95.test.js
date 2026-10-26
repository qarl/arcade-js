// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1d95 (ROM 0x1D95) — the item-collection `call z` target:
 * commit A into the 0x6225 collection flag, then (off 25m) queue priority tune 0x0D
 * for 3 frames (SND_PRIORITY 0x608A / SND_PRIORITY_FRAMES 0x608B).
 *
 * loc_1d95 WRITES memory only, so it is gated by capture / clone / replay (docs/decompiler-pipeline)
 * with a FRESH clone per case. Because the idiomatic routine does NOT model the Z80
 * stack while the oracle's `ret` pops the pushed return address, the contract is
 * RAM − the stack scratch below the entry SP (never the full register file, never cycles), with the extra
 * requirement that idiomatic loc_1d95 leaves SP/pc UNCHANGED (it models no stack).
 *
 * Reachability: attract plays level-1 25m only, and 0x1d95 fires there just twice per
 * 8000 frames — ALWAYS on BOARD == 1 with A == 0, i.e. the `ret z` no-sound arm.
 * The sound arm (BOARD != 1) is never reached in attract. So the gate is
 * crafted-entry, built four ways:
 *
 *   1. REALISM / NATURAL — the real 0x1d95 dispatches attract produces (BOARD == 1,
 *      A == 0, flag 0x6225 == 1). Run the ORACLE on one clone and idiomatic on
 *      another; every game-visible byte matches, idiomatic leaves SP/pc put, and the
 *      oracle's own output pins the effect (0x6225 cleared to 0, no sound written).
 *
 *   2. REALISM / FORCED (breadth) — force the dispatch by poking 0x6225 = 1 at each
 *      real entry_1c4f entry so its `call z,0x1d95` fires; each hands 0x1d95 a genuine
 *      in-play state (still BOARD == 1). Same oracle-vs-idiomatic contract, more states.
 *
 *   3. BOARD (exhaustive crafted) — BOARD is the routine's ONLY branch variable and
 *      attract only reaches 25m, so on a real entry poke BOARD 0..255 identically on
 *      both sides and compare. This pins the sound-write arm (BOARD != 1) attract never
 *      reaches; the sweep must exercise BOTH arms (silent on 25m, tune 0x0D otherwise).
 *
 *   4. STORE (A-sweep crafted) — real dispatches only ever pass A == 0, so poke A over
 *      a curated set identically on both sides and confirm the store commits A into
 *      0x6225 faithfully (the byte the routine writes is A, not a constant).
 *
 *   5. TEETH — three twins the sweeps MUST catch: (a) wrong-sound (0x0C not 0x0D) —
 *      caught in the BOARD sweep at 0x608A; (b) wrong board-gate (skip on BOARD == 2,
 *      so it plays the sound on 25m) — caught on the real BOARD == 1 dispatch at
 *      0x608A; (c) wrong-store (writes constant 0, dropping A) — caught in the A-sweep
 *      at 0x6225 when A != 0.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1d95.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d95 as oracle } from "../../translated/loc_1d95.js";
import { loc_1d95 as idiomatic } from "../loc_1d95.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1d95;
const LANDING = 0x1c4f;   // entry_1c4f — `ld a,(0x6225) / dec a / call z,0x1d95`
const FLAG = 0x6225;      // the collection flag committed from A
const BOARD = 0x6227;     // 25m == 1 (silent arm); anything else queues the sound
const SND_PRIO = 0x608a;  // SND_PRIORITY — tune 0x0D
const SND_FRAMES = 0x608b; // SND_PRIORITY_FRAMES — 3
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible RAM difference between two machines, EXCLUDING the dead
 * STACK_SCRATCH region (the contract is RAM − the stack scratch below the entry SP; SP/pc are handled
 * separately because the oracle models the stack `ret` and idiomatic does not).
 */
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

/** Assert idiomatic loc_1d95 models no stack: SP and pc unchanged from entry. */
function assertNoStackModel(entry) {
  const b = entry.clone();
  const sp0 = b.regs.sp, pc0 = b.pc;
  idiomatic(b);
  assert.equal(b.regs.sp, sp0, "loc_1d95 must leave SP unchanged (no stack modelling)");
  assert.equal(b.pc, pc0, "loc_1d95 must leave pc unchanged (no ret modelling)");
}

/** Clone the machine at each real 0x1d95 dispatch during attract. */
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

/**
 * Force 0x1d95 dispatches by poking the collection flag 0x6225 = 1 at each real
 * entry_1c4f entry, so its `call z,0x1d95` fires and hands 0x1d95 a genuine, in-play
 * state. Each capture is a real machine snapshot at the true 0x1d95 entry.
 */
function captureForced(K, maxFrames) {
  const caps = [];
  const base = new Machine(ROM);
  const realLanding = base.routines.get(LANDING);
  const realTarget = base.routines.get(TARGET);
  const snap = new Map([
    [LANDING, (mm) => { mm.mem.write8(FLAG, 1); return realLanding(mm); }],
    [TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return realTarget(mm); }],
  ]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}

/** A real 0x1d95 entry (BOARD == 1) to craft arms onto. */
function craftedBase() {
  const caps = captureNatural(1, 8000);
  assert.ok(caps.length >= 1, "expected a real 0x1d95 dispatch to craft from");
  return caps[0];
}

// -- 1. REALISM / NATURAL -----------------------------------------------------

test("REALISM (natural): real 0x1d95 dispatches — RAM identical, flag cleared, silent on 25m", () => {
  const caps = captureNatural(4, 8000);
  assert.ok(caps.length >= 1, "expected at least one natural 0x1d95 dispatch during 25m attract");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract dispatches 0x1d95 on BOARD == 1 (25m)");
    const { a, bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on a real 0x1d95 dispatch (A=${hx(entry.regs.a)} SP=${hx(entry.regs.sp)})`,
    );
    // The oracle's own output pins the 25m effect: flag cleared, sound untouched.
    assert.equal(a.mem.read8(FLAG), 0, "0x1d95 must clear the collection flag (A == 0 in play)");
    assert.equal(a.mem.read8(SND_PRIO), entry.mem.read8(SND_PRIO), "25m must not touch SND_PRIORITY");
    assertNoStackModel(entry);
  }
  console.log(`  REALISM/natural: ${caps.length} real 0x1d95 dispatch(es) — game-visible RAM identical to the oracle`);
});

// -- 2. REALISM / FORCED (breadth) --------------------------------------------

test("REALISM (forced): genuine 0x1d95 entries forced via entry_1c4f — RAM identical, SP/pc unmodelled", () => {
  const caps = captureForced(8, 8000);
  assert.ok(caps.length >= 1, "expected at least one forced 0x1d95 entry via the entry_1c4f path");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "the forced 25m attract dispatches 0x1d95 on BOARD == 1");
    const { bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) on a forced entry`,
    );
    assertNoStackModel(entry);
  }
  console.log(`  REALISM/forced: ${caps.length} genuine forced 0x1d95 entr(ies) — game-visible RAM identical`);
});

// -- 3. BOARD (exhaustive crafted) --------------------------------------------

test("BOARD (exhaustive): loc_1d95 == oracle over all 256 BOARD values (silent + sound arms)", () => {
  const base = craftedBase();
  let count = 0, silent = 0, sounded = 0, mismatch = null;
  for (let v = 0; v < 256 && !mismatch; v++) {
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    // Clean sound probes so "was the sound queued?" reads unambiguously.
    for (const m of [a, b]) { m.mem.write8(BOARD, v); m.mem.write8(SND_PRIO, 0x00); m.mem.write8(SND_FRAMES, 0x00); }
    oracle(a);
    idiomatic(b);
    count++;
    if (a.mem.read8(SND_PRIO) === 0x0d && a.mem.read8(SND_FRAMES) === 0x03) sounded++;
    else if (a.mem.read8(SND_PRIO) === 0x00) silent++;
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) mismatch = { v, bad };
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at BOARD=${hx(mismatch.v)}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 BOARD values");
  assert.equal(silent, 1, "exactly BOARD == 1 must be silent");
  assert.equal(sounded, 255, "every non-25m BOARD must queue tune 0x0D for 3 frames");
  console.log(`  BOARD/exhaustive: 256 values — RAM identical (silent on ${silent}, tune 0x0D on ${sounded})`);
});

// -- 4. STORE (A-sweep crafted) -----------------------------------------------

test("STORE (A-sweep): loc_1d95 commits A into 0x6225 faithfully over a curated A set", () => {
  const base = craftedBase();
  const AS = [0x00, 0x01, 0x02, 0x2a, 0x7f, 0x80, 0xa5, 0xff];
  for (const av of AS) {
    // Force the SOUND arm (BOARD 2) so the store is checked alongside the sound writes.
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    for (const m of [a, b]) { m.mem.write8(BOARD, 2); m.regs.a = av; }
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `A=${hx(av)}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
    assert.equal(a.mem.read8(FLAG), av, `oracle must store A=${hx(av)} into 0x6225`);
    assert.equal(b.mem.read8(FLAG), av, `idiomatic must store A=${hx(av)} into 0x6225`);
  }
  console.log(`  STORE/A-sweep: ${AS.length} A values — 0x6225 == A on both sides`);
});

// -- 5. TEETH -----------------------------------------------------------------

/** Twin (a): wrong sound tune (0x0C not 0x0D). */
function brokenWrongSound(m) {
  const { regs, mem } = m;
  mem.write8(FLAG, regs.a & 0xff);
  if (mem.read8(BOARD) === 1) return;
  mem.write8(SND_PRIO, 0x0c); // BUG: should be 0x0D
  mem.write8(SND_FRAMES, 0x03);
}

/** Twin (b): wrong board-gate (skip on BOARD == 2), so it plays the sound on 25m. */
function brokenWrongGate(m) {
  const { regs, mem } = m;
  mem.write8(FLAG, regs.a & 0xff);
  if (mem.read8(BOARD) === 2) return; // BUG: should be == 1
  mem.write8(SND_PRIO, 0x0d);
  mem.write8(SND_FRAMES, 0x03);
}

/** Twin (c): wrong store (constant 0), dropping A. */
function brokenWrongStore(m) {
  const { mem } = m;
  mem.write8(FLAG, 0x00); // BUG: should store A
  if (mem.read8(BOARD) === 1) return;
  mem.write8(SND_PRIO, 0x0d);
  mem.write8(SND_FRAMES, 0x03);
}

test("TEETH (wrong-sound): the 0x0C twin is CAUGHT in the BOARD sweep at 0x608A", () => {
  const base = craftedBase();
  const a = base.clone(), b = base.clone();
  const aFloor = a.regs.sp;
  for (const m of [a, b]) { m.mem.write8(BOARD, 2); m.mem.write8(SND_PRIO, 0x00); }
  oracle(a);
  brokenWrongSound(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the replay FAILED to catch a wrong sound tune — it is worthless");
  assert.equal(bad.addr, SND_PRIO, `expected the caught diff at 0x608A, got ${hx(bad.addr)}`);
  assert.equal(bad.a, 0x0d, "oracle must queue tune 0x0D");
  assert.equal(bad.b, 0x0c, "broken twin must queue tune 0x0C");
  console.log(`  TEETH/wrong-sound: caught at 0x608A (oracle=${hx(bad.a)} broken=${hx(bad.b)})`);
});

test("TEETH (wrong-gate): the skip-on-BOARD-2 twin is CAUGHT on a real 25m dispatch at 0x608A", () => {
  const base = craftedBase(); // real BOARD == 1 entry
  assert.equal(base.mem.read8(BOARD), 1, "crafted base must be a real 25m (BOARD == 1) entry");
  const { bad } = replay(base, brokenWrongGate);
  assert.notEqual(bad, null, "the replay FAILED to catch a wrong board-gate — it is worthless");
  assert.equal(bad.addr, SND_PRIO, `expected the caught diff at 0x608A, got ${hx(bad.addr)}`);
  assert.equal(bad.a, base.mem.read8(SND_PRIO), "oracle must leave SND_PRIORITY untouched on 25m");
  assert.equal(bad.b, 0x0d, "broken twin wrongly queues tune 0x0D on 25m");
  console.log(`  TEETH/wrong-gate: caught at 0x608A (oracle=${hx(bad.a)} broken=${hx(bad.b)})`);
});

test("TEETH (wrong-store): the constant-0 store twin is CAUGHT in the A-sweep at 0x6225", () => {
  const base = craftedBase();
  const a = base.clone(), b = base.clone();
  const aFloor = a.regs.sp;
  for (const m of [a, b]) { m.mem.write8(BOARD, 2); m.regs.a = 0xa5; } // A != 0 so the store matters
  oracle(a);
  brokenWrongStore(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the replay FAILED to catch a store that drops A — it is worthless");
  assert.equal(bad.addr, FLAG, `expected the caught diff at 0x6225, got ${hx(bad.addr)}`);
  assert.equal(bad.a, 0xa5, "oracle must store A into 0x6225");
  assert.equal(bad.b, 0x00, "broken twin stores constant 0");
  console.log(`  TEETH/wrong-store: caught at 0x6225 (oracle=${hx(bad.a)} broken=${hx(bad.b)})`);
});
