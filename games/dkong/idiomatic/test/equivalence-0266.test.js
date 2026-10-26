// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearRamAndInitHardware (ROM 0x0266) — power-on setup: wipe all RAM, seed
 * the task queue, set the display-hardware bits, silence the sound, and hand the
 * game its stack.
 *
 * bootInit is INPUT-INDEPENDENT: it reads no work RAM and every store writes a
 * constant, so there is no data-dependent branch and no unreached arm. That makes a
 * crafted-entry gate a proof of behaviour: run the oracle and clearRamAndInitHardware from the SAME
 * entry and diff. Three entries span the input space that matters — a clean power-on,
 * a real mid-attract machine, and a pre-dirtied RAM/io machine — each proving every
 * span is overwritten regardless of prior contents.
 *
 * The oracle sets SP to 0x6C00, `push16`es the 0x02B8 return address, then `call`s
 * 0x011C (silenceSound) whose `ret` pops it, so the pushed bytes land at 0x6BFE/0x6BFF —
 * inside the dead STACK_SCRATCH [0x6be0,0x6c00), which the memory-equivalence contract
 * excludes. clearRamAndInitHardware dissolves that bracket into a direct silenceSound(m)
 * call and does not seat SP at all: the idiomatic layer fires the vblank NMI as a direct
 * JS call and uses no guest stack, so the seat is vestigial (runbook §4, "Retiring SP").
 *
 * The contract compared here is RAM − the stack scratch below STACK_TOP (the routine reseats SP there), pc, the io device state (the
 * display/sound hardware latches bootInit sets are board outputs, not RAM), the
 * discard-write counter (proving the faithful 0x6C00-0x6FFF over-run), and the
 * candidate's SP unmoved from entry (SP-inert).
 *
 *   1. REACHABILITY — the real boot path (bootOnly) runs bootInit last and leaves its
 *      invariants (blank-tile VRAM, empty task queue, flip-screen + NMI enabled).
 *   2. EQUAL — clearRamAndInitHardware == oracle over power-on / mid-attract / dirtied entries,
 *      and boot's bootInit (mask vblank + this routine) == the translated bootOnly (ROM
 *      0x0000-0x02BC) over the same entries.
 *   3. TEETH — three broken twins the same contract MUST catch:
 *        (a) blank-tile twin (VRAM zeroed, not 0x10) — caught in RAM at 0x7400.
 *        (b) flip-screen twin (0x7D82 left off) — caught in io.flipScreen.
 *        (c) missing-silence twin (skips silenceSound) — caught in io on a dirtied
 *            entry (the sound latches stay dirty).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0266.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0266 as oracle } from "../../translated/loc_0266.js";
import { bootOnly } from "../../translated/bootOnly.js";
import { clearRamAndInitHardware } from "../clearRamAndInitHardware.js";
import { bootInit } from "../boot.js";
import { silenceSound } from "../silenceSound.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, STACK_TOP, TASK_TAIL, TASK_HEAD, TASK_RING } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, skipping the stack scratch below the floor
// region (the memory-equivalence contract is RAM − the stack scratch below STACK_TOP). { addr, a, b } | null.
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

// Snapshot of the io device latches bootInit touches (display banks + sound outputs).
function ioSnapshot(m) {
  const io = m.io;
  return {
    nmiMask: io.nmiMask,
    flipScreen: io.flipScreen,
    spriteBank: io.spriteBank,
    paletteBank: io.paletteBank,
    audioIrq: io.audioIrq,
    soundLatch3d: io.soundLatch3d,
    latch6h: Array.from(io.latch6h),
  };
}

function ioDiffs(o, c) {
  const so = ioSnapshot(o), sc = ioSnapshot(c);
  const out = [];
  for (const k of ["nmiMask", "flipScreen", "spriteBank", "paletteBank", "audioIrq", "soundLatch3d"]) {
    if (so[k] !== sc[k]) out.push(`io.${k} oracle=${so[k]} cand=${sc[k]}`);
  }
  for (let i = 0; i < 8; i++) {
    if (so.latch6h[i] !== sc.latch6h[i]) out.push(`io.latch6h[${i}] oracle=${so.latch6h[i]} cand=${sc.latch6h[i]}`);
  }
  return out;
}

/** Run a candidate on a fresh clone. clearRamAndInitHardware falls through (no ret) and never touches SP. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  return c;
}

/** Full contract diff: RAM − the stack scratch below STACK_TOP, pc, io device state, discard counter, candidate SP unmoved. */
function contractDiffs(entry, fn, oracleFn = oracle) {
  const o = entry.clone();
  oracleFn(o);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, STACK_TOP); // the routine reseats SP at STACK_TOP: no caller frame survives it
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (c.regs.sp !== entry.regs.sp) diffs.push(`SP moved: entry=${hx(entry.regs.sp)} cand=${hx(c.regs.sp)}`);
  if (o.mem.discardedWrites !== c.mem.discardedWrites) {
    diffs.push(`discardedWrites oracle=${o.mem.discardedWrites} cand=${c.mem.discardedWrites}`);
  }
  diffs.push(...ioDiffs(o, c));
  return diffs;
}

// Entry states. All are clones so the frame machinery is neutralised
// (nextNmi/nextBoundary = Infinity), so no stray NMI can masquerade as a side effect
// during bootInit's long tick sequence.
function powerOn() {
  return new Machine(ROM).clone(); // fresh, RAM zeroed, io at defaults
}

function attractBase(frames = 300) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // a real, self-consistent mid-attract machine
}

// A machine with every span pre-dirtied so the wipes/fills/latch-writes must all land.
function dirtied() {
  const m = new Machine(ROM).clone();
  for (let a = 0x6000; a <= 0x6bff; a++) m.mem.write8(a, (a * 7 + 0x5a) & 0xff); // work RAM
  for (let a = 0x7000; a <= 0x77ff; a++) m.mem.write8(a, (a * 3 + 0x21) & 0xff); // sprite + video RAM
  m.mem.write8(TASK_TAIL, 0x11);
  m.mem.write8(TASK_HEAD, 0x22);
  for (let i = 0; i < 0x40; i++) m.mem.write8(TASK_RING + i, 0x33);
  // Dirty the display + sound hardware so bootInit's writes must overwrite them.
  m.io.flipScreen = 0;
  m.io.spriteBank = 1;
  m.io.paletteBank = 3;
  m.io.nmiMask = 0;
  m.io.audioIrq = 1;
  m.io.soundLatch3d = 0xaa;
  for (let i = 0; i < 8; i++) m.io.latch6h[i] = 0xff;
  return m;
}

// -- 1. reachability ----------------------------------------------------------

test("REACHABILITY: bootInit runs on the real boot path and leaves its invariants", () => {
  const m = new Machine(ROM);
  bootOnly(m); // reset → … → bootInit (the last thing bootOnly does)
  assert.equal(m.mem.read8(0x7400), 0x10, "video RAM should be filled with the blank tile");
  assert.equal(m.mem.read8(TASK_TAIL), 0xc0, "task tail parked at ring base");
  assert.equal(m.mem.read8(TASK_HEAD), 0xc0, "task head parked at ring base");
  assert.equal(m.mem.read8(TASK_RING), 0xff, "task-ring slot marked free");
  assert.equal(m.io.flipScreen, 1, "flip-screen enabled");
  assert.equal(m.io.nmiMask, 1, "vblank NMI re-enabled");
  console.log("  REACHABILITY: bootOnly reaches bootInit and its invariants hold");
});

// -- 2. EQUAL -----------------------------------------------------------------

test("EQUAL: clearRamAndInitHardware == oracle over power-on / mid-attract / dirtied entries", () => {
  const entries = [
    ["power-on", powerOn()],
    ["mid-attract", attractBase()],
    ["dirtied", dirtied()],
  ];
  for (const [name, entry] of entries) {
    const diffs = contractDiffs(entry, clearRamAndInitHardware);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);

    // Non-vacuity: the routine really performed its setup on this entry.
    const c = runCandidate(entry, clearRamAndInitHardware);
    assert.equal(c.mem.read8(0x7400), 0x10, `${name}: video RAM not filled`);
    assert.equal(c.mem.read8(TASK_RING), 0xff, `${name}: task ring not marked free`);
    assert.equal(c.io.flipScreen, 1, `${name}: flip-screen not set`);
  }
  console.log("  EQUAL: 3 entries (power-on, mid-attract, dirtied) identical to the oracle");
});

test("EQUAL: boot's bootInit == translated bootOnly (ROM 0x0000-0x02BC) over the same entries", () => {
  const entries = [
    ["power-on", powerOn()],
    ["mid-attract", attractBase()],
    ["dirtied", dirtied()],
  ];
  for (const [name, entry] of entries) {
    const diffs = contractDiffs(entry, bootInit, bootOnly);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
  }
  // Teeth: the io snapshot carries nmiMask, so a twin that leaves vblank masked is caught there.
  const noRearm = contractDiffs(powerOn(), (m) => { bootInit(m); m.mem.write8(0x7d84, 0); }, bootOnly);
  assert.ok(noRearm.some((d) => d.startsWith("io.nmiMask")), `no-re-arm twin escaped: ${noRearm.join("; ")}`);
  console.log("  EQUAL: bootInit == bootOnly on 3 entries; a twin leaving vblank masked is caught at io.nmiMask");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): does the correct setup, then zeroes VRAM (should stay blank tile 0x10). */
function twinBlankTile(m) {
  clearRamAndInitHardware(m);
  for (let a = 0x7400; a < 0x7800; a++) m.mem.write8(a, 0); // BUG
}

/** Broken twin (b): does the correct setup, then turns flip-screen back off. */
function twinNoFlip(m) {
  clearRamAndInitHardware(m);
  m.io.flipScreen = 0; // BUG
}

/** Broken twin (c): the full routine EXCEPT the silenceSound call is omitted. */
function twinNoSilence(m) {
  const { mem } = m;
  for (let a = 0x6000; a < 0x7000; a++) mem.write8(a, 0);
  for (let a = 0x7000; a < 0x7400; a++) mem.write8(a, 0);
  for (let a = 0x7400; a < 0x7800; a++) mem.write8(a, 0x10);
  for (let i = 0; i < 0x40; i++) mem.write8(TASK_RING + i, 0xff);
  mem.write8(TASK_TAIL, 0xc0);
  mem.write8(TASK_HEAD, 0xc0);
  mem.write8(0x7d83, 0);
  mem.write8(0x7d86, 0);
  mem.write8(0x7d87, 0);
  mem.write8(0x7d82, 1);
  // BUG: silenceSound(m) omitted — the sound latches keep their prior contents.
  mem.write8(0x7d84, 1);
}

test("TEETH: the blank-tile, flip-screen, and missing-silence twins are CAUGHT", () => {
  const a = contractDiffs(powerOn(), twinBlankTile);
  assert.ok(a.some((d) => d.startsWith(`RAM@${hx(0x7400)}`)), `blank-tile twin escaped: ${a.join("; ")}`);

  const b = contractDiffs(powerOn(), twinNoFlip);
  assert.ok(b.some((d) => d.startsWith("io.flipScreen")), `no-flip twin escaped: ${b.join("; ")}`);

  // On a dirtied entry the oracle's silence pass clears latch6h/audioIrq/soundLatch3d;
  // the twin leaves them dirty, so the io comparison must diverge.
  const c = contractDiffs(dirtied(), twinNoSilence);
  assert.ok(c.some((d) => d.startsWith("io.")), `missing-silence twin escaped: ${c.join("; ")}`);

  console.log(`  TEETH: blank-tile caught (${a.find((d) => d.startsWith("RAM@"))}); ` +
    `no-flip caught (${b.find((d) => d.startsWith("io.flipScreen"))}); ` +
    `no-silence caught (${c.find((d) => d.startsWith("io."))})`);
});

// Reference the imported leaf so the direct-call dependency is explicit even if a
// future edit stops exercising it through clearRamAndInitHardware.
void silenceSound;
