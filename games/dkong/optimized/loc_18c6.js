// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_18c6 — hand-optimized rewrite of the translated routine at ROM 0x18C6,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one address-boundary callee (0x3009) is reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so it
 * resolves to the oracle — or to a future optimized rewrite — never a copy.
 *
 * THE WRAP FRAGMENT. loc_18c6's `jp z,0x193d` is an INTRA-routine jump into a
 * tail fragment the translator split out as `loc_18c6_wrap`. That fragment is
 * NOT a registry entry (0x18c6 in the swap table resolves to loc_18c6 itself),
 * so it cannot be reached with `m.call(0x18c6)`. It is reused exactly as the
 * oracle reuses it — imported from translated/ and called DIRECTLY — so there is
 * a single implementation of the wrap and it can never drift. (This is the one
 * sanctioned import of translated *code*; every other callee goes via m.call.)
 * Only RAM *names* are otherwise imported (ram.js).
 */

import { MARIO_X, LEVEL, SND_PRIORITY, SND_PRIORITY_FRAMES } from "./ram.js";
import { loc_18c6_wrap } from "../translated/state0.js";

/**
 * loc_18c6 -- "how-high" board-advance staging, driven by the 0x62AF counter.
 * [ROM 0x18C6-0x196A; entry 5 of loc_1644's rst-0x28 table @0x1648 (0x6388==5),
 * reached via dispatchGameState while GAME_STATE(0x6005)==3, GAME_SUBSTATE
 * (0x600A)==0x16, and BOARD(0x6227) bits 0+1 clear -> loc_1615 -> sub_1641.]
 *
 * WHAT IT DOES. A per-frame down-counter (0x62AF) that paces the "how high can
 * you get?" board-transition screen. Each dispatch first `dec (0x62AF)`:
 *   - COUNTER WRAPS TO 0 (Z): hand off to loc_18c6_wrap (ROM 0x193D) -- walk the
 *     board-sequence pointer, reset the 0x6388 sequence, and set GAME_SUBSTATE
 *     0x600A=8 to advance to the next state. (Delegated to the oracle fragment.)
 *   - EVERY-8th GATE: reload the counter, `and 0x07`; on any non-multiple-of-8
 *     value just `ret` (most frames do nothing but tick).
 *   - On each 8th tick, PROCEED: toggle bit 7 of 0x6A25 and (around a call to
 *     sub_3009, a bit-field selector fed A=0 / B=(0x6919) with bit5 cleared) set
 *     bit 5 of 0x6919 -- the two blink/animation flags for the screen. Then
 *     re-read the counter and branch on its exact value:
 *       * == 0xE0: STAGE. Seed a sprite record 0x694C/0x694D/0x694F, then by
 *         MARIO_X(0x6203) vs 0x80 pick its X/attr (< 0x80 -> 0x694D=0x80,
 *         0x694C=0x5F; else leave 0/0x9F). Falls through to a `cp 0xC0` that
 *         is never equal here, so it rets.
 *       * == 0xC0: RECORD. Write the sound cue -- SND_PRIORITY(0x608A)=0x0C, or
 *         0x05 when LEVEL(0x6229) is even (bit0 clear) -- SND_PRIORITY_FRAMES
 *         (0x608B)=0x03, and a 4-byte object record 8F 76 09 40 at 0x6A20. Then
 *         by MARIO_X vs 0x80: >= 0x80 rets; < 0x80 overwrites 0x6A20 with 0x6F.
 *       * otherwise: `ret` (neither staging value).
 *
 * INPUTS (RAM read): 0x62AF (the counter), 0x6A25 + 0x6919 (blink flags),
 *   MARIO_X (0x6203), LEVEL (0x6229). Register live-in to sub_3009 is set here.
 * OUTPUTS (RAM written): 0x62AF (dec); on the proceed arms 0x6A25, 0x6919; on
 *   STAGE 0x694C/0x694D/0x694F; on RECORD SND_PRIORITY, SND_PRIORITY_FRAMES,
 *   and 0x6A20-0x6A23; via loc_18c6_wrap on the wrap arm (0x622A/0x6227/0x6229/
 *   0x622E/0x6388/0x6009/0x600A). No HARDWARE (0x7Dxx) write anywhere -- every
 *   store is work RAM -- so no write-bus-cycle trace is at stake and the cycle
 *   collapse below is unconstrained by the hardware-write caveat.
 *
 * NAMES. MARIO_X/LEVEL/SND_PRIORITY/SND_PRIORITY_FRAMES are the evidenced ram.js
 *   names for the addresses read/written here. 0x694C/0x694D/0x694F are left hex
 *   deliberately: 0x694C is ram.js's MARIO_SPRITE_RECORD, but this is the how-
 *   high transition screen setting up a cutscene sprite, so asserting "Mario"
 *   here would mislead (README §4: a wrong name is worse than hex). 0x62AF,
 *   0x6A25, 0x6919, 0x6A20-23 have no evidenced name -> hex.
 *
 * FLAGS. Nothing downstream consumes loc_18c6's flags -- dispatchGameState's
 *   rst-0x28 tail makes no `ret cc` and branches on no flag it leaves. But the
 *   unit gate compares the whole register file (F included), so every flag-
 *   writer is kept verbatim and each exit lands the oracle's F exactly: gate-ret
 *   = `and 0x07`; proceed/stage/record-retnc = the terminating `cp`; the 0x6F
 *   write-arm keeps `cp 0x80`'s F (the two `ld` after it are flag-neutral).
 *   Registers likewise: the whole op sequence (incl. the exact A=0/B setup that
 *   feeds sub_3009, and HL's walk) is preserved, so A/B/C/D/E/HL match at every
 *   exit; only the per-instruction cycle *distribution* is changed.
 *
 * ATOMIC -- cycles collapsed to one total per straight-line segment, TOTAL
 *   preserved. loc_18c6 runs INSIDE the vblank NMI (dispatchGameState), which is
 *   non-reentrant, so the NMI never lands inside it or sub_3009 -- its internal
 *   cycle distribution is unobservable (same basis as loc_0a8a). The TOTAL is
 *   still load-bearing (it feeds the main-loop spin count, README §2), so each
 *   executed path charges exactly the oracle's per-instruction SUM, split only
 *   where the sub_3009 call forces it. Harness-verified: whole-machine EQUAL
 *   holds with the collapse (a wrong total would diverge at the spin count), and
 *   every synthesised branch asserts its cycle total equals the oracle's.
 *
 *   Per-branch totals (loc_18c6's own T-states, excl. sub_3009's/the wrap's own):
 *     wrap        21 + wrap        gate-ret            56
 *     proceed !E0!C0 (C2-nz)  193  stage @E0, MARIO<80 330  MARIO>=80  290
 *     record @C0: LEVEL-odd+MARIO>=80 351 / +MARIO<80 375;
 *                 LEVEL-even+MARIO>=80 356 / +MARIO<80 380
 */
export function loc_18c6(m) {
  const { regs, mem } = m;

  // -- 0x18C6: dec the 0x62AF pacing counter; hand to the wrap on 0-crossing --
  regs.hl = 0x62af;
  regs.decMem8(mem, regs.hl); // dec (hl) -- Z set on wrap
  if (regs.fZ) {
    // jp z,0x193d TAKEN -> loc_18c6_wrap. Oracle charges only ld hl(10)+dec(11)
    // before delegating (the taken jp-z's 10t is not charged on this arm), so
    // this segment is 21t; the wrap fragment then charges its own path.
    m.step(0x18ca, 21);
    return loc_18c6_wrap(m); // intra-routine fragment: call DIRECTLY, not m.call
  }

  // -- 0x18CD: every-8th gate -- most frames just tick and ret --
  regs.a = mem.read8(regs.hl); // ld a,(hl) = post-dec counter
  regs.and(0x07); // and 0x07
  if (regs.fNZ) {
    m.ret(56); // ret nz -- 10+11+10+7+7+11
    return;
  }

  // -- 0x18D1: toggle the two blink flags around sub_3009 --
  regs.hl = 0x6a25;
  regs.a = mem.read8(regs.hl);
  regs.xor(0x80); // xor 0x80
  mem.write8(regs.hl, regs.a); // (0x6A25) ^= 0x80
  regs.hl = 0x6919;
  regs.b = mem.read8(regs.hl);
  regs.b = regs.res(5, regs.b); // res 5,b -- sub_3009's B arg
  regs.xor(regs.a); // xor a -- A=0, sub_3009's A arg
  m.push16(0x18e2);
  m.step(0x3009, 127); // entry..call 0x3009 inclusive (proceed prologue 50 + toggle/call 77)
  m.call(0x3009); // sub_3009: A in / A out; preserves HL=0x6919
  regs.or(0x20); // or 0x20
  mem.write8(regs.hl, regs.a); // (0x6919) = A | 0x20

  // -- 0x18E5: reload the counter, branch on its exact value --
  regs.hl = 0x62af;
  regs.a = mem.read8(regs.hl); // A = post-dec counter
  regs.cp(0xe0);
  m.step(0x18eb, 48); // post-call..jp nz inclusive
  if (regs.fZ) {
    // -- 0x18EE: STAGE @0xE0 -- seed the cutscene sprite record --
    regs.a = 0x50;
    mem.write8(0x694f, regs.a);
    regs.a = 0x00;
    mem.write8(0x694d, regs.a);
    regs.a = 0x9f;
    mem.write8(0x694c, regs.a);
    regs.a = mem.read8(MARIO_X); // ld a,(0x6203)
    regs.cp(0x80);
    m.step(0x1902, 90); // stage block .. jp nc inclusive
    if (regs.fC) {
      // jp nc NOT taken (MARIO_X < 0x80) -> 0x1905
      regs.a = 0x80;
      mem.write8(0x694d, regs.a);
      regs.a = 0x5f;
      mem.write8(0x694c, regs.a);
      m.step(0x190f, 40);
    }
    regs.a = mem.read8(regs.hl); // 0x190F: ld a,(hl) re-read 0x62AF (== 0xE0)
    regs.cp(0xc0); // 0xE0 != 0xC0 -> ret nz
    m.ret(25); // ld a(7)+cp c0(7)+ret nz(11)
    return;
  }

  // -- 0x1910: cp 0xC0 (A still the reloaded counter) --
  regs.cp(0xc0);
  if (regs.fNZ) {
    m.ret(18); // ret nz -- not 0xC0: cp c0(7)+ret nz(11)
    return;
  }

  // -- 0x1913: RECORD @0xC0 -- sound cue + a 4-byte object record --
  regs.hl = SND_PRIORITY; // 0x608A
  mem.write8(regs.hl, 0x0c); // (0x608A) = 0x0C
  regs.a = mem.read8(LEVEL); // ld a,(0x6229)
  regs.rrca(); // rrca -- LEVEL bit0 -> carry
  if (regs.fC) {
    // jr c TAKEN -- LEVEL odd: keep 0x0C
    m.step(0x1920, 61); // cp c0(7)+retnz-nt(5) + block7(37) + jr c taken(12)
  } else {
    mem.write8(regs.hl, 0x05); // LEVEL even: (0x608A) = 0x05
    m.step(0x1920, 66); // ...+ jr nc nt(7) + ld(hl),0x05(10)
  }
  regs.hl = (regs.hl + 1) & 0xffff; // inc hl -> 0x608B
  mem.write8(regs.hl, 0x03); // SND_PRIORITY_FRAMES = 0x03
  regs.hl = 0x6a23;
  mem.write8(regs.hl, 0x40);
  regs.hl = (regs.hl - 1) & 0xffff;
  mem.write8(regs.hl, 0x09);
  regs.hl = (regs.hl - 1) & 0xffff;
  mem.write8(regs.hl, 0x76);
  regs.hl = (regs.hl - 1) & 0xffff;
  mem.write8(regs.hl, 0x8f); // record 8F 76 09 40 at 0x6A20-0x6A23
  regs.a = mem.read8(MARIO_X); // ld a,(0x6203)
  regs.cp(0x80);
  m.step(0x1936, 104); // inc hl .. cp 0x80 (record block, pre-ret)
  if (regs.fNC) {
    m.ret(11); // ret nc -- MARIO_X >= 0x80
    return;
  }
  m.step(0x1937, 5); // ret nc not taken
  regs.a = 0x6f;
  mem.write8(0x6a20, regs.a); // (0x6A20) = 0x6F
  m.ret(30); // ld a,0x6f(7)+ld(0x6A20),a(13)+ret(10)
}
