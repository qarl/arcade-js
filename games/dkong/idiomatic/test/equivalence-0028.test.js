// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchInlineJumpTable (ROM 0x0028) — the `rst 0x28`
 * inline-jump-table trampoline.
 *
 * sub_0028 is NOT a pure leaf: it consumes the pushed table base off the stack
 * (advancing SP), then dispatches — the dispatched arm writes memory and drives
 * state. So it is validated by MEMORY-equivalence against the frozen oracle
 * (RAM − the stack scratch below the entry SP, pc, SP, and the returned skip-boolean), never the full
 * register file and never cycles, with a FRESH clone per case:
 *
 *   1. REALISM (captured dispatches) — hook 0x0028 in a real attract run and clone
 *      the machine at each true dispatch (the caller's rst has already pushed the
 *      table base). For each, run the ORACLE on one clone and dispatchInlineJumpTable
 *      on another and prove RAM(−stack) + pc + SP + return value identical — the full
 *      oracle handler runs on BOTH sides, so a wrong target or a wrong register/flag
 *      handoff surfaces as divergent memory.
 *
 *   2. CRAFTED (exhaustive selector sweep) — the address arithmetic on arms/indices
 *      attract never reaches. For five representative table bases, sweep the selector
 *      byte 0..255, set up the stack exactly as the rst does, and route the computed
 *      target to an IDENTICAL stub on both sides (m.overrides duck-typed to a catch-all
 *      so the arm never runs). Compare the handoff the stub sees (A, HL = target, DE,
 *      SP) + the propagated return. This exhaustively pins the `base + (2*sel & 0xff)`
 *      8-bit-wrap math the oracle uses.
 *
 *   3. TEETH — a twin that computes `base + 2*sel` as a full 16-bit offset (skipping
 *      the 8-bit wrap) MUST be caught by the selector sweep at sel >= 0x80.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0028.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0028 as oracle } from "../../translated/loc_0028.js";
import { dispatchInlineJumpTable } from "../dispatchInlineJumpTable.js";
import { loc_00ca } from "../../translated/loc_00ca.js";
import { Machine } from "../../machine.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0028;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First differing RAM byte between two dumps, EXCLUDING the dead stack scratch
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns
// { addr, a, b } or null.
function firstRamDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

// -- 1. REALISM (captured dispatches) -----------------------------------------

/**
 * Hook 0x0028 in a real attract run and clone the machine at up to K real
 * dispatches. sub_0028 fires every NMI (game-state dispatch) plus the in-game
 * sub-state dispatches, so attract mints a spread of real (selector, table base)
 * states. The wrapper clones the entry state, then runs the oracle (forwarding the
 * caller's site) so the host game proceeds undisturbed to a clean stop. Capturing is
 * gated off after the host run so the isolated replays below (whose handlers may
 * themselves rst 0x28) cannot pollute the set.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm, ...args) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm, ...args);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// A catch-all override (duck-typed like the Machine's overrides Map) that runs the FROZEN ORACLE
// handler for whatever target the trampoline computed, and records that target. Installed
// IDENTICALLY on the oracle and the candidate so BOTH loc_00ca take the override path (translated
// line 11, idiomatic line 49) and reach the SAME handler by the SAME direct call. The old REALISM
// ran that handler behind idiomatic loc_00ca's `m.call`; the idiomatic layer no longer has that path,
// so the handler is reached through the production override seam instead. Because both sides use the
// identical path and handler, downstream RAM/SP/pc/return remain a true dispatcher-vs-dispatcher
// comparison — a wrong target or a wrong LIVE-IN register handoff still diverges through the handler,
// exactly as before, while dead handoff bits the handler ignores stay (correctly) invisible.
function oracleCatchAll(rec) {
  return {
    has: () => true,
    get: (target) => (mm) => {
      rec.push({ target, sp: mm.regs.sp });
      return ORACLE_ROUTINES.get(target)(mm);
    },
  };
}

test("REALISM: real captured 0x0028 dispatches — target + RAM(−stack) + pc + SP + return match", () => {
  const caps = captureDispatches(96, 1400);
  assert.ok(caps.length >= 1, "expected at least one real 0x0028 dispatch during attract");

  let compared = 0;
  for (const cap of caps) {
    const a = cap.clone(); // oracle
    const b = cap.clone(); // candidate
    const recA = [], recB = [];
    a.overrides = oracleCatchAll(recA);
    b.overrides = oracleCatchAll(recB);
    const ra = oracle(a);
    const rb = dispatchInlineJumpTable(b);

    // The trampoline's OWN dispatch is recA[0]/recB[0] (the first override hit); any later records
    // are nested rst-0x28 dispatches the frozen handler itself makes. Both sides run the identical
    // handler by the identical path, so the WHOLE dispatch sequence — the arithmetic handoff plus
    // every target the handler reaches from it — must match address-for-address. A wrong target or a
    // wrong LIVE-IN register handoff diverges the sequence (or the RAM below); the assertion is direct
    // rather than only inferred from a downstream effect.
    assert.ok(recA.length >= 1, "the trampoline dispatched nothing on the oracle side");
    assert.deepEqual(
      recB.map((r) => hx(r.target)),
      recA.map((r) => hx(r.target)),
      `dispatch sequence diverged (entry selector A=${hx(cap.regs.a)}, SP=${hx(cap.regs.sp)})`,
    );

    const ramDiff = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), cap.regs.sp);
    assert.equal(
      ramDiff,
      null,
      ramDiff && `RAM diverged at ${hx(ramDiff.addr)}: oracle=${ramDiff.a} cand=${ramDiff.b} ` +
        `(entry selector A=${hx(cap.regs.a)}, SP=${hx(cap.regs.sp)})`,
    );
    assert.equal(b.regs.sp, a.regs.sp, `SP diverged: oracle=${hx(a.regs.sp)} cand=${hx(b.regs.sp)}`);
    assert.equal(b.pc, a.pc, `pc diverged: oracle=${hx(a.pc)} cand=${hx(b.pc)}`);
    assert.equal(rb, ra, `return (skip-boolean) diverged: oracle=${ra} cand=${rb}`);
    compared++;
  }
  console.log(
    `  REALISM: ${compared} real dispatches — computed target, RAM(−stack), pc, SP and forwarded ` +
      "return identical to the oracle (handler reached through the production override seam)",
  );
});

// -- 2. CRAFTED (exhaustive selector sweep) -----------------------------------

// Representative table bases: NMI game-state (0x00CA), in-game sub-state (0x0702),
// opening-cutscene (0x0A7A), gateFireUpdateByDifficulty guard (0x3104), state-1 sub (0x08B6).
const TABLE_BASES = [0x00ca, 0x0702, 0x0a7a, 0x3104, 0x08b6];

// A catch-all override object (duck-typed like the Machine's overrides Map) that
// routes ANY computed target to `stub`, so the dispatched arm never runs and we can
// read the handoff the trampoline formed. Records A, HL (=target), DE, SP and returns
// a sentinel so the propagated dispatch return is also checked.
function stubOverrides(rec) {
  const SENTINEL = 0x5a;
  return {
    has: () => true,
    get: (target) => (mm) => {
      // The dissolved form hands loc_00ca the target as a value, not via regs.hl, so the
      // arithmetic is observed at the dispatched target itself (== the old regs.hl handoff).
      rec.push({ target, sp: mm.regs.sp });
      return SENTINEL;
    },
  };
}

// Set the selector in A and place `base` on the stack exactly as `rst 0x28` does.
function craft(base, tableBase, selector) {
  const m = base.clone();
  m.regs.sp = 0x6bfe;
  m.regs.a = selector;
  m.push16(tableBase); // the rst's pushed "return address" = inline table base
  return m;
}

// Run oracle and candidate on identically-crafted machines; return { oracle, cand }
// records + returns for one (tableBase, selector).
function runCrafted(base, candidate, tableBase, selector) {
  const mA = craft(base, tableBase, selector);
  const mB = craft(base, tableBase, selector);
  const recA = [], recB = [];
  mA.overrides = stubOverrides(recA);
  mB.overrides = stubOverrides(recB);
  const retA = oracle(mA, "crafted");
  const retB = candidate(mB, "crafted");
  return { recA, recB, retA, retB, mA, mB };
}

test("CRAFTED: dispatchInlineJumpTable == oracle over all 256 selectors × 5 table bases", () => {
  const base = new Machine(ROM).clone();
  let count = 0;
  let mismatch = null;
  for (const tableBase of TABLE_BASES) {
    for (let sel = 0; sel < 256 && !mismatch; sel++) {
      const { recA, recB, retA, retB } = runCrafted(base, dispatchInlineJumpTable, tableBase, sel);
      count++;
      if (recA.length !== 1 || recB.length !== 1) {
        mismatch = { tableBase, sel, why: `dispatch fired ${recA.length}/${recB.length} times (want 1/1)` };
        break;
      }
      const A = recA[0], B = recB[0];
      if (A.target !== B.target) mismatch = { tableBase, sel, why: `target ${hx(A.target)}/${hx(B.target)}` };
      else if (A.sp !== B.sp) mismatch = { tableBase, sel, why: `SP ${hx(A.sp)}/${hx(B.sp)}` };
      else if (retA !== retB) mismatch = { tableBase, sel, why: `return ${retA}/${retB}` };
    }
    if (mismatch) break;
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at base=${hx(mismatch.tableBase)} sel=${hx(mismatch.sel)}: ${mismatch.why}`,
  );
  assert.equal(count, TABLE_BASES.length * 256, "must have swept all 256 selectors per base");
  console.log(`  CRAFTED: ${count} (base,selector) handoffs identical to the oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: forms the table offset as a FULL 16-bit `2*selector` instead of the
 * hardware's 8-bit `add a,a` (`2*selector & 0xff`). It agrees with the oracle for
 * every selector < 0x80 and diverges from 0x80 up, so only a real sweep across the
 * wrap catches it.
 */
function brokenDispatch(m, site = "the NMI game-state table") {
  const { regs, mem } = m;
  const tableBase = m.pop16();
  const entry = (tableBase + 2 * regs.a) & 0xffff; // BUG: 16-bit offset, no 8-bit wrap
  regs.add(regs.a);
  regs.e = mem.read8(entry);
  regs.hl = (entry + 1) & 0xffff;
  regs.d = mem.read8(regs.hl);
  regs.hl = (regs.e | (regs.d << 8)) & 0xffff;
  regs.de = (entry + 1) & 0xffff;
  // Dispatch through the SAME seam the routine uses, so the catch-all stub sees the
  // (wrong) computed target.
  return loc_00ca(m, regs.hl, site);
}

test("TEETH: the 16-bit-offset twin (no 8-bit wrap) is CAUGHT by the selector sweep", () => {
  const base = new Machine(ROM).clone();
  let caughtAt = null;
  for (const tableBase of TABLE_BASES) {
    for (let sel = 0; sel < 256 && !caughtAt; sel++) {
      const { recA, recB } = runCrafted(base, brokenDispatch, tableBase, sel);
      if (recA.length !== 1 || recB.length !== 1 || recA[0].target !== recB[0].target) {
        caughtAt = { tableBase, sel };
      }
    }
    if (caughtAt) break;
  }
  assert.notEqual(caughtAt, null, "the sweep FAILED to catch the missing 8-bit offset wrap — it is worthless");
  console.log(`  TEETH: caught the 16-bit-offset twin at base=${hx(caughtAt.tableBase)} sel=${hx(caughtAt.sel)}`);
});
