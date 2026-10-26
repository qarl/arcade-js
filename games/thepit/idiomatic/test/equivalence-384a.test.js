// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceAltPhaseActor (ROM 0x384a) — the per-frame animate + march
 * step for an active object (cadence tick + walk-tile flip, an every-4th-tick move that
 * marches the object across its travel row then descends it to the floor).
 *
 * The observable effect is the work/sprite RAM the object leaves behind: its coordinate
 * and tile, the shadow sprite's coordinate and tile, the arrival flag/latch, the floor
 * hold-timer, and the records its two already-decompiled callees rebuild — the sprite
 * records from stageActorSpriteRecords (0x3a4c) and, on the arrival arm, the deferral/probe
 * record from stageObjectSpriteRecord (0x1b5b). Both are now called directly (they read their inputs from,
 * and write their outputs to, fixed work RAM; neither takes an argument or returns a value),
 * so the routine's whole live-out is that RAM.
 *
 * WHY THE CONTRACT EXCLUDES THE STACK SCRATCH. The oracle reaches stageObjectSpriteRecord through a Z80
 * CALL, which pushes the return address 0x3897 to [SP-2, SP) — top of work RAM (0x8000-
 * 0x87ff), inside the diffed state region. The dissolved direct JS call makes no such push,
 * so those two bytes legitimately differ from the oracle on the arrival arm. They are dead
 * stack scratch (popped by the callee's ret, read by no one after), so the RAM diff excludes
 * exactly the [SP-2, SP) window and compares everything else byte-for-byte. pc and SP are CPU
 * registers, absent from the RAM dump, so they are already out of scope — no register or pc
 * comparison remains (the oracle threads an accumulator and pops a return address the
 * stack-free JS does not, all declared-dead live-out).
 *
 *   1. UNIT (first real dispatch) — capture the machine at the first natural dispatch and
 *      diff observable RAM (outside the stack scratch). The first dispatch is a march step,
 *      which exits through stageActorSpriteRecords and pushes no stack scratch at all, so
 *      it is identical byte-for-byte.
 *   2. REALISM (all real dispatches) — hook 0x384a through a whole attract run (it is
 *      dispatched in the gameplay demo, ~584 times after frame 4000), clone at each
 *      dispatch, and run oracle vs idiomatic on two fresh clones. Observable RAM identical
 *      on every one — covering the tail-early, march, descend, latch+probe, and floor-idle
 *      arms the demo actually produces.
 *   3. CRAFTED — force the arms the demo underexercises (the floor re-arm when the hold
 *      timer has elapsed, both tile-toggle directions, the latch+probe build) on a real
 *      captured background, poked identically on both sides. Observable RAM identical. The
 *      latch+probe arm is exactly the one where the oracle writes the stack scratch the
 *      dissolve drops, so its pass proves the exclusion window is correct.
 *   4. TEETH — a twin of the DISSOLVED routine (same direct calls) with the wrong shadow-X
 *      trailing offset (32 instead of 16) MUST be caught. The bad byte lands at the shadow-X
 *      field 0x811b, far from the excluded stack window, so the observable diff catches it.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-384a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_384a as oracle } from "../../translated/loc_384a.js";
import { advanceAltPhaseActor as idiomatic } from "../advanceAltPhaseActor.js";
import { stageActorSpriteRecords } from "../stageActorSpriteRecords.js";
import { stageObjectSpriteRecord } from "../stageObjectSpriteRecord.js";
import { makeMachineFactory } from "../../machine.js";
import { ENEMY3_TIMER, ENEMY3_TILE, ENEMY3_X, ENEMY3_Y, ENEMY3_TWIN_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const FLOOR_HOLD = 0x807c; // idles the object at the floor (unnamed in names.js)
const BIAS = 0x8051; // record-build bias read by the still-oracle callees

// The oracle reaches stageObjectSpriteRecord through a Z80 CALL that pushes a 2-byte return address to
// [SP-2, SP); the dissolved direct call makes no such push, so those two dead bytes differ.
const STACK_SCRATCH = 2;

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x384a;
const CAPTURE_FRAMES = 8000; // the demo (where the object lives) starts after ~frame 4000
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Run oracle and candidate on two FRESH clones of `entry`; return the first observable-RAM
 * difference, EXCLUDING the dead stack-scratch window [SP-STACK_SCRATCH, SP) the oracle's
 * callee return-address push parks below the entry stack pointer (which the stack-free direct
 * calls do not reproduce). Null when otherwise identical. pc and SP are CPU registers, absent
 * from the RAM dump, so they are already out of scope.
 */
function ramDiff(entry, candidate) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  candidate(b);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: sp - STACK_SCRATCH, hi: sp }, sp)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Capture a clone at every 0x384a dispatch across an attract run (the wrapper runs the
 *  oracle so the host proceeds normally). */
function captureDispatches() {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => { caps.push(mm.clone()); return oracle(mm); }]]);
  makeMachine(snapshot).runFrames(CAPTURE_FRAMES);
  return caps;
}

/** A crafted entry: a real captured background with the named object bytes poked. */
function craft(base, pokes) {
  const e = base.clone();
  for (const [addr, val] of pokes) e.mem.write8(addr, val);
  return e;
}

// -- 1. UNIT: observable RAM on the first real dispatch -----------------------

test("UNIT: idiomatic == oracle on observable RAM at the first real dispatch", () => {
  const caps = captureDispatches();
  assert.ok(caps.length >= 1, `expected at least one real 0x384a dispatch, got ${caps.length}`);

  const ram = ramDiff(caps[0], idiomatic);
  assert.equal(
    ram,
    null,
    ram && `observable RAM diverges at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b}) ` +
      `at the first real dispatch`,
  );
  console.log("  UNIT: first real dispatch (a march step, exits via stageActorSpriteRecords) — observable RAM identical");
});

// -- 2. REALISM: observable RAM over every real dispatch ----------------------

test("REALISM: idiomatic == oracle on observable RAM over every real attract dispatch", () => {
  const caps = captureDispatches();
  assert.ok(caps.length >= 100, `expected many real 0x384a dispatches, got ${caps.length}`);

  let checked = 0;
  for (const cap of caps) {
    const ram = ramDiff(cap, idiomatic);
    assert.equal(
      ram,
      null,
      ram && `RAM diverges at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b}) ` +
        `on dispatch ${checked}`,
    );
    checked++;
  }
  console.log(`  REALISM: ${checked} real dispatches — observable RAM identical to the oracle`);
});

// -- 3. CRAFTED: the arms the demo underexercises -----------------------------

test("CRAFTED: floor re-arm, tile toggles, and latch+probe match on real backgrounds", () => {
  const caps = captureDispatches();
  const bg = caps[caps.length - 1];

  // A move tick fires when the post-decrement timer is a multiple of 4; timer=5 gives a
  // clean move tick with no cadence underflow, timer=1 underflows (reload + tile flip).
  const crafted = [
    { tag: "floor re-arm (hold elapsed)", pokes: [[ENEMY3_TIMER, 5], [ENEMY3_Y, 0], [FLOOR_HOLD, 0]] },
    { tag: "floor idle (hold running)", pokes: [[ENEMY3_TIMER, 5], [ENEMY3_Y, 0], [FLOOR_HOLD, 0x40]] },
    { tag: "tile toggle A->B", pokes: [[ENEMY3_TIMER, 1], [ENEMY3_TILE, 46], [ENEMY3_Y, 0], [FLOOR_HOLD, 0x40]] },
    { tag: "tile toggle B->A", pokes: [[ENEMY3_TIMER, 1], [ENEMY3_TILE, 175], [ENEMY3_Y, 0], [FLOOR_HOLD, 0x40]] },
    { tag: "tile toggle other->A", pokes: [[ENEMY3_TIMER, 1], [ENEMY3_TILE, 99], [ENEMY3_Y, 0], [FLOOR_HOLD, 0x40]] },
    { tag: "march right", pokes: [[ENEMY3_TIMER, 5], [ENEMY3_Y, 30], [ENEMY3_X, 10]] },
    { tag: "march to far column (X edge)", pokes: [[ENEMY3_TIMER, 5], [ENEMY3_Y, 30], [ENEMY3_X, 35]] },
    { tag: "latch + probe build", pokes: [[ENEMY3_TIMER, 5], [ENEMY3_Y, 23], [ENEMY3_X, 40], [BIAS, 3]] },
    { tag: "descend", pokes: [[ENEMY3_TIMER, 5], [ENEMY3_Y, 30], [ENEMY3_X, 40]] },
    { tag: "tail-early (not a move tick)", pokes: [[ENEMY3_TIMER, 4]] },
  ];

  for (const { tag, pokes } of crafted) {
    const ram = ramDiff(craft(bg, pokes), idiomatic);
    assert.equal(ram, null, ram && `crafted "${tag}": RAM diverges at ${hx(ram.addr ?? 0)} (oracle=${ram.a} idiomatic=${ram.b})`);
  }
  console.log(`  CRAFTED: ${crafted.length} forced arms — observable RAM identical to the oracle`);
});

// -- 4. TEETH: a deliberately-broken twin MUST be caught ----------------------

/**
 * A twin of the DISSOLVED idiomatic routine (same direct calls) with ONE wrong constant:
 * the shadow sprite trails the object by 32 columns instead of 16. A real logic error on
 * the march arm — the bad byte lands at the shadow-X field 0x811b, far from the excluded
 * stack window, so the observable diff must catch it.
 */
function brokenShadowOffset(m) {
  const { mem } = m;
  mem.write8(ENEMY3_TIMER, mem.read8(ENEMY3_TIMER) - 1);
  let timer = mem.read8(ENEMY3_TIMER);
  if (timer === 0) {
    timer = 8;
    mem.write8(ENEMY3_TIMER, 8);
    const next = mem.read8(ENEMY3_TILE) === 46 ? 175 : 46;
    mem.write8(ENEMY3_TILE, next);
    mem.write8(0x811c, next ^ 1);
  }
  if (timer % 4 !== 0) return stageActorSpriteRecords(m);
  const y = mem.read8(ENEMY3_Y);
  if (y >= 23) {
    const x = mem.read8(ENEMY3_X);
    if (x < 36) {
      mem.write8(ENEMY3_X, x + 1);
      mem.write8(0x811b, mem.read8(ENEMY3_X) + 32); // BUG: shadow-X offset should be 16
      return stageActorSpriteRecords(m);
    }
    if (y === 23) {
      mem.write8(0x8079, 0);
      mem.write8(0x8068, 0);
      mem.write8(0x807d, 1);
      stageObjectSpriteRecord(m);
    }
  }
  const row = mem.read8(ENEMY3_Y);
  if (row !== 0) {
    const nextRow = row - 1;
    mem.write8(ENEMY3_Y, nextRow);
    mem.write8(0x811e, nextRow);
    return stageActorSpriteRecords(m);
  }
  if (mem.read8(FLOOR_HOLD) !== 0) return;
  mem.write8(FLOOR_HOLD, 120);
  mem.write8(ENEMY3_TILE, 9);
  mem.write8(0x811c, 9);
  return stageActorSpriteRecords(m);
}

test("TEETH: the wrong-shadow-offset twin is CAUGHT (observable RAM has teeth)", () => {
  const caps = captureDispatches();
  const bg = caps[caps.length - 1];
  const marchEntry = craft(bg, [[ENEMY3_TIMER, 5], [ENEMY3_Y, 30], [ENEMY3_X, 10]]);

  const ram = ramDiff(marchEntry, brokenShadowOffset);
  assert.ok(ram, "the wrong-shadow-offset twin must be caught by the observable-RAM diff on a march arm");
  assert.equal(
    ram.addr,
    ENEMY3_TWIN_X,
    `teeth caught the wrong address ${hx(ram.addr ?? 0)} (expected the shadow-X field ${hx(ENEMY3_TWIN_X)})`,
  );
  console.log(`  TEETH: caught at ${hx(ram.addr)} (oracle=${ram.a} twin=${ram.b})`);
});
