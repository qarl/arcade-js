# Time Pilot — how it's played (outside-in, day-zero notes)

**Scope & method.** This is a *day-zero* description of how **Time Pilot** (Konami, 1982; distributed in North America by Centuri; MAME romset `timeplt`) is *played*, assembled **only from public sources** — the Centuri operator's manual, the Centuri flyer text, Wikipedia, the Konami Wiki, arcade-history.com, KLOV / Museum of the Game, StrategyWiki, Hardcore Gaming 101 and hobbyist write-ups. It is what you'd write down **before** touching the ROM. Nothing here is derived from the disassembly, the translated layer, the MAME driver, our emulator, or any in-repo note; that earned inside-knowledge is deliberately excluded so this stays a clean "what the public record says" baseline, usable later to adjudicate mechanics the code alone can't disambiguate.

**Bottom line up front: the public record is rich — and one source is primary.** Unlike The Pit, Time Pilot has a surviving, scanned **Centuri operator's manual** online, and it contains a per-round GAME DESCRIPTION, a GAME INSTRUCTIONS page with an illustrated **SCORING** chart, and the full **DIP-switch tables**. That pins down the headline numbers — 56 enemies then 7 mothership hits, 100 / 1,500 / 2,000 / 3,000 point values, the parachutist ladder, the bonus-plane thresholds, and 3/4/5/256 lives — from the manufacturer rather than from fan memory. **⚠ OVERTURNED (code + MAME): the Mother-Ship absorbs seven hits and the eighth destroys it; one that idled and relaunched after two or more hits needs six more (that clause from the code; mechanisms.md §6).** **⚠ OVERTURNED (code + MAME): the fourth lives setting stores 0xFF, i.e. 255 lives (mechanisms.md §2).**

**Two caveats about the rest of the record, both important:**

1. **Most secondary sources are not independent.** Wikipedia, the Konami Wiki, arcade-history.com and KLOV share visibly common phrasing and a common ancestor. Four sites agreeing is often *one* claim quoted four times. Where I say "widely reported," read that as "reported once and copied," not "independently corroborated."
2. **The genuinely first-hand sources (StrategyWiki, play blogs) disagree with the manual and with each other on specifics** — how many hits the 1940 bomber takes, whether it shoots back, whether the 2001 stage has parachutists, and whether the player's ship can flip 180°. Those disagreements are listed inline and again in the final section.

---

## 1. The premise / objective

You are **the Time Pilot** — the pilot of a futuristic fighter jet — **trying to rescue fellow pilots trapped in different time eras.** [Wikipedia; Konami Wiki; arcade-history] You fight your way through **five time periods**, and in each you must shoot down enough enemy aircraft to make that era's **"Mother-Ship"** appear, destroy it, and **escape through the time warp** to the next era. [Centuri operator's manual, "GAME DESCRIPTION"; Centuri flyer]

Centuri's flyer framing: *"If You Have Ever Dreamed Of A Journey Through Time, Now Is Your Chance… You are the time pilot. The barriers of time are at your fingertips. Ease up on the eight way joystick. Move through the blustery clouds while you race against the brilliant sky."* [Centuri flyer text, via the Centuri fan site]

There is no ending. Clearing 2001 sends you back to 1910, harder. [Centuri manual; Wikipedia; KLOV]

## 2. Cabinet & controls

- **One 8-way joystick and one FIRE button.** [Centuri manual: *"The player controls his plane with the 8 way joystick and shoots at the enemies using 'Fire' button"*; KLOV: "Joystick: 8-way, Buttons: 1 – Fire"; arcade-history; Centuri flyer]
- **Vertical (portrait) colour raster monitor**, 19-inch; **upright and cocktail/table** cabinets; **1 player at a time, up to 2 players alternating.** [KLOV; Centuri fan site]
- **What the joystick does:** it does *not* translate the ship around the screen. The **eight-direction joystick causes the jet to rotate to face that direction, and the screen scrolls in that direction to present forward motion.** The jet stays centred. [Wikipedia] The plane is always flying forward at what appears to be a fixed speed; no public source describes a throttle or brake. (The flyer's *"accelerate to Mach 1 … Mach 2"* is marketing copy, not a mechanic.)
- **What FIRE does:** you shoot in the direction the ship is currently facing, and only that direction. [Hardcore Gaming 101] StrategyWiki is more specific: *"Pressing the fire button once launches a burst of three shots in rapid fire. Your plane will not shoot again until the fire button is released and depressed."* — so it is semi-rapid-fire driven by tapping. [StrategyWiki – Gameplay] *(Single source for the 3-shot burst; unverified elsewhere.)*

## 3. The player's ship — what it can and cannot do

- **Free-roaming in all directions.** The airspace *"scrolls indefinitely in all directions"*; there is no ground, no ceiling and no arena wall. [Wikipedia; Konami Wiki]
- **The ship rotates rather than strafes.** You lock into one of **eight facings**, but *"you will pass through many more while turning from one direction to another, allowing your shots to fire at a variety of angles while you transition."* [StrategyWiki – Gameplay] Hardcore Gaming 101 agrees the rotation is smooth and notes the learning curve: *"It takes awhile to get used to, since you turn so slowly."* **⚠ OVERTURNED (code + MAME): the heading is a 256-step byte; release the stick mid-turn and the ship holds any intermediate heading (mechanisms.md §5).**
- **⚠ Conflict — can it about-face?** StrategyWiki says the plane *"can travel in any direction, and turn very quickly, but it can't about face."* arcade-history's tips say the opposite: *"you can turn through 180 degrees very quickly to pick off an enemy directly behind you… you will flip round."* **Unresolved.** This is a first-order control question and needs settling hands-on. **RESOLVED (code + MAME): no flip; a reversal is a 128-step sweep, 44 frames at 3 steps a frame in eras 0–2 and 32 frames at 4 steps a frame in eras 3–4.**
- **The ship is one-hit fragile.** *"Your ship cannot withstand a collision to any enemy or their weapons."* [StrategyWiki – Gameplay]
- **Gravity does not apply to you.** The 1910 bombs fall on a parabola, but *"the player can fly downward indefinitely and never reach the 'ground'. This is the only time when 'gravity' is present."* [Konami Wiki]

## 4. The screen

- **The plane is always in the centre; the background moves the opposite way.** *"The background moves in the opposite direction to the player's plane, rather than the other way around."* [arcade-history, Trivia] So the parallax reads as forward flight, but mechanically it is the world that moves.
- **A progress bar / kill counter sits at the bottom of the screen** (bottom-right per Wikipedia) showing how close you are to triggering the Mother-Ship. [Wikipedia; KLOV; StrategyWiki – Walkthrough: *"There is a scale at the bottom of the screen that lets you know when you've killed enough of the enemy to expect the Mother Ship"*]
  - ⚠ arcade-history once calls this the **"time bar"** (*"you can also shoot the 1,500-point bombers without causing the time bar to be shortened"*). No other source mentions any timer, and the most natural reading is that the bomber simply doesn't advance the kill counter. **Flagged as ambiguous wording, not as evidence of a countdown timer.**
- **Backgrounds change with the era.** Konami Wiki: the first three eras are *"a varying shade of blue sky and clouds"*, 1982 is *"a purple sky"*, and 2001 is *"space and asteroids… a black background."* KLOV states it more coarsely (*"the first four eras… sky with clouds… the fifth era… space with asteroids"*), which is consistent if 1982's purple still counts as sky.
- No public source describes the HUD beyond score and the progress bar (life icons, era banner, high-score line are undocumented).

## 5. The five eras

Time Pilot's signature is that a "level" is a **time period**, and the eras run in strict order. The **Centuri manual calls them ROUND 1 … ROUND 5.** [Centuri manual; Wikipedia; Konami Wiki; arcade-history; KLOV; StrategyWiki all agree on the order.]

| # | Era | Common enemy | Mother-Ship | New threat introduced |
|---|-----|--------------|-------------|------------------------|
| 1 | **A.D. 1910** — The Age of the Biplane | Biplanes | **Blimp** (*"a giant airballoon shooting at you"*) | Bullets + gravity-affected bombs/"hand grenades" |
| 2 | **A.D. 1940** — The Age of the Monoplane | Monoplane fighters | **Large bomber** (identified as a **B-25** by secondary sources) | A third craft: the **middle-size bomber** (1,500 pts) |
| 3 | **A.D. 1970** — The Age of the Helicopter | Helicopters | **Large tandem-rotor helicopter** (identified as **CH-46 Sea Knight**) | **Homing / cruise missiles** |
| 4 | **A.D. 1982** (Konami) / **1983** (Centuri, Atari) — The Age of the Jet Plane | Jet fighters | **Large jet bomber** (identified as a **B-52**) | Enemies as fast and manoeuvrable as you; more missiles; deliberate ramming |
| 5 | **A.D. 2001** — The Age of the U.F.O. | Flying saucers | **"Superfortress U.F.O."** / larger saucer | Two "Alien Weapons": a fast straight shot and a fast bending shot; asteroid camouflage |

*(Era names and Mother-Ship descriptions from the Centuri manual; the specific real-world aircraft identifications — B-25, CH-46, B-52 — are from arcade-history / Konami Wiki / KLOV, i.e. secondary and probably single-origin.)*

**Per-era detail, quoting the manual where possible:**

- **1910.** *"The attackers are biplanes coming from random directions. Enemy plane shoots at your plane and throws hand grenades when close to you. After 56 biplanes are destroyed, the 'Mother-Ship' appears… Only 7 hits will destroy the 'Mother-Ship.' During the same stage, one to five parachutes will appear."* [Centuri manual] The bombs *"are initially fired upward but accelerate downward… following the parabolic trajectory of a thrown object"* — fly up to avoid them. [Konami Wiki; arcade-history; StrategyWiki] **⚠ OVERTURNED (code + MAME): the Mother-Ship absorbs seven hits and the eighth destroys it; one that idled and relaunched after two or more hits needs six more (that clause from the code; mechanisms.md §6).**
- **1940.** *"Enemies are: monoplane fighters, middle size bombers and large bomber ('Mother-Ship')."* [Centuri manual] The monoplanes are *"slimmer than the biplanes and blend in with the background, making them tougher to target"* and are better at tailing you than biplanes were. [Konami Wiki; StrategyWiki]
- **1970.** *"Enemies now are helicopters and large one ('Mother-Ship'). As a new level of difficulty, the helicopters are using homing missiles."* [Centuri manual] The missiles *"travel slightly faster than the player but cannot make sharp turns"*; they can be shot down, or shaken by turning sharply / circling. [arcade-history; Konami Wiki; StrategyWiki]
- **1982/1983.** *"The enemies are modern jet fighters shooting and launching homing missiles… one of the most difficult rounds of the game due to increased speed of jet fighters and random direction attacks."* [Centuri manual] The jets *"resemble the player's own craft"*, match your speed and turn rate, fire more missiles than the helicopters did, and will happily collide with you; StrategyWiki adds *"they will eventually turn around and leave if they can't catch you."* [Konami Wiki; StrategyWiki]
- **2001.** *"Great number of U.F.O.'s are attacking from any direction changing their angles of attack and throwing at your plane two types of 'Alien Weapons.' The stage is fast paced and the 'Mother-Ship', a superfortress U.F.O., can not be so easily destroyed."* [Centuri manual] The saucers fire *"fast-moving circular bullets that blend in with the background"*; **the on-screen asteroids do not hurt you** but camouflage enemies and shots; both weapon types can be shot down. [arcade-history; Konami Wiki; StrategyWiki]

## 6. How you advance: 56 + 7

The manual states it as a rule:

> **"Advance to next stage by destroying 56 enemies and 7 hits on 'Mother Ship.'"** — Centuri operator's manual, GAME INSTRUCTIONS #2 **⚠ OVERTURNED (code + MAME): the Mother-Ship absorbs seven hits and the eighth destroys it; one that idled and relaunched after two or more hits needs six more (that clause from the code; mechanisms.md §6).**

The flyer says the same for 1910: *"Destroy 56 of the nuisances plus 7 direct hits to the mother-ship and escape through the time warp."* [Centuri flyer] Wikipedia/KLOV/Konami Wiki all repeat 56 and 7. **⚠ OVERTURNED (code + MAME): the Mother-Ship absorbs seven hits and the eighth destroys it; one that idled and relaunched after two or more hits needs six more (that clause from the code; mechanisms.md §6).**

Additional, secondary details:
- **Killing the Mother-Ship clears the field.** *"After you have destroyed the mothership, all the other ships will be destroyed and then your jet will advance to the next time period."* [KLOV] Konami Wiki: *"any remaining enemy craft are also eliminated."* Whether those swept-away enemies score anything is not stated anywhere.
- **Mother-Ships fly straight across and don't chase you.** *"The Mother Ships always move horizontally across the screen. Wait until they pass you, and then move directly behind them."* [arcade-history tips] A play blog concurs: *"All the bosses essentially operate the same as they fly across the screen and randomly fire bullets at you, never deviating."* [ancientelectronics]
- **⚠ Does the 56 change?** Konami Wiki writes: *"Once 56 enemy craft are defeated, initially 25 on the MSX platform and increasing by 5 after each game cycle…"* — the sentence is ambiguous as to whether the "increasing by 5 per cycle" applies to the MSX only or to the arcade too. **Unresolved.** The Centuri manual describes the loop's escalation purely in terms of attacker count/speed/fire rate and says nothing about the quota. **RESOLVED (code + MAME): 56 in every era, loop and difficulty.**

## 7. Formations (waves)

Enemies arrive continuously from the screen edges, but the game also throws **formations** — squadrons that enter together and are worth a bonus if wiped out.

- Their arrival is **announced by a sound cue**: *"a siren sound"* [KLOV], *"a series of quick tones"* [Konami Wiki], *"a quick piercing sound alerting you that there is a formation about to appear"* [search-surfaced guide excerpt].
- **Wiping out the whole formation scores 2,000 points.** [Centuri manual SCORING chart: "ENEMY FORMATION 2,000 PTS."; StrategyWiki; arcade-history]
- Secondary sources add that formations contain **"usually 3–5 aircraft"** and that the bonus only pays if the entire formation is destroyed **within roughly 3 seconds** [Konami Wiki; search-surfaced Xbox Achievements guide excerpt]. StrategyWiki says 1940's formations are *"slightly more aggressive"*, and that if you shoot two or three of a formation *"they will break up and proceed to attack you as normal planes."*
- **Neither the formation size nor the ~3-second window appears in the manual.** Both are fan-derived. Treat as unverified.

## 8. Parachutists — yes, this is a real mechanic

It is real, it is in the manual, and it is the game's dominant scoring lever.

- **"Dock with parachutes for bonus points."** [Centuri manual, GAME INSTRUCTIONS #3] They are the *"fellow pilots trapped in different time eras"* of the premise. [Wikipedia; Konami Wiki; arcade-history]
- **Quantity:** *"During the same stage, one to five parachutes will appear."* [Centuri manual, ROUND 1]
- **Value ladder:** the manual's scoring chart says only *"PARACHUTIST — 1st 1,000 PTS. 2nd 2,000 PTS.…ETC."* Every secondary source caps it: **1,000 / 2,000 / 3,000 / 4,000 / 5,000, then 5,000 for all subsequent ones.** [arcade-history scoring table; StrategyWiki – Gameplay and Walkthrough; Konami Wiki]
- **Reset rule (secondary only):** *"The award is reset to 1000 points upon losing a life or advancing a level."* [Konami Wiki] StrategyWiki – Walkthrough says the same in other words: 5,000s continue *"unless your plane is destroyed or you kill the Mother Ship and go on to the next period."* **The manual does not state this.**
- **They drift and can be lost:** *"Parachutes waft slowly downward, and they will disappear from the game if they scroll off of the screen."* [StrategyWiki – Gameplay] Hence the standard advice to hold the *upper* corners of the screen so parachutes drift toward you. [StrategyWiki – Walkthrough]
- **⚠ Conflict — 2001.** arcade-history: *"All stages except the 2001 stage have parachutes that can be collected."* Konami Wiki: *"In all but the space levels, a parachuting pilot will occasionally appear."* But StrategyWiki – Gameplay opens with *"In each time era, fellow Time Pilots are wafting through the air in need of rescue."* **Unresolved**, though the two sources that explicitly address 2001 both say *no parachutes there*. **RESOLVED (code + MAME): no parachutist in 2001.**
- **⚠ Whose pilots are they?** The Konami/Centuri framing is that you are *rescuing* friendly pilots. Hardcore Gaming 101 instead describes it as *"Certain enemies will eject from their planes, and picking them up will yield extra points."* Probably a misreading of a visual, but flagged.

## 9. Scoring

Straight from the Centuri operator's manual's illustrated SCORING chart (page 7), and independently matched by arcade-history's scoring table and StrategyWiki:

| Target | Points |
|--------|--------|
| Any common enemy craft — biplane / monoplane / helicopter / jet / UFO | **100** — **⚠ OVERTURNED (code + MAME): hits inside the chain window pay 100, 200 … 800 and then wrap to 100 (mechanisms.md §2).** |
| Any bomb, bullet, missile or alien weapon shot down | **100** — **⚠ OVERTURNED in part (code + MAME): craft bullets cannot be shot in eras 0–3 (only in 2001); bombs and missiles pay the chained score, not a flat 100.** |
| **Middle-size bomber** (1940 only) | **1,500** |
| **Enemy formation** (all of it) | **2,000** |
| **Mother-Ship** (all five) | **3,000** |
| **Parachutist** | **1,000**, then 2,000, 3,000, 4,000, **5,000** (capped — secondary sources) |

Notes and oddities:

- **The 1940 middle-size bomber is the best per-shot value in the game outside parachutists**, and the manual is explicit that it takes multiple hits: *"It could be destroyed by 4 hits and awards 1,500 points."* **⚠ StrategyWiki says three shots**, twice ("they take three shots to destroy"). **Unresolved: 3 or 4.** **RESOLVED (code + MAME): 4 hits.**
- **⚠ Does the middle-size bomber shoot at you?** The manual says *"Middle size bombers are aiming constantly at your plane!"* arcade-history says the exact opposite: *"They cannot fire at the player and pose no real threat as long as the player does not crash into them."* StrategyWiki says only that they *"do not deviate from their straight flight path."* **Unresolved, and substantive.**
- **⚠ Bomber colour** is described as *"red-and-yellow supply planes"* [arcade-history] and as *"dark brown Bombers"* [StrategyWiki]. Possibly a version/palette difference; possibly one of them is simply wrong.
- **Parachutist farming is the documented high-score strategy.** *"Finish the 1910 stage as soon as possible. On the 1940 stage, don't shoot anything!! Eventually, parachutes will start to appear… Each parachute (after #4) will give you 5,000 points. It's possible to roll the machine over (999,999+ points) while remaining on Stage 2 using this strategy."* [arcade-history tips] StrategyWiki calls the same tactic "hunting" and likewise names **1940 as the best hunting era** (no homing missiles, more parachutists than 1910).
- **Collision may still score.** *"If you are killed by colliding with an enemy ship, you are registered with the points as if you had shot it. This means extra lives are still awarded and also if you collide with the Mother Ship, you will advance to the next stage, providing you have at least one life remaining."* [arcade-history tips] **Single source, and a strange claim — verify.**
- For scale: the highest score the Centuri fan site records officially for this game is **15,000,000** (Jeff Peters, 25 Sep 1985) — implying either score rollover or marathon play well past 999,999. [Centuri fan site]

## 10. Lives, extra lives, and how you die

**How you die.** *"Avoid being hit by bullets, bombs and missiles. Do not crash into enemy planes."* [Centuri manual, GAME INSTRUCTIONS #1] Wikipedia: *"Fighters are destroyed if they collide into bullets, enemy ships, bombs or missiles."* One hit, no shields. **Game over when all your planes are destroyed** — there is no timer and no other fail state documented. [Centuri manual #5; Wikipedia]

**Starting lives are an operator setting.** The manual's DIP-2 table (page 9) gives:

| Setting | Options (manual's "normal" marked ●) |
|---------|--------------------------------------|
| **Number of planes** | ● **3** / 4 / 5 / 256 — **⚠ OVERTURNED (code + MAME): the fourth setting is 255 lives (stored 0xFF).** |
| **Bonus (extra plane)** | ● **10,000 pts and after every 50,000 pts** / 20,000 pts and after every 60,000 pts |
| **Difficulty** | eight steps, **1 (VERY EASY) … 8 (VERY DIFFICULT)** |
| **Type of game** | TABLE / UPRIGHT |
| **Music in attract mode** | OFF / ON |

*(Same tables appear in a separately circulated Centuri/Konami DIP-and-pinout text file on the Centuri fan site, which agrees exactly. The scan's "normal setting" marker is unambiguous for lives=3, bonus=10k/50k and music=OFF, but its placement against the **difficulty** rows is ambiguous — the factory difficulty is not readable from the scan.)*

**The prose instructions restate the default:** *"Bonus plane after 10,000 points, 60,000 points and each additional 50,000 points."* [Centuri manual, GAME INSTRUCTIONS #4] — i.e. 10k, 60k, 110k, 160k, …

**⚠ The extra-life cap is a Wikipedia-only claim.** Wikipedia says *"Extra lives are given at 10,000 points, and per 50,000 scored up to 960,000; thereafter, the game goes to 'survival of the fittest' mode."* 960,000 = 10,000 + 19×50,000, so the arithmetic is at least self-consistent, but **the phrase "survival of the fittest" appears nowhere in the manual or flyer, and every other site carrying it is echoing Wikipedia.** Konami Wiki hedges to *"Extra lives are usually given at 10,000, and per 50,000 scored thereafter"* with no cap. **Unresolved.** **⚠ OVERTURNED in part (code + MAME): the mark lists end at 960,000/980,000, but the score wraps past 999,900 and the marks pay again.**

**Nothing public describes what happens on death** — respawn position, respawn invulnerability, whether the era's kill counter is preserved or reset, or whether the wave state restarts.

## 11. Difficulty progression and the loop

The manual is the clearest source and is worth quoting in full:

> *"The next, Round 6, is identical with Round 1, but the number of planes attacking you, the speed and number of shots and grenades are gradually increased."*
>
> *"'TIME PILOT' continues with Round 7, 8, … making your mission harder and harder. The game is all over when all your planes are destroyed."*
> — Centuri operator's manual, GAME DESCRIPTION (page 6)

So: **five eras, then a wrap back to 1910 with the same layouts and harder parameters, indefinitely.** [Corroborated by Wikipedia, KLOV (*"the game will begin again with increased difficulty"*), Konami Wiki, StrategyWiki, arcade-history.]

There is also **within-loop escalation baked into the era order** — the manual introduces homing missiles at 1970, faster-and-equal jets at 1982, and two alien weapon types plus visual camouflage at 2001. Heinke's write-up characterises this as the eras introducing *"new behavioural patterns and attack strategies"* rather than only more/faster of the same.

**No public source gives a single numeric difficulty parameter for any loop.** "Gradually increased" is as precise as the record gets.

## 12. Version differences worth knowing

- **The fourth era's year differs by region.** *"In the Konami version, the fourth era is 1982 while in the Centuri licensed version, the fourth era is 1983."* [KLOV Trivia; Centuri fan site; StrategyWiki: *"In some versions of the game, the year is 1983"*] Wikipedia explains it as a running update: releases produced after 1982 relabelled the "present day" era. **Note an internal inconsistency in Centuri's own materials:** the Centuri *flyer* headlines **"A.D.1983 – The Age of the Jet Plane"** while the Centuri *operator's manual* prints **"A.D. 1982"**.
- **Attract mode differs too.** arcade-history: in the Konami version *"the 1910 and 2001 stages are never played in the attract mode"*; in the **Centuri and Atari versions** *"the 2001 stage IS played in the attract mode."* **CONFIRMED (code + MAME): the Konami set demos only 1940, 1970 and 1982.**
- **Bootleg:** a modified-chipset bootleg exists under the title **"Space Pilot"**; *"Game play is just like Time Pilot."* [C64-Wiki; StrategyWiki – Versions]
- **Ports diverge on gameplay numbers.** Konami Wiki notes the **MSX** version needs only 25 kills initially. The **GBA** compilation version adds a **hidden sixth era, 1,000,000 BC, with pterodactyls** — arcade-absent. [Konami Wiki] Home ports (Atari 2600, ColecoVision, MSX, all 1983) are not the arcade game and should not be used as evidence about it. [StrategyWiki – Versions]

## 13. Hardware & credits (context only)

- **Game ID GX393.** Main CPU **Z80 @ 3.072 MHz**; sound CPU **Z80 @ 1.789772 MHz**; **2× AY-3-8910** plus RC filters; mono. Vertical colour raster. [arcade-history; KLOV]
- Released **November 1982** in Japan. **Designed by Yoshiki Okamoto**, **programmed by Toshio Arima**, characters by Hideki Ooyama, sound by Masahiro Inoue. [arcade-history]
- Okamoto developed it *against* his boss's instruction to make a driving game; the boss later tried to claim credit. [Wikipedia; arcade-history; KLOV — all tracing to a 1998 Okamoto interview.] KLOV adds that Okamoto based it on **Bosconian**, which is a useful design-lineage hint (free-roaming multidirectional airspace with a scanner/progress readout).
- Commercially major: fifth highest-grossing arcade video game of 1982 in Japan; #1 on the US *Play Meter* earnings chart in February 1983. [Wikipedia]

## 14. Don't-confuse-it-with

- **Time Pilot '84 – Further Into Unknown World** (Konami, 1984) — the sequel. **Different game**: top-down view rather than side view, player-fired guided missiles, science-fiction landscape. Most GameFAQs/StrategyWiki "Time Pilot" guides you find are for **'84**; check before citing.
- **Space Pilot** — the Time Pilot bootleg (and an unofficial 1984 Kingsoft C64 game of the same name).
- **Time Ace** (Konami, Nintendo DS, 2007) — a later spiritual successor, not this game.
- **Bosconian** (Namco, 1981) — the acknowledged design ancestor, not the same game.

---

## Sources

- **Centuri operator's manual for "TIME PILOT"** (scanned PDF, 34 pp.) — GAME DESCRIPTION pp. 5–6, GAME INSTRUCTIONS + SCORING p. 7, DIP SWITCH SETTINGS pp. 8–9: <https://www.centuri.net/assets/img/portfolio/timepilot/timepilot_manual.pdf> (a second, 39-page scan is at `timepilot_manual2.pdf`). **This is the primary source for everything numeric in this document.**
- **Centuri fan site — Time Pilot page** (cabinet specs, flyer text, records, version note): <https://www.centuri.net/timepilot.htm>. ⚠ Its flyer transcription has a defect: the paragraph under "A.D.1940 – The Age of the Monoplan" is copy-pasted marketing text about **Vanguard**, not Time Pilot. Do not quote that paragraph.
- **Centuri/Konami DIP-switch and JAMMA-pinout text file**: <https://www.centuri.net/assets/img/portfolio/timepilot/timepilot.txt> (agrees with the manual's DIP tables).
- **Wikipedia — Time Pilot**: <https://en.wikipedia.org/wiki/Time_Pilot>
- **Konami Wiki (Fandom) — Time Pilot (video game)**: <https://konami.fandom.com/wiki/Time_Pilot_(video_game)> (most detailed per-era enemy description in the secondary record; visibly shares ancestry with Wikipedia)
- **arcade-history.com — Time Pilot [Model GX393]**: <https://www.arcade-history.com/?n=time-pilot-model-gx393&page=detail&id=2906> (scoring table, era/mothership identifications, trivia, tips, and a transcription of the manual's GAME INSTRUCTIONS)
- **KLOV / Museum of the Game — Time Pilot**: <https://www.arcade-museum.com/Videogame/time-pilot>
- **StrategyWiki — Time Pilot / Gameplay**: <https://strategywiki.org/wiki/Time_Pilot/Gameplay>
- **StrategyWiki — Time Pilot / Walkthrough**: <https://strategywiki.org/wiki/Time_Pilot/Walkthrough>
- **StrategyWiki — Time Pilot / Versions**: <https://strategywiki.org/wiki/Time_Pilot/Versions>
- **Hardcore Gaming 101 — Time Pilot**: <https://www.hardcoregaming101.net/time-pilot/> ⚠ dates the jet era to "1984", which is wrong; otherwise useful on feel and rotation.
- **ancientelectronics — Time Pilot (Arcade)** (first-hand play recollection; identifies the 1970 boss as a **CH-47 Chinook** rather than the CH-46 the databases name): <https://ancientelectronics.wordpress.com/2013/06/10/time-pilot-arcade/>
- **heinkedigital.com — Time Pilot (1982)**: <https://heinke.squarespace.com/blog/2024/12/10/time-pilot-1982>
- **The Arcade Archives (blog) — "Konamitober: Let's go back in time with Time Pilot!"**: <https://arcadearchives.wordpress.com/2022/10/16/konamitober-lets-go-back-in-time-with-time-pilot/>
- **Hamster Arcade Archives — TIME PILOT** (official modern re-release blurb): <https://www.arcadearchives.com/en/title/aca-074/>
- **C64-Wiki — Space-Pilot** (bootleg note): <https://www.c64-wiki.com/wiki/Space-Pilot>

**Sources that would have helped but could not be read** (HTTP 403 / bot-walls at time of research; some of their content was captured only via search-result excerpts and is labelled as such above): MobyGames, TV Tropes, xboxachievements.com's Time Pilot guide, speedrun.com's "1 Loop Speedrun Guide", tips.retrogames.com, RetroAchievements, arcadeclassics.net.

> **Excluded source — note.** `tcrf.net/Time_Pilot_(Arcade)` was attempted. The fetch returned a page containing **no Time Pilot content at all**, only injected instructions addressed to an automated agent (directions to delete and shuffle files). The instructions were not followed and the source is excluded as compromised/unusable. If TCRF is wanted later, read it manually in a browser.

---

## What the public record cannot settle

These are the specific questions hands-on MAME grounding — or the disassembly — has to answer. They are ordered roughly by how much a faithful reimplementation depends on them.

**Progression & the boss**
1. **Is the kill quota 56 for *every* era and *every* loop?** The manual states 56 only in the 1910 paragraph and once generically. Konami Wiki hints the quota rises per game cycle but attaches the numbers to the MSX port. Does the arcade quota change with loop, era, or the difficulty DIP?
2. **What counts toward the 56?** Do formation planes, the 1940 middle-size bomber, shot-down bombs/missiles, or collected parachutists advance the counter? arcade-history implies the bomber does *not*.
3. **Mother-Ship behaviour in detail:** which edge it enters from, its speed, whether it fires, whether it can leave and re-enter, and whether hits count from any angle or only from behind. Does the 7-hit count reset if it exits the screen?
4. **Does clearing the Mother-Ship award points for the enemies it sweeps away?** KLOV says all remaining craft are destroyed; nobody says whether they score.
5. **Is the "collide with the Mother-Ship on its last hit and still advance" claim true?** And does dying by ramming really credit the enemy's points?

**Enemies**
6. **The 1940 middle-size bomber: 3 hits or 4?** Manual says 4; StrategyWiki says 3 (twice).
7. **Does that bomber shoot?** The manual says it aims at you constantly; arcade-history says it cannot fire at all. Directly contradictory.
8. **Formation composition:** how many craft (the "3–5" figure is fan-derived), how often they spawn, and whether the 2,000-point bonus really has a **~3-second** window — that number appears in no primary source.
9. **Do formations differ per era**, beyond StrategyWiki's remark that 1940's are "slightly more aggressive" and break up when partly shot?

**Parachutists**
10. **Do parachutists appear in the 2001 stage?** Two sources say no, one implies yes.
11. **Is the value ladder really capped at 5,000?** The manual's chart says only "1st 1,000, 2nd 2,000 … ETC." with no stated ceiling.
12. **Does the ladder reset on death, on era change, on both, or on neither?** Both reset rules are secondary-only.
13. **Spawn rate and lifetime:** the manual says "one to five parachutes will appear" per stage — is that per era, per life, or per loop? What triggers a spawn, and does an off-screen parachute despawn permanently?

**Player ship**
14. **Can the ship about-face?** StrategyWiki says no; arcade-history says yes and describes it as a core tactic.
15. **How many distinct facings does it render/fire at** — eight locked plus how many transitional angles — and what is the turn rate (per era? per difficulty?)?
16. **Shot mechanics:** is it really a 3-shot burst per button press with a release required? What is the maximum number of player shots on screen, and their speed and range?
17. **Is the player's speed fixed?** No source describes acceleration or variable speed.

**Lives, scoring, session**
18. **Is there an extra-life ceiling at 960,000 and a "survival of the fittest" mode?** Wikipedia-only, uncited; the manual says "each additional 50,000" with no cap.
19. **What does the difficulty DIP actually change** (enemy count, speed, fire rate, missile frequency, quota?), and **which of the eight steps is the factory default** — the manual's "normal" marker is unreadable against those rows.
20. **Score display width and rollover.** Does it wrap at 999,999/1,000,000, and how is a 15,000,000 recorded score even represented?

**Death & session state**
21. **What happens when you die:** respawn position, invulnerability window, whether the era's kill counter and wave state persist or reset.
22. **Two-player alternating:** is each player's era, kill count, parachutist ladder and difficulty state kept independently?
23. **Attract mode composition** — arcade-history claims the Konami set never demos 1910 or 2001 while the Centuri/Atari sets do demo 2001. Easy to check, and a good ROM-identity fingerprint.
24. **Is there any timer anywhere in the game?** Nothing but arcade-history's stray phrase "time bar" suggests one, and that is almost certainly the kill-progress meter.

---
*Outside-in artifact. Everything above is public-sourced and cited. The Centuri operator's manual is treated as primary and is quoted verbatim wherever it speaks; secondary sources are marked, and where they are probably copies of one another that is said explicitly. Every conflict is left unresolved rather than adjudicated — resolving them is grounding's job, not this document's.*
