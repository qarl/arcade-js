// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for activateReleasedBarrel (ROM 0x2D8C) — the string renderer's 0x7F terminator:
 * reinitialise the object record it was building (fields +0..+0x14), copy two bytes out
 * of the renderer's destination pointer into it, then reload the ten-record sprite-object
 * block from a ROM template and add -4 to its Y column.
 *
 * activateReleasedBarrel WRITES MEMORY, so it is gated on memory-equivalence, not a returned scalar,
 * and every case runs on FRESH clones. The contract is RAM (minus the stack scratch below the entry SP) + pc +
 * SP — the routine's live-out is memory-only (it is a render-loop terminator; the caller
 * reads none of the residual registers). The oracle DISSOLVES two internal call brackets
 * (`call 0x004E` -> loadSpriteObjectBlock and `rst 0x38` -> addToSpriteObjectColumn): each
 * push16 lands in the dead STACK_SCRATCH region (captured SP is 0x6bec/0x6bee, so the
 * pushes at SP-2/SP-4 sit inside [0x6be0,0x6c00)), and the idiomatic routine replaces both
 * with direct calls that touch no stack. The oracle also ends on one terminal `ret` that
 * pops the caller's return; the idiomatic routine models that as a JS return, so the
 * harness performs one m.ret() on the candidate AFTER the call to line pc + SP up.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x2D8C in a real attract run and clone the
 *      machine at each true dispatch (the renderer fires them from 25m barrel play,
 *      IX at an object record 0x67xx, DE at a sprite slot 0x698x). Both BARREL_CLAIM_MODE bit0 arms
 *      occur naturally. Each captured entry: run the ORACLE on one clone and activateReleasedBarrel on
 *      another, confirm identical RAM + pc + SP.
 *
 *   2. EQUAL (crafted) — seed from a real capture, then poke BARREL_CLAIM_MODE to force BOTH mode
 *      arms explicitly (bit0 SET -> +1=1; bit0 CLEAR -> +1=0,+2=2) and poke distinctive
 *      source bytes at the destination pointer to prove they are copied into +3 and +5.
 *
 *   3. TEETH — two broken twins, each MUST be caught:
 *      (a) wrong mode init — writes 3 (not 2) at +2 on the CLEAR arm; caught at the +2 byte.
 *      (b) dropped Y-column nudge — skips addToSpriteObjectColumn; caught in the reloaded
 *          sprite block (its Y column is left 4 higher than the oracle's).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2d8c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d8c as oracle } from "../../translated/loc_2d8c.js";
import { activateReleasedBarrel } from "../activateReleasedBarrel.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { addToSpriteObjectColumn } from "../addToSpriteObjectColumn.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK, BARREL_CLAIM_MODE, OBJ_ACTIVE, OBJ_X, OBJ_Y, SPRITE_Y } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2d8c;
const Y_COLUMN = SPRITE_OBJ_BLOCK + 3; // 0x690b — the sprite block's Y column
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/**
 * First RAM byte that differs between two machines, skipping the stack scratch below the entry SP
 * region — the two dissolved call brackets push their return addresses there, so the
 * standard exclusion is exactly what the memory-equivalence contract calls for.
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

/** Run the ORACLE on a fresh clone. It performs its own terminal `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its terminal `ret` with one m.ret() so
 * pc + SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Full contract diff: RAM − the stack scratch below the entry SP, pc, SP. Live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x2D8C in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Every terminator dispatch (m.call(0x2d8c)) is captured here.
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

// -- broken twins -------------------------------------------------------------

/** Twin (a): on the CLEAR mode arm writes 3 at +2 instead of 2. Caught at the +2 byte. */
function brokenWrongModeInit(m) {
  const { regs, mem } = m;
  const obj = regs.ix;
  const renderPtr = regs.de;
  mem.write16(0x62a8, 0x39c3);
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x01) !== 0) {
    mem.write8(obj + 0x01, 0x01);
  } else {
    mem.write8(obj + 0x01, 0x00);
    mem.write8(obj + 0x02, 0x03); // BUG: should be 0x02
  }
  mem.write8(obj + OBJ_ACTIVE, 0x01);
  mem.write8(obj + 0x0f, 0x01);
  for (const off of [0x10, 0x11, 0x12, 0x13, 0x14]) mem.write8(obj + off, 0x00);
  mem.write8(0x6393, 0x00);
  mem.write8(0x6392, 0x00);
  mem.write8(obj + OBJ_X, mem.read8(renderPtr));
  mem.write8(obj + OBJ_Y, mem.read8(renderPtr + SPRITE_Y));
  regs.hl = 0x385c;
  loadSpriteObjectBlock(m);
  regs.hl = Y_COLUMN;
  regs.c = 0xfc;
  addToSpriteObjectColumn(m);
}

/** Twin (b): omits the Y-column nudge. Caught in the reloaded sprite block's Y column. */
function brokenDropColumnNudge(m) {
  const { regs, mem } = m;
  const obj = regs.ix;
  const renderPtr = regs.de;
  mem.write16(0x62a8, 0x39c3);
  if ((mem.read8(BARREL_CLAIM_MODE) & 0x01) !== 0) {
    mem.write8(obj + 0x01, 0x01);
  } else {
    mem.write8(obj + 0x01, 0x00);
    mem.write8(obj + 0x02, 0x02);
  }
  mem.write8(obj + OBJ_ACTIVE, 0x01);
  mem.write8(obj + 0x0f, 0x01);
  for (const off of [0x10, 0x11, 0x12, 0x13, 0x14]) mem.write8(obj + off, 0x00);
  mem.write8(0x6393, 0x00);
  mem.write8(0x6392, 0x00);
  mem.write8(obj + OBJ_X, mem.read8(renderPtr));
  mem.write8(obj + OBJ_Y, mem.read8(renderPtr + SPRITE_Y));
  regs.hl = 0x385c;
  loadSpriteObjectBlock(m);
  // BUG: the addToSpriteObjectColumn nudge is dropped entirely.
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): activateReleasedBarrel == oracle on every captured 0x2D8C entry", () => {
  const caps = captureDispatches(64, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x2D8C dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, activateReleasedBarrel); // FRESH clones inside — cap is untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const arms = new Set(caps.map((c) => c.mem.read8(BARREL_CLAIM_MODE) & 0x01));
  const ixs = new Set(caps.map((c) => c.regs.ix));
  console.log(
    `  EQUAL/real: ${caps.length} captured dispatches identical to the oracle ` +
      `(BARREL_CLAIM_MODE bit0 arms seen { ${[...arms].sort().join(", ")} }, ` +
      `${ixs.size} distinct object records)`,
  );
  assert.ok(caps.length >= 2, "expected several real dispatches for coverage");
});

// -- 2. EQUAL (crafted: both mode arms + source-byte copy) --------------------

test("EQUAL (crafted): both BARREL_CLAIM_MODE mode arms and the +3/+5 source copy match the oracle", () => {
  const caps = captureDispatches(1, 3000);
  assert.ok(caps.length >= 1, "need one real capture to seed crafted entries with real RAM");
  const seed = caps[0];

  // Seed a crafted entry from real captured RAM: force the mode bit and stamp distinctive
  // source bytes at the renderer's destination pointer (DE) so the +3/+5 copy is observable.
  const craft = (modeBit, srcHere, srcThree) => {
    const e = seed.clone();
    e.mem.write8(BARREL_CLAIM_MODE, modeBit); // bit0 SET (1) or CLEAR (0)
    e.mem.write8(e.regs.de, srcHere); // -> record +3
    e.mem.write8((e.regs.de + 3) & 0xffff, srcThree); // -> record +5
    return e;
  };

  const cases = [
    { name: "mode bit SET (+1=1, +2 untouched)", e: craft(0x01, 0xa5, 0x5a), set: true },
    { name: "mode bit CLEAR (+1=0, +2=2)", e: craft(0x00, 0x3c, 0xc3), set: false },
    { name: "mode bit SET, odd source bytes", e: craft(0x01, 0x00, 0xff), set: true },
    { name: "mode bit CLEAR, high BARREL_CLAIM_MODE byte (only bit0 matters)", e: craft(0xfe, 0x11, 0x22), set: false },
  ];

  for (const { name, e, set } of cases) {
    const diffs = contractDiffs(e, activateReleasedBarrel);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Confirm the crafted path really exercised the intended arm + copy, via the oracle.
    const after = runOracle(e);
    const obj = e.regs.ix;
    assert.equal(after.mem.read8(obj + 0x01), set ? 0x01 : 0x00, `${name}: +1 mode byte`);
    if (!set) assert.equal(after.mem.read8(obj + 0x02), 0x02, `${name}: +2 not marked on CLEAR arm`);
    assert.equal(after.mem.read8(obj + OBJ_X), e.mem.read8(e.regs.de), `${name}: OBJ_X source copy`);
    assert.equal(after.mem.read8(obj + OBJ_Y), e.mem.read8((e.regs.de + SPRITE_Y) & 0xffff), `${name}: OBJ_Y source copy`);
  }
  console.log(`  EQUAL/crafted: ${cases.length} arms (both mode selects, +3/+5 source copy) identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-mode-init twin and the dropped-Y-nudge twin are CAUGHT", () => {
  const caps = captureDispatches(16, 3000);
  assert.ok(caps.length >= 1, "need a real capture to run the teeth twins");

  // (a) wrong +2 init — only visible on the CLEAR mode arm, so craft one.
  const clear = caps[0].clone();
  clear.mem.write8(BARREL_CLAIM_MODE, 0x00);
  const modeDiffs = contractDiffs(clear, brokenWrongModeInit);
  assert.ok(modeDiffs.length > 0, "the wrong-mode-init twin escaped — the gate is worthless");
  const obj = clear.regs.ix;
  assert.ok(
    modeDiffs[0].startsWith(`RAM@0x${(obj + 0x02).toString(16)}`),
    `expected the mode-init diff at record +2 (0x${(obj + 0x02).toString(16)}), got ${modeDiffs[0]}`,
  );

  // (b) dropped Y-column nudge — caught on every real dispatch (the Y column always moves).
  let caught = 0;
  for (const cap of caps) {
    const d = contractDiffs(cap, brokenDropColumnNudge);
    if (d.length > 0) caught++;
  }
  assert.equal(caught, caps.length, `the dropped-Y-nudge twin escaped on ${caps.length - caught}/${caps.length} dispatches`);
  const sampleY = contractDiffs(caps[0], brokenDropColumnNudge)[0];
  assert.ok(
    sampleY.startsWith(`RAM@0x${Y_COLUMN.toString(16)}`),
    `expected the dropped-nudge diff at the Y column 0x${Y_COLUMN.toString(16)}, got ${sampleY}`,
  );

  console.log(
    `  TEETH: wrong-mode-init caught (${modeDiffs[0]}); ` +
      `dropped-Y-nudge caught on all ${caps.length} dispatches (${sampleY})`,
  );
});
