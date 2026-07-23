// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_00e0 — hand-optimized rewrite of the translated routine at ROM 0x00E0,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. sub_00e0 is a LEAF — it calls nothing — so there is no
 * `m.call` here and nothing to import from translated/. Only RAM *names* are
 * imported (from ram.js); the three hardware-latch addresses it drives are board
 * outputs (not work RAM), so they are named locally, like loc_0a8a's palette bank.
 */

import {
  ATTRACT,
  SND_TRIGGER,
  SND_IRQ_TRIGGER,
  SND_BGM,
  SND_PRIORITY,
  SND_PRIORITY_FRAMES,
} from "./ram.js";

// ---- Hardware output latches (board devices, NOT work RAM — see io.js) -------
// ls259.6h addressable sound-trigger latch, one address per bit, data on bit 0.
// sub_00e0 walks its eight addresses in lockstep with the SND_TRIGGER shadows.
const SOUND_TRIGGER_LATCH = 0x7d00; // [8] 0x7D00-0x7D07
// ls175.3d sound-tune latch: the tune index the sound CPU plays.
const SOUND_TUNE_LATCH = 0x7c00;
// I8035 sound-CPU interrupt line (asserted to kick a queued IRQ tune).
const SOUND_IRQ = 0x7d80;

/**
 * sub_00e0 -- "sound driver tick": push the queued sound state to the audio
 * hardware, once per vblank.  [ROM 0x00E0-0x011B]
 *
 * WHAT IT DOES (three parts, in order):
 *   1. ENABLE GUARD. Read ATTRACT (0x6007); if it is non-zero (no credited game)
 *      `ret nz` — the sound driver is silent during attract. (Same 0x6007 gate
 *      sub_0008/entry_0611 use, here as `and a / ret nz` rather than `rrca`.)
 *   2. EIGHT SOUND TRIGGERS. Walk the eight SND_TRIGGER shadow bytes (0x6080-
 *      0x6087) in step with the eight ls259.6h latch bits (0x7D00-0x7D07): a
 *      non-zero shadow is a countdown — decrement it and drive its latch bit to 1
 *      (assert the sound); a zero shadow drives its bit to 0 (release). So a
 *      shadow byte holds a trigger asserted for N frames. The shadows are the
 *      readable copy of the write-only device, which is why they live in RAM.
 *   3. TUNE + IRQ TAIL.
 *      - Tune latch (0x7C00): if SND_PRIORITY_FRAMES (0x608B) is non-zero, play
 *        the priority tune SND_PRIORITY (0x608A) and tick the frame counter down;
 *        otherwise play the background tune SND_BGM (0x6089). (`ld hl,0x608b`
 *        then `dec l` walks HL down 0x608B->0x608A / ->0x6089.)
 *      - IRQ line (0x7D80): if SND_IRQ_TRIGGER (0x6088) is non-zero, decrement it
 *        and drive the line to 1 (fire a queued IRQ tune); otherwise drive it 0.
 *
 * INPUTS (RAM read): ATTRACT, SND_TRIGGER[8], SND_PRIORITY_FRAMES, SND_PRIORITY,
 *   SND_BGM, SND_IRQ_TRIGGER.  OUTPUTS: the eight ls259.6h latch bits; the 0x7C00
 *   tune latch; the 0x7D80 IRQ line; and the decremented shadows (SND_TRIGGER[i],
 *   SND_PRIORITY_FRAMES, SND_IRQ_TRIGGER) in work RAM.
 *
 * REGISTERS at exit (the unit gate compares the whole file). On the guard-clear
 *   (early-return) path: HL=0x6080, DE=0x7D00, A=ATTRACT, B untouched, F = `and a`
 *   on ATTRACT. On the full path: DE ends 0x7D08 and B ends 0 (the loop leaves
 *   them; nothing downstream reads them, so they are walked faithfully rather than
 *   dropped), HL=0x6088 (tail sets it), A = 0 or 1 (the IRQ bit).
 *
 * FLAGS. Exit F is set by the TAIL: on the IRQ Z-branch by `cp (0x6088)` (A=0 vs
 *   the trigger), on the NZ-branch by `inc a` (A 0->1). The per-iteration `and a`
 *   in the loop and the `and a` at the tail head only pick a branch and are
 *   overwritten before anything reads them (the routine is atomic — see below —
 *   so no NMI snapshots an intermediate F), so those dead flag tests are dropped;
 *   the JS `if` picks the branch instead. Every flag-writer whose result DOES
 *   reach exit — the guard `and a`, the tail `cp`, the `dec8`/`inc8` on the taken
 *   IRQ arm — is kept verbatim.
 *
 * ATOMIC — its ONE call path (grepped): sub_00e0's only caller is perFrame (ROM
 *   0x00B5) via `m.call(0x00e0)`, and perFrame runs INSIDE the vblank NMI, which
 *   does not re-enter. So the NMI can never land inside sub_00e0: its internal
 *   cycle DISTRIBUTION is unobservable and may be collapsed. The TOTAL per branch
 *   is still load-bearing — as part of the NMI's cost it sets the main-loop spin
 *   count (README §2, SPIN_COUNT) — so each branch's per-instruction charges are
 *   summed and preserved exactly (whole-machine EQUAL confirms it).
 *
 * PARTIAL COLLAPSE (hardware-write caveat). sub_00e0 makes TEN hardware writes —
 *   the eight ls259.6h bits (`ld (de),a`, bus offset 4), the 0x7C00 tune latch and
 *   the 0x7D80 IRQ line (both `ld (nn),a`, bus offset 10). Each has a write-bus
 *   cycle (clock()+busOffset) recorded in emit.js's --writes trace that the RAM+
 *   regs gate CANNOT see (0x7C00/0x7Dxx are write-only devices, not RAM). So this
 *   does NOT fully collapse: it keeps each hardware-write-free RUN as ONE m.step,
 *   but brackets every hardware write so the cumulative clock at it — hence its bus
 *   cycle — is byte-identical to the oracle. The per-branch sums (verified against
 *   the oracle's per-instruction charges):
 *     prologue     early-return 48t  |  continue 49t
 *     loop /iter   pre-write 21t (zero shadow) / 39t (non-zero)  +  latch write
 *                  post-write 28t (djnz taken) / 23t (last iteration)
 *     tail-1       53t (priority) / 56t (background)  before the 0x7C00 write
 *     tail-2       44t (IRQ clear) / 59t (IRQ set)    before the 0x7D80 write, then ret 10t
 *   The equivalence gate can't police the trace, so the write-trace test proves the
 *   ten writes land at the oracle's exact bus cycle and that a flat collapse shifts
 *   them (loc_0a8a is the worked pattern).
 */
export function sub_00e0(m) {
  const { regs, mem } = m;

  // ---- 1. Enable guard: silent unless a credited game is in progress. --------
  // ld hl,SND_TRIGGER / ld de,0x7d00 / ld a,(ATTRACT) / and a
  regs.hl = SND_TRIGGER; // 0x6080
  regs.de = SOUND_TRIGGER_LATCH; // 0x7d00
  regs.a = mem.read8(ATTRACT);
  regs.and(regs.a);
  if (regs.fNZ) {
    // ret nz taken — do nothing. path total 10+10+13+4 + 11 = 48t.
    const ret = m.pop16();
    m.step(ret, 48);
    return;
  }
  regs.b = 0x08;
  m.step(0x00ed, 49); // ...+ ret nz not-taken (5) + ld b,0x08 (7) = 49t

  // ---- 2. Eight sound triggers: shadow countdown -> ls259.6h latch bit. ------
  do {
    const shadow = mem.read8(regs.hl);
    if (shadow === 0) {
      regs.a = 0; // drive the bit low (release)
      m.step(0x00f5, 21); // ld a,(hl) 7 + and a 4 + jp z 10
    } else {
      mem.write8(regs.hl, regs.dec8(shadow)); // dec (hl) -- tick the countdown (work RAM)
      regs.a = 0x01; // drive the bit high (assert)
      m.step(0x00f5, 39); // ld a,(hl) 7 + and a 4 + jp z(nt) 10 + dec(hl) 11 + ld a,0x01 7
    }
    mem.write8(regs.de, regs.a, 4); // ls259.6h bit  [HW write @ +4t]
    regs.e = (regs.e + 1) & 0xff; // inc e
    regs.l = (regs.l + 1) & 0xff; // inc l
    regs.b = (regs.b - 1) & 0xff; // djnz counter
    // ld (de),a 7 + inc e 4 + inc l 4 + djnz (13 taken / 8 last) = 28 / 23t
    m.step(regs.b !== 0 ? 0x00ed : 0x00fa, regs.b !== 0 ? 28 : 23);
  } while (regs.b !== 0);

  // ---- 3a. Tune latch (0x7C00): priority tune, else background tune. ---------
  regs.hl = SND_PRIORITY_FRAMES; // 0x608b
  regs.a = mem.read8(regs.hl);
  regs.and(regs.a);
  if (regs.fNZ) {
    // Priority tune active: tick its frame counter, select SND_PRIORITY (0x608a).
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl))); // dec (0x608b)
    regs.l = (regs.l - 1) & 0xff; // hl -> SND_PRIORITY (0x608a)
    regs.a = mem.read8(regs.hl);
    m.step(0x010b, 53); // ld hl 10 + ld a 7 + and a 4 + jp nz 10 + dec(hl) 11 + dec l 4 + ld a 7
  } else {
    // No priority tune: select the looping background tune SND_BGM (0x6089).
    regs.l = (regs.l - 1) & 0xff; // hl -> 0x608a
    regs.l = (regs.l - 1) & 0xff; // hl -> SND_BGM (0x6089)
    regs.a = mem.read8(regs.hl);
    m.step(0x010b, 56); // ld hl 10 + ld a 7 + and a 4 + jp nz(nt) 10 + dec l 4 + dec l 4 + ld a 7 + jp 10
  }
  mem.write8(SOUND_TUNE_LATCH, regs.a, 10); // ls175.3d tune latch  [HW write @ +10t]

  // ---- 3b. IRQ line (0x7D80): fire a queued IRQ tune, else release. ----------
  regs.hl = SND_IRQ_TRIGGER; // 0x6088
  regs.xor(regs.a); // A = 0
  regs.cp(mem.read8(regs.hl)); // cp (0x6088) -- sets Z if no IRQ queued
  if (regs.fZ) {
    // No IRQ queued: A stays 0, drive the line low.
    m.step(0x0118, 44); // ld (7c00) 13 + ld hl 10 + xor a 4 + cp(hl) 7 + jp z 10
  } else {
    // IRQ queued: tick its counter and drive the line to 1.
    mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl))); // dec (0x6088)
    regs.a = regs.inc8(regs.a); // A = 1
    m.step(0x0118, 59); // ...+ jp z(nt) 10 + dec(hl) 11 + inc a 4
  }
  mem.write8(SOUND_IRQ, regs.a, 10); // I8035 IRQ line  [HW write @ +10t]
  m.step(0x011b, 13); // ld (0x7d80),a
  m.ret(); // ret (0x011B)
}
