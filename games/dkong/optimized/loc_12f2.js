// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_12f2 — hand-optimized rewrite of the translated routine at ROM 0x12F2,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its callees (0x011C, 0x13CA, 0x1826, 0x309F) are reached
 * through `m.call`, the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to a future optimized rewrite — never a copy. Only
 * the RAM names are imported (from ram.js); 0x600F stays hex because ram.js
 * deliberately leaves it unnamed (no re-derived meaning), and 0x76D4 is video RAM.
 */

import { PLAY_INTRO, LIVES, P1_CONTEXT, GAME_SUBSTATE, SUBSTATE_TIMER, P1_SCORE } from "./ram.js";

/**
 * loc_12f2 -- life-loss / player-context-save sub-state: decrement lives, save
 * the live P1 context, then branch on lives-remaining (continue vs game over).
 * [ROM 0x12F2-0x1343; entry 14 (0x0E) of loc_06fe's 0x0702 rst-0x28 table,
 * dispatched by dispatchGameState while GAME_STATE(0x6005)==3 and
 * GAME_SUBSTATE(0x600A)==0x0E. Twin: loc_1344 (idx15, different constants).]
 *
 *   12f2  cd 1c 01     call 0x011c        ; silence the sound hardware
 *   12f5  af           xor  a
 *   12f6  32 2c 60     ld   (0x622c),a    ; PLAY_INTRO := 0 (skip the intro next board)
 *   12f9  21 28 62     ld   hl,0x6228     ; HL = LIVES
 *   12fc  35           dec  (hl)          ; one life lost
 *   12fd  7e           ld   a,(hl)        ; A = lives remaining (the branch counter)
 *   12fe  11 40 60     ld   de,0x6040     ; DE = P1_CONTEXT
 *   1301  01 08 00     ld   bc,0x0008
 *   1304  ed b0        ldir               ; save the 8-byte live context 0x6228..0x622F -> 0x6040
 *   1306  a7           and  a             ; test lives remaining
 *   1307  c2 34 13     jp   nz,0x1334     ; lives remain -> continue arm
 *   ...  (Z: game over)                   ; no lives left -> game-over arm
 *
 * WHAT IT DOES. Runs inside the vblank NMI on the life-loss sub-state. It calls
 * sub_011c (ROM 0x011C, "silence the sound hardware"), clears PLAY_INTRO(0x622C)
 * so the opening cutscene is skipped, `dec (LIVES)` to spend a life, and `ldir`s
 * the whole live 8-byte P1 context (0x6228..0x622F) down to the P1_CONTEXT save
 * block (0x6040). The post-decrement lives count is the branch counter:
 *
 *   - lives remain (counter != 0, loc_1334): arm the next sub-state to 0x08 when
 *     the 0x600F mode byte is zero (a 1-player game -> the "how-high" interlude),
 *     else 0x17 (a 2-player context). Store into GAME_SUBSTATE(0x600A). No calls.
 *
 *   - no lives left (counter == 0, the GAME-OVER arm): call sub_13ca (ROM 0x13CA,
 *     BCD unpack + fill + score sort; HL=P1_SCORE(0x60B2), A=0x01), point HL at the
 *     game-over VRAM region (0x76D4), and when 0x600F is non-zero enqueue task
 *     0x0302 (sub_309f) and step HL to 0x76D3; then sub_1826 (ROM 0x1826, descending
 *     VRAM fill) draws the region, enqueue task 0x0300 (sub_309f), arm
 *     SUBSTATE_TIMER(0x6009):=0xC0 and set GAME_SUBSTATE(0x600A):=0x10 (the phase
 *     loc_138f services after the countdown).
 *
 * INPUTS  (RAM read):  LIVES (0x6228, dec'd then read as the counter), the 8-byte
 *   0x6228..0x622F context (ldir source), 0x600F (mode/arm selector, read twice).
 * OUTPUTS (RAM write): PLAY_INTRO(0x622C):=0; LIVES(0x6228) dec'd; P1_CONTEXT
 *   (0x6040..0x6047, the ldir save); GAME_SUBSTATE(0x600A):=0x08/0x17/0x10; on the
 *   game-over arm also SUBSTATE_TIMER(0x6009):=0xC0, the task ring (via sub_309f),
 *   VRAM (via sub_1826), and the score/scratch region (via sub_13ca). Every
 *   0x7Dxx hardware write in the routine's reach belongs to a CALLEE (sub_011c's
 *   sound latches) — loc_12f2 itself writes only work + video RAM, so it has NO
 *   bus-cycle-positioned hardware write to preserve and needs no --writes trace
 *   test (contrast optimized/loc_0a8a.js).
 *
 * FLAGS. loc_12f2 ends in a plain `ret` (no `ret cc`), so no flag is a return
 *   value; the unit gate still compares the WHOLE register file incl. F, so the
 *   finish state must match. On the CONTINUE arm the final F is set by `and a`
 *   (0x133A) on the 0x600F byte — the later `ld a,c` / `ld (0x600a),a` set none —
 *   so `regs.and(regs.a)` is kept as BOTH the branch test and the source of the
 *   final F; A ends = C = 0x08 or 0x17. On the GAME-OVER arm the final F is left by
 *   the last callee (sub_309f @0x1328) and the flag-neutral tail (ld/inc/ld) does
 *   not touch it — so it matches the oracle for free. The `xor a` (A=0 for the
 *   PLAY_INTRO store) and the counter `and a` (0x1306) are kept verbatim; the
 *   `dec (hl)` is a real Z-correct decrement so the counter test sees the right
 *   value.
 *
 * ATOMIC — cycles collapsed to one m.step per straight-line segment, TOTAL
 *   preserved per branch. loc_12f2 runs INSIDE the vblank NMI (dispatchGameState),
 *   which is non-reentrant (the NMI mask is the guard) and, with NMI_CYCLE_IN_FRAME
 *   a full frame from the next boundary, never captures a mid-routine state dump.
 *   So the NMI never lands inside loc_12f2 OR its callees, its internal cycle
 *   DISTRIBUTION is unobservable, and the per-instruction m.step charges between
 *   the call/ldir boundaries collapse to one charge per segment — prologue 65t,
 *   continue arm folded onto the ret (75t at 0x600F==0, 82t at 0x600F!=0), plus the
 *   game-over segments (Z1 31t, Z2-taken 39t, Z2-not-taken 44t+dec 6t, Z4 10t, Z5
 *   folded onto the ret 46t). Each equals the oracle's per-instruction sum for that
 *   run. Each call keeps its own push16/step(17)/call scaffolding (the calling
 *   convention, README §2) and the ldir stays m.ldir (its own 163t). The TOTAL is
 *   still load-bearing — as part of the NMI's cost it sets the main-loop spin count
 *   that seeds the PRNG (README §2, SPIN_COUNT) — so each branch's sum is preserved
 *   exactly; whole-machine EQUAL confirms it, and the synthesised per-branch
 *   cycle-total teeth confirm every arm the driven run does not reach. (Same
 *   collapse decision as loc_1615 / loc_138f on this identical NMI dispatch path.)
 */
export function loc_12f2(m) {
  const { regs, mem } = m;

  // call 0x011c -- silence the sound hardware. Keep the calling-convention
  // scaffolding (push the return address 0x12f5, charge the CALL's 17t).
  m.push16(0x12f5);
  m.step(0x011c, 17);
  m.call(0x011c);

  // ---- prologue: clear PLAY_INTRO, spend a life, save the live P1 context ----
  regs.xor(regs.a); // A = 0
  mem.write8(PLAY_INTRO, regs.a); // 0x622C := 0
  regs.hl = LIVES; // 0x6228
  regs.decMem8(mem, regs.hl); // dec (LIVES) -- Z-correct
  regs.a = mem.read8(regs.hl); // A = lives remaining (the branch counter)
  regs.de = P1_CONTEXT; // 0x6040
  regs.bc = 0x0008;
  // xor a(4)+ld(622c)(13)+ld hl(10)+dec(hl)(11)+ld a,(hl)(7)+ld de(10)+ld bc(10) = 65
  m.step(0x1304, 65);
  m.ldir(0x1306); // save 0x6228..0x622F -> 0x6040 (8 bytes; own 163t)

  regs.and(regs.a); // test lives remaining -- sets the jp nz flag

  if (regs.fNZ) {
    // ---- continue arm (loc_1334): lives remain, arm the next sub-state ----
    regs.c = 0x08; // ld c,0x08 -- default (1-player how-high)
    regs.a = mem.read8(0x600f); // A = mode byte (unnamed in ram.js)
    regs.and(regs.a); // test 0x600F -- sets the routine's FINAL F, leaves A
    const mode2p = regs.fNZ; // 0x600F != 0 -> the 0x17 (2-player) arm
    if (mode2p) regs.c = 0x17;
    regs.a = regs.c; // ld a,c -- A = 0x08 or 0x17
    mem.write8(GAME_SUBSTATE, regs.a); // 0x600A := 0x08 / 0x17

    // Collapsed total incl. the ret (atomic; see header): and a(4)+jp nz(10)
    //   +ld c(7)+ld a(13)+and a(4)+jp z(10)[+ld c,0x17(7) when 2p]+ld a,c(4)
    //   +ld(600a)(13)+ret(10) = 75 (0x600F==0) / 82 (0x600F!=0).
    m.ret(mode2p ? 82 : 75);
    return;
  }

  // ---- game-over arm: no lives left ----
  // Z1: and a(4)+jp nz not taken(10)+ld a,0x01(7)+ld hl,0x60b2(10) = 31.
  regs.a = 0x01;
  regs.hl = P1_SCORE; // 0x60b2
  m.step(0x130f, 31);
  m.push16(0x1312);
  m.step(0x13ca, 17);
  m.call(0x13ca); // BCD unpack + fill + score sort (HL=P1_SCORE, A=0x01)

  regs.hl = 0x76d4; // game-over VRAM region
  regs.a = mem.read8(0x600f); // mode byte again
  regs.and(regs.a); // test 0x600F for the jr z below

  if (regs.fZ) {
    // 0x600F == 0: skip the extra enqueue; HL stays 0x76D4.
    // ld hl(10)+ld a(13)+and a(4)+jr z taken(12) = 39.
    m.step(0x1322, 39);
  } else {
    // 0x600F != 0: enqueue task 0x0302, then dec HL to 0x76D3.
    regs.de = 0x0302;
    // ld hl(10)+ld a(13)+and a(4)+jr z not taken(7)+ld de(10) = 44.
    m.step(0x131e, 44);
    m.push16(0x1321);
    m.step(0x309f, 17);
    m.call(0x309f);
    regs.hl = (regs.hl - 1) & 0xffff; // dec hl -- HL = 0x76D3
    m.step(0x1322, 6);
  }

  m.push16(0x1325);
  m.step(0x1826, 17);
  m.call(0x1826); // descending VRAM fill (HL live-in = 0x76D4 or 0x76D3)

  regs.de = 0x0300;
  m.step(0x1328, 10); // ld de,0x0300
  m.push16(0x132b);
  m.step(0x309f, 17);
  m.call(0x309f); // enqueue task 0x0300

  regs.hl = SUBSTATE_TIMER; // 0x6009
  mem.write8(regs.hl, 0xc0); // arm the 0xC0-frame countdown
  regs.hl = (regs.hl + 1) & 0xffff; // inc hl -> GAME_SUBSTATE (0x600A)
  mem.write8(regs.hl, 0x10); // 0x600A := 0x10 (loc_138f services it after the countdown)

  // Z5 collapsed incl. the ret: ld hl(10)+ld(hl),0xc0(10)+inc hl(6)+ld(hl),0x10(10)+ret(10) = 46.
  m.ret(46);
}
