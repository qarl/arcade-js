// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2281 (ROM 0x2281–0x2289) — step Mario down one pixel, held in the
 * climb-down pose (slide50mObjectDown's Y-descend tail).
 *
 * descend_2281 does three things, all memory side-effects: increment MARIO_Y (0x6205),
 * call 0x3FC0 (which pins the sprite pose byte 0x694D to 3 and returns a pointer to the
 * sprite record's Y byte 0x694F), then increment that sprite-record Y. The idiomatic
 * routine DIRECT-CALLS loc_3fc0 instead of the oracle's push16/`call 0x3FC0`/internal
 * `ret` bracket, so the dissolved bracket's push (the byte pair 0x2288) lands in the dead
 * STACK_SCRATCH region and nowhere else — the contract therefore excludes STACK_SCRATCH,
 * exactly the memory-equivalence contract for a dissolved call.
 *
 * LIVE-OUT is memory-only: 0x2281 is tail-reached from slide50mObjectDown -> dispatch50mObjectState's dispatcher,
 * which returns into loc_197a at 0x199E, whose next statement issues a fresh `call`
 * without reading any register the descend leaves. So no register/flag is a live-out; the
 * gate compares RAM (minus the stack scratch below the entry SP) + pc + SP after modelling the terminal `ret`.
 *
 * 0x2281 is NOT dispatched during attract (its only caller is the still-translated,
 * unwired slide50mObjectDown), so capture yields nothing. That is fine here: the routine's effect
 * is input-independent, so the proof runs it against the oracle over many self-consistent
 * base states with MARIO_Y and the three sprite record bytes (code / attr / Y) pre-poked
 * to ADVERSARIAL values (including the 0xFF -> 0x00 wrap), and shows the two Y bytes step
 * by one, the pose byte is pinned to 3, the attribute neighbour is untouched, and nothing
 * else (outside stack scratch) moves.
 *
 *   1. EQUAL (adversarial grid) — loc_2281 == oracle across base states × pre-poked
 *      {marioY, code, attr, y}. RAM − the stack scratch below the entry SP, pc, SP identical; and the specific
 *      invariants pinned: 0x6205 stepped, 0x694D == 3, 0x694E untouched, 0x694F stepped.
 *
 *   2. TEETH — three broken twins, each MUST be caught:
 *      (a) skip the logical-Y step — leaves MARIO_Y unchanged; caught at 0x6205.
 *      (b) skip the sprite-Y step — leaves 0x694F unchanged; caught at 0x694F.
 *      (c) step the wrong sprite byte — increments the attribute byte (0x694E) instead of
 *          the Y byte; caught at 0x694E.
 *
 *   3. REACHABILITY (informational) — hook 0x2281 across a long attract run and confirm it
 *      is not naturally dispatched (documents why crafted entries stand in); any dispatch
 *      that DID occur is verified against the oracle too.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2281.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2281 as oracle } from "../../translated/loc_2281.js";
import { stepMarioDownInClimbPose as loc_2281 } from "../stepMarioDownInClimbPose.js";
import { pinMarioClimbPose as loc_3fc0 } from "../pinMarioClimbPose.js";
import { Machine } from "../../machine.js";
import {
  MARIO_Y,
  MARIO_SPRITE_RECORD,
  SPRITE_CODE,
  SPRITE_ATTR,
  SPRITE_Y,
  STACK_SCRATCH,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2281;
const RET_ADDR = 0x199e; // the real caller-return site (loc_197a, after its `call 0x2207`)

const CODE_CELL = MARIO_SPRITE_RECORD + SPRITE_CODE; // 0x694D — pinned to 3 by loc_3fc0
const ATTR_CELL = MARIO_SPRITE_RECORD + SPRITE_ATTR; // 0x694E — stepped over, never written
const Y_CELL = MARIO_SPRITE_RECORD + SPRITE_Y;       // 0x694F — the sprite Y that gets stepped

const hx = (v) => "0x" + (v & 0xffff).toString(16);

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

/**
 * A crafted 0x2281 entry: a clone of `base` with a controlled stack (so the oracle's
 * terminal `ret` is well-defined), and MARIO_Y plus the three sprite record bytes
 * pre-poked to chosen values so the two increments and the untouched neighbour are all
 * pinned by adversarial data.
 */
function craft(base, { marioY = 0x40, code = 0x00, attr = 0xaa, y = 0x55, sp = 0x6c00 } = {}) {
  const m = base.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
  m.regs.sp = sp;
  m.push16(RET_ADDR);
  m.mem.write8(MARIO_Y, marioY);
  m.mem.write8(CODE_CELL, code);
  m.mem.write8(ATTR_CELL, attr);
  m.mem.write8(Y_CELL, y);
  return m;
}

function contractDiffs(entry, candidate) {
  const o = entry.clone();
  oracle(o); // inc MARIO_Y, call 0x3FC0 (pose->3), inc sprite Y, then ret

  const c = entry.clone();
  candidate(c); // same memory effect, direct-call loc_3fc0, no stack touched
  c.ret();      // model the terminal ret to align pc + SP with the oracle

  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// A few real, self-consistent base machines (fresh power-on + several attract depths), so
// the crafted bytes sit inside genuine work RAM rather than a blank image.
function baseMachines() {
  const bases = [];
  for (const frames of [0, 60, 180, 600]) {
    const m = new Machine(ROM);
    if (frames > 0) m.runFrames(frames);
    bases.push(m.clone());
  }
  return bases;
}

// -- 1. EQUAL (adversarial grid) ----------------------------------------------

test("EQUAL: loc_2281 == oracle across base states × adversarial MARIO_Y and sprite bytes", () => {
  const bases = baseMachines();
  const marioYs = [0x00, 0x40, 0x67, 0xff]; // logical Y, incl. the 0xFF -> 0x00 wrap
  const codes = [0x00, 0x03, 0x88, 0xff];   // prior pose byte, incl. one already == 3 and the hammer code
  const attrs = [0x00, 0xaa];               // neighbour that must stay untouched
  const ys = [0x00, 0x55, 0xff];            // sprite Y, incl. the 0xFF -> 0x00 wrap

  let count = 0;
  for (const base of bases) {
    for (const marioY of marioYs) {
      for (const code of codes) {
        for (const attr of attrs) {
          for (const y of ys) {
            const entry = craft(base, { marioY, code, attr, y });
            const diffs = contractDiffs(entry, loc_2281);
            count++;
            assert.equal(
              diffs.length,
              0,
              `marioY=${hx(marioY)} code=${hx(code)} attr=${hx(attr)} y=${hx(y)}: ${diffs.join("; ")}`,
            );

            // Pin the exact invariants the routine is claimed to produce (read off a fresh
            // oracle run so this also documents the oracle's own effect).
            const o = entry.clone();
            oracle(o);
            assert.equal(o.mem.read8(MARIO_Y), (marioY + 1) & 0xff, "logical Y must step by one");
            assert.equal(o.mem.read8(CODE_CELL), 3, "sprite pose byte must be pinned to 3");
            assert.equal(o.mem.read8(ATTR_CELL), attr, "attribute neighbour must be untouched");
            assert.equal(o.mem.read8(Y_CELL), (y + 1) & 0xff, "sprite Y must step by one");
          }
        }
      }
    }
  }
  assert.ok(count >= 4 * 4 * 4 * 2 * 3, "must have compared the full adversarial grid");
  console.log(`  EQUAL: ${count} (base × marioY × code × attr × y) combos — RAM−STACK + pc + SP identical`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** (a) skip the logical-Y step: leaves MARIO_Y unchanged. */
function brokenSkipLogicalY(m) {
  const { mem } = m;
  // BUG: no MARIO_Y increment
  const spriteYPtr = loc_3fc0(m);
  mem.write8(spriteYPtr, mem.read8(spriteYPtr) + 1);
}

/** (b) skip the sprite-Y step: pins the pose but never steps the sprite Y. */
function brokenSkipSpriteY(m) {
  const { mem } = m;
  mem.write8(MARIO_Y, mem.read8(MARIO_Y) + 1);
  loc_3fc0(m); // BUG: dropped the sprite-Y increment
}

/** (c) step the wrong sprite byte: increments the attribute byte, not the Y byte. */
function brokenWrongSpriteByte(m) {
  const { mem } = m;
  mem.write8(MARIO_Y, mem.read8(MARIO_Y) + 1);
  loc_3fc0(m); // pins pose, returns the Y pointer (ignored)
  mem.write8(ATTR_CELL, mem.read8(ATTR_CELL) + 1); // BUG: +2 (attr) not +3 (Y)
}

test("TEETH: skip-logical-Y, skip-sprite-Y, and wrong-sprite-byte twins are all CAUGHT", () => {
  const base = baseMachines()[2]; // attract@180
  // Adversarial entry: distinct MARIO_Y / attr / Y so a dropped or misplaced step diverges.
  const entry = craft(base, { marioY: 0x40, code: 0x00, attr: 0xaa, y: 0x55 });

  const a = contractDiffs(entry, brokenSkipLogicalY);
  assert.ok(a.length > 0, "the skip-logical-Y twin escaped — the RAM check is worthless");
  assert.ok(a[0].startsWith(`RAM@${hx(MARIO_Y)}`), `expected the diff at ${hx(MARIO_Y)}, got ${a[0]}`);

  const b = contractDiffs(entry, brokenSkipSpriteY);
  assert.ok(b.length > 0, "the skip-sprite-Y twin escaped — the RAM check is worthless");
  assert.ok(b[0].startsWith(`RAM@${hx(Y_CELL)}`), `expected the diff at ${hx(Y_CELL)}, got ${b[0]}`);

  const c = contractDiffs(entry, brokenWrongSpriteByte);
  assert.ok(c.length > 0, "the wrong-sprite-byte twin escaped — the RAM check is worthless");
  assert.ok(c[0].startsWith(`RAM@${hx(ATTR_CELL)}`), `expected the diff at ${hx(ATTR_CELL)}, got ${c[0]}`);

  console.log(`  TEETH: skip-logical-Y caught (${a[0]}); skip-sprite-Y caught (${b[0]}); wrong-byte caught (${c[0]})`);
});

// -- 3. REACHABILITY (informational) ------------------------------------------

test("REACHABILITY: 0x2281 is not naturally dispatched in attract (crafted entries stand in)", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < 16) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(1500);

  // Its only caller (slide50mObjectDown) is unwired, so we expect zero — but verify any that occur.
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_2281);
    assert.equal(diffs.length, 0, `unexpected real 0x2281 dispatch diverged: ${diffs.join("; ")}`);
  }
  console.log(`  REACHABILITY: ${caps.length} natural 0x2281 dispatches in 1500 attract frames (expected 0)`);
});
