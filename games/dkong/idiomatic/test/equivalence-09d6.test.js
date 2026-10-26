// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for armTwoPlayerBoardSetup (ROM 0x09D6) — the 2-player board-setup arm:
 * clear two latches, post two enqueueTask draw tasks, advance GAME_SUBSTATE, then tail-call the
 * draw2UpLabel column painter. Gated by capture / clone / replay on the memory-equivalence
 * contract (RAM − the stack scratch below the entry SP); pc/SP are NOT compared — the routine used to import the frozen
 * loc_09ee whose tail `ret` kept pc/SP aligned, but the idiomatic draw2UpLabel models no `ret`,
 * so the idiomatic side leaves pc/SP two apart from the oracle. A pure seam artifact (RAM is
 * byte-identical); the whole-game SP guards (idiomatic "FULL FLIP", barrel-jump-reset) back-stop.
 *
 *   1. EQUAL (real driven dispatch) — a 2-coin + start-2 tape drives a real 2-player game (attract
 *      never reaches this arm); the arm dispatches once at game start and RAM matches game-visible.
 *   2. EQUAL (crafted arms) — FULL / WRAP / CLEAN ring states poked identically on both sides; the
 *      CLEAN arm pins the footprint (ring 03 02 02 01, tail 0xC0→0xC4, 0x600A=5, VRAM 02/25/20).
 *      The 0x7D86/0x7D87 latches are write-only (unread); the RAM diff covers the rest.
 *   3. TEETH — a twin posting the second task with the wrong opcode (0x0301 not 0x0201) MUST be
 *      caught; it diverges in the free ring slot on both the real and CLEAN-ring dispatches.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-09d6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_09d6 as oracle } from "../../translated/loc_09d6.js";
import { armTwoPlayerBoardSetup } from "../armTwoPlayerBoardSetup.js";
import { enqueueTask } from "../enqueueTask.js";
import { loc_09ee } from "../../translated/loc_09ee.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x09d6;
const TASK_TAIL = 0x60b0;
const RING_LO = 0x60c0, RING_HI = 0x60ff; // 32 slots x 2 bytes
const GAME_SUBSTATE = 0x600a;
const VRAM_CELLS = [0x74e0, 0x74c0, 0x74a0]; // the 3-cell column loc_09ee paints
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch (the tolerated push residue).
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

/**
 * Replay one entry state through the oracle and a candidate on independent clones and
 * return the RAM diff (RAM − the stack scratch below the entry SP). Live-out is memory-only; pc/SP diverge as a seam
 * artifact of the dissolved tail call (see the dissolution note) and are not compared.
 */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

// A 2-coin + start-2 tape credits and starts a real 2-player game (attract is a 1-player
// demo and never routes through this arm). IN2 (0x7D00): coin = bit7 (0x80), start2 = bit3 (0x08).
const TWO_PLAYER_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin 1
  { port: 0x7d00, bits: 0x80, frame: 30, dur: 6 }, // coin 2 (line must re-arm between coins)
  { port: 0x7d00, bits: 0x08, frame: 60, dur: 6 }, // start2
];

/**
 * Drive TWO_PLAYER_TAPE and clone the machine at up to K true 0x09D6 dispatches. The arm
 * fires once, at 2-player game start; the wrapper delegates to the oracle so the host run
 * proceeds. Capturing is fenced off after the host run.
 */
function captureDrivenDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.inputTape = TWO_PLAYER_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  return caps;
}

// Poke a whole ring state (fill + tail) IDENTICALLY on a real entry — a surgical crafted
// nudge (docs/decompiler-pipeline), not a fabrication.
const fillRing = (m, byte) => { for (let s = RING_LO; s <= RING_HI; s++) m.mem.write8(s, byte); };
const CLEAN = (m) => { fillRing(m, 0xff); m.mem.write8(TASK_TAIL, 0xc0); }; // all free, base
const FULL  = (m) => { fillRing(m, 0x00); m.mem.write8(TASK_TAIL, 0xc0); }; // all occupied
const WRAP  = (m) => { fillRing(m, 0xff); m.mem.write8(TASK_TAIL, 0xfc); }; // 2nd post wraps to base

// -- 1. EQUAL (real driven dispatch) ------------------------------------------

test("EQUAL (driven): armTwoPlayerBoardSetup == oracle on the real 2-player dispatch (RAM−stack)", () => {
  const caps = captureDrivenDispatches(8, 400);
  assert.ok(caps.length >= 1, "expected the 2-player board-setup arm to dispatch during a driven start-2 game");

  for (const entry of caps) {
    // Sanity: the routine really is reached in its 2-player board-setup context.
    assert.equal(entry.mem.read8(0x600f), 1, "TWO_PLAYER_GAME must be 1 at this dispatch");
    assert.equal(entry.mem.read8(GAME_SUBSTATE), 2, "GAME_SUBSTATE must be 2 at this dispatch");
    // The oracle's push traffic must land in dead stack scratch, so excluding the stack scratch below the entry SP
    // cannot mask a real diff — the entry SP sits inside the region.
    assert.ok(
      entry.regs.sp > STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `entry SP must sit inside STACK_SCRATCH so oracle pushes stay in-region (SP=${hx(entry.regs.sp)})`,
    );

    const { bad } = replay(entry, armTwoPlayerBoardSetup);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
  }
  console.log(`  EQUAL/driven: ${caps.length} real 2-player dispatch(es) — game-visible RAM identical`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): CLEAN / FULL / WRAP ring arms match the oracle, exact footprint pinned", () => {
  const caps = captureDrivenDispatches(1, 400);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  for (const [label, craft] of [["CLEAN", CLEAN], ["FULL", FULL], ["WRAP", WRAP]]) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    craft(a); craft(b);
    oracle(a);
    armTwoPlayerBoardSetup(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(`  EQUAL/crafted ${label}: tail 0x60b0 -> ${hx(a.mem.read8(TASK_TAIL))}, game-visible RAM identical`);
  }

  // Positive content check on a clean ring: the exact footprint this arm lays down.
  const b = entry.clone();
  CLEAN(b);
  armTwoPlayerBoardSetup(b);
  const ring = [0, 1, 2, 3].map((i) => b.mem.read8(RING_LO + i));
  assert.deepEqual(ring, [0x03, 0x02, 0x02, 0x01], `clean-ring payload mismatch: got ${ring.map(hx).join(" ")}`);
  assert.equal(b.mem.read8(TASK_TAIL), 0xc4, "tail must advance 0xC0 -> 0xC4 (two posts)");
  assert.equal(b.mem.read8(GAME_SUBSTATE), 0x05, "GAME_SUBSTATE must advance to 5");
  const vram = VRAM_CELLS.map((a) => b.mem.read8(a));
  assert.deepEqual(vram, [0x02, 0x25, 0x20], `VRAM column mismatch: got ${vram.map(hx).join(" ")}`);
  console.log(
    `  EQUAL/crafted footprint: ring ${ring.map((v) => v.toString(16).padStart(2, "0")).join(" ")}, ` +
      `tail -> 0xc4, 0x600a -> 5, column ${vram.map((v) => v.toString(16).padStart(2, "0")).join(" ")}`,
  );
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: posts the SECOND task with the wrong opcode (0x0301 instead of 0x0201 — the
 * first post's opcode 0x03 copy-pasted). It differs ONLY in that byte, so it diverges in the
 * ring wherever the slot was free (the opcode byte of the second post: 0x03 vs 0x02).
 */
function brokenArmTwoPlayerBoardSetup(m) {
  const { regs, mem } = m;
  mem.write8(0x7d86, 0x00);
  mem.write8(0x7d87, 0x00);
  regs.de = 0x0302;
  enqueueTask(m);
  regs.de = 0x0301; // BUG: opcode should be 0x02
  enqueueTask(m);
  mem.write8(GAME_SUBSTATE, 0x05);
  return loc_09ee(m);
}

test("TEETH: the wrong-second-opcode twin is CAUGHT (real free-ring dispatch + deterministic clean ring)", () => {
  const caps = captureDrivenDispatches(8, 400);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  // Captured catch: the real dispatch's ring slot is free, so the twin's wrong opcode shows.
  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenArmTwoPlayerBoardSetup);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch the wrong-opcode twin — it is worthless");

  // Deterministic clean-ring catch, independent of whatever ring state the game minted.
  const a = caps[0].clone(), b = caps[0].clone();
  const aFloor = a.regs.sp;
  CLEAN(a); CLEAN(b);
  oracle(a);
  brokenArmTwoPlayerBoardSetup(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "clean-ring sweep FAILED to catch the wrong-opcode twin");
  console.log(`  TEETH: caught at ${hx(caught.addr)} (captured) and ${hx(bad.addr)} (clean ring)`);
});
