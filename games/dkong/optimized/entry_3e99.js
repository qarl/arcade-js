// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_3e99 — hand-optimized rewrite of the translated routine at ROM 0x3E99,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its only callee (0x3EC3, entry_3ec3) is reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so it resolves to the
 * oracle or to a future optimized rewrite — never a copy. Nothing is imported:
 * the only address it touches, 0x6060, is un-evidenced scratch (ram.js lists it
 * under "Board/animation scratch", left hex on purpose), so it stays hex here.
 *
 * ── WHAT IT DOES ──────────────────────────────────────────────────────────────
 * entry_3e99 — ROM 0x3E99-0x3EC2 (42 bytes, 20 instructions). A collision-severity
 * scorer: it clears the overlap counter 0x6060, runs entry_3ec3's object-overlap
 * sweep over TWO record groups (10 objects at 0x6700, then 5 at 0x6400, both stride
 * 0x0020) which accumulate their overlap count into 0x6060, then maps that count to
 * a severity CODE in A and returns it.
 *
 *   3e99  e1           pop  hl            ; recover entry_3e88's pushed HL
 *   3e9a  af           xor  a
 *   3e9b  32 60 60     ld   (0x6060),a    ; clear the overlap counter
 *   3e9e  06 0a        ld   b,0x0a        ; group 1: 10 objects
 *   3ea0  11 20 00     ld   de,0x0020     ; stride
 *   3ea3  dd 21 00 67  ld   ix,0x6700     ; group 1 base
 *   3ea7  cd c3 3e     call 0x3ec3        ; sweep group 1 -> 0x6060 += overlaps
 *   3eaa  06 05        ld   b,0x05        ; group 2: 5 objects
 *   3eac  dd 21 00 64  ld   ix,0x6400     ; group 2 base (DE stride still 0x0020)
 *   3eb0  cd c3 3e     call 0x3ec3        ; sweep group 2 -> 0x6060 += overlaps
 *   3eb3  3a 60 60     ld   a,(0x6060)    ; A = total overlap count
 *   3eb6  a7           and  a
 *   3eb7  c8           ret  z             ; count 0 -> code 0
 *   3eb8  fe 01        cp   0x01
 *   3eba  c8           ret  z             ; count 1 -> code 1
 *   3ebb  fe 03        cp   0x03
 *   3ebd  3e 03        ld   a,0x03
 *   3ebf  d8           ret  c             ; count 2 (< 3) -> code 3
 *   3ec0  3e 07        ld   a,0x07
 *   3ec2  c9           ret                ; count >= 3 -> code 7
 *
 * The count -> code map is 0/1/2/>=3 -> 0/1/3/7. The `cp 0x03 / ld a,0x03 / ret c`
 * idiom reads the carry from `cp 0x03` ACROSS the flag-neutral `ld a,0x03`: the
 * value 0x03 is loaded BEFORE the branch that decides whether to return it, so a
 * count of exactly 2 (carry set) returns code 3 and any count >= 3 (carry clear)
 * falls through to code 7.
 *
 * The leading `pop hl` is NOT decorative: entry_3e99 is reached through entry_3e88's
 * rst-0x28 dispatch, and sub_0028's own `pop hl` clobbers HL with the table base,
 * so entry_3e88 stashed the real HL beneath the dispatch. `pop hl` recovers it
 * (a live-in that the dispatch mechanism destroyed) — modelled `regs.hl = m.pop16()`.
 *
 * REACHED LIVE. entry_3e99 IS on an executed path today: entry_1ac3 (movement) calls
 * entry_2853 @0x1C20, which calls entry_3e88 @0x286B, whose rst-0x28 table (base
 * 0x3E8D, index = 0x6227/BOARD) selects entry_3e99 for board 1 (25m). Over 1500
 * attract frames it dispatches 4x (frames ~606/1136/1250/1470), naturally reaching
 * BOTH the count-0 -> code-0 arm (3x) and the count-1 -> code-1 arm (once, frame
 * 1136). (The oracle header's "not yet wired into the live dispatcher" note predates
 * that chain going live and is stale — corrected here, not in the frozen oracle.)
 *
 * INPUTS  — stack top (the pushed HL, popped into HL); C, IY, H, L and the object
 *           records at 0x6700 / 0x6400 (all live-in to entry_3ec3, which reads C
 *           and (iy+3) as the two axis references and H/L as the axis thresholds).
 * OUTPUTS — RAM 0x6060 (cleared, then accumulated by entry_3ec3); register A = the
 *           severity code (0/1/3/7); B/DE/IX/F are whatever the routine leaves at
 *           its exit (see FLAGS). PC/SP: an ordinary single `ret` at every exit.
 *
 * NOT skip-capable. Unlike sub_2901 (whose entry_2913 can unwind past it), all four
 * of entry_3e99's exits are ordinary `ret` — it returns void and hands its result
 * to the caller in register A, so there is no boolean to propagate.
 *
 * ── DECISIONS ─────────────────────────────────────────────────────────────────
 * FLAGS — preserved verbatim. The caller consumes the return CODE in A, but the
 * unit gate also compares F, so the three flag-setters that decide the exit
 * (`and a`, `cp 0x01`, `cp 0x03`) are kept exactly, and the observable F at each
 * exit equals the oracle's: count 0 -> `and a` (Z set, C clear); count 1 -> `cp 0x01`
 * (Z set, C clear); count 2 -> `cp 0x03` with the ORIGINAL A=2 (C set, Z clear),
 * surviving the flag-neutral `ld a,0x03`; count >= 3 -> `cp 0x03` (C clear). The
 * `xor a` at the head is kept for its VALUE too (A=0 written to clear 0x6060).
 *
 * CYCLES — COLLAPSED, each executed path's TOTAL preserved (rung 5). entry_3e99 is
 * ATOMIC because it runs on the NMI-dispatch path (loc_197a -> entry_1ac3 -> entry_2853
 * -> entry_3e88 -> here), where the handler has cleared the NMI mask on entry, so the
 * vblank NMI cannot fire inside it. (Its only callee, entry_3ec3, is a bounded djnz
 * loop that calls nothing, so there is no deeper interruptible routine either — but the
 * mask, not the call depth, is what makes it atomic.) So its internal cycle DISTRIBUTION
 * is unobservable and
 * the 18 per-instruction m.step charges collapse to one per straight-line segment:
 * the two `call 0x3ec3` boundaries are mandatory (each executes the callee mid-body),
 * so the collapse is segmented around them — prologue+call1 = 75t, mid-setup+call2 =
 * 38t, then one per-branch epilogue total (count 0 = 28, 1 = 40, 2 = 59, >= 3 = 70).
 * The TOTAL stays load-bearing, though — as part of the frame's work it sets the
 * main-loop spin count (README §2, SPIN_COUNT). Harness-proven on all three points,
 * over the live 1500-frame attract window that dispatches it 4x:
 *   • per-instruction  -> EQUAL
 *   • this collapse    -> EQUAL           (distribution is free: atomic)
 *   • strip ALL cycles -> DIVERGES @ 0x6019 (SPIN_COUNT), frame 606, 250 vs 251
 * The identical spin-count divergence handler_05c6 / entry_0611 showed — the total
 * is observable, the distribution is not.
 *
 * NO HARDWARE WRITES — entry_3e99 (and entry_3ec3) touch only work RAM (0x6060), no
 * 0x7Dxx latch, so there is no bus-cycle-positioned write to protect: the segment
 * collapse crosses nothing traced, and no write-trace test is needed.
 */
export function entry_3e99(m) {
  const { regs, mem } = m;

  // pop hl -- recover entry_3e88's pushed HL (sub_0028's dispatch clobbered it).
  regs.hl = m.pop16();

  // xor a / ld (0x6060),a -- clear the overlap counter the two sweeps accumulate into.
  regs.xor(regs.a); // A = 0
  mem.write8(0x6060, regs.a);

  // Group 1: sweep 10 objects at 0x6700, stride 0x0020; entry_3ec3 adds each in-range
  // overlap to 0x6060. Segment total 75t (pop 10 + xor 4 + store 13 + ld b 7 + ld de
  // 10 + ld ix 14 + call 17), charged once — atomic, so the distribution is free.
  regs.b = 0x0a;
  regs.de = 0x0020;
  regs.ix = 0x6700;
  m.push16(0x3eaa);
  m.step(0x3ec3, 75);
  m.call(0x3ec3);

  // Group 2: sweep 5 objects at 0x6400 (DE stride unchanged); accumulates into the
  // SAME 0x6060. Segment total 38t (ld b 7 + ld ix 14 + call 17).
  regs.b = 0x05;
  regs.ix = 0x6400;
  m.push16(0x3eb3);
  m.step(0x3ec3, 38);
  m.call(0x3ec3);

  // Map the total overlap count in 0x6060 to a severity code in A: 0/1/2/>=3 -> 0/1/3/7.
  // Each branch's epilogue total is charged in its single `ret` (only one pop per arm).
  regs.a = mem.read8(0x6060);
  regs.and(regs.a); // and a -- test for count 0
  if (regs.fZ) {
    m.ret(28); // ret z -- count 0 -> code 0.  (ld a 13 + and 4 + ret 11)
    return;
  }

  regs.cp(0x01);
  if (regs.fZ) {
    m.ret(40); // ret z -- count 1 -> code 1.  (+ ret-z-nt 5 + cp 7 + ret 11)
    return;
  }

  // cp 0x03 sets carry when count < 3; ld a,0x03 is flag-neutral so that carry
  // survives to the ret c.
  regs.cp(0x03);
  regs.a = 0x03;
  if (regs.fC) {
    m.ret(59); // ret c -- count 2 (< 3) -> code 3.  (+ ret-z-nt 5 + cp 7 + ld a 7 + ret 11)
    return;
  }

  regs.a = 0x07;
  m.ret(70); // ret (0x3EC2) -- count >= 3 -> code 7.  (+ ret-c-nt 5 + ld a 7 + ret 10)
}
