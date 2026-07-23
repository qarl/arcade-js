// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0cf2 — hand-optimized rewrite of the translated routine at ROM 0x0CF2,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Both callees (0x0D27, 0x0CC6) are reached through
 * `m.call(0xADDR)`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to a future optimized rewrite — never a copy.
 * Only the RAM *name* SND_BGM is imported (from ram.js).
 */

import { SND_BGM } from "./ram.js";

/**
 * loc_0cf2 -- board 3 (75m elevators) per-board setup arm.  [ROM 0x0CF2-0x0CFF]
 *
 *   0cf2  cd 27 0d     call 0x0d27      ; clear a sprite row
 *   0cf5  3e 0a        ld   a,0x0a
 *   0cf7  32 89 60     ld   (0x6089),a  ; SND_BGM = 0x0A -- queue the 75m theme
 *   0cfa  11 e5 3b     ld   de,0x3be5   ; DE = 75m elevator layout ptr (live-out)
 *   0cfd  c3 c6 0c     jp   0x0cc6      ; TAIL -> shared draw tail
 *
 * WHAT IT DOES. One of the four arms of the per-board setup cascade at loc_0c92
 * (0x0C92 reads BOARD=0x6227 and `dec a`-tests it: 1->loc_0cd4 25m, 2->loc_0cdf
 * 50m, 3->THIS 75m, else 0x0cb6 100m). Reached only when BOARD==3. It:
 *   - call 0x0d27 (sub_0d27): clear a sprite/tile row in video RAM (fills the
 *     0x760D.. and 0x770D.. rows) -- fixed, reads no work RAM.
 *   - Queue the 75m background tune: SND_BGM(0x6089) <- 0x0A. 0x6089 is WORK RAM
 *     (the ls175.3d sound-latch SOURCE that a later NMI copies to hardware 0x7C00),
 *     NOT a hardware latch, so its write has no observable bus-cycle position.
 *     Sibling arms queue 0x08 (25m) / 0x09 (50m) / 0x0B (100m); 0x0A is 75m.
 *   - DE <- 0x3be5 (a ROM table, the 75m elevator layout) as a LIVE-OUT, then
 *     tail-jump the shared draw tail loc_0cc6, which walks that table via sub_0da7.
 *
 * STRAIGHT-LINE: no data-dependent branch of its own (the BOARD test already
 * happened in loc_0c92). One path.
 *
 * INPUTS: none from work RAM (every value is an immediate or a ROM address).
 * OUTPUTS: video RAM (via sub_0d27); SND_BGM = 0x0A; DE = 0x3be5 handed to the
 *   tail; plus everything loc_0cc6/sub_0da7 write (unchanged — reached by m.call).
 *   A ends 0x0A on entry to the tail, exactly as the oracle; the tail then
 *   overwrites A/F, so the final register file is loc_0cc6's and matches.
 *
 * FLAGS: loc_0cf2's OWN five instructions (call / ld a,n / ld (nn),a / ld de,nn /
 *   jp) set NO flags — nothing here to keep. The observable final F is whatever
 *   the tail leaves; the unit gate compares F and confirms it matches.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved. loc_0cf2 is reachable ONLY through
 *   loc_0c92, whose two entries (handler_0763's tail and loc_0c91's rst-0x18 gate)
 *   are BOTH game-state handlers dispatched by dispatchGameState. That dispatch
 *   runs INSIDE the vblank NMI (entry_0066 clears the 0x7D84 mask on entry and
 *   restores it only at the 0x00DB epilogue, so a second vblank cannot re-enter).
 *   So the NMI never lands inside loc_0cf2 OR its callees on any call path — it is
 *   atomic, and its internal cycle DISTRIBUTION is unobservable. The four post-
 *   call instructions therefore collapse from four m.step charges to ONE 40t total
 *   (7+13+10+10). The leading `call 0x0d27` keeps its own 17t charge (nothing
 *   precedes it to fold, and its callee runs between). No hardware write lives in
 *   loc_0cf2's own body (0x6089 is work RAM), so — unlike loc_0a8a — there is no
 *   write-bus-cycle to preserve and the collapse needs no write-trace test.
 *   The TOTAL stays load-bearing (as part of the NMI's cost it feeds the main-loop
 *   spin count, README §2), so it is preserved exactly: 17 + 40 = 57t of loc_0cf2
 *   proper, plus the two callees' own identical charges. The synthesised single-
 *   path test pins that total to the oracle's with teeth.
 */
export function loc_0cf2(m) {
  const { regs, mem } = m;

  // call 0x0d27 -- clear a sprite/tile row. 17t call cost; nothing precedes it.
  m.push16(0x0cf5);
  m.step(0x0d27, 17);
  m.call(0x0d27);

  // ld a,0x0a / ld (SND_BGM),a / ld de,0x3be5 / jp 0x0cc6 -- atomic, no hardware
  // write here, so the four charges collapse to one 40t total (7+13+10+10).
  regs.a = 0x0a;
  mem.write8(SND_BGM, regs.a); // SND_BGM(0x6089)=0x0A -- 75m theme; work RAM (sound source)
  regs.de = 0x3be5;            // 75m elevator layout ptr (DE live-out for sub_0da7 via the tail)
  m.step(0x0cc6, 40);
  return m.call(0x0cc6);
}
