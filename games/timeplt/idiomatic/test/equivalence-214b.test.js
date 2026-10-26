// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyDemoShipByScript — memory-equivalent to the frozen oracle at ROM 0x214B.
 * GATE: real attract dispatches (undriven tape), plus crafted turn/advance entries; compares work
 *   RAM, pc and every register but the shadow bank — the frozen exit swap fills it with dead loop
 *   scratch, and the rewrite does not swap at all. That the swap is dead is proven twice: the
 *   identical RAM/pc/main-register result shows the mover never reads it, and the SHADOW BANK arm
 *   shows no idiomatic routine swaps banks or reads a shadow register. Teeth land in RAM.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { flyDemoShipByScript } from "../flyDemoShipByScript.js";
import { loc_214b as oracle } from "../../translated/loc_214b.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = 0x214b;
const MOVER = 0x1f42;
const COUNTDOWN = 0xadf2;
const SCRIPT_LO = 0xadf3;
const SCRIPT_HI = 0xadf4;
const HEADING = 0xa802;
const CAP = 40;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

// Two dead sets, both measured. The frozen loop swaps its spent scratch into the shadow bank on the
// closing exx and never swaps back; the rewrite keeps no scratch in registers and does not swap. The world-scroll mover is a tail: once flyDemoShipByScript returns nothing reads its
// accumulator, flags or index registers, and the ROM ret it drops leaves sp two bytes low. Excluding
// them keeps the gate from demanding a value the rewrite need not carry.
const EXCLUDED = ["b_", "c_", "d_", "e_", "h_", "l_", "a", "f", "d", "e", "l", "sp"];

// The mover's deepest dead push below the exit pointer, measured and pinned by the WINDOW arm.
const SCRATCH_BYTES = 4;

const hex = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

let real = null;
function captureReal() {
  if (real) return real;
  const entries = [];
  const fn = TRANSLATED.get(TARGET);
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (entries.length < CAP) entries.push(mm.clone());
    return fn(mm);
  }]]), { tape: [] });
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the attract run stopped early: ${m.stoppedBy}`);
  assert.ok(entries.length > 0, "vacuous: attract never dispatched this address");
  real = entries;
  return real;
}

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  // The dissolved mover writes no dead stack scratch and takes no ROM ret, so the diff masks the
  // window below the oracle's exit pointer, cut at the entry SP; pc is the tail's return address, dead once flyDemoShipByScript ends.
  const sp = a.regs.sp;
  const dead = deadStackBelow({ lo: sp - SCRATCH_BYTES, hi: sp }, machine.regs.sp);
  const da = a.dumpState();
  const db = b.dumpState();
  for (let i = 0; i < da.length; i++) {
    if (da[i] === db[i]) continue;
    const ad = a.stateOffsetToAddr(i);
    if (dead(ad)) continue;
    return `${hex(ad)} frozen=${da[i]} rewrite=${db[i]}`;
  }
  for (const k of REG_FIELDS) {
    if (EXCLUDED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return `${k} frozen=${a.regs[k]} rewrite=${b.regs[k]}`;
  }
  return null;
}

function ramCaught(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try { candidate(b); } catch { return true; }
  return firstStateDiff(a.dumpState(), b.dumpState()) !== null;
}

function footprint(machine) {
  const before = machine.dumpState().slice();
  const after = machine.clone();
  oracle(after);
  const now = after.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) n++;
  return n;
}

function movedFields(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return new Set(REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]));
}

function craft(poke) {
  const m = captureReal()[0].clone();
  poke(m);
  return m;
}

// A real turn-0 entry poked to each surviving turn command; a spent entry poked to advance through
// a one-byte script parked in RAM; and a dwell of exactly one, which advances rather than ticks.
const CRAFTS = {
  "turn-1": (m) => { m.mem8[COUNTDOWN] = 0x42; },
  "turn-2": (m) => { m.mem8[COUNTDOWN] = 0x82; },
  "turn-3": (m) => { m.mem8[COUNTDOWN] = 0xc2; },
  "advance": (m) => {
    m.mem8[COUNTDOWN] = 0x00; m.mem8[SCRIPT_LO] = 0x00; m.mem8[SCRIPT_HI] = 0xae; m.mem8[0xae01] = 0x04;
  },
  "dwell-1": (m) => {
    m.mem8[COUNTDOWN] = 0x01; m.mem8[SCRIPT_LO] = 0x00; m.mem8[SCRIPT_HI] = 0xae; m.mem8[0xae01] = 0x04;
  },
};

function allEntries() {
  return [...captureReal(), ...Object.values(CRAFTS).map((p) => craft(p))];
}

// ── broken twins: each is CAUGHT — the assertion is the point ──────────────────────────────────

function tickAndSteer(m, flipSteer) {
  const { regs, mem8, mem16 } = m;
  let command;
  for (;;) {
    const c = mem8[COUNTDOWN];
    if ((c & 0x3f) > 1) { command = (c - 1) & 0xff; mem8[COUNTDOWN] = command; break; }
    const n = (mem16[SCRIPT_LO] + 1) & 0xffff; mem16[SCRIPT_LO] = n; mem8[COUNTDOWN] = (mem8[n] + 1) & 0xff;
  }
  const turn = (command >> 6) & 3;
  const away = flipSteer ? 3 : -3;
  if (turn === 1) mem8[HEADING] = (mem8[HEADING] + away) & 0xff;
  else if (turn !== 0) mem8[HEADING] = (mem8[HEADING] - away) & 0xff;
  regs.exx();
}

function brokenNoOp() {}
function brokenNoMover(m) { tickAndSteer(m, false); }
function brokenSteerWrongWay(m) { tickAndSteer(m, true); return m.call(MOVER); }

function brokenNoTick(m) {
  const { regs, mem8, mem16 } = m;
  let command;
  for (;;) {
    const c = mem8[COUNTDOWN];
    if ((c & 0x3f) > 1) { command = (c - 1) & 0xff; break; } // BUG: the ticked byte is never stored
    const n = (mem16[SCRIPT_LO] + 1) & 0xffff; mem16[SCRIPT_LO] = n; mem8[COUNTDOWN] = (mem8[n] + 1) & 0xff;
  }
  const turn = (command >> 6) & 3;
  if (turn === 1) mem8[HEADING] = (mem8[HEADING] - 3) & 0xff;
  else if (turn !== 0) mem8[HEADING] = (mem8[HEADING] + 3) & 0xff;
  regs.exx();
  return m.call(MOVER);
}

function brokenAdvanceThreshold(m) {
  const { regs, mem8, mem16 } = m;
  let command;
  for (;;) {
    const c = mem8[COUNTDOWN];
    if ((c & 0x3f) > 0) { command = (c - 1) & 0xff; mem8[COUNTDOWN] = command; break; } // BUG: > 0, not > 1
    const n = (mem16[SCRIPT_LO] + 1) & 0xffff; mem16[SCRIPT_LO] = n; mem8[COUNTDOWN] = (mem8[n] + 1) & 0xff;
  }
  const turn = (command >> 6) & 3;
  if (turn === 1) mem8[HEADING] = (mem8[HEADING] - 3) & 0xff;
  else if (turn !== 0) mem8[HEADING] = (mem8[HEADING] + 3) & 0xff;
  regs.exx();
  return m.call(MOVER);
}

function brokenScribblesMainReg(m) { flyDemoShipByScript(m); m.regs.b = (m.regs.b + 1) & 0xff; }

const TWINS = [
  ["no-op", brokenNoOp],
  ["no-mover", brokenNoMover],
  ["steer-wrong-way", brokenSteerWrongWay],
  ["no-tick", brokenNoTick],
  ["advance-threshold", brokenAdvanceThreshold],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("REAL DISPATCHES: every attract dispatch replays identical", { skip }, () => {
  const entries = captureReal();
  for (const e of entries) assert.equal(unitDiff(flyDemoShipByScript, e), null, "a real dispatch diverged");
  assert.ok(entries.some((e) => footprint(e) > 0),
    "every oracle dispatch wrote nothing, so a rewrite that did nothing would pass");
  console.log(`  REAL: ${entries.length} attract dispatches identical`);
});

test("CRAFTED: turn commands and the advance path replay identical", { skip }, () => {
  for (const [label, poke] of Object.entries(CRAFTS)) {
    const m = craft(poke);
    assert.equal(unitDiff(flyDemoShipByScript, m), null, `crafted ${label} diverged`);
    assert.ok(footprint(m) > 0, `crafted ${label} moved nothing, so it proves nothing`);
  }
  console.log(`  CRAFTED: ${Object.keys(CRAFTS).length} arms identical`);
});

test("EXCLUDED: only the dead sets differ, and the check can still see a register", { skip }, () => {
  const m = captureReal()[0];
  const moved = movedFields(flyDemoShipByScript, m);
  // The exclusion is load-bearing, not decoration: the dead registers really do differ here.
  assert.ok(EXCLUDED.some((k) => moved.has(k)), "no excluded register moved, so the set excludes nothing");
  // ★ and an empty non-excluded result means nothing unless the same check catches a real one.
  assert.ok([...moved].every((k) => EXCLUDED.includes(k)), "a register diverged outside the excluded set");
  assert.notEqual(unitDiff(brokenScribblesMainReg, m), null, "the register comparison is blind to a scribbled live register");
  console.log(`  EXCLUDED: ${[...moved].join(", ")} move; nothing outside the excluded set does`);
});

test("WINDOW: the widest divergence is exactly the declared dead-scratch window", { skip }, () => {
  let widest = 0;
  for (const mc of allEntries()) {
    const a = mc.clone();
    const b = mc.clone();
    oracle(a);
    flyDemoShipByScript(b);
    const sp = a.regs.sp;
    const da = a.dumpState();
    const db = b.dumpState();
    for (let i = 0; i < da.length; i++) {
      if (da[i] === db[i]) continue;
      const ad = a.stateOffsetToAddr(i);
      assert.ok(ad !== null && ad < mc.regs.sp, `a divergence at ${hex(ad)} is at or above the entry pointer ${hex(mc.regs.sp)}`);
      widest = Math.max(widest, sp - ad);
    }
  }
  assert.equal(widest, SCRATCH_BYTES, "the widest dead-scratch divergence moved; the window is the wrong size");
  console.log(`  WINDOW: widest divergence sp-${widest}, all below the entry pointer`);
});

test("SP: the rewrite drops exactly the ROM tail return the oracle pops", { skip }, () => {
  for (const mc of allEntries()) {
    const a = mc.clone();
    const b = mc.clone();
    oracle(a);
    flyDemoShipByScript(b);
    assert.equal(a.regs.sp - b.regs.sp, 2, "the sp drift is not the single dropped tail return");
  }
  console.log("  SP: oracle pops the tail return, the rewrite leaves it — sp+2 on every entry");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const entries = allEntries();
    const caught = entries.filter((e) => unitDiff(twin, e) !== null).length;
    const inRam = entries.filter((e) => ramCaught(twin, e)).length;
    assert.ok(caught > 0, `every entry PASSED the ${label} twin`);
    assert.ok(inRam > 0, `the ${label} twin is never caught in RAM, only in a register`);
    console.log(`  TEETH/${label}: caught ${caught}/${entries.length} (${inRam} in RAM)`);
  });
}

// A swap of the BC/DE/HL banks or a reference to one of their shadow halves, in source text. (The
// shadow accumulator is a separate swap this routine never makes, so it is not the question here.)
const SHADOW_USE = /\bexx\(|regs\.(?:[bcdehl]_|bc_|de_|hl_)\b/;
const IDIOMATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

test("SHADOW BANK: no idiomatic routine swaps BC/DE/HL or reads their shadow halves, so the dropped swap is dead", () => {
  // Positive control: the frozen routine's own swap is what the pattern must see.
  const frozen = readFileSync(join(IDIOMATIC_DIR, "..", "translated", "loc_214b.js"), "utf8");
  assert.ok(SHADOW_USE.test(frozen), "the pattern does not see the frozen routine's swap, so an absence means nothing");
  const users = readdirSync(IDIOMATIC_DIR)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => SHADOW_USE.test(readFileSync(join(IDIOMATIC_DIR, f), "utf8")));
  assert.deepEqual(users, [], `an idiomatic routine touches the shadow bank: ${users.join(", ")}`);
  console.log("  SHADOW BANK: no idiomatic routine swaps or reads it; the frozen swap is seen by the same pattern");
});
