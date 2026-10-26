// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceSpring (ROM 0x2E12) — the per-object scan's update entry: a four-way
 * active/state dispatcher with an inline default-motion arm.
 *
 * advanceSpring is dispatched once per object by update75mActorObjects. It routes the object four ways:
 *   • Inactive (active-flag bit0 clear) -> spawnObjectIntoInactiveSlot (0x2EA7).
 *   • Active, every 16 frames (FRAME&0x0f==0): flip the low 3 bits of the paired sprite's
 *     tile code (an animation flicker), THEN continue dispatching.
 *   • State 4 -> loc_2e84 (0x2E84): step Y / deactivate.
 *   • Otherwise: advance X by 2, read the next animation-string byte through the walk pointer —
 *     terminator (0x7f) -> loc_2e9c (0x2E9C, rewind) ; normal byte -> accumulate it into Y —
 *     both converging at advanceSpringArcAndDropAtTravelEnd (0x2E4B). Every arm ends in the shared cursor advance.
 * The idiomatic routine dissolves the oracle's four `jp` tails into direct calls to the
 * already-idiomatic callees, handing the shared tails the last string byte and the advanced
 * walk pointer through registers (the still-translated scan loop's register ABI).
 *
 * CONTRACT (memory-equivalence): RAM − the stack scratch below the entry SP (the inactive arm's spawn tail brackets
 * its stirRandomSeed call with push16/ret — two dead stack bytes the direct-call candidate never
 * writes, excluded; the other three arms perform no push/pop), SP (unchanged: the spawn arm's
 * push/ret balance, the candidate touches no stack), and the routine's declared REGISTER
 * live-out — the two advanced cursors (ix, iy), the remaining-object count (b) the loop feeds to
 * its djnz, and the leftover step (de). The scratch byte the oracle leaves in the accumulator,
 * its residual pointer register on the state-4 / inactive arms, and its landing pc are DEAD (the
 * loop reloads/re-derives them for the next object before any test), so none is compared.
 *
 * The dispatch factorises — each arm is selected by ONE cell (active-flag bit0, state, string
 * byte) and the toggle by FRAME&0x0f — so:
 *   1. EQUAL (sweeps) — active flag over 256 (only bit0 selects the inactive arm), state over
 *      256 (only 4 selects loc_2e84), string byte over 256 at a below- and an above-boundary X
 *      (only 0x7f selects the terminator rewind; the above-X sweep fires advanceSpringArcAndDropAtTravelEnd's transition),
 *      the sprite tile code over 256 with the toggle firing, and the frame phase over 16 (the
 *      toggle fires only on low-nibble 0). Each must match the oracle on the whole contract.
 *   2. EQUAL (grid) — the exact in-game cursor sequence, cross-producted, on the default arm.
 *   3. EQUAL (independence) — vary de/b/scratch regs and an unrelated RAM byte: output unchanged.
 *   4. REALISM (captured) — attract never reaches update75mActorObjects's loop; steer the game's own board/
 *      enable gates into the full 10-object pass with objects seeded across all four arms, hook
 *      0x2e12, capture the 10 real dispatches, and replay oracle vs candidate on each.
 *   5. TEETH — seven deliberately-broken twins (inverted active arm, wrong toggle bits, dropped
 *      toggle, wrong dispatch state, wrong X step, wrong terminator value, dropped Y accumulate);
 *      the SAME sweeps must catch every one, or the gate proves nothing.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2e12.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e12 as oracle } from "../../translated/loc_2e12.js";
import { advanceSpring as candidate } from "../advanceSpring.js";
import { spawnObjectIntoInactiveSlot } from "../spawnObjectIntoInactiveSlot.js"; // ROM 0x2EA7 (twins)
import { loc_2e84 } from "../loc_2e84.js"; // ROM 0x2E84 (twins)
import { loc_2e9c } from "../loc_2e9c.js"; // ROM 0x2E9C (twins)
import { advanceSpringArcAndDropAtTravelEnd } from "../advanceSpringArcAndDropAtTravelEnd.js"; // ROM 0x2E4B (twins)
import { loc_2e04 } from "../../translated/loc_2e04.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  FRAME,
  OBJ_ACTIVE,
  OBJ_STATE,
  OBJ_X,
  OBJ_Y,
  SPRITE_CODE,
  SPRITE_X,
  SPRITE_Y,
  OBJ_ARRAY_65,
  ACTOR_SPRITES,
  SPAWN_REQUEST,
  RANDOM,
  SPIN_COUNT,
  SND_TRIGGER,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2e12;
const OBJ_BASE = OBJ_ARRAY_65; // 0x6500 — object-record scan base (the object cursor / IX)
const SPR_BASE = ACTOR_SPRITES; // 0x6980 — paired sprite-record scan base (the sprite cursor / IY)
const OBJ_STR_PTR = 0x0e;       // object-record animation walk pointer (low +0x0e, high +0x0f)
const STR_SCRATCH = 0x6110;     // work-RAM cell the walk pointer aims at, so the string byte is controlled
const LOOP_COUNT = 0x0a;        // remaining-object count the loop holds while an object is processed
const JUNK_DE = 0x1234;         // nonzero incoming step; the advance tail overwrites it to 4
const SP_TOP = 0x6c00;          // stack top: the spawn arm's push16 return-bracket lands in STACK_SCRATCH
const DEST_SENTINEL = 0xee;     // pre-stamped sprite X/Y cells so a dropped/misplaced mirror write shows

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const hx16 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// First RAM byte that differs, skipping the stack scratch below the entry SP (the memory-equivalence
// contract is RAM − the stack scratch below the entry SP: the spawn arm's push16 return-bracket writes there). null | {addr,a,b}.
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

// The register live-out contract (what update75mActorObjects consumes after this dispatch) + de (conservative).
function regLiveOutDiff(o, c) {
  if (o.regs.ix !== c.regs.ix) return `ix oracle=${hx16(o.regs.ix)} cand=${hx16(c.regs.ix)}`;
  if (o.regs.iy !== c.regs.iy) return `iy oracle=${hx16(o.regs.iy)} cand=${hx16(c.regs.iy)}`;
  if (o.regs.b !== c.regs.b) return `b oracle=${hx(o.regs.b)} cand=${hx(c.regs.b)}`;
  if (o.regs.de !== c.regs.de) return `de oracle=${hx16(o.regs.de)} cand=${hx16(c.regs.de)}`;
  return null;
}

// Full contract: RAM − the stack scratch below the entry SP + SP (unchanged) + register live-out. null | string.
function contractDiff(o, c, liveFloor) {
  const ram = firstRamDiff(o, c, liveFloor);
  if (ram) return `RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`;
  if (o.regs.sp !== c.regs.sp) return `SP oracle=${hx16(o.regs.sp)} cand=${hx16(c.regs.sp)}`;
  return regLiveOutDiff(o, c);
}

// Set the compared registers on a clone (frame machinery already neutralised by clone();
// re-asserted so the oracle's internal stepping can never fire an NMI/frame).
function setInput(m, ix, iy) {
  m.regs.ix = ix;
  m.regs.iy = iy;
  m.regs.b = LOOP_COUNT;
  m.regs.de = JUNK_DE;
  m.regs.sp = SP_TOP;
  m.nextNmi = Infinity;
  m.nextBoundary = Infinity;
}

// Prepare one fresh entry (applied identically to oracle and candidate clones): cursors +
// registers set, the object record's dispatch fields poked, the walk pointer aimed at a
// controlled string byte, the sprite record's toggle-and-mirror cells stamped, and the spawn
// request + PRNG bytes seeded so the inactive arm is deterministic.
function prep(base, ix, iy, {
  active = 1, state = 0, strByte = 0x10, objX = 0x40, objY = 0x30,
  frame = 0x05, spriteCode = 0x11, spawnReq = 0x01, rnd = 0xa5, spin = 0x00,
} = {}) {
  const m = base.clone();
  setInput(m, ix, iy);
  m.mem.write8(ix + OBJ_ACTIVE, active);
  m.mem.write8(ix + OBJ_STATE, state);
  m.mem.write8(ix + OBJ_X, objX);
  m.mem.write8(ix + OBJ_Y, objY);
  m.mem.write8(ix + OBJ_STR_PTR, STR_SCRATCH & 0xff);
  m.mem.write8(ix + OBJ_STR_PTR + 1, (STR_SCRATCH >> 8) & 0xff);
  m.mem.write8(STR_SCRATCH, strByte);
  m.mem.write8(FRAME, frame);
  m.mem.write8(iy + SPRITE_CODE, spriteCode);
  m.mem.write8(iy + SPRITE_X, DEST_SENTINEL);
  m.mem.write8(iy + SPRITE_Y, DEST_SENTINEL);
  m.mem.write8(SPAWN_REQUEST, spawnReq);
  m.mem.write8(RANDOM, rnd);
  m.mem.write8(SPIN_COUNT, spin);
  return m;
}

// Run one entry through oracle vs `impl` at a record pair; full contract diff.
function compareOne(base, ix, iy, opts, impl) {
  const om = prep(base, ix, iy, opts);
  const omFloor = om.regs.sp;
  const cm = prep(base, ix, iy, opts);
  oracle(om);
  impl(cm);
  return contractDiff(om, cm, omFloor);
}

// The full arm-selector + toggle sweep, run in sequence; returns the first mismatch (or null)
// and the combos compared. Reused by the EQUAL proof and every TEETH twin.
function fullSweep(base, impl) {
  const ix = OBJ_BASE, iy = SPR_BASE;
  let count = 0;

  // Active-flag: only bit0 selects the inactive/spawn arm (even) vs default motion (odd).
  for (let a = 0; a < 256; a++) {
    const d = compareOne(base, ix, iy, { active: a, state: 0, strByte: 0x10, frame: 0x05, spawnReq: 0x01 }, impl);
    count++;
    if (d) return { mismatch: `active=${hx(a)}: ${d}`, count };
  }
  // State: only 4 selects loc_2e84; every other value takes default motion.
  for (let s = 0; s < 256; s++) {
    const d = compareOne(base, ix, iy, { active: 1, state: s, strByte: 0x10, frame: 0x05 }, impl);
    count++;
    if (d) return { mismatch: `state=${hx(s)}: ${d}`, count };
  }
  // String byte below the advanceSpringArcAndDropAtTravelEnd boundary (X=0x40): 0x7f rewinds (no transition); every other
  // byte takes default motion (X+=2, Y+=byte).
  for (let b = 0; b < 256; b++) {
    const d = compareOne(base, ix, iy, { active: 1, state: 0, strByte: b, objX: 0x40, frame: 0x05 }, impl);
    count++;
    if (d) return { mismatch: `strByte(lowX)=${hx(b)}: ${d}`, count };
  }
  // String byte above the boundary (X=0xc0 -> 0xc2 after +2): at 0x7f advanceSpringArcAndDropAtTravelEnd's transition arm
  // fires (state->4, sound), pinning the boundary + terminator conjunction through the tail.
  for (let b = 0; b < 256; b++) {
    const d = compareOne(base, ix, iy, { active: 1, state: 0, strByte: b, objX: 0xc0, frame: 0x05 }, impl);
    count++;
    if (d) return { mismatch: `strByte(highX)=${hx(b)}: ${d}`, count };
  }
  // Toggle: with the toggle firing (frame low-nibble 0), the sprite tile code flips its low 3
  // bits; sweep the code so a wrong-bit / dropped toggle diverges.
  for (let code = 0; code < 256; code++) {
    const d = compareOne(base, ix, iy, { active: 1, state: 0, strByte: 0x10, frame: 0x00, spriteCode: code }, impl);
    count++;
    if (d) return { mismatch: `toggle code=${hx(code)} (frame=0): ${d}`, count };
  }
  // Frame phase: the toggle fires only on low-nibble 0.
  for (let f = 0; f < 16; f++) {
    const d = compareOne(base, ix, iy, { active: 1, state: 0, strByte: 0x10, frame: f, spriteCode: 0x25 }, impl);
    count++;
    if (d) return { mismatch: `frame-phase=${hx(f)}: ${d}`, count };
  }

  return { mismatch: null, count };
}

const SWEEP_COUNT = 256 * 5 + 16;

// -- 1. EQUAL (sweeps) --------------------------------------------------------

test("EQUAL (sweeps): advanceSpring == oracle over all four arms + the sprite-code toggle", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = fullSweep(base, candidate);
  assert.equal(mismatch, null, mismatch || "");
  assert.equal(count, SWEEP_COUNT, "must run the active + state + string(×2) + toggle + frame-phase sweep");

  // Non-vacuity: the oracle really DOES the four distinct things, so a green sweep is agreement
  // on real work, not on four no-ops.
  const ix = OBJ_BASE, iy = SPR_BASE;

  // Inactive -> spawn: slot activated, request consumed, spawn Y=80.
  const spawn = prep(base, ix, iy, { active: 0, spawnReq: 0x01 });
  oracle(spawn);
  assert.equal(spawn.mem.read8(ix + OBJ_ACTIVE), 1, "inactive arm: oracle activates the slot");
  assert.equal(spawn.mem.read8(SPAWN_REQUEST), 0, "inactive arm: oracle consumes the spawn request");
  assert.equal(spawn.mem.read8(ix + OBJ_Y), 80, "inactive arm: oracle seeds Y=80");
  assert.equal(spawn.regs.ix, (ix + 16) & 0xffff, "inactive arm: object cursor advances by 16");

  // State 4 -> loc_2e84: Y steps by 3.
  const st4 = prep(base, ix, iy, { active: 1, state: 4, objY: 0x30, frame: 0x05 });
  oracle(st4);
  assert.equal(st4.mem.read8(ix + OBJ_Y), (0x30 + 3) & 0xff, "state-4 arm: Y steps by 3");
  assert.equal(st4.mem.read8(iy + SPRITE_Y), (0x30 + 3) & 0xff, "state-4 arm: sprite Y mirrors the stepped Y");

  // Terminator -> loc_2e9c: X still +2, walk pointer rewound to 0x39AA, wrap sound fired.
  const term = prep(base, ix, iy, { active: 1, state: 0, strByte: 0x7f, objX: 0x40, frame: 0x05 });
  oracle(term);
  assert.equal(term.mem.read8(ix + OBJ_X), (0x40 + 2) & 0xff, "terminator arm: X still advances by 2");
  assert.equal(term.mem.read8(ix + OBJ_STR_PTR), 0xaa, "terminator arm: walk pointer low rewound to 0x39AA");
  assert.equal(term.mem.read8(ix + OBJ_STR_PTR + 1), 0x39, "terminator arm: walk pointer high rewound");
  assert.equal(term.mem.read8(SND_TRIGGER + 3), 3, "terminator arm: wrap sound trigger fired");

  // Default motion: X +2, Y += the string byte.
  const move = prep(base, ix, iy, { active: 1, state: 0, strByte: 0x10, objX: 0x40, objY: 0x30, frame: 0x05 });
  oracle(move);
  assert.equal(move.mem.read8(ix + OBJ_X), (0x40 + 2) & 0xff, "default arm: X advances by 2");
  assert.equal(move.mem.read8(ix + OBJ_Y), (0x30 + 0x10) & 0xff, "default arm: Y accumulates the string byte");

  // Toggle really flips the low 3 bits when it fires (frame low-nibble 0), and does nothing else.
  const tog = prep(base, ix, iy, { active: 1, state: 4, frame: 0x00, spriteCode: 0x11 });
  oracle(tog);
  assert.equal(tog.mem.read8(iy + SPRITE_CODE), 0x11 ^ 0x07, "toggle: sprite code low 3 bits flipped when firing");
  const noTog = prep(base, ix, iy, { active: 1, state: 4, frame: 0x01, spriteCode: 0x11 });
  oracle(noTog);
  assert.equal(noTog.mem.read8(iy + SPRITE_CODE), 0x11, "toggle: sprite code untouched off-phase");

  console.log(`  EQUAL/sweeps: ${count} entries (4 arms + toggle) — RAM − the stack scratch below the entry SP + SP + live-out identical to the oracle`);
});

// -- 2. EQUAL (grid over the in-game cursor sequence) -------------------------

test("EQUAL (grid): the exact in-game cursor sequence, cross-producted, matches the oracle", () => {
  const base = new Machine(ROM).clone();
  let count = 0;
  for (let k = 0; k < 10; k++) {
    for (let j = 0; j < 10; j++) {
      const ix = (OBJ_BASE + 16 * k) & 0xffff;
      const iy = (SPR_BASE + 4 * j) & 0xffff;
      // Default arm, distinct position-dependent source bytes so a wrong field offset diverges.
      const d = compareOne(base, ix, iy, { active: 1, state: 0, strByte: 0x10, objX: (0x30 + k) & 0xff, objY: (0x40 + k) & 0xff, frame: 0x05 }, candidate);
      assert.equal(d, null, d ? `grid k=${k} j=${j} (ix=${hx16(ix)} iy=${hx16(iy)}): ${d}` : "");
      count++;
    }
  }
  assert.equal(count, 100);
  console.log(`  EQUAL/grid: ${count} in-game (object, sprite) cursor combos identical to the oracle`);
});

// -- 3. EQUAL (input independence) --------------------------------------------

test("EQUAL (independence): output depends ONLY on the cursors + their fields, not de/b/scratch/RAM", () => {
  const base = new Machine(ROM).clone();
  const ix = OBJ_BASE, iy = SPR_BASE;
  let count = 0;
  for (const de of [0x0000, 0x0004, 0x1234, 0xffff]) {
    for (const b of [0x01, 0x0a, 0xff]) {
      const om = prep(base, ix, iy, { active: 1, state: 0, strByte: 0x10, objX: 0x40, objY: 0x30, frame: 0x05 });
      const omFloor = om.regs.sp;
      const cm = prep(base, ix, iy, { active: 1, state: 0, strByte: 0x10, objX: 0x40, objY: 0x30, frame: 0x05 });
      for (const m of [om, cm]) {
        m.regs.de = de; m.regs.b = b;
        m.regs.a = 0x11; m.regs.c = 0x33; m.regs.h = 0x44; m.regs.l = 0x55;
        m.mem.write8(0x6100, 0xa5); // a work-RAM byte the routine must not read or write
      }
      oracle(om);
      candidate(cm);
      const d = contractDiff(om, cm, omFloor);
      assert.equal(d, null, d ? `de=${hx16(de)} b=${hx(b)}: ${d}` : "");
      assert.equal(cm.mem.read8(ix + OBJ_X), (0x40 + 2) & 0xff, "X must advance by 2 regardless of de/b");
      assert.equal(cm.mem.read8(ix + OBJ_Y), (0x30 + 0x10) & 0xff, "Y must accumulate the byte regardless of de/b");
      assert.equal(cm.regs.ix, (ix + 16) & 0xffff, "object cursor must advance by 16");
      assert.equal(cm.regs.iy, (iy + 4) & 0xffff, "sprite cursor must advance by 4");
      assert.equal(cm.regs.de, 4, "leftover step must be 4 regardless of incoming de");
      assert.equal(cm.regs.b, b, "remaining-object count must be preserved");
      count++;
    }
  }
  console.log(`  EQUAL/independence: ${count} (de,b,scratch,RAM) variations — output unchanged`);
});

// -- 4. REALISM (real captured dispatches) ------------------------------------

const TERM_SCRATCH = 0x6110; // captured-test walk target holding the terminator (0x7f)
const DEF_SCRATCH = 0x6112;  // captured-test walk target holding a normal byte (0x10)

// Classify which arm a captured dispatch state takes (for the mix non-vacuity check).
function armOf(cap) {
  const ix = cap.regs.ix;
  if ((cap.mem.read8(ix + OBJ_ACTIVE) & 0x01) === 0) return "inactive";
  if (cap.mem.read8(ix + OBJ_STATE) === 4) return "state4";
  const ptr = cap.mem.read8(ix + OBJ_STR_PTR) | (cap.mem.read8(ix + OBJ_STR_PTR + 1) << 8);
  return cap.mem.read8(ptr) === 0x7f ? "terminator" : "default";
}

// Steer update75mActorObjects's full 10-object loop with objects seeded across all four arms, then hook
// 0x2e12 to capture the real in-game dispatch states (attract never reaches the loop).
function captureRealDispatches() {
  const host = new Machine(ROM);
  host.runFrames(700); // realistic work RAM (0x2e12 does not dispatch in attract)
  const m = host.clone();
  m.regs.sp = SP_TOP;
  m.push16(0x4d17);          // sentinel caller-return for update75mActorObjects
  m.mem.write8(0x6227, 3);   // board = 3   -> rst 0x30 (A=0x04) passes
  m.mem.write8(0x6200, 1);   // enable bit0 -> rst 0x10 passes -> full 10-object loop
  m.mem.write8(FRAME, 0x00); // toggle fires for the active objects this pass
  m.mem.write8(SPAWN_REQUEST, 0x03); // a spawn pending (as sub_2fcb stores)
  m.mem.write8(TERM_SCRATCH, 0x7f);  // terminator byte for the terminator-arm objects
  m.mem.write8(DEF_SCRATCH, 0x10);   // a normal string byte for the default-arm objects

  for (let k = 0; k < 10; k++) {
    const ix = OBJ_BASE + 16 * k;
    if (k < 2) {
      m.mem.write8(ix + OBJ_ACTIVE, 0x00); // inactive -> spawn (k=0 consumes the request) / advance
    } else if (k < 4) {
      m.mem.write8(ix + OBJ_ACTIVE, 0x01);
      m.mem.write8(ix + OBJ_STATE, 0x04);  // state 4 -> loc_2e84
    } else if (k < 6) {
      m.mem.write8(ix + OBJ_ACTIVE, 0x01);
      m.mem.write8(ix + OBJ_STATE, 0x00);
      m.mem.write8(ix + OBJ_STR_PTR, TERM_SCRATCH & 0xff);       // walk -> terminator
      m.mem.write8(ix + OBJ_STR_PTR + 1, (TERM_SCRATCH >> 8) & 0xff);
      m.mem.write8(ix + OBJ_X, k === 4 ? 0xc0 : 0x40); // one above / one below the advanceSpringArcAndDropAtTravelEnd boundary
    } else {
      m.mem.write8(ix + OBJ_ACTIVE, 0x01);
      m.mem.write8(ix + OBJ_STATE, 0x00);
      m.mem.write8(ix + OBJ_STR_PTR, DEF_SCRATCH & 0xff);        // walk -> default motion
      m.mem.write8(ix + OBJ_STR_PTR + 1, (DEF_SCRATCH >> 8) & 0xff);
      m.mem.write8(ix + OBJ_X, (0x30 + k) & 0xff);
      m.mem.write8(ix + OBJ_Y, (0x40 + k) & 0xff);
    }
  }

  const caps = [];
  const hook = (mm) => {
    caps.push(mm.clone());
    return oracle(mm);
  };
  m.overrides.set(TARGET, hook);
  m.routines.set(TARGET, hook);
  loc_2e04(m);
  return caps;
}

test("REALISM: real captured 0x2e12 dispatches — advanceSpring matches the oracle across all four arms", () => {
  const caps = captureRealDispatches();
  assert.equal(caps.length, 10, "the steered full-loop update75mActorObjects should dispatch 0x2e12 once per object (10)");

  const seen = new Set();
  caps.forEach((cap, i) => {
    assert.equal(cap.regs.ix, (OBJ_BASE + 16 * i) & 0xffff, `dispatch ${i}: unexpected object cursor`);
    assert.equal(cap.regs.iy, (SPR_BASE + 4 * i) & 0xffff, `dispatch ${i}: unexpected sprite cursor`);
    seen.add(armOf(cap));
    const o = cap.clone();
    const c = cap.clone();
    o.nextNmi = Infinity; o.nextBoundary = Infinity;
    c.nextNmi = Infinity; c.nextBoundary = Infinity;
    oracle(o);
    candidate(c);
    const d = contractDiff(o, c, cap.regs.sp);
    assert.equal(d, null, d ? `real dispatch ${i} (ix=${hx16(cap.regs.ix)}, arm=${armOf(cap)}): ${d}` : "");
  });

  for (const arm of ["inactive", "state4", "terminator", "default"]) {
    assert.ok(seen.has(arm), `the captured mix should exercise the ${arm} arm`);
  }
  console.log(`  REALISM: ${caps.length} real 0x2e12 dispatches across ${[...seen].sort().join(", ")} — RAM − the stack scratch below the entry SP + SP + live-out == oracle`);
});

// -- 5. TEETH -----------------------------------------------------------------
//
// Each twin is a faithful copy of advanceSpring with ONE injected bug, calling the same idiomatic
// callees, so the ONLY difference is the mutation. The same fullSweep must catch every one.

/** (a) inverts the active arm: spawns when active, default when inactive. */
function brokenInvertedActive(m) {
  const { regs, mem } = m;
  const ix = regs.ix, iy = regs.iy;
  if ((mem.read8(ix + OBJ_ACTIVE) & 0x01) !== 0) { spawnObjectIntoInactiveSlot(m); return; } // BUG: inverted
  if ((mem.read8(FRAME) & 0x0f) === 0) mem.write8(iy + SPRITE_CODE, mem.read8(iy + SPRITE_CODE) ^ 0x07);
  if (mem.read8(ix + OBJ_STATE) === 4) { loc_2e84(m); return; }
  mem.write8(ix + OBJ_X, mem.read8(ix + OBJ_X) + 2);
  const ptr = mem.read8(ix + OBJ_STR_PTR) | (mem.read8(ix + OBJ_STR_PTR + 1) << 8);
  const strByte = mem.read8(ptr); regs.c = strByte;
  if (strByte === 0x7f) { loc_2e9c(m); return; }
  regs.hl = (ptr + 1) & 0xffff; mem.write8(ix + OBJ_Y, strByte + mem.read8(ix + OBJ_Y)); advanceSpringArcAndDropAtTravelEnd(m);
}
/** (b) toggles the wrong bits (flips the low 4, not the low 3). */
function brokenToggleBits(m) {
  const { regs, mem } = m;
  const ix = regs.ix, iy = regs.iy;
  if ((mem.read8(ix + OBJ_ACTIVE) & 0x01) === 0) { spawnObjectIntoInactiveSlot(m); return; }
  if ((mem.read8(FRAME) & 0x0f) === 0) mem.write8(iy + SPRITE_CODE, mem.read8(iy + SPRITE_CODE) ^ 0x0f); // BUG
  if (mem.read8(ix + OBJ_STATE) === 4) { loc_2e84(m); return; }
  mem.write8(ix + OBJ_X, mem.read8(ix + OBJ_X) + 2);
  const ptr = mem.read8(ix + OBJ_STR_PTR) | (mem.read8(ix + OBJ_STR_PTR + 1) << 8);
  const strByte = mem.read8(ptr); regs.c = strByte;
  if (strByte === 0x7f) { loc_2e9c(m); return; }
  regs.hl = (ptr + 1) & 0xffff; mem.write8(ix + OBJ_Y, strByte + mem.read8(ix + OBJ_Y)); advanceSpringArcAndDropAtTravelEnd(m);
}
/** (c) drops the toggle entirely. */
function brokenDroppedToggle(m) {
  const { regs, mem } = m;
  const ix = regs.ix;
  if ((mem.read8(ix + OBJ_ACTIVE) & 0x01) === 0) { spawnObjectIntoInactiveSlot(m); return; }
  // BUG: no toggle
  if (mem.read8(ix + OBJ_STATE) === 4) { loc_2e84(m); return; }
  mem.write8(ix + OBJ_X, mem.read8(ix + OBJ_X) + 2);
  const ptr = mem.read8(ix + OBJ_STR_PTR) | (mem.read8(ix + OBJ_STR_PTR + 1) << 8);
  const strByte = mem.read8(ptr); regs.c = strByte;
  if (strByte === 0x7f) { loc_2e9c(m); return; }
  regs.hl = (ptr + 1) & 0xffff; mem.write8(ix + OBJ_Y, strByte + mem.read8(ix + OBJ_Y)); advanceSpringArcAndDropAtTravelEnd(m);
}
/** (d) dispatches loc_2e84 on the wrong state (5, not 4). */
function brokenWrongState(m) {
  const { regs, mem } = m;
  const ix = regs.ix, iy = regs.iy;
  if ((mem.read8(ix + OBJ_ACTIVE) & 0x01) === 0) { spawnObjectIntoInactiveSlot(m); return; }
  if ((mem.read8(FRAME) & 0x0f) === 0) mem.write8(iy + SPRITE_CODE, mem.read8(iy + SPRITE_CODE) ^ 0x07);
  if (mem.read8(ix + OBJ_STATE) === 5) { loc_2e84(m); return; } // BUG: should be 4
  mem.write8(ix + OBJ_X, mem.read8(ix + OBJ_X) + 2);
  const ptr = mem.read8(ix + OBJ_STR_PTR) | (mem.read8(ix + OBJ_STR_PTR + 1) << 8);
  const strByte = mem.read8(ptr); regs.c = strByte;
  if (strByte === 0x7f) { loc_2e9c(m); return; }
  regs.hl = (ptr + 1) & 0xffff; mem.write8(ix + OBJ_Y, strByte + mem.read8(ix + OBJ_Y)); advanceSpringArcAndDropAtTravelEnd(m);
}
/** (e) advances X by the wrong step (1, not 2). */
function brokenXStep(m) {
  const { regs, mem } = m;
  const ix = regs.ix, iy = regs.iy;
  if ((mem.read8(ix + OBJ_ACTIVE) & 0x01) === 0) { spawnObjectIntoInactiveSlot(m); return; }
  if ((mem.read8(FRAME) & 0x0f) === 0) mem.write8(iy + SPRITE_CODE, mem.read8(iy + SPRITE_CODE) ^ 0x07);
  if (mem.read8(ix + OBJ_STATE) === 4) { loc_2e84(m); return; }
  mem.write8(ix + OBJ_X, mem.read8(ix + OBJ_X) + 1); // BUG: should be + 2
  const ptr = mem.read8(ix + OBJ_STR_PTR) | (mem.read8(ix + OBJ_STR_PTR + 1) << 8);
  const strByte = mem.read8(ptr); regs.c = strByte;
  if (strByte === 0x7f) { loc_2e9c(m); return; }
  regs.hl = (ptr + 1) & 0xffff; mem.write8(ix + OBJ_Y, strByte + mem.read8(ix + OBJ_Y)); advanceSpringArcAndDropAtTravelEnd(m);
}
/** (f) uses the wrong terminator value (0x7e, not 0x7f). */
function brokenTerminator(m) {
  const { regs, mem } = m;
  const ix = regs.ix, iy = regs.iy;
  if ((mem.read8(ix + OBJ_ACTIVE) & 0x01) === 0) { spawnObjectIntoInactiveSlot(m); return; }
  if ((mem.read8(FRAME) & 0x0f) === 0) mem.write8(iy + SPRITE_CODE, mem.read8(iy + SPRITE_CODE) ^ 0x07);
  if (mem.read8(ix + OBJ_STATE) === 4) { loc_2e84(m); return; }
  mem.write8(ix + OBJ_X, mem.read8(ix + OBJ_X) + 2);
  const ptr = mem.read8(ix + OBJ_STR_PTR) | (mem.read8(ix + OBJ_STR_PTR + 1) << 8);
  const strByte = mem.read8(ptr); regs.c = strByte;
  if (strByte === 0x7e) { loc_2e9c(m); return; } // BUG: should be 0x7f
  regs.hl = (ptr + 1) & 0xffff; mem.write8(ix + OBJ_Y, strByte + mem.read8(ix + OBJ_Y)); advanceSpringArcAndDropAtTravelEnd(m);
}
/** (g) drops the Y accumulation on the default arm. */
function brokenNoYAccum(m) {
  const { regs, mem } = m;
  const ix = regs.ix, iy = regs.iy;
  if ((mem.read8(ix + OBJ_ACTIVE) & 0x01) === 0) { spawnObjectIntoInactiveSlot(m); return; }
  if ((mem.read8(FRAME) & 0x0f) === 0) mem.write8(iy + SPRITE_CODE, mem.read8(iy + SPRITE_CODE) ^ 0x07);
  if (mem.read8(ix + OBJ_STATE) === 4) { loc_2e84(m); return; }
  mem.write8(ix + OBJ_X, mem.read8(ix + OBJ_X) + 2);
  const ptr = mem.read8(ix + OBJ_STR_PTR) | (mem.read8(ix + OBJ_STR_PTR + 1) << 8);
  const strByte = mem.read8(ptr); regs.c = strByte;
  if (strByte === 0x7f) { loc_2e9c(m); return; }
  regs.hl = (ptr + 1) & 0xffff; /* BUG: dropped mem.write8(ix + OBJ_Y, ...) */ advanceSpringArcAndDropAtTravelEnd(m);
}

test("TEETH: the same sweeps CATCH every broken twin", () => {
  const base = new Machine(ROM).clone();
  const twins = [
    ["inverted active arm", brokenInvertedActive],
    ["wrong toggle bits", brokenToggleBits],
    ["dropped toggle", brokenDroppedToggle],
    ["wrong dispatch state", brokenWrongState],
    ["wrong X step", brokenXStep],
    ["wrong terminator value", brokenTerminator],
    ["dropped Y accumulate", brokenNoYAccum],
  ];
  for (const [name, twin] of twins) {
    const { mismatch } = fullSweep(base, twin);
    assert.notEqual(mismatch, null, `the sweep FAILED to catch "${name}" — the gate is worthless`);
    console.log(`  TEETH/${name}: caught — ${mismatch}`);
  }
});
