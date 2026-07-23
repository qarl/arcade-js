// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_2901 — hand-checked idiomatic rewrite of the translated routine at ROM
 * 0x2901, proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Its one callee (0x2913, entry_2913) is reached through
 * `m.call`, the routine registry (games/dkong/routines.js), so it resolves to the
 * oracle or to a future optimized rewrite. Nothing is imported: 0x63B9 has no
 * evidenced name in ram.js, so it stays hex.
 *
 * ── WHAT IT DOES ──────────────────────────────────────────────────────────────
 * sub_2901 — ROM 0x2901-0x2912. A one-group wrapper around entry_2913's object-
 * list search (the twin of sub_28b0's three-group and sub_28e0's two-group forms;
 * this one runs a SINGLE sweep: count B=7, stride DE=0x0020, base IX=0x6400).
 *
 *   2901  e1           pop  hl            ; recover the dispatcher's pushed HL
 *   2902  06 07        ld   b,0x07        ; record count (djnz limit)
 *   2904  78           ld   a,b
 *   2905  32 b9 63     ld   (0x63b9),a    ; 0x63B9 = entry_2913's shared count byte
 *   2908  11 20 00     ld   de,0x0020     ; record stride
 *   290b  dd 21 00 64  ld   ix,0x6400     ; record base
 *   290f  cd 13 29     call 0x2913        ; the object-list search
 *   2912  c9           ret
 *
 * The leading `pop hl` recovers the HL that entry_3e88 pushed BEFORE its rst 0x28
 * dispatch (sub_0028's own `pop hl` clobbers HL with the table base, so the caller
 * stashes the real HL beneath it); that HL is entry_2913's axis-2 search bound
 * (H/L live-in). The middle five instructions set up the one sweep and mirror the
 * count through A into 0x63B9. `call 0x2913` then searches up to 7 records.
 *
 * INPUTS  — stack top (the pushed HL, popped into HL); C, IY, and the object
 *           records at 0x6400 (all live-in to entry_2913).
 * OUTPUTS — RAM 0x63B9 = 0x07 (the sweep count); registers A/F/HL/DE/IX/SP and PC
 *           are whatever entry_2913 leaves (see the two exits below).
 *
 * TWO EXITS (both observed EQUAL, see the test):
 *   • NORMAL  — entry_2913 exhausts the list (no active record in range) and rets
 *     A=0; sub_2901 then rets to its caller. Return value true.
 *   • HIT     — entry_2913 finds a match: it sets A=1, DISCARDS sub_2901's return
 *     address (0x2912) via `inc sp / inc sp`, and rets straight to sub_2901's
 *     CALLER (the "skip a frame" idiom). `m.call(0x2913)` returns false, so
 *     sub_2901 returns true WITHOUT its own `ret` — executing it would double-
 *     return. Both exits leave PC/SP identical (HIT's discard + single ret equals
 *     NORMAL's two rets); they differ observably in A (0 vs 1) and cycle total
 *     (529 vs 276 t on the captured entry). Return value true either way.
 *
 * ── DECISIONS ─────────────────────────────────────────────────────────────────
 * FLAGS. sub_2901's own body sets NO flags (pop and the five loads leave F
 * untouched); the final F/A the caller sees are entry_2913's, reached identically
 * through `m.call`. So nothing flag-related is elided or reconstructed here —
 * the register file matches the oracle by delegating.
 *
 * REGISTER CHURN kept, not dropped. `ld a,b` (A=B=0x07) then `ld (0x63b9),a` is
 * left verbatim rather than writing 0x07 straight to 0x63B9: keeping A=0x07 at the
 * store boundary makes every instruction boundary observably identical to the
 * oracle, which the per-instruction timing (below) promises. A is dead afterward
 * (entry_2913 reloads it from C), but the faithful boundary is worth one `ld`.
 *
 * CYCLES — kept PER-INSTRUCTION (NOT collapsed). sub_2901 is an entry_3e88 rst-
 * 0x28 dispatch target that is NOT wired into any executed dispatcher: entry_3e88
 * is called only from 0x286B (untranslated, < 0x3000), so sub_2901 NEVER runs on
 * the live NMI / substate / sub_30fa paths (grep-confirmed in the oracle header;
 * probe-confirmed: 0 dispatches over 2500 attract + 2000 coin+start frames, while
 * its live twin sub_2880 fires ~2017x and entry_2913 ~6044x). Because it never
 * runs in a real frame, a cycle-COLLAPSE (one m.step total per branch) cannot be
 * harness-VERIFIED by a whole-machine run — the rule (README §2) permits a collapse
 * only once the harness proves it EQUAL, which is impossible for an unreached
 * routine. So the charges stay per-instruction: byte-identical to the oracle's
 * distribution, no unverifiable timing claim. The per-branch TOTAL (529 / 276 t)
 * is asserted equal to the oracle's in the test regardless. If handler_1977 ever
 * lands and this chain goes live, revisit the collapse WITH the harness then.
 */
export function sub_2901(m) {
  const { regs, mem } = m;

  // pop hl -- recover entry_3e88's pushed HL (entry_2913's axis-2 search bound).
  regs.hl = m.pop16();
  m.step(0x2902, 10);

  // Configure ONE entry_2913 sweep: 7 records, stride 0x20, base 0x6400. The
  // count is mirrored B -> A -> 0x63B9 (entry_2913's shared count byte).
  regs.b = 0x07; // ld b,0x07 -- record count / djnz limit
  m.step(0x2904, 7);
  regs.a = regs.b; // ld a,b
  m.step(0x2905, 4);
  mem.write8(0x63b9, regs.a); // ld (0x63b9),a
  m.step(0x2908, 13);
  regs.de = 0x0020; // ld de,0x0020 -- record stride
  m.step(0x290b, 10);
  regs.ix = 0x6400; // ld ix,0x6400 -- record base
  m.step(0x290f, 14);

  // call 0x2913 -- the object-list search. false = HIT (entry_2913 already
  // discarded our return address and returned to sub_2901's caller); true =
  // list exhausted normally.
  m.push16(0x2912);
  m.step(0x2913, 17);
  if (!m.call(0x2913)) return true; // HIT: entry_2913 unwound past us -> do NOT ret again.

  m.ret(); // ret (0x2912) -- normal exit: return to caller.
  return true;
}
