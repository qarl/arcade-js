// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0a53 — hand-optimized rewrite of the translated routine at ROM 0x0A53,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. It calls nothing, so there is no `m.call` here; the only
 * import would be RAM names, and it needs none (see the block comment on why the
 * three targets stay hex). Behaviour is byte-identical to ../translated/state0.js.
 */

/**
 * sub_0a53 -- seed three fixed cutscene/marker tiles into video RAM. [ROM
 * 0x0A53-0x0A62]
 *
 *   0a53  3e 01        ld   a,0x01
 *   0a55  32 40 77     ld   (0x7740),a   ; tile 0x01
 *   0a58  3e 25        ld   a,0x25
 *   0a5a  32 20 77     ld   (0x7720),a   ; tile 0x25
 *   0a5d  3e 20        ld   a,0x20
 *   0a5f  32 00 77     ld   (0x7700),a   ; tile 0x20
 *   0a62  c9           ret
 *
 * WHAT IT DOES. Straight-line, no data-dependent branch: it stamps three fixed
 * tile codes into three video-RAM cells exactly one tilemap row (0x20 bytes)
 * apart — 0x7740<-0x01, 0x7720<-0x25, 0x7700<-0x20 — the same three cells
 * sub_0315 maintains. Called from the two setup handlers that build the top-of-
 * screen furniture: handler_01c3 (game state 0, power-on init, ROM 0x01F1) and
 * handler_0779 (game state 1 sub-state 0, ROM 0x0798).
 *
 * INPUTS: none (every value is an immediate). OUTPUTS: the three video-RAM cells
 * above, written in that order; register A left = 0x20 (the last `ld a`); flags
 * untouched. The three addresses are HELD HEX on purpose: 0x7700-0x77FF is video
 * RAM, not work RAM, so they are outside ram.js's map — naming them would be an
 * unevidenced claim (README §4). They are NOT hardware latches (no 0x7Dxx bus
 * latch, no busOffset on the stores), so — like loc_0a8a's video-RAM epilogue —
 * they carry no --writes trace position and need no write-trace gate.
 *
 * FLAGS: sub_0a53 executes no flag-affecting instruction (`ld a,imm`,
 * `ld (nn),a`, `ret` all leave F untouched), so F passes through from the caller
 * unchanged — identical to the oracle. Nothing downstream consumes a flag it
 * sets (its callers make no `ret cc` off it), but the unit gate compares the
 * whole register file, so leaving F verbatim is what keeps that comparison EQUAL.
 * A must end 0x20 for the same reason; the last store's value carries it there.
 *
 * ATOMIC — cycles collapsed, TOTAL preserved (the one path = 70t: 4 stores/loads
 * of 7+13+7+13+7+13 = 60t, plus the ret's 10t). ATOMICITY IS PER-CALL-PATH and
 * every path qualifies: `m.call(0x0a53)` has exactly two call sites, handler_01c3
 * and handler_0779, and BOTH run inside the vblank NMI's rst-0x28 game-state
 * dispatch (ROM 0x00CA, reached via entry_0066 -> sub_0028). The NMI handler's
 * first act clears the NMI mask (0x7D84) and the machine takes no NMI while it is
 * clear, so the vblank NMI structurally cannot land inside sub_0a53 on either
 * path — there is no interruptible or main-loop caller. Its internal cycle
 * DISTRIBUTION is therefore unobservable and the six per-instruction charges
 * collapse to one 60t m.step. The TOTAL stays load-bearing (as part of the NMI's
 * cost it sets the main-loop spin count, README §2 SPIN_COUNT) so it is preserved
 * exactly; a wrong total would diverge at 0x6019 — and the whole-machine gate,
 * which dispatches this routine on BOTH its paths (frames 5 and 6), confirms it.
 */
export function sub_0a53(m) {
  const { regs, mem } = m;

  // ld a,0x01 / ld (0x7740),a
  regs.a = 0x01;
  mem.write8(0x7740, regs.a);
  // ld a,0x25 / ld (0x7720),a
  regs.a = 0x25;
  mem.write8(0x7720, regs.a);
  // ld a,0x20 / ld (0x7700),a  -- leaves A = 0x20, the oracle's final A
  regs.a = 0x20;
  mem.write8(0x7700, regs.a);

  // Atomic (see block comment): the six instructions' 60t collapse to one charge;
  // pc -> 0x0a62 (the ret). No flag op ran, so F is already the oracle's.
  m.step(0x0a62, 60);
  m.ret(); // ret (0x0A62) -- 10t; path total 70t
}
