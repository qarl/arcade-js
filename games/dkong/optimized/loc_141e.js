// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_141e — hand-optimized rewrite of the translated routine at ROM 0x141E,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x0616, 0x0018, 0x0874, and the tails
 * 0x1459 / 0x144f / 0x1475) is reached through `m.call(0xADDR)`, the routine
 * registry (games/dkong/routines.js), so each resolves to the oracle — or to a
 * future optimized rewrite — never a copy that could drift. Nothing is imported
 * here but this comment: loc_141e touches no *named* work-RAM byte (its only own
 * writes, 0x600D/0x600E, and its scan base 0x611C, are all deliberately-unnamed
 * scratch in ram.js), so there is nothing to import from ./ram.js.
 */

/**
 * loc_141e -- 0x0702 table idx20 (GAME_SUBSTATE == 0x14): scan the 0x611C[5]
 * object table for a record and dispatch a flip-screen / substate-advance tail.
 * [ROM 0x141E-0x1485; reached via dispatchGameState (the NMI game-state path) ->
 * loc_06fe rst-0x28 while GAME_STATE(0x6005)==3 and GAME_SUBSTATE(0x600A)==0x14.]
 *
 *   141e  cd 16 06     call 0x0616         ; sub_0616 -- draw string 5 + BCD expand
 *   1421  df           rst  0x18           ; gate on SUBSTATE_TIMER (0x6009)
 *   1422  cd 74 08     call 0x0874         ; sub_0874 -- clear the playfield
 *   1425  3e 00        ld   a,0x00
 *   1427  32 0e 60     ld   (0x600e),a     ; clear player index
 *   142a  32 0d 60     ld   (0x600d),a     ; clear score-slot selector
 *   1430  21 1c 61     ld   hl,0x611c      )
 *   1433  11 22 00     ld   de,0x0022      ) scan 0x611C, stride 0x22, 5 records
 *   1435  06 05        ld   b,0x05         )
 *   1437  3e 01        ld   a,0x01         ; search key #1 (loaded once; invariant)
 *   1437-143d  {cp (hl) / jp z,0x1459 / add hl,de / djnz 0x1437}   record==1 -> 0x1459
 *   1441  21 1c 61 .. 06 05 .. 3e 03    ; re-scan for key #3
 *   1445-144b  {cp (hl) / jp z,0x144f / add hl,de / djnz 0x1445}   record==3 -> 0x144f
 *   1475  ... (jp)                        ; neither found -> 0x1475
 *
 * WHAT IT DOES. A per-frame substate handler behind two gates:
 *   1. call sub_0616 (unconditional) -- redraw string 5 and expand the credits BCD.
 *   2. rst 0x18 on SUBSTATE_TIMER (0x6009): unless the timer has EXPIRED this frame,
 *      sub_0018 discards loc_141e's return address and control skips to the caller's
 *      caller -- the dispatch is abandoned and nothing below runs (early return).
 *   3. On expiry: call sub_0874 (clear the playfield), clear the player index
 *      (0x600E) and score-slot selector (0x600D), then linearly scan the five
 *      0x611C-based object records (stride 0x22) FIRST for a byte == 1, THEN for a
 *      byte == 3, and dispatch:
 *        - a record == 1 -> loc_1459 (entered with A = 0x01): OR DIP_UPRIGHT into
 *          the flip-screen latch, clear the timer, advance GAME_SUBSTATE, enqueue 12
 *          tasks.
 *        - else a record == 3 -> loc_144f: set the player index to 1, then fall into
 *          loc_1459 with A = 0x00.
 *        - else neither -> loc_1475: force flip-screen = 1, GAME_STATE/ATTRACT = 1,
 *          clear GAME_SUBSTATE.
 *
 * INPUTS  (own reads): SUBSTATE_TIMER (0x6009, via the rst-0x18 gate); the five scan
 *   records 0x611C, 0x613E, 0x6160, 0x6182, 0x61A4. (Everything else is read inside
 *   the callees, which run as the oracle.)
 * OUTPUTS (own writes): 0x600E and 0x600D, both cleared to 0. NO HARDWARE (0x7Dxx)
 *   WRITE happens in loc_141e itself: the flip-screen latch (0x7D82) is written by
 *   the tails loc_1459 / loc_1475, which run unchanged via m.call. So there is no
 *   bus-cycle-positioned hardware write to preserve here and no --writes trace at
 *   stake (contrast optimized/loc_0a8a.js / loc_13aa.js, which write 0x7Dxx directly).
 *
 * NAMES. loc_141e uses no evidenced RAM name: 0x600D/0x600E and the 0x611C scan base
 *   are all in ram.js's "deliberately unnamed" scratch set, so they stay hex here
 *   (README §4 -- a wrong name is worse than an honest address). The search keys 1
 *   and 3 and the tail addresses are literals -- they ARE the ROM's own bytes.
 *
 * REGISTERS / FLAGS. loc_141e ends on EVERY path by tail-calling an oracle routine
 *   (the early return is taken right after m.call(0x0018); the three search exits
 *   tail-call loc_1459 / loc_144f / loc_1475). loc_1459 (the record==1 tail, also the
 *   fall-through of loc_144f) reloads HL/DE/B/A and sets F, and READS one incoming
 *   register: it ORs the INCOMING A with DIP_UPRIGHT into the flip-screen latch, so on
 *   the record==1 path A must be the oracle's 0x01 (the search key) at that m.call.
 *   loc_144f reloads A first, so nothing incoming matters there. loc_1475 (the
 *   NEITHER-found tail), however, writes ONLY A and memory -- it leaves HL, DE, B, C
 *   and F exactly as the scan left them. So on that one path the scan's final register
 *   file AND flags are observable at the routine's exit and must match the oracle
 *   bit-for-bit. That is why the scan is run with the REAL Z80 register ops
 *   (regs.hl/regs.de/regs.b pointer + counter, regs.cp for the compare, regs.addHl for
 *   the stride add) rather than a value-only local scan: `cp`/`add hl,de` leave S/Z/PV
 *   from the last compare and H/N/C from the last add, and loc_1475 passes them
 *   through unchanged. (On the record==1/record==3 paths loc_1459 overwrites all of
 *   this, so the faithful scan is harmless there and keeps one code path.) C is never
 *   touched on any path (oracle or here). No path ends in `ret cc`, so no flag is a
 *   return value; loc_141e's own return value is the callee's (undefined on every
 *   path, matching the oracle), forwarded by `return m.call(...)`.
 *
 * ATOMIC / CYCLES — collapsed to one charge per branch across the scan segment.
 *   loc_141e runs INSIDE the vblank NMI (dispatchGameState -> loc_06fe rst-0x28),
 *   where the hardware NMI mask is already cleared, so no nested NMI can land inside
 *   loc_141e OR any callee it reaches -- the whole routine is atomic and its internal
 *   cycle DISTRIBUTION is unobservable. The TOTAL is still load-bearing: as part of
 *   the NMI handler's cost it sets the main-loop spin count that seeds the PRNG
 *   (README §2, SPIN_COUNT), so each branch's total is preserved EXACTLY. The three
 *   INTERMEDIATE call sites (0x0616, rst 0x18, 0x0874) keep their own per-call charge
 *   (17 / 11 / 17) and their push16 -- the calling convention, AND what keeps the
 *   cumulative cycle at each m.call identical so the tails' downstream 0x7D82 writes
 *   land at their exact bus cycle. Only the call-free scan segment (0x1425..the tail
 *   transfer) is collapsed, into a single m.step folded onto the tail m.call:
 *     prologue through `ld a,0x01`               = 67t
 *     each scanned record that MISSES            = 41t   (cp + jp z n/t + add + djnz)
 *     the record that EXHAUSTS a loop (djnz f/t) = 36t   (djnz not-taken: 8 vs 13)
 *     a HIT (cp + jp z taken)                    = 17t
 *     loop-2 setup (ld hl / ld b / ld a,0x03)    = 24t
 *     the final `jp 0x1475`                      = 10t
 *   giving segment totals: record==1 @ pos i -> 67+41i+17; record==3 @ pos j ->
 *   67+200+24+41j+17; neither -> 67+200+24+200+10 = 501. Harness-verified EQUAL
 *   whole-machine + unit; each branch's collapsed total is re-asserted against the
 *   oracle in the synthesised branch-coverage tests.
 */
export function loc_141e(m) {
  const { regs, mem } = m;

  // ── call sub_0616 (draw string 5 + BCD expand). 17t is the call itself. ──
  m.push16(0x1421);
  m.step(0x0616, 17);
  m.call(0x0616);

  // ── rst 0x18: tick SUBSTATE_TIMER (0x6009). If it has NOT expired, sub_0018
  //    discards our return address and control skips to our caller's caller --
  //    the dispatch is abandoned this frame (early return, no writes). ──
  m.push16(0x1422);
  m.step(0x0018, 11);
  if (!m.call(0x0018)) return;

  // ── call sub_0874 (clear the playfield). 17t is the call itself. ──
  m.push16(0x1425);
  m.step(0x0874, 17);
  m.call(0x0874);

  // ── clear the player index / score-slot selector, then scan 0x611C[5] ──
  mem.write8(0x600e, 0x00); // clear player index
  mem.write8(0x600d, 0x00); // clear score-slot selector

  // The scan uses REAL registers (not local values): on the neither-found path
  // loc_1475 preserves HL/DE/B/C and F, so the scan's exact end-state is observable
  // (see header REGISTERS/FLAGS). `regs.b = (b-1)&0xff` models djnz's counter
  // WITHOUT touching flags, exactly as the oracle does.
  regs.hl = 0x611c;
  regs.de = 0x0022; // stride
  regs.b = 0x05;
  regs.a = 0x01; // search key #1 (invariant across loop 1)

  // Collapsed cycle accounting (atomic NMI routine; see header). Start at the
  // 67t prologue (0x1425 `ld a,0x00` .. 0x1437 `ld a,0x01`).
  let cyc = 67;

  // Scan for a record == 1 -> loc_1459 (entered with A = 0x01).
  for (;;) {
    regs.cp(mem.read8(regs.hl)); // cp (hl) -- sets Z on a match
    if (regs.fZ) {
      m.step(0x1459, cyc + 17); // + the hit (cp + jp z taken)
      return m.call(0x1459);
    }
    regs.addHl(regs.de); // advance to the next record
    regs.b = (regs.b - 1) & 0xff; // djnz counter (no flag effect)
    if (regs.b === 0) { cyc += 36; break; } // 5th miss exhausts the loop (djnz n/t = 8)
    cyc += 41; // miss (cp + jp z n/t + add + djnz taken = 13)
  }

  // Not found: re-scan for a record == 3 -> loc_144f.  (+24t loop-2 setup.)
  regs.hl = 0x611c;
  regs.b = 0x05;
  regs.a = 0x03; // search key #3
  cyc += 24;
  for (;;) {
    regs.cp(mem.read8(regs.hl));
    if (regs.fZ) {
      m.step(0x144f, cyc + 17);
      return m.call(0x144f);
    }
    regs.addHl(regs.de);
    regs.b = (regs.b - 1) & 0xff;
    if (regs.b === 0) { cyc += 36; break; }
    cyc += 41;
  }

  // Neither found -> loc_1475 (which passes the scan's final HL/DE/B/F through).
  m.step(0x1475, cyc + 10); // + the `jp 0x1475`
  return m.call(0x1475);
}
