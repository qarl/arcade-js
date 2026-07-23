// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_011c — hand-optimized rewrite of the translated routine at ROM 0x011C,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It calls nothing, so there is no `m.call`. Only the RAM
 * *names* for its two work-RAM shadow spans are imported (from ram.js); the four
 * hardware-latch addresses it writes are board control outputs (not work RAM),
 * so they live as local constants here, exactly as loc_0a8a keeps the palette
 * latches.
 */

import { SND_TRIGGER, SND_IRQ_TRIGGER } from "./ram.js";

// ---- Hardware sound latches (board control outputs, NOT work RAM) -----------
// ls259.6h addressable latch, one address per bit at 0x7D00-0x7D07 (data on bit
// 0). Its eight bits are the per-effect sound triggers; the CPU keeps a readable
// shadow of them in work RAM at SND_TRIGGER (0x6080-0x6087) because the latch is
// write-only from the Z80 side.
const SOUND_LATCH_6H = 0x7d00;
// The I8035 sound-CPU interrupt line (ls259-style, writeAudioIrq): a pulse here
// interrupts the audio CPU.
const AUDIO_IRQ = 0x7d80;
// ls175.3d sound latch (writeSoundLatch3d): the byte handed to the sound CPU.
const SOUND_LATCH_3D = 0x7c00;

/**
 * sub_011c -- "silence the sound hardware". [ROM 0x011C-0x0137, a leaf: no calls.]
 *
 *   011c  06 08        ld   b,0x08
 *   011e  af           xor  a
 *   011f  21 00 7d     ld   hl,0x7d00
 *   0122  11 80 60     ld   de,0x6080
 *   0125  77 12 2c 1c  ld (hl),a / ld (de),a / inc l / inc e   ; loc_0125
 *   0129  10 fa        djnz 0x0125
 *   012b  06 04        ld   b,0x04
 *   012d  12 1c        ld (de),a / inc e                       ; loc_012d
 *   012f  10 fc        djnz 0x012d
 *   0131  32 80 7d     ld   (0x7d80),a
 *   0134  32 00 7c     ld   (0x7c00),a
 *   0137  c9           ret
 *
 * WHAT IT DOES. Zeroes every sound output and its work-RAM mirror, in three steps:
 *   1. Loop 8× (loc_0125): write 0 to each ls259.6h latch bit (0x7D00-0x7D07, the
 *      hardware) AND to its shadow in work RAM (SND_TRIGGER 0x6080-0x6087). `inc l`
 *      / `inc e` walk both pointers -- deliberately 8-bit increments (the high
 *      bytes never move, and a 16-bit inc would be wrong the moment a low byte
 *      wrapped).
 *   2. Loop 4× (loc_012d): write 0 to the sound-control block 0x6088-0x608B
 *      (SND_IRQ_TRIGGER, SND_BGM, SND_PRIORITY, SND_PRIORITY_FRAMES). Work RAM
 *      only -- no hardware side, so no shadow/hardware pair here.
 *   3. Two final hardware writes: AUDIO_IRQ (0x7D80) off and SOUND_LATCH_3D
 *      (0x7C00) cleared.
 *
 * The shadow copies matter to us: the latch is write-only from the Z80 side, so
 * the ROM keeps its own readable mirror in RAM, and THAT mirror is what lands in
 * the diffed state dump (the hardware register itself is invisible to it). So the
 * state gate sees the work-RAM zeros; the hardware writes are policed separately
 * by the write-trace test (see below).
 *
 * INPUTS: none read from RAM -- A is zeroed by `xor a` and every store writes that
 *   0. OUTPUTS: hardware latches 0x7D00-0x7D07, 0x7D80, 0x7C00 all 0; work RAM
 *   0x6080-0x608B all 0.
 *
 * REGISTERS on exit (the unit gate compares the whole file, so these are exact):
 *   A = 0; B = 0 (both djnz loops run to zero); HL = 0x7D08 (0x7D00 + 8 inc l);
 *   DE = 0x608C (0x6080 + 8 inc e + 4 inc e); SP = entry SP + 2 (the ret pops its
 *   return address). The inc8/xor/djnz ops are kept verbatim so those values --
 *   and F -- come out identical.
 *
 * FLAGS: the routine ends in an unconditional `ret`, so its caller consumes no
 *   `ret cc`; but the unit gate compares F, so the flag-writers are kept verbatim.
 *   The final observable F is the last `inc e`'s (E 0x8B -> 0x8C): S set, Z/H/PV
 *   clear, N clear, C preserved 0 (from the initial `xor a`; nothing between sets
 *   carry -- inc/djnz/ld never touch it). `djnz` sets no flags on the Z80.
 *
 * PC / RET -- NOTE (this is a boot.js-style routine). The oracle uses `m.tick`
 *   throughout and ends `m.pop16(); m.tick(10)` -- it does NOT maintain m.pc (it
 *   discards the popped return address rather than stepping to it). So this rewrite
 *   mirrors that EXACTLY: `m.pop16()` + a bare tick for the `ret`, and NO `m.step`
 *   / `m.ret` anywhere. Using `m.ret` would set pc to the return address and
 *   diverge from the oracle, which leaves pc stale at its entry value -- and the
 *   unit gate compares pc. (That the oracle never step()s is also why the vblank
 *   NMI can never fire inside it: fireNmi throws on pcKnown=false, so the game
 *   running proves the NMI never lands here -- i.e. sub_011c is ATOMIC on every
 *   call path. It runs during boot with the NMI masked, and from the masked NMI
 *   dispatch and reset/game-over transitions.)
 *
 * ATOMIC -- cycles PARTIALLY collapsed (like loc_0a8a), the TOTAL preserved.
 *   sub_011c is atomic (above), so the NMI never lands inside it and its internal
 *   cycle DISTRIBUTION would be free -- EXCEPT it makes ten HARDWARE writes whose
 *   write-bus cycle (= clock()+busOffset) is recorded in the emit.js --writes
 *   trace, which the RAM+regs gate cannot see. A full collapse would silently move
 *   those. So each loop-1 iteration's HARDWARE write is issued FIRST, at the exact
 *   cumulative cycle the oracle reached (prologue 31, then +35 per prior iter), and
 *   the iteration's remaining charges collapse into one tick AFTER it. Loop 2 has
 *   no hardware write, so its body collapses to one tick/iteration freely; the two
 *   tail writes keep their own charges so 0x7D80/0x7C00 land at their exact cycle.
 *   The routine TOTAL (440t) is still load-bearing: it is part of boot's cycle
 *   budget, so a wrong total shifts where the first post-boot NMI lands and the
 *   spin count that seeds the PRNG (README §2) -- the whole-machine gate would
 *   diverge. The write-trace test pins the ten hardware-write cycles with teeth.
 */
export function sub_011c(m) {
  const { regs, mem } = m;

  // ---- Prologue (no hardware write -> collapses freely): A=0, set up pointers.
  regs.b = 0x08;
  regs.xor(regs.a); // A = 0 -- the byte written to every latch + shadow
  regs.hl = SOUND_LATCH_6H; // 0x7D00, the ls259.6h hardware latch
  regs.de = SND_TRIGGER; // 0x6080, its work-RAM shadow
  m.tick(31); // ld b (7) + xor a (4) + ld hl (10) + ld de (10)

  // ---- Loop 1 (loc_0125): clear the 8 latch bits + their shadow copies. -------
  // The HARDWARE write is issued first each iteration so its bus cycle = the
  // oracle's cumulative (31 + 35*k) + 4; the rest of the iteration's charge
  // (ld (hl),a 7 + ld (de),a 7 + inc l 4 + inc e 4 + djnz 13/8 = 35, last 30)
  // collapses into one tick AFTER it.
  do {
    mem.write8(regs.hl, regs.a, 4); // ls259.6h bit  [HW write, ld (hl),a bus +4t]
    mem.write8(regs.de, regs.a); //     work-RAM shadow copy (not traced)
    regs.l = regs.inc8(regs.l); // inc l -- NOT inc hl (high byte fixed)
    regs.e = regs.inc8(regs.e); // inc e -- NOT inc de
    regs.djnz();
    m.tick(regs.b !== 0 ? 35 : 30);
  } while (regs.b !== 0);

  // ---- Loop 2 (loc_012d): clear the 0x6088-0x608B sound-control block. --------
  // Work RAM only (SND_IRQ_TRIGGER..SND_PRIORITY_FRAMES), no hardware write, so
  // each iteration collapses to one tick (ld (de),a 7 + inc e 4 + djnz 13/8).
  regs.b = 0x04;
  m.tick(7); // ld b,0x04
  do {
    mem.write8(regs.de, regs.a); // 0x6088-0x608B (starts at SND_IRQ_TRIGGER)
    regs.e = regs.inc8(regs.e); // inc e
    regs.djnz();
    m.tick(regs.b !== 0 ? 24 : 19);
  } while (regs.b !== 0);

  // ---- Tail: two hardware writes, each keeping its own charge so it lands at
  //      the oracle's exact bus cycle (ld (nn),a bus +10t).
  mem.write8(AUDIO_IRQ, regs.a, 10); // 0x7D80 audio IRQ off        [HW write]
  m.tick(13); // ld (0x7d80),a
  mem.write8(SOUND_LATCH_3D, regs.a, 10); // 0x7C00 ls175.3d cleared [HW write]
  m.tick(13); // ld (0x7c00),a

  // ret (0x0137): pop the return address and discard it -- the oracle does NOT
  // step to it (boot.js style, m.pc left stale). SP += 2; pc unchanged.
  m.pop16();
  m.tick(10);
}
