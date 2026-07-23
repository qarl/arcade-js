// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0965 — hand-optimized rewrite of the translated routine at ROM 0x0965,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x309f, the task-enqueue helper) is reached
 * through m.call(0xADDR) — the routine registry (games/dkong/routines.js) — so it
 * resolves to the oracle, or to sub_309f's own optimized rewrite once one exists,
 * never a copied implementation. This routine references no work-RAM address of its
 * own (every store is sub_309f's), so it imports no names from ram.js.
 */

/**
 * sub_0965 -- ROM 0x0965-0x0976  "enqueue the attract / how-high string task block"
 *
 *   0965  11 00 04   ld   de,0x0400
 *   0968  cd 9f 30   call 0x309f          ; enqueue task [D=0x04, E=0x00]
 *   096b  11 14 03   ld   de,0x0314
 *   096e  06 06      ld   b,0x06
 *   0970  cd 9f 30   call 0x309f          ; loop: enqueue task [D=0x03, E]
 *   0973  1c         inc  e               ; step the payload byte
 *   0974  10 fa      djnz 0x0970
 *   0976  c9         ret
 *
 * WHAT IT DOES. Pushes SEVEN draw tasks onto the task ring — sub_309f writes each
 * [D,E] pair at 0x60C0+TASK_TAIL (0x60B0). First one task 0x0400, then six
 * consecutive tasks 0x0314..0x0319: the handler index D stays 0x03 across the six
 * while the payload byte E increments 0x14->0x19, so it queues six instances of the
 * SAME draw handler with six different parameters. That is how a single routine
 * paints several strings — the attract title block and the "how high" interlude,
 * which are this routine's two callers (loc_08ba @0x08CB, handler_0779 @0x078E).
 *
 * INPUTS: none. DE and B are loaded from immediates; it reads no work RAM.
 * OUTPUTS: seven task-ring entries (all written by sub_309f, at sub_309f's own bus
 *   cycles). Registers on return: B=0 (djnz ran it down), D=0x03, E=0x1a (0x14 plus
 *   six inc e), and A/F left by sub_309f's final call. sub_309f pushes/pops HL and
 *   never writes B/D/E, so DE and B evolve here exactly as written and HL is
 *   preserved across each call (verified from the oracle sub_309f).
 *   ★ This routine makes NO direct memory write of its own and touches NO hardware
 *   latch (0x7Dxx) — every store is sub_309f's work-RAM task-ring write — so there
 *   is NO hardware-write-trace concern and nothing to partial-collapse around.
 *
 * FLAGS. The observable F on return is `inc e`'s from the LAST loop iteration: the
 * translation models djnz as a bare `b = (b-1)&0xff` with no flag effect, and ret
 * leaves F alone, so the final `inc e` is the last writer of F. Kept verbatim via
 * regs.inc8 so F matches the oracle exactly — the unit gate compares the whole
 * register file, F included. Neither caller consumes a flag from it (both fall
 * through into their own straight-line continuation).
 *
 * LADDER STATUS — idiomatic, cycles collapsed to ONE total (single branch).
 * sub_0965 is ATOMIC on every call path. Grep confirms its ONLY `m.call(0x0965)`
 * sites are loc_08ba (0x08CB) and handler_0779 (0x078E); both run INSIDE the vblank
 * NMI, whose handler clears the NMI mask (io.nmiMask := 0) on entry, so the NMI
 * cannot re-fire anywhere inside this routine or sub_309f on either path. Its
 * control flow is fixed — B is the immediate 0x06 and DE are immediates, so there is
 * no data-dependent branch and no loop-count variability: exactly ONE execution
 * path. Its internal cycle DISTRIBUTION is therefore unobservable, so the
 * per-instruction m.step charges collapse to one:
 *   10 (ld de) + 17 (call) + 10 (ld de) + 7 (ld b)
 *   + 199 (loop: 6*(17 call + 4 inc e) + djnz 5*13 taken + 1*8 not-taken)
 *   = 243, charged once before the ret; m.ret adds its own 10 -> own total 253 t.
 * The TOTAL is still load-bearing (it is part of the caller's NMI cost, which sets
 * the main-loop vblank spin count = the PRNG entropy, README §2), so it is preserved
 * exactly; only the distribution is dropped. Harness-verified EQUAL whole-machine
 * AND unit, and the total is pinned by an explicit oracle-vs-optimized cycle-delta
 * test (both = 1205 t including the seven sub_309f callees). Same universal lesson
 * as loc_08ba / handler_0779, which collapse identically and both call this routine.
 */
export function sub_0965(m) {
  const { regs } = m;

  // 0x0965-0x096A: enqueue task [D=0x04, E=0x00].
  regs.de = 0x0400;
  m.push16(0x096b);
  m.call(0x309f);

  // 0x096B-0x0975: enqueue six tasks [D=0x03, E=0x14..0x19] — one draw handler, six
  // payloads. B is the djnz loop counter; E is the payload byte stepped each pass.
  regs.de = 0x0314;
  regs.b = 0x06;
  do {
    m.push16(0x0973);
    m.call(0x309f);
    regs.e = regs.inc8(regs.e); // inc e — sets F (last pass's F is the return F)
    regs.b = (regs.b - 1) & 0xff; // djnz — 8-bit decrement, no flags (oracle model)
  } while (regs.b !== 0);

  // 0x0976: ret. Atomic + single branch -> collapse the whole own-instruction cost
  // into one charge, then ret. 243 + ret(10) = 253 t, exactly the oracle's own total.
  m.step(0x0976, 243);
  m.ret();
}
