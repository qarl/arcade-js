// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_017b — hand-optimized rewrite of the translated routine at ROM 0x017B,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its two callees (0x011C sub_011c, 0x309F sub_309f) are
 * reached through `m.call`, the routine registry (games/dkong/routines.js), so
 * each resolves to the oracle — or to a future optimized rewrite — never a copy.
 * Only RAM *names* are imported (from ram.js); the one hardware address (IN2) is
 * a local const, since it is a board input, not work RAM.
 */

import {
  COIN_EDGE,
  GAME_STATE,
  DIP_COINS_PER_CREDIT,
  SND_TRIGGER,
} from "./ram.js";

// IN2 (0x7D00). READING it kicks the watchdog (the read IS the kick — nothing
// ever writes a watchdog register); bit 7 is COIN1. Not work RAM, so not in
// ram.js — it is a board input port (boards/dkong/memory.js readIn2).
const IN2 = 0x7d00;

/**
 * sub_017b -- coin input / credit accounting. [ROM 0x017B-0x01B9]
 * Called ONCE per vblank from perFrame (ROM 0x00B5), the NMI body.
 *
 *   017b  ld  a,(0x7d00)   ; read IN2 (2nd watchdog kick this frame)
 *   017e  bit 7,a          ; bit 7 = COIN1
 *   0180  ld  hl,0x6003    ; HL = COIN_EDGE
 *   0183  jp  nz,0x0189    ; coin present -> 0x0189
 *   0186  ld  (hl),0x01    ; no coin: (re)arm the edge latch
 *   0188  ret
 *   0189  ld  a,(hl)       ; A = edge latch
 *   018a  and a
 *   018b  ret z            ; latch already 0 -> this pulse was counted already
 *   018c  push hl          ; save 0x6003
 *   018d  ld  a,(0x6005)   ; GAME_STATE
 *   0190  cp  0x03
 *   0192  jp  z,0x019d     ; in-game (state 3) -> skip the coin sound
 *   0195  call 0x011c      ; silence/reset the sound hardware
 *   0198  ld  a,0x03
 *   019a  ld  (0x6083),a   ; SND_TRIGGER[3] = 3 (a 3-frame coin blip)
 *   019d  pop hl           ; HL = 0x6003
 *   019e  ld  (hl),0x00    ; clear the edge latch
 *   01a0  dec hl           ; -> 0x6002 COINS_PARTIAL
 *   01a1  inc (hl)         ; count this coin pulse
 *   01a2  ld  de,0x6024    ; DIP_COINS_PER_CREDIT
 *   01a5  ld  a,(de)
 *   01a6  sub (hl)         ; A = coins-per-credit - pulses-so-far
 *   01a7  ret nz           ; not enough pulses for a credit yet
 *   01a8  ld  (hl),a       ; A==0 -> reset the pulse counter
 *   01a9  inc de           ; -> 0x6025 DIP_CREDITS_PER_COIN
 *   01aa  dec hl           ; -> 0x6001 CREDITS
 *   01ab  ex  de,hl        ; HL=0x6025, DE=0x6001
 *   01ac  ld  a,(de)       ; A = credit count
 *   01ad  cp  0x90
 *   01af  ret nc           ; already at the 0x90 credit cap
 *   01b0  add a,(hl)       ; + credits-per-coin
 *   01b1  daa              ; BCD adjust (credits are packed BCD)
 *   01b2  ld  (de),a       ; store the new credit count
 *   01b3  ld  de,0x0400    ; task opcode 4 (arg 0)
 *   01b6  call 0x309f      ; enqueue it on the task ring
 *   01b9  ret
 *
 * WHAT IT DOES. IN2 bit 7 is COIN1. 0x6003 (COIN_EDGE) is a one-bit edge latch:
 * held 1 while the coin line is idle, so a coin is counted only on the frame it
 * finds the latch armed (the latch is then cleared and re-armed by the next idle
 * frame) -- holding the coin line does NOT repeat-credit. An accepted coin (a)
 * blips the coin sound unless a game is already running, (b) bumps the coin-pulse
 * counter COINS_PARTIAL, and (c) once pulses reach DIP_COINS_PER_CREDIT and the
 * credit count is below its 0x90 cap, adds DIP_CREDITS_PER_COIN to CREDITS in BCD
 * and posts a task (opcode 4) via sub_309f.
 *
 * INPUTS (read): IN2 (0x7D00, hardware), COIN_EDGE, GAME_STATE, COINS_PARTIAL,
 *   DIP_COINS_PER_CREDIT, DIP_CREDITS_PER_COIN, CREDITS.
 * OUTPUTS (written): COIN_EDGE (armed 1 / cleared 0), COINS_PARTIAL (++ then reset
 *   0), SND_TRIGGER[3]=3 (accepted, non-in-game), CREDITS (BCD, on a full credit),
 *   plus sub_011c's own writes (the ls259.6h sound latches + shadows) and
 *   sub_309f's task-ring write.
 *
 * FLAGS. The sole caller (perFrame) consumes NO flag and no return-cc value from
 * sub_017b -- it just proceeds to call sub_00e0. But the UNIT gate compares the
 * whole register file (A, F, BC, DE, HL, SP, …), so every value/flag operation is
 * kept VERBATIM (bit / and / cp / sub / ex de,hl / add / daa / the HL/DE pointer
 * walk / inc (hl)) and every callee is reached via m.call to the same oracle — so
 * the final registers on each of the six exits match by construction, not by
 * re-derivation. The idiomatic win here is names + structured branches + the
 * collapse below; there is almost no dead register churn to drop (the HL/DE
 * arithmetic all reaches a compared final value).
 *
 * ATOMIC — but only PARTIALLY collapsed, and here is the subtlety. sub_017b's one
 * call path is perFrame, which runs INSIDE the vblank NMI with the NMI mask
 * cleared (the handler's first act, 0x7D84<-0), so the NMI cannot re-enter and
 * land inside sub_017b OR either callee: it is atomic on its only path. So for the
 * RAM+reg diff the internal cycle DISTRIBUTION is free, and each executed branch's
 * per-instruction charges collapse to lumps (branch totals: no-coin 61t, ret-z
 * 63t, and the accepted arms build from 98t/115t prologues). BUT sub_017b reaches
 * a HARDWARE-writing callee: sub_011c writes the ls259.6h latches (0x7D00-07 @+4t,
 * 0x7D80/0x7C00 @+10t), each recorded in the emit.js --writes trace at its
 * write-bus cycle = clock()+busOffset. The RAM gate cannot see that trace, and a
 * FULL collapse across the `call 0x011c` would move sub_011c's entry cycle and
 * shift every one of those writes. So the collapse is chunked at each m.call: the
 * lump BEFORE `m.call(0x011c)` charges the oracle's exact cumulative 115t so
 * sub_011c enters at the identical cycle (its writes then trace identically); the
 * same discipline preserves sub_309f's entry cycle (work-RAM only, but the total
 * is load-bearing anyway -- as NMI cost it sets the main-loop spin count, README
 * §2, so a wrong total diverges the whole-machine trace). The entry `ld a,(7D00)`
 * read stays FIRST (cycle 0), so its watchdog kick lands where the oracle's does.
 * A WRITE-TRACE test pins sub_011c's writes to the oracle's cycles (a flat-collapse
 * variant is caught); the whole-machine + per-branch cycle-total gates pin the rest.
 */
export function sub_017b(m) {
  const { regs, mem } = m;

  // ld a,(IN2) -- 2nd watchdog kick this vblank; bit 7 = COIN1. Read FIRST so the
  // kick lands at cycle 0, exactly as the oracle (which reads then charges 13t).
  regs.a = mem.read8(IN2);
  const coinPresent = regs.bit(7, regs.a); // sets Z = !bit7 (jp nz below)
  regs.hl = COIN_EDGE; // 0x6003

  if (!coinPresent) {
    // [0x0186-0x0188] No coin: (re)arm the edge latch and return.
    mem.write8(COIN_EDGE, 0x01);
    m.step(0x0188, 51); // 13 + 8 + 10 (prologue) + 10 (jp nz nt) + 10 (ld (hl),1)
    m.ret(); // ret -- branch total 61t
    return;
  }

  // [0x0189-0x018b] Coin present: was this pulse already counted?
  regs.a = mem.read8(regs.hl); // A = edge latch
  regs.and(regs.a); // Z set iff latch == 0
  if (regs.fZ) {
    // Latch already cleared on an earlier frame -- do nothing.
    m.step(0x018b, 52); // 31 (prologue) + 10 (jp nz taken) + 7 (ld a,(hl)) + 4 (and a)
    m.ret(11); // ret z -- branch total 63t
    return;
  }

  // -- coin accepted (0x018C-0x01B9) --
  m.push16(regs.hl); // push hl -- save 0x6003 on the stack (popped at loc_019d)

  regs.a = mem.read8(GAME_STATE); // 0x6005
  regs.cp(0x03);
  if (regs.fZ) {
    // [jp z,0x019d] In-game (state 3): skip the coin sound.
    m.step(0x019d, 98); // prologue -> 0x019d via jp z taken (no sub_011c on this arm)
  } else {
    // [0x0195-0x019a] Attract/credited: blip the coin sound.
    m.push16(0x0198); // call return address
    // 115t = the oracle's exact cumulative through the CALL, so sub_011c enters
    // at the identical cycle and its hardware-latch writes keep their bus cycle.
    m.step(0x011c, 115);
    m.call(0x011c); // silence/reset the sound hardware [HW writes inside]
    regs.a = 0x03;
    mem.write8(SND_TRIGGER + 3, regs.a); // 0x6083 = 3
    m.step(0x019d, 20); // ld a,03 (7) + ld (6083),a (13)
  }

  // -- loc_019d: clear latch, count the pulse, maybe roll a credit --
  regs.hl = m.pop16(); // HL = 0x6003
  mem.write8(regs.hl, 0x00); // clear the edge latch
  regs.hl = (regs.hl - 1) & 0xffff; // -> 0x6002 COINS_PARTIAL
  regs.incMem8(mem, regs.hl); // inc (0x6002) -- count this coin pulse
  regs.de = DIP_COINS_PER_CREDIT; // 0x6024
  regs.a = mem.read8(regs.de);
  regs.sub(mem.read8(regs.hl)); // A = coins-per-credit - pulses
  m.step(0x01a7, 61); // loc_019d span: 10+10+6+11+10+7+7
  if (regs.fNZ) {
    // Not enough coin pulses for a credit yet.
    m.ret(11); // ret nz
    return;
  }

  mem.write8(regs.hl, regs.a); // (0x6002) = 0 -- reset the pulse counter (A==0)
  regs.de = (regs.de + 1) & 0xffff; // -> 0x6025 DIP_CREDITS_PER_COIN
  regs.hl = (regs.hl - 1) & 0xffff; // -> 0x6001 CREDITS
  regs.exDeHl(); // HL = 0x6025, DE = 0x6001
  regs.a = mem.read8(regs.de); // A = credit count
  regs.cp(0x90);
  m.step(0x01af, 42); // 5 (ret nz nt) + 7 + 6 + 6 + 4 + 7 + 7
  if (regs.fNC) {
    // Credits already at the 0x90 cap.
    m.ret(11); // ret nc
    return;
  }

  regs.add(mem.read8(regs.hl)); // + DIP_CREDITS_PER_COIN
  regs.daa(); // BCD adjust
  mem.write8(regs.de, regs.a); // (0x6001) = new BCD credit count
  regs.de = 0x0400; // task opcode 4, arg 0
  m.push16(0x01b9); // call return address
  m.step(0x309f, 50); // 5 (ret nc nt) + 7 + 4 + 7 + 10 + 17 (call)
  m.call(0x309f); // enqueue the task (work-RAM only)
  m.ret();
}
