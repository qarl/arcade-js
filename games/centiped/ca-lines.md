200e	call the round-setup entry to seed a fresh board's working cells
2011	enable interrupts so the frame heartbeat can start firing
2012	lay down the record-field scaffolding the round is played on
2015	consume the frame-ready bit by shifting the heartbeat latch 0x8a
2017	no frame yet -- block here at the top of the loop until the heartbeat lands
2019	kick the watchdog with the sampled port value so the board isn't reset mid-frame
201c	read input port IN0 (vblank edge and service-switch bits)
201f	isolate the service-switch bit (bit 5)
2021	spin here while that bit reads clear
2023	run the per-frame wave/board-start service
2026	push one frame's worth of bytes into the four POKEY channels
2029	run the spawn-and-move dispatcher and inspect its answer
202c	dispatcher says skip the rest of this frame -- loop back to the heartbeat wait
202e	flush one pending high-score cell out to the EAROM
2031	run the per-frame layout and coordinate pass
2034	render the current object coordinates as decimal
2037	open the centipede segment sweep
203a	age the bank of countdown timers gating periodic events
203d	advance the movement sub-step accumulator for the 63 axis
2040	progress the column heading/dwell state
2043	step the centipede head segment forward
2046	release a new secondary actor when its interval timer expires
2049	pick the head's heading and lay down a fresh velocity seed
204c	continue the per-object grid-stamp state step
204f	step the death-and-respawn state machine one tick
2052	walk the playfield cell stream for a ripe cell to seed
2055	loop back to the top of the frame for the next heartbeat
2059	read the mode/state gate 0x43
205b	mask off its mode bits
205d	mode bits set -- bail out of the object step
205f	read the object's X-attribute cell 0x40
2061	fold it against the orientation mask 0xef
2063	test the folded X against its low band bound
2065	inside the band -- go run the state step
2067	out of band -- return
2068	read the object's Y cell 0x70
206a	fold it against orientation byte 0xf0
206c	test the folded Y against the high band bound
206e	Y in range -- skip the per-slot bounds test and go to the step
2070	load the active-object slot index 0x88
2072	read the slot's length/phase byte from the 0x9a array
2074	compare against the full length 0x0c
2076	slot at or over full length -- bail
2078	read the slot's gate/count byte from the 0xab array
207a	compare that count against 2
207c	default bound index 5
207e	count below 2 -- keep bound index 5
2080	else use bound index 9
2082	compare the count against 0x12
2084	below 0x12 -- use the index as-is
2086	halve the count
2087	clear carry for the bias add
2088	bias the halved count by 6
208a	move the derived bound into Y
208b	bring the bound index into A
208c	compare it against the slot's per-column tally in the 0xd7 array
208e	still within the column bound -- bail
2090	read the frame counter 0x00
2092	keep its low two bits
2094	not the fourth frame -- skip the attribute cycle
2096	advance the object's X-attribute cell 0x40
2098	read it back
209a	clear carry for the add
209b	add one
209d	wrap into a two-bit phase
209f	fold in the fixed 0x1c base
20a1	mirror the attribute for orientation
20a3	store the cycled attribute back to 0x40
20a5	read the running velocity/limit cell 0x60
20a7	stash it into scratch 0x8b
20a9	read the object Y cell 0x70
20ab	read the orientation selector 0xef
20ad	orientation zero -- take the subtract branch
20af	clear carry for the add
20b0	add the column step 0x80 to Y
20b2	join the store
20b5	set carry for the subtract
20b6	subtract the column step 0x80 from Y
20b8	store the stepped Y back into the object cell 0x70
20ba	fold it against orientation 0xf0
20bc	test whether it has reached the edge (below 4)
20be	at the edge -- go re-seed the wave instead of stamping
20c0	target the head slot index 0x0c
20c2	range/collision-check the object against the reference point
20c5	object in range of another -- bail without stamping
20c7	read the frame counter 0x00
20c9	keep its low two bits
20cb	not the fourth frame -- bail
20cd	read the POKEY random register
20d0	keep its low two bits
20d2	RNG gate fails -- bail
20d4	base column code 4
20d6	fold it for orientation through 0xf3
20d8	clear carry for the add
20d9	add the object's Y to form the target column
20db	row 0
20dd	position the grid pointer at that cell
20e0	stamp a mushroom there if the cell is empty
20e3	return
20e4	object hit the edge -- re-seed the wave state
20e7	return
20e8	load the fixed X seed constant 0x1c
20ea	fold it against orientation 0xef
20ec	seed the object X cell 0x40
20ee	load the fixed Y seed constant 0xf8
20f0	fold it against orientation 0xf0
20f2	seed the object Y cell 0x70
20f4	read the POKEY random register
20f7	keep the top five bits
20f9	all-zero draw -- re-roll
20fb	require the value to be at least 0x10
20fd	too small -- re-roll
20ff	set carry for the subtract
2100	subtract 4 from the accepted value
2102	seed the velocity/limit cell 0x60 in its bounded band
2104	default per-wave count 3
2106	load the active slot index 0x88
2108	read that slot's gate byte from the 0xab array
210a	compare it against 6
210c	6 or more -- keep per-wave count 3
210e	else per-wave count 2
2110	store the chosen per-wave count into 0x80
2112	zero
2114	clear the head-velocity seed 0x50
2116	clear 0xb8 so no velocity carries into the new wave
2118	return
2119	read the master enable/round flag 0x86
211b	bit 7 clear -- nothing to lay out this pass, return
211d	draw the config-selected banner line
2120	layout constant 3
2122	seed layout-draw cell 0x93
2124	layout constant 0x20
2126	seed layout-draw cell 0x94
2128	layout constant 0x40
212a	seed the draw cursor low byte 0x91
212c	layout constant 5
212e	seed the draw cursor high byte 0x92
2130	redraw a pointer-table layout row, unblanked
2133	read the frame counter 0x00
2135	not frame zero -- skip the extra row
2137	row selector 0x84
2139	draw that pointer-table row
213c	read the frame counter 0x00
213e	load a byte from the object page 0x0600
2141	stash it into scratch 0xff
2143	test the frame counter's high bit
2145	high bit set -- skip the target stepping and return
2147	read the mode/state gate 0x43
2149	mask its mode bits
214b	mode bits set -- skip the target clamps, go to the tail-writer
214d	read the 63-axis coordinate
214f	default target step +1
2151	compare against the low band edge 0x1c
2153	below the low edge -- keep +1
2155	else set target step -1
2157	compare against the high band edge 0xe4
2159	at or above the high edge -- keep -1
215b	in-band -- reuse the stored 0x53 target step
215d	bring the chosen step into A
215e	store the new 0x53 target
2160	clear carry for the coordinate step
2161	step the 73-axis coordinate integrator with it
2164	read the 73-axis coordinate
2166	snapshot it into 0x8d
2168	default target step -1
216a	compare against the low band edge 0x30
216c	at or above it -- keep step -1
216e	else target step +1
2170	compare against 0x09
2172	below it -- keep +1
2174	in-band -- reuse the stored 0x83 target step
2176	bring the chosen step into A
2177	store the new 0x83 target
2179	clear carry for the coordinate step
217a	step the 73 coordinate and clamp it into its band
217d	run the tail-writer's coord-delta routing
2180	index 0x13 -- top of the 20-byte block
2182	seed the checksum accumulator with 0xfa
2184	fold in one byte of the 20-byte block at 0x2120
2187	step to the previous byte
2188	loop across the whole block
218a	store the folded checksum into 0xfe
218c	return
2195	fetch the config-indexed table byte (index returned in Y)
2198	stash that first byte into 0xae
219a	read the parallel-table byte at the same index
219d	stash it into 0xb0
219f	row selector 6
21a1	draw the fixed layout row
21a4	reload the parallel byte
21a6	plot it as a glyph
21a9	reload the first table byte
21ab	plot it as a two-digit number
21ae	trailing zero
21b0	plot the trailing zero as two digits and return
21b3	read the config/mode byte 0xfd
21b5	isolate bits 5-4, the ROM-table selector
21b7	shift it down toward an even index
21b8	shift again
21b9	shift again -- giving 0, 2, 4, or 6
21ba	move the index into Y
21bb	read that byte from the ROM table at 0x21bf
21be	return with the byte in A and the index in Y
21c7	load the active-object slot index 0x88
21c9	default steer selector 2
21cb	read that slot's gate byte from the 0xab array
21cd	gate nonzero -- keep selector 2
21cf	read the config/mode byte 0xfd
21d1	isolate bit 6
21d3	fold in the 0x10 threshold base
21d5	compare against the slot's 0xa9 entry
21d7	threshold below the slot value -- keep selector 2
21d9	else drop the steer selector to 1
21db	store the selector into the Y-steer cell 0x81
21dd	read the POKEY random register
21e0	test bit 2
21e2	bit clear -- skip the sign mirror
21e4	bring the selector into A
21e5	two's-complement negate it
21e8	move the negated value back into Y
21e9	stash the (possibly mirrored) horizontal drift seed into the object's drift cell
21eb	load the base heading constant 0x60
21ed	fold it against the orientation mask so it mirrors for a flipped cabinet
21ef	seed the object's heading cell with the folded key
21f1	load 0xff
21f3	seed the object's row cell to 0xff
21f5	load 0xf8
21f7	seed the column heading cell
21f9	load the dwell interval 0x60
21fb	arm the column dwell timer
21fd	load zero
21ff	silence the channel-4 SFX timer
2201	spawn cells seeded -- return
2202	read the state/mode flag
2204	keep only its mode bits
2206	if none are set, go advance the column heading this frame
2208	otherwise nothing to do this frame -- return
2209	set the slot index to the head slot 0x0d
220b	read the column heading
220d	keep a copy in Y
220e	test the high-branch bit of the heading
2210	bit clear -- take the low branch and step the heading
2212	high branch: compare the heading against the far edge 0xf8
2214	not at the far edge yet -- bail and wait
2216	reached the far edge -- jump to re-arm the heading countdown
2219	read the frame counter
221b	mask to every fourth frame
221d	not this frame -- skip the heading step
221f	step the column heading forward
2221	re-read the heading
2223	fold it against the wrap-boundary orientation byte
2225	compare against the fold boundary 0x1c
2227	still inside the range -- skip the wrap
2229	load the wrap-around heading 0x14
222b	fold it against the wrap-boundary orientation byte
222d	wrap the column heading back to its start
222f	tick the column dwell timer down
2231	still counting -- skip the wrap-through-zero work and go fold the drift
2233	timer expired: read the hardware random register
2236	test its top bit
2238	bit clear -- skip the drift pause/resume swap
223a	read the current horizontal drift
223c	drift is zero (paused) -- go restore it from the stash
223e	drift is live: read the object's row cell
2240	compare against the high band edge 0xfb
2242	too near the top -- skip the swap
2244	compare against the low band edge 0x05
2246	too near the bottom -- skip the swap
2248	in-band: stash the live drift away
224a	load zero
224c	always taken -- store zero into the drift (pause the horizontal drift)
224e	restore the horizontal drift from its stash (resume it)
2250	write the chosen drift value back
2252	read the config/mode byte
2254	keep its config bit 6
2256	force bit 5 on
2258	gate the result through the hardware random register
225b	zero -- skip flipping the vertical steer
225d	read the vertical steer delta
225f	negate it
2262	store the flipped vertical steer back
2264	load the re-arm interval 0x30
2266	re-arm the column dwell timer
2268	read the object's row cell
226a	prepare a borrowless subtract
226b	subtract the horizontal drift out of the row cell
226d	store the drifted row back
226f	mirror the row into scratch
2271	read the object's heading
2273	read the direction selector
2275	selector zero -- take the subtract branch
2277	clear carry for the add
2278	add the vertical steer onto the heading
227a	jump into the row-target steerer with the summed heading
227d	prepare a borrowless subtract
227e	subtract the vertical steer from the heading
2280	commit the computed heading as the new row target
2282	select row 0 for the cell probe
2284	resolve the tile cell at the target coordinate
2287	empty cell -- skip the mushroom-consume
2289	index 0 for the cell read
228b	read the tile at the target through the working pointer
228d	keep only the tile code
228f	compare against the high tile class 0x38
2291	below it -- not consumable, skip
2293	load a blank
2295	clear the cell -- the object consumes the mushroom there
2297	decrement the matching per-column tally for the eaten mushroom
229a	restore the head slot index 0x0d
229c	read the object's row cell
229e	is the column retired (0xff)?
22a0	retired -- go reseed the spawn state and return
22a2	read the row target
22a4	fold it against the orientation mask
22a6	compare against the near-top edge 0x09
22a8	far enough from the edge -- run the distance test
22aa	near the top: read the vertical steer
22ac	steer positive -- go straight to the store step
22ae	steer negative -- take the flip-and-fold path
22b0	load the active-object selector
22b2	read that object's per-object counter
22b4	switch to decimal mode
22b5	prepare a borrowless subtract
22b6	knock the counter down by 6 in BCD
22b8	back to binary mode
22b9	result still non-negative -- keep it
22bb	underflowed -- floor the distance at zero
22bd	halve the reduced counter
22be	compare against the clamp 6
22c0	below the clamp -- keep it
22c2	clamp the distance to 5
22c4	scale the distance up (x2)
22c5	scale it (x4)
22c6	scale it (x8)
22c7	store the scaled distance
22c9	load the base coordinate 0x60
22cb	fold it against the orientation mask
22cd	prepare a borrowless subtract
22ce	subtract the scaled distance to get the target coordinate
22d0	read the direction selector
22d2	selector zero -- take the mirrored compare
22d4	compare the target coordinate against the row target
22d6	target below -- take the flip-and-fold path
22d8	target at or above -- go to the steer test
22da	compare the target coordinate against the row target
22dc	target at or above -- take the flip-and-fold path
22de	read the vertical steer
22e0	steer negative -- go straight to the store step
22e2	set the slot index to the head slot 0x0d
22e4	test whether another object shares this column nearby
22e7	no neighbour -- skip the flip
22e9	neighbour present: read the vertical steer
22eb	flip the vertical steer
22ee	store the flipped steer back
22f0	set the slot index to the head slot 0x0d
22f2	arm the slot and dispatch the distance-fold step
22f5	steering done -- return
22f6	retired column -- reseed the segment spawn state
22f9	return
22fa	tick the column dwell timer down
22fc	still counting -- return
22fe	timer expired: read the hardware random register
2301	mask the raw random value
2303	force in the low bits -- a fresh interval of 0x0f or 0x2f
2305	reload the column dwell timer
2307	load 0x14
2309	re-arm the channel-4 companion SFX timer
230b	fold 0x14 against the wrap-boundary orientation byte
230d	re-arm the column heading
230f	return
2310	read the object slot's base byte
2312	copy it into scratch
2314	default the step to -1
2316	read the slot's heading byte
2318	heading points negative -- keep the -1 step
231a	else set the step to +1
231c	load the slot's coordinate byte for the tile probe
231e	inputs packaged -- return
231f	load the active-object selector
2321	read this object's rebuild gate
2323	gate already set -- skip the length-counter maintenance
2325	read the slot's busy/flag byte
2327	set its busy (high) bit
2329	store the flag byte back
232b	read the slot's spawn counter
232d	is it at least 3?
232f	below 3 -- skip the length wrap
2331	tick the length counter down
2333	still nonzero -- skip the wrap
2335	load the wrap value 0x0c
2337	wrap the length counter back to 0x0c
2339	default the new spawn count to 2
233b	read this object's per-object counter
233d	compare against 4
233f	counter high enough -- keep the count of 2
2341	else drop the new count to 1
2343	store the new spawn counter
2345	load the head-entry length 3
2347	seed the [0] length entry
2349	read the slot's spawn counter
234b	seed the [0] length field
234d	keep the length in Y
234e	read the frame counter
2350	test its negate-select bit
2352	bit set -- keep the length unnegated
2354	move the length into A
2355	negate the length
2358	move it back to Y
2359	seed the [0] heading with the signed length
235b	load the base coordinate 0xf8
235d	fold it against the orientation mask
235f	seed the [0] coordinate cell
2361	load the midline 0x80
2363	seed the [0] coordinate-row cell
2365	read the length counter
2367	copy it into scratch as the copy-loop length
2369	is the centipede just one segment long?
236b	single segment -- skip the descriptor-copy loop
236d	seed the descriptor source index 0x42
236f	start the copy at destination slot 1
2371	store the descriptor index into this slot's phase cell
2373	load the base coordinate 0xf8
2375	fold it against the orientation mask
2377	seed this slot's coordinate cell
2379	read the descriptor's row byte
237b	copy it into this slot's row table
237d	read the descriptor's heading byte
237f	copy it into this slot's heading table
2381	descriptor positive -- use the 0xf8 coordinate base
2383	descriptor negative -- use the 0x08 coordinate base
2385	always taken -- go add the row offset
2387	positive descriptor -- use the 0xf8 coordinate base
2389	clear carry for the add
238a	add this slot's descriptor row offset
238c	store the slot's coordinate-row cell
238e	step the descriptor source index down
238f	reached the descriptor wrap boundary 0x3f?
2391	no -- continue the copy loop
2393	wrap the descriptor source index up to 0x47
2395	step to the next segment sprite-table slot
2396	compare the slot index against the length limit in $8b
2398	loop back to fill the next slot while still under the length
239a	reload the object-slot selector
239c	read this object's segment length counter
239e	is the length already at the full 0x0c segments?
23a0	full-length -- skip the random fill and go mark the slot rebuilt
23a2	build the orientation-folded coordinate base 0xf8 ^ $f0
23a6	start the fill index at the length limit
23a8	write the folded base into the segment's vertical coordinate row
23aa	load a zero
23ac	clear the segment's phase byte
23ae	default the heading magnitude to 2
23b0	read the wave step value $f4
23b2	if it is zero keep the default magnitude
23b4	otherwise use $f4 as the heading magnitude
23b5	store the heading delta for this segment
23b7	test bit 7 of the POKEY random register
23ba	if clear skip the negate
23bc	mirror the value via two's complement to flip its sign
23bf	store the signed heading delta for this segment
23c1	read the POKEY random register
23c4	keep only the high five bits
23c6	seed the segment's coordinate with that random value
23c8	reload the folded coordinate base
23ca	advance to the next segment slot
23cb	reached the full twelve slots?
23cd	loop back to fill the remaining slots
23cf	load the rebuilt marker 0x0c
23d1	reload the object-slot selector
23d3	mark this object's segment slot rebuilt
23d5	read the flip source byte $fe
23d7	copy it into the spawn-enable byte $97
23d9	done rebuilding this segment's sprite tables
23da	read the death/respawn countdown $87
23dc	nonzero -- the sequence is active, keep going
23de	countdown at zero -- nothing to do this frame
23df	read the field-scan pointer high byte
23e1	scan pointer busy -- the sequence is paused, return
23e3	tick the death countdown down by one
23e5	still counting -- act only on the frame it hits zero
23e7	read the blank-a-cell flag $d6
23e9	flag clear -- skip the cell-blank action
23eb	load selector 0x80 for the row redraw
23ed	redraw a status row
23f0	load a zero to erase with
23f2	index zero for the cursor write
23f3	blank the cell the draw cursor points at -- erase the dying glyph
23f5	clear the blank-a-cell flag
23f7	reseed the player-shot start cells
23fa	read the $43 mode/state byte
23fc	mask off its mode bits
23fe	any mode bit set -- continue the dispatcher
2400	no mode bits -- forward to the sprite-table rebuild
2403	reseed the player-shot start cells
2406	read the pending-wave/life sign byte $86
2408	non-negative -- take the object-count branch
240a	read the $01 high-bit flag
240c	bit 7 clear -- skip the screen transpose
240e	strip the high bit
2410	store $01 with its high bit cleared
2412	rotate the tile grid a column
2415	relay out the sorted-object record field
2418	hand off to the segment-spawn reseed
241b	read object-present cell $a5
241d	fold with $a6 -- is any object still on screen?
241f	an object remains -- take the step-a-slot branch
2421	no object left -- decrement the life/round counter
2423	rebuild the sorted object table
2426	read the spawn-pending flag $ef
2428	clear -- skip the state-block broadcast
242a	read object-active flag $c2
242c	non-negative -- skip the broadcast
242e	load 0x80
2430	mark a broadcast/screen-setup pending in $ee
2432	fan the flip byte across the whole state block
2435	reseed the player-shot start cells
2438	rotate the tile grid a column
243b	read object-active flag $c1
243d	non-negative -- skip the record redraw
243f	relay out the sorted-object record field
2442	seed the segment spawn state for the fresh wave
2445	rebuild the segment sprite tables
2448	seed the per-wave working values
244b	load 1
244d	set the frame counter $00 to 1
244f	load selector 4 for the row draw
2451	draw a pointer-table row
2454	load the slot index $89
2456	load 0xff
2458	clear the per-slot output latch at $1c02+slot
245b	fold the high-score checksum
245e	load writeback cursor value 0x3d
2460	arm the EAROM writeback cursor $f9
2462	load zero
2464	clear the EAROM writeback phase $fa
2466	wave restart done
2467	load the slot count $89
2469	drop it by one
246a	more than one slot -- keep going
246c	exactly one slot left -- close it out and redraw borders
246f	load the object-slot selector $88
2471	read this slot's timer $a4+x
2473	slot occupied -- switch to the mirror slot
2475	empty slot -- read the arm/pass counter $a7
2477	already armed on a prior pass -- decrement it
2479	first empty pass -- bump the arm counter
247b	load death-countdown reload 0x80
247d	reload the death countdown $87
247f	load 0xf9
2481	set mode byte $43 to 0xf9
2483	set companion $42 to 0xf9
2485	load selector 4 for the row draw
2487	draw a pointer-table row
248a	load selector 0 for the row draw
248c	draw a second pointer-table row
248f	read the slot selector $88
2491	fold in the slot glyph bit 0x20
2493	paint the slot's glyph and advance the cursor
2496	slot armed -- return
2497	later empty pass -- decrement the arm counter
2499	read the current slot selector
249b	flip to the mirror slot index
249d	move it into the index register
249e	read the mirror slot's timer $a4+x
24a0	mirror also empty -- abandon into the close-slot tail
24a2	commit to the mirror slot: store its index in $88
24a4	load the high-bit mask 0x80
24a6	keep only the top bit of $ee
24a8	fold in the new slot selector
24aa	store the combined flag back into $ee
24ac	did it land on 0x82?
24ae	no -- skip the constant reseed
24b0	reseed the state-block constants
24b3	read the spawn-timer reload from the $a1 table
24b5	arm the spawn timer $a0
24b7	reload the slot selector
24b9	is this slot 1?
24bb	no -- skip the broadcast
24bd	fan the flip byte across the state block for slot 1
24c0	rotate the tile grid a column
24c3	reload the slot selector
24c5	is this slot 2?
24c7	no -- skip the playfield-reset special case
24c9	read this slot's timer
24cb	compare it against slot 0's timer
24cd	differ -- skip
24cf	read $ad
24d1	nonzero -- skip
24d3	load the rebuilt marker 0x0c
24d5	write 0x0c into this slot's $94 cell
24d7	clear the field and lay a fresh mushroom carpet
24da	read the slot's active flag $c2+x
24dc	set the busy bit 0x40
24de	mark the slot busy
24e0	load death-countdown reload 0xa0
24e2	reload the death countdown $87
24e4	load selector 0 for the row draw
24e6	draw a pointer-table row
24e9	read the slot selector $88
24eb	fold in the slot glyph bit 0x20
24ed	paint the slot's glyph and advance the cursor
24f0	load 0xf9
24f2	set mode byte $43 to 0xf9
24f4	set companion $42 to 0xf9
24f6	set the blank-a-cell flag $d6 to 0xf9
24f8	load the slot selector $88
24fa	count this slot's $a4 timer down by one
24fc	repaint the two vertical grid side-borders
24ff	seed the segment spawn state
2502	seed the per-wave working values
2505	rebuild the segment sprite tables
2508	return
2509	read the broadcast source byte $fe
250b	fan it into $bd
250d	fan it into $bf
250f	drive the flip-screen latch from bit 7 of the value
2512	mirror the same write to the ignored $2400 store
2515	fan the value into flip byte $f5
2517	fan into $f7
2519	fan into $f6
251b	fan into orientation mask $f0
251d	fan into mask $ef
251f	fan into $f1
2521	fan into $f2
2523	fan into $f3
2525	fan into $f4
2527	fan into $f8
2529	broadcast done
252a	load 0xf8
252c	seed orientation mask $f0
252e	load 0xff
2530	seed $f3
2532	load 0xfe
2534	seed $f4
2536	load 0xfc
2538	seed $f8
253a	load 0xe0
253c	seed $f1
253e	load 0xc0
2540	seed mask $ef
2542	load 0x40
2544	seed $f2
2546	load 0xbf
2548	seed flip byte $f5
254a	load 0x03
254c	seed $f7
254e	load 0x3f
2550	seed $f6
2552	load 0x80
2554	set the flip-screen latch bit 7
2557	mirror the write to the ignored $2400 store
255a	load zero
255c	clear $bd
255e	clear $bf
2560	state-block seeded
2561	read the DSW2 config source byte
2564	stash it into $d3
2566	keep the low two bits
2568	store the wave-select selector into $8d
256a	nonzero selector -- skip the default
256c	load 2
256e	selector zero -- set the object limit $c8 to 2
2570	read the mode/DIP config byte
2572	keep bits 3-2, the difficulty selector
2574	shift the difficulty bits down one
2575	shift them down again, into the low two bits
2576	add 2 to form the difficulty-scaled count
2578	stash that difficulty count in $a4
257a	read the pending-wave-start flag $86
257c	bit7 set means a wave start is pending -- go service the banner
257e	no wave pending -- return (the common frame)
257f	read the wave-select code $8d
2581	zero -- skip the banner status row
2583	lay down a banner status row
2586	read the frame/tick cell
2588	isolate bit5 of the tick
258a	shift it up
258b	shift it up again, into bit7
258c	store the reshaped bit as the wave-select code $8d
258e	read the banner countdown counter $c8
2590	fold in the segment-movement accumulator so either keeps the count alive
2592	both counters spent -- draw the finished banner row and return
2594	read the banner flip byte $dc
2596	non-negative -- jump straight to drawing the count digits
2598	compare the folded count against 2
259a	below 2 -- take the low-count banner branch
259c	clear value
259e	clear the banner flip byte $dc
25a0	load banner row code 0x8a
25a2	always taken -- draw that row
25a4	read the mode/DIP config byte
25a6	isolate its top bit
25a8	latch that bit into the banner flip byte $dc
25aa	fold it into a banner row code
25ac	lay down that banner row
25af	all-ones
25b1	drive the per-slot output latch 0x1c03 high
25b4	drive the per-slot output latch 0x1c04 high
25b7	return
25b8	low-count banner row base
25ba	fold in the wave-select code $8d
25bc	lay down the banner row
25bf	row code 9
25c1	lay down the banner row
25c4	read the banner countdown counter $c8
25c6	compare against ten
25c8	below ten -- single digit, skip the tens
25ca	tens-digit glyph
25cc	plot the tens digit and step the cursor
25cf	reload the countdown counter
25d1	prepare for subtraction
25d2	strip off the ten, leaving the units
25d4	set the glyph bit on the units value
25d6	plot the units digit and step the cursor
25d9	read the segment-movement accumulator
25db	zero -- keep the current glyph
25dd	otherwise use the alternate glyph
25df	plot it and step the cursor
25e2	read the banner countdown counter $c8
25e4	zero -- return
25e6	read the banner flip byte $dc
25e8	negative -- return
25ea	read the wave-select code $8d
25ec	write it to the per-slot output latch 0x1c03
25ef	is the counter below 2?
25f1	below 2 -- skip ahead
25f3	write the code to the output latch 0x1c04 as well
25f6	default slot index 2
25f8	read input port IN1
25fb	test bit1
25fd	set -- a held input defers the commit
25ff	read the difficulty count $a4
2601	seed the slot timer $a6 with it
2603	tick the banner countdown counter down
2605	go commit the wave
2607	read input port IN1
260a	take the fallback slot index from $ff
260c	shift IN1 bit0 into carry
260d	set -- a held input aborts, return
260f	tick the banner countdown counter down
2611	all-ones
2613	drive the per-slot output latch 0x1c03 high
2616	drive the per-slot output latch 0x1c04 high
2619	zero
261b	clear working cell $fb
261d	clear working cell $fc
261f	clear the phase accumulator $9a
2621	clear the segment row-crossing counter
2623	clear the shared segment-movement accumulator
2625	store the chosen slot index in $89
2627	clear this slot's output latch at 0x1c02
262a	read the difficulty count $a4
262c	minus one
262d	store it as the slot count $a5
262f	bump the round/wave flag $86
2631	snapshot the low working cells and refold the checksum
2634	read the config-selected table byte
2637	seed object cell $ae with it
2639	mirror it into $af
263b	read the per-config parallel table byte
263e	seed object cell $b0 with it
2640	mirror it into $b1
2642	read input port IN0
2645	test bit4
2647	clear -- skip the state-block broadcast
2649	value 0x80
264b	set the pending flag $ee to it
264d	broadcast that byte through the state block
2650	run the full round setup
2653	go draw the grid side borders
2656	read palette record byte b0 from the ROM table
2659	save b0 on the stack
265a	read palette record byte b1
265d	hold b1 in Y
265e	read palette record byte b2
2661	hold b2 in X
2662	recover b0
2663	write b2 into palette cell 0x0E
2666	write b2 into palette cell 0x06
2669	write b0 into palette cell 0x0F
266c	write b0 into palette cell 0x05
266f	write b1 into palette cell 0x0D
2672	write b1 into palette cell 0x07
2675	return
26a0	all-ones
26a2	mark object slot $c1 idle
26a4	mark object slot $c2 idle
26a6	nine cells to copy
26a8	read working cell $02+x
26aa	copy it into the high-score table mirror at 0x178+x
26ad	read working cell $1a+x
26af	copy it into the high-score mirror at 0x181+x
26b2	step the index down
26b3	loop over the block
26b5	fold the high-score checksum and return
26b8	six rows to draw
26ba	set the row loop count in $8b
26bc	base high byte
26be	fold with the flip byte $f7
26c0	keep the low bits
26c2	set the draw cursor high byte $92
26c4	base low byte
26c6	fold with the flip byte $f6
26c8	set the draw cursor low byte $91
26ca	load the slot count $a5 as the row index
26cc	left-border glyph
26ce	step the index down
26cf	still in range -- draw the border glyph
26d1	past the count -- blank this cell instead
26d3	plot the cell and advance the cursor
26d6	tick the row counter down
26d8	loop the left border column
26da	base high byte
26dc	fold with the flip byte $f7
26de	set the draw cursor high byte $92
26e0	base low byte
26e2	fold with the flip byte $f6
26e4	set the draw cursor low byte $91
26e6	six rows again
26e8	set the row loop count in $8b
26ea	prepare for subtraction
26eb	subtract the slot timer $a6
26ed	use the result as the row index
26ee	blank cell
26f0	step the index down
26f1	still in range -- blank this cell
26f3	past the count -- draw the right-border glyph
26f5	plot the cell and advance the cursor
26f8	tick the row counter down
26fa	loop the right border column
26fc	return
26fd	start at the top timer slot 0x0d
26ff	read the countdown byte $34+x
2701	compare against 0xF9
2703	below it -- this timer is resting, skip it
2705	compare against 0xFA
2707	exactly 0xF9 -- just expired, don't decrement
2709	live countdown -- tick it down one step toward the 0xf9 expiry marker
270b	not expired this pass -- skip
270d	is this the master slot?
270f	not the master -- skip the re-arm
2711	read the frame/step counter $43
2713	mask it
2715	busy -- skip the re-arm
2717	read $d7
2719	fold it with $ef
271b	refresh the shared timing key $41
271d	step to the next timer slot
271e	loop the timer bank
2720	read the frame/step counter $43
2722	mask it
2724	inactive -- stop here
2726	read the frame cell $00
2728	only every fourth frame
272a	not this frame -- stop
272c	read the step counter $43
272e	compare against the 0x28 ceiling
2730	reached the ceiling -- stop
2732	advance the step counter
2734	was the pre-step value the 0x27 top?
2736	not the top -- done
2738	zero
273a	seed the field-scan pointer low byte
273c	page 4
273e	seed the field-scan pointer high byte, aiming the scan at 0x0400
2740	return
2741	read object-active flag $c1
2743	AND it with object-active flag $c2
2745	at least one object is live -- go do the frame's work
2747	both objects idle -- return, telling the caller to run the full chain
2748	read object-active flag $c2
274a	no live object in this slot ($c2 idle) -- branch onward
274c	read the pending flag $ee
274e	not pending -- branch onward
2750	read the pending flag $ef
2752	set -- branch onward
2754	value 0x82
2756	set the pending flag $ee to it, kicking a fresh screen/wave setup
2758	seed the state-block constants
275b	transpose the screen bitmap
275e	plot the object coordinates
2761	reseed the player-shot start cells
2764	read the slot count/index
2766	shift it right, testing the low bit
2767	nothing there -- skip painting the slot glyph
2769	pick layout-row selector 0
276b	draw that status row
276e	default the glyph index to 2
2770	read the object's angle/active cell
2772	positive -- keep index 2
2774	negative object -- drop the index to 1
2775	stash the chosen slot selector
2777	move it into A
2778	fold in bit 5 to make it a glyph code
277a	plot that slot glyph through the draw cursor
277d	pick layout-row selector 8
277f	draw that status row
2782	pick layout-row selector 5
2784	draw that status row
2787	start from constant 0x89
2789	mirror it against the flip byte
278b	seat the draw cursor low byte
278d	start from constant 0x05
278f	mirror it against the other flip byte
2791	seat the draw cursor high byte
2793	load the slot selector
2795	read this slot's spawn-column counter
2797	stash it as the record index
2799	move it into A
279a	clear carry for the add
279b	add the counter base
279d	store the record's base offset
279f	plot the record's first field byte
27a2	reload the record index
27a4	step to the next field
27a5	plot the record's second field byte
27a8	reload the record index
27aa	step past the first field
27ab	step to the third field
27ac	plot the record's third field byte
27af	read the IN1 control port
27b2	check the spawn-pending/orientation flag
27b4	no pending -- leave the bit where it is
27b6	shift once to bring bit 2 into place
27b7	shift the input bit down
27b8	shift again
27b9	shift again into carry
27ba	roll that input bit into the phase accumulator
27bc	read the phase accumulator back
27be	keep its low five phase bits
27c0	compare against the top of the phase cycle
27c2	not at the top -- skip the column advance
27c4	advance this object's spawn-column counter
27c6	read the counter
27c8	compare it to three
27ca	still below the wrap -- re-arm one lane cell
27cc	load the slot selector
27ce	value 0xff
27d0	mark this spawn-column counter spent
27d2	read the spawn-pending flag
27d4	nothing pending -- skip the full respawn
27d6	value 0x80
27d8	raise the pending-spawn flag
27da	broadcast 0x80 across the state block
27dd	rotate the tile grid
27e0	reseed the player-shot start cells
27e3	redraw the object coordinates
27e6	rebuild the segment sprite tables
27e9	seed the segment spawn state
27ec	seed the wave state
27ef	read the object-active flag
27f1	object idle -- jump to the frame tail
27f3	read the object-active flag
27f5	AND with the second active flag
27f7	both idle -- take the setup branch
27f9	index zero
27fb	clear this spawn-column counter
27fd	return
27fe	bump the record offset
2800	load it as the lane index
2802	value 0xf4
2804	stash it in the run flag
2806	value 1
2808	re-arm this lane cell to 1
280a	read the run flag
280c	clear -- loop back to mark the slot spent
280e	set -- jump into the per-frame move body
2810	pick layout-row selector 0x88
2812	draw that status row
2815	pick layout-row selector 0x85
2817	draw that status row
281a	value 0
281c	clear the first sprite-shadow cell
281f	clear the second sprite-shadow cell
2822	clear the third sprite-shadow cell
2825	refresh the state snapshot for the checksum
2828	redraw the sorted-object record columns
282b	read the slot count
282d	store it in the run flag
282f	decrement it
2830	only one slot left -- return
2832	pick layout-row selector 0x80
2834	draw that status row
2837	value 0
2839	clear the row index
283a	write a blank through the draw cursor
283c	return
283e	read the frame counter
2840	keep its low three bits
2842	not this frame -- exit with nothing to do
2844	direction sign 0xff (negative)
2846	value 0
2848	read the trackball accumulator
284a	clear the accumulator
284c	positive -- keep the positive direction
284e	direction sign 1 (positive)
2850	move the accumulator into A
2851	take its magnitude
2854	back into the magnitude index
2855	compare the magnitude to four
2857	too small -- no lane nudge this pass
2859	move the direction sign into A
285a	mirror it against the flip byte
285c	load the lane record offset
285e	clear carry for the add
285f	add the object's current lane value
2861	wrapped below zero -- go set the lane to the top of the band (0x1a)
2863	compare against the high rail
2865	inside the band -- store it
2867	past the top -- clamp to 0
2869	go store the clamp
286b	past the bottom -- clamp to 0x1a
286d	store the object's new lane value
286f	return value 0 (skip the rest of the frame)
2871	return
2872	value 0x20
2874	arm the POKEY audio-control latch for a fresh round
2877	value 0x0c
2879	seed the first round countdown
287b	seed the second round countdown
287d	take one random snapshot byte
287f	seed the slot index from it
2881	mirror that seed to its first consumer
2883	mirror that seed to its second consumer
2885	value 2
2887	seed the first round step
2889	seed the second round step
288b	sweep index for seven timer cells
288d	value 0
288f	silence the POKEY serial/keyboard-control register
2892	clear one SFX timer-bank cell
2894	step the sweep index down
2895	loop for the whole SFX timer bank
2897	sweep index for six slot-table cells
2899	clear one slot-table cell
289b	step the sweep index down
289c	loop for the whole slot table
289e	read the POKEY random register
28a1	XOR a second read (self-cancelling mix)
28a4	clear carry for the add
28a5	fold it into the object counter
28a7	store the object counter
28a9	value 3
28ab	bring the POKEY serial-control register back up
28ae	rebuild the segment sprite tables
28b1	value 0xc0
28b3	arm the spawn timer
28b5	arm its first companion timer
28b7	arm its second companion timer
28b9	seed the segment spawn state
28bc	seed the wave state
28bf	value 0x0f
28c1	write the fixed playfield colour value
28c4	load the slot selector
28c6	value 0
28c8	clear this slot's angle/active cell
28ca	zero the palette-record index
28cb	fan the first palette record into the palette cells
28ce	zero the video-page index
28d0	value 0 to store
28d1	blank one byte of the first video page
28d4	blank the matching byte of the second page
28d7	blank the matching byte of the third page
28da	blank the matching byte of the fourth page
28dd	step to the next byte
28de	loop across all 256 bytes of the four pages
28e0	load the slot selector
28e2	clear this slot's per-column mushroom tally
28e4	value 0x1b
28e6	seed the cycling column stride
28e8	outer counter -- 46 columns to seed
28ea	read the POKEY random register
28ed	keep its top three bits
28ef	fold in the cycling column stride
28f1	store the mushroom cell pointer low byte
28f3	read the POKEY random register again
28f6	keep its low two bits
28f8	force the video-page bits
28fa	store the mushroom cell pointer high byte
28fc	stash the outer column counter
28fe	clear the cell index
2900	read the pointer low byte
2902	keep its low five column bits
2904	check the orientation flag
2906	upright -- take the low-threshold test
2908	compare the column against 0x14
290a	below it -- skip the tally bump
290c	at or above -- go test the cell
290e	compare the column against 0x0c
2910	at or above -- skip the tally bump
2912	read the cell at the mushroom pointer
2914	already occupied -- skip the tally bump
2916	load the slot selector
2918	bump this slot's per-column mushroom tally
291a	load the mushroom glyph base 0x3f
291c	fold in the orientation mask $ef so the mushroom mirrors for a flipped cabinet
291e	stamp the mushroom into the cell the random field pointer $8d/$8e is sitting on
2920	read the cycling column-stride byte $8b
2922	set carry for the subtract
2923	step the stride down by one
2925	has the stride fallen below 0x02?
2927	still 0x02 or more -- keep it
2929	wrapped -- reload the stride to 0x1b
292b	store the column stride back
292d	load the outer mushroom-column counter $8f
292f	step to the previous column
2930	more columns left -- loop back to the top of the mushroom sweep
2932	load the shot-start seed 0x10
2934	fold in orientation byte $f2 so the launch coord mirrors for a flipped cabinet
2936	seed the player/shot start cell $43
2938	load the screen-midline coordinate 0x80
293a	seed the $63-axis coordinate to the midline
293c	mirror the midline into $62
293e	load the shot-start seed 0x08
2940	fold in orientation byte $f0
2942	seed the $73-axis start cell
2944	load the start seed 0x0c
2946	fold in orientation byte $f1
2948	seed start cell $72
294a	load the start seed 0x11
294c	fold in orientation byte $f2
294e	seed start cell $42
2950	return from the shot/start seeding
2951	read the death/respawn countdown gate $87
2953	gate clear -- run the centipede segment sweep
2955	still counting down -- skip the sweep this frame
2956	seed the segment cursor at the last slot 0x0b
2958	read the frame counter $00
295a	keep its low nibble
295c	not a footstep frame -- drop straight into the mover
295e	load the marching-footstep interval 0x07
2960	arm the channel-2 SFX timer with the footstep tick
2962	read this slot's phase/state byte loc_34+x
2964	live segment (bit 7 clear) -- move it
2966	retired slot -- jump to the loop tail
2969	read the frame counter $00
296b	keep its low bit
296d	odd frame -- skip the phase bump
296f	read the phase byte again
2971	clear carry for the add
2972	bump the segment phase by one
2974	keep phase bit 3 clear
2976	store the advanced phase
2978	set Y to 1, the on-home-column marker value
297a	read the segment's coordinate loc_64+x
297c	fold in orientation $f0
297e	is the coordinate near the edge (below 0x09)?
2980	not near the edge -- skip the edge classification
2982	read the phase byte
2984	is the phase below 0x10?
2986	phase already 0x10 or more -- skip the flag
2988	flag this near-edge low-phase segment into loc_97
298a	reload the coordinate loc_64+x
298c	keep the low 3 bits of the coordinate
298e	not grid-aligned -- take the coordinate-advance path
2990	A = the home marker value 1
2991	load the active object slot index $88
2993	compare with the home-column flag loc_94 for this slot
2996	not on its home column -- skip the heading re-seed
2998	default heading delta +2
299a	test the current delta loc_44+x sign
299c	positive -- keep +2
299e	negative -- use -2 instead
29a0	store the re-seeded heading delta loc_44+x
29a2	default +2 for the other axis
29a4	test the link/delta loc_74+x sign
29a6	positive -- keep +2
29a8	negative -- use -2 instead
29aa	store the re-seeded link loc_74+x
29ac	read the phase byte
29ae	test bit 6, the distance-check branch flag
29b0	bit 6 clear -- take the wall-band branch
29b2	read the reference coordinate loc_63+x
29b4	set carry for the subtract
29b5	distance = loc_63+x minus loc_64+x
29b7	fold the distance to its magnitude
29ba	is the distance 8 or more?
29bc	too far -- take the coordinate-advance path
29be	near -- jump to advance the coordinate and arm
29c1	read the phase byte
29c3	test bit 5, the straight-to-edge shortcut flag
29c5	shortcut set -- take the coordinate-advance path
29c7	read the segment coordinate loc_54+x
29c9	near the high wall (0xf0 or more)?
29cb	below it -- check the low wall band
29cd	read the link loc_74+x
29cf	no link -- jump to reverse the delta and turn
29d1	read the delta loc_44+x
29d3	delta positive -- take the coordinate-advance path
29d5	delta negative -- probe the tile ahead
29d7	near the low wall (below 0x10)?
29d9	not near a wall -- probe the tile ahead
29db	read the link loc_74+x
29dd	link set -- check the delta sign
29df	jump to reverse the delta and step the coordinate
29e2	read the delta loc_44+x
29e4	delta negative -- take the coordinate-advance path
29e6	marshal this object's tile-probe inputs
29e9	resolve the tile cell the segment faces
29ec	empty cell -- run the column-collision check
29ee	occupied: below the solid band (below 0x38)?
29f0	not a wall tile -- take the coordinate-advance path
29f2	is the tile at or above 0x3c?
29f4	above the mushroom band -- take the coordinate-advance path
29f6	mushroom-band tile: read the phase byte
29f8	mark bit 5, the blocked-band diversion flag
29fa	store the phase
29fc	take the coordinate-advance path
29fe	test for another object blocking the column ahead
2a01	no collision -- jump to advance the coordinate and arm
2a03	read the coordinate loc_64+x
2a05	fold in orientation $f0
2a07	read the link loc_74+x
2a09	no link -- jump to reverse the delta and turn
2a0b	link positive -- take the forward-edge test
2a0d	read the direction selector $ef
2a0f	$ef zero -- take the plain band test
2a11	re-fold the coordinate with $f0
2a13	compare the folded coordinate against 0xc9
2a15	below -- take the link-negate tail
2a17	at or above -- take the coordinate-commit path
2a19	compare the folded coordinate against 0x30
2a1b	0x30 or more -- take the link-negate tail
2a1d	below -- take the coordinate-commit path
2a1f	folded coordinate near the edge (below 0x09)?
2a21	not near the edge -- take the coordinate-commit path
2a23	read the phase byte
2a25	test bit 6
2a27	bit 6 set -- take the link-negate tail
2a29	read the phase byte
2a2b	clear bit 5
2a2d	store the phase
2a2f	is this the last slot 0x0b?
2a31	yes -- take the link-negate tail
2a33	A = this slot index
2a34	Y = this slot index
2a35	step Y to the trailing neighbour slot
2a36	read the neighbour's phase loc_34[y]
2a39	neighbour retired -- take the link-negate tail
2a3b	test the neighbour's bit 6
2a3d	clear -- take the link-negate tail
2a3f	scanned all the way to the last slot?
2a41	yes -- fold this neighbour back
2a43	peek the slot-after-next's phase loc_35[y]
2a46	it is retired -- fold this neighbour back
2a48	test its bit 6
2a4a	bit 6 set -- skip to the next neighbour
2a4c	read the neighbour's coordinate loc_64[y]
2a4f	fold in orientation $f0
2a51	neighbour clear of the edge (0x09 or more)?
2a53	too far -- take the link-negate tail
2a55	read the neighbour's phase loc_34[y]
2a58	keep only its low 3 bits, clearing the flags
2a5a	store the cleared neighbour phase
2a5d	read the neighbour's heading delta loc_44[y]
2a60	negate the delta
2a63	store the negated neighbour delta
2a66	read the neighbour's coordinate loc_64[y]
2a69	snap it to the grid (clear the low 3 bits)
2a6b	store the snapped coordinate
2a6e	load zero
2a70	clear the neighbour's link loc_74[y]
2a73	always -- take the link-negate tail
2a75	step to the next neighbour slot
2a76	past the last slot 0x0c?
2a78	still in range -- keep scanning neighbours
2a7a	read this segment's link loc_74+x
2a7c	negate the link
2a7f	store the negated link
2a81	read the coordinate loc_64+x
2a83	read the direction selector $ef
2a85	$ef zero -- subtract the link
2a87	clear carry for the add
2a88	add the link loc_74+x into the coordinate
2a8a	jump to commit the coordinate
2a8d	set carry for the subtract
2a8e	subtract the link loc_74+x from the coordinate
2a90	commit the new coordinate loc_64+x
2a92	read the heading delta loc_44+x
2a94	clear carry for the add
2a95	add the delta into the segment coordinate loc_54+x
2a97	store the advanced coordinate
2a99	probe whether the segment is now in range to arm the slot
2a9c	slot armed -- this segment is done
2a9e	read the state field loc_64+x
2aa0	keep its low 3 bits
2aa2	is it the aligned value 4?
2aa4	not aligned -- step to the next segment
2aa6	read the heading delta loc_44+x
2aa8	negate it in place
2aab	store the flipped delta
2aad	read the link loc_74+x
2aaf	link already set -- step to the next segment
2ab1	set the flags from the flipped delta
2ab3	delta negative -- skip the negate
2ab5	take the negative magnitude of the delta
2ab8	seed the link loc_74+x with the negative magnitude
2aba	default coordinate nudge +4
2abc	test the flipped delta sign
2abe	positive -- keep +4
2ac0	negative -- nudge by -4 instead
2ac2	clear carry for the add
2ac3	nudge the coordinate loc_54+x by the chosen step
2ac5	store the nudged coordinate
2ac7	step the segment cursor to the previous slot
2ac8	ran past the first slot -- end the walk
2aca	otherwise move the next segment
2acd	return from the segment sweep
2ace	read the master enable $86
2ad0	non-negative -- run the axis integrator
2ad2	disabled -- return
2ad3	read the $43 control byte
2ad5	test its mode bits (mask 0xaf)
2ad7	any mode bit set -- return without integrating
2ad9	read the $73-axis coordinate
2adb	snapshot it into $8d
2add	read $fe
2adf	read the old $b9 delta
2ae1	swap $fe into $b9
2ae3	clamp and halve the old delta toward the playfield rails
2ae6	fold the halved magnitude into the $63-axis sub-step accumulator $84
2ae8	store the sub-step accumulator $84
2aea	A = the halved delta, falling into the $73-axis companion integrator
2aeb	fold the integer carry from the sub-step accumulator into the $63 coordinate
2aed	hold the new $63 coordinate in x
2aee	stash the coordinate into scratch $8b for the tile lookup
2af0	row index zero for the lookup
2af2	load the other-axis coordinate $73
2af4	resolve the tile cell the object would move onto
2af7	destination occupied -- keep the old $63 coordinate
2af9	recall the freshly computed $63 coordinate
2afa	test it against the upper playfield wall band
2afc	below the wall -- go check the lower clamp
2afe	pin the coordinate to the upper limit 0xf4
2b00	go store the clamped coordinate
2b02	test it against the lower playfield edge
2b04	at or above the edge -- store as-is
2b06	pin the coordinate to the lower limit 0x0b
2b08	go store the clamped coordinate
2b0a	blocked path -- reload the unchanged $63 coordinate
2b0c	write the settled $63 coordinate back
2b0e	read the pending-wave/round flag $86
2b10	still counting a round -- keep going
2b12	wave teardown pending -- drop out here
2b13	row index zero
2b15	read the carried delta $bb
2b17	clear $bb so the delta is consumed once
2b19	negate the delta magnitude
2b1c	clamp and halve the signed delta
2b1f	add it into the $73-axis sub-step accumulator $85
2b21	store the accumulator back
2b23	move the whole-step carry into a for the coordinate add
2b24	fold the integer carry into the $73 coordinate
2b26	hold the new $73 coordinate in x
2b27	load the $63 coordinate
2b29	stash it into scratch $8b for the tile lookup
2b2b	row index zero for the lookup
2b2d	resolve the tile cell the object would move onto
2b30	destination occupied -- keep the old $73 coordinate
2b32	recall the freshly computed $73 coordinate
2b33	test against the low wall band
2b35	below 0x08 -- pin to the low edge
2b37	test against the high wall band
2b39	at or above 0xf1 -- pin to the high edge
2b3b	is it in the lower half of the field
2b3d	yes -- go check the lower dead-band clamp
2b3f	upper half -- test the central dead band
2b41	clear of the dead band -- store as-is
2b43	snap up past the central dead band to 0xc8
2b45	go store the clamped coordinate
2b47	lower-half dead-band edge test
2b49	below the dead band -- store as-is
2b4b	snap down to the dead-band edge 0x30
2b4d	go store the clamped coordinate
2b4f	pin to the high edge 0xf0
2b51	go store the clamped coordinate
2b53	pin to the low edge 0x08
2b55	go store the clamped coordinate
2b57	blocked path -- reload the unchanged $73 coordinate
2b59	write the settled $73 coordinate back
2b5b	read the pending-wave/round flag $86
2b5d	still counting a round -- keep going
2b5f	wave teardown pending -- drop out here
2b60	load the head coordinate $72
2b62	read the direction selector $ef
2b64	selector zero -- take the other subtract path
2b66	prepare a clean subtract
2b67	subtract the step $8d from the head coordinate
2b69	no borrow -- retarget the head
2b6b	borrowed -- go measure the distance
2b6d	prepare a clean subtract
2b6e	subtract the step $8d from the head coordinate
2b70	borrowed -- retarget the head
2b72	fold the signed distance to a magnitude
2b75	compare the distance to the retarget threshold
2b77	far enough -- skip the retarget
2b79	start from a step of 4
2b7b	fold it with the direction sign $f0
2b7d	clear carry for the add
2b7e	add the $73 coordinate
2b80	set the head target coordinate $72
2b82	load the $63 coordinate
2b84	copy it into the $62 companion coordinate
2b86	read the movement state flag $43
2b88	mask the active-state bits
2b8a	none set -- nothing to arm
2b8c	arm value 0x28
2b8e	load it into the $42 timer cell
2b90	done
2b91	load the working tile pointer low byte
2b93	keep the column within the row (low five bits)
2b95	read the direction selector $ef
2b97	selector zero -- take the other range test
2b99	compare the column to the mid-row split 0x14
2b9b	before the split -- nothing to do
2b9d	past the split -- decrement the shot-origin cell
2b9f	compare the column to the near-edge limit 0x0c
2ba1	past it -- nothing to do
2ba3	load the slot index $88
2ba5	step the shot-origin cell $d7+slot down by one
2ba7	done
2ba8	row index zero
2baa	read the tile cell through the working pointer
2bac	cell already occupied -- leave it
2bae	take the tile pointer low byte
2bb0	keep the column within the row
2bb2	column at the left edge -- leave it
2bb4	compare against the right edge column
2bb6	column at the right edge -- leave it
2bb8	read the direction selector $ef
2bba	selector zero -- take the other edge test
2bbc	compare against the inner-edge column 0x1e
2bbe	on that edge -- leave it
2bc0	compare against the mid-row split 0x14
2bc2	before the split -- go stamp a mushroom
2bc4	past the split -- bump the shot-origin cell
2bc6	compare against column 1
2bc8	on column 1 -- leave it
2bca	compare against the near-edge limit 0x0c
2bcc	past it -- go stamp a mushroom
2bce	load the slot index $88
2bd0	bump the shot-origin cell $d7+slot up by one
2bd2	start from the mushroom glyph 0x3f
2bd4	fold it with the direction/colour $ef
2bd6	stamp the mushroom into the tile cell
2bd8	done
2bd9	read the spawner enable byte $97
2bdb	spawner disabled -- return
2bdd	read the busy byte $87
2bdf	busy this frame -- return
2be1	read the spawn interval timer
2be3	timer expired -- run the spawn
2be5	still counting -- tick the spawn timer down
2be7	nothing spawns mid-interval -- return
2be8	load the channel selector $88
2bea	scan the actor slots from the top slot 0x0b
2bec	read this actor slot's phase byte
2bef	sign set -- this slot is free, claim it
2bf1	step down to the next slot
2bf2	keep scanning for a free slot
2bf4	field full -- nothing spawns, return
2bf5	clear value
2bf7	claim the slot by zeroing its phase byte
2bfa	orientation base 0x40
2bfc	fold it with the direction sign $f0
2bfe	seed the new actor's coordinate field
2c01	motion seed 0xfc
2c03	seed the new actor's row field
2c06	motion seed 0x02
2c08	seed the new actor's step field
2c0b	read this channel's spawn-interval reload value
2c0d	still above the ratchet floor 0x60
2c0f	at or below the floor -- keep the reload as-is
2c11	ratchet the interval shorter by 8
2c13	write the shortened reload back
2c15	load the new interval into the spawn timer
2c17	read the hardware random register
2c1a	take its variant bit
2c1c	bit set -- take actor variant A
2c1e	variant B step 0x04
2c20	override the actor's row field for variant B
2c23	variant B mirrored delta 0xfe
2c25	seed the actor's delta field
2c28	bump this channel's spawn count
2c2a	done
2c2b	shift the coordinate right one
2c2c	shift it right again
2c2d	shift it a third time to divide by eight into a column
2c2e	round with the shifted-out carry
2c30	store it as the tile pointer low byte
2c32	page base 1
2c34	store it as the tile pointer high byte
2c36	move the passed row index into a
2c37	shift it left once
2c38	shift it left again
2c39	shift it a third time to scale the row by eight
2c3a	clear carry for the add
2c3b	add the stashed column offset $8b
2c3d	store the combined row/column offset back
2c3f	top-of-screen constant 0xf7
2c41	prepare a clean subtract
2c42	invert the offset for screen orientation
2c44	no borrow -- keep the inverted offset
2c46	underflowed -- floor the offset to zero
2c48	keep the row's high bits
2c4a	shift the row bits toward the pointer high byte
2c4b	rotate the carry into the pointer high byte
2c4d	shift again
2c4e	rotate the carry into the pointer high byte
2c50	fold the column back into the pointer low byte
2c52	load the pointer high byte
2c54	is the pointer in the last page (7)
2c56	no -- pointer is ready
2c58	within page 7, above the status region
2c5a	below it -- pointer is ready
2c5c	wrap the low byte within page 7
2c5e	steer it into the page-7 wrap window
2c60	store the final tile pointer low byte
2c62	row index zero
2c64	read the tile cell at the pointer
2c66	cell empty -- return zero
2c68	fold the occupied cell with the direction $ef
2c6a	return the cell reading
2c6b	stash object index x into $8b
2c6d	stash it into $8c as well
2c6f	step $8c to the next slot index
2c71	scan the object slots from the top slot 0x0c
2c73	read the other slot's column $64+y
2c76	compare it to this object's column
2c78	different column -- skip this slot
2c7a	read the other slot's phase byte
2c7d	compare against the retired marker 0xf4
2c7f	retired slot -- skip it
2c81	is this the object itself
2c83	yes -- skip it
2c85	read this object's row $54+x
2c87	prepare a clean subtract
2c88	subtract the other slot's row $54+y
2c8b	fold the gap with this object's delta sign
2c8d	compare the folded row gap to the band 0xf4
2c8f	within the band -- report a collision in this column
2c91	step the scan index down to the next slot and keep hunting a same-column neighbour
2c92	loop back while more slots remain to check
2c94	no neighbouring object shares this column -- clear carry
2c95	return
2c96	read object X's horizontal coordinate
2c98	set carry for the subtract
2c99	subtract the reference point's horizontal position
2c9b	take the absolute value of the horizontal distance
2c9e	is this the special last slot 0x0d?
2ca0	other slot -- use the ordinary horizontal bound
2ca2	slot 0x0d: horizontal magnitude must be under 0x0a
2ca4	within reach horizontally -- go test the vertical distance
2ca6	out of range -- return with carry set, no arming
2ca7	other slots: horizontal magnitude against the 0x07 bound
2ca9	too far horizontally -- bail
2cab	stash the horizontal magnitude
2cad	read object X's vertical coordinate
2caf	set carry for the subtract
2cb0	subtract the reference point's vertical position
2cb2	take the absolute value of the vertical distance
2cb5	vertical magnitude must clear 0x07
2cb7	too far vertically -- bail
2cb9	clear carry for the add
2cba	add the horizontal magnitude to form the summed distance
2cbc	is this the special last slot 0x0d?
2cbe	slot 0x0d -- route through the value-gated arm entry
2cc0	other slots: carry set when the summed distance is 0x0c or more
2cc2	caller gate: carry set means do not arm -- return
2cc4	load the countdown constant
2cc6	stamp 0x30 into the slot countdown timer
2cc8	load the state-cell constant
2cca	stamp 0x20 into the mode/state cell
2ccc	load the free marker
2cce	retire slot X's row byte to 0xff (slot free)
2cd0	load the arm constant
2cd2	stamp 0x28 into the arm cell
2cd4	read the master sign/enable cell
2cd6	negative -- skip arming the channel-1 priority tone
2cd8	load the tone-timer value
2cda	arm the channel-1 priority SFX timer to 0x13
2cdc	zero out the working cells that follow
2cde	clear the channel-1 background SFX timer
2ce0	clear the channel-2 SFX timer
2ce2	clear the channel-3 SFX timer
2ce4	clear the channel-4 SFX timer
2ce6	clear the sweep counter
2ce8	signal armed -- carry clear
2ce9	return
2cea	slot 0x0d gate: arm only when the summed distance is below 0x0e
2cec	fall into the arm block (carry set here blocks the arm)
2cef	clear Y as the indirect scan offset
2cf1	read the frame counter
2cf3	keep only the low three bits -- every eighth frame
2cf5	not this frame -- return
2cf7	check the channel-1 priority SFX timer
2cf9	priority tone busy -- skip the field scan
2cfb	read the field-scan pointer high byte
2cfd	zero high byte -- scan pass is over, return
2cff	sitting on the last video page (0x07)?
2d01	not the top page -- go read the cell
2d03	top page: read the scan pointer low byte
2d05	past the fold point 0xc0?
2d07	below the fold -- go read the cell
2d09	top-of-page reached -- zero the high byte, ending the pass
2d0b	return
2d0c	read the playfield cell at the scan pointer
2d0e	keep the low six bits (the tile code)
2d10	is the tile in the ripe band (0x38 or above)?
2d12	below the band -- advance to the next cell
2d14	upper edge of the ripe band
2d16	at or above 0x3f -- skip, advance
2d18	load the base glyph 0x3f
2d1a	fold the base glyph 0x3f through the $ef mask to build the mushroom glyph
2d1c	stamp the full mushroom glyph 0x3f (folded through $ef) into the scanned cell
2d1e	load zero
2d20	clear the path-accumulator step seed
2d22	load the step magnitude 0x05
2d24	fold the step into the path accumulator
2d27	load 0xff
2d29	set loc_3f to 0xff
2d2b	read the scan pointer high byte
2d2d	seed loc_8b with it
2d2f	read the scan pointer low byte
2d31	shift the address up one bit...
2d32	...rolling into the high part
2d34	shift up another bit...
2d35	...rolling into the high part
2d37	shift up a third bit...
2d38	...rolling into the high part
2d3a	stash the folded low part as a seed coordinate
2d3c	take the folded high part
2d3e	keep the low five bits (the column)
2d40	invert the column bits
2d42	scale the column up...
2d43	...by eight...
2d44	...three shifts left
2d45	bias the result down by three
2d47	store the seed vertical coordinate
2d49	advance the scan pointer low byte
2d4b	no carry -- skip the high-byte bump
2d4d	carry into the pointer high byte
2d4f	load the timer value 0x13
2d51	arm the channel-1 background SFX timer to 0x13
2d53	return
2d54	advance the scan pointer low byte
2d56	no carry -- loop back to test the next cell
2d58	carry into the pointer high byte
2d5a	keep scanning the next cell
2d5c	load the header row selector 7
2d5e	draw the record-field header row
2d61	Y = record cursor, start at zero
2d63	X = starting column base
2d65	seat the draw cursor low byte at the column base
2d67	load the high byte of the draw cursor
2d69	set the draw cursor high byte to 0x05
2d6b	read the record's first field
2d6e	save the record index
2d70	set carry to suppress a leading zero
2d71	print the first field as two digits
2d74	restore the record index
2d76	read the record's second field
2d79	print it as two digits, inheriting the leading-zero carry
2d7c	restore the record index
2d7e	read the record's third field
2d81	clear carry -- no leading-zero suppression
2d82	print the third field as two digits
2d85	load a blank
2d87	write a blank separator cell and advance the cursor
2d8a	restore the record index
2d8c	plot the record's first glyph byte
2d8f	advance the record index
2d91	reload the record index
2d93	plot the record's second glyph byte
2d96	advance the record index
2d98	reload the record index
2d9a	plot the record's third glyph byte
2d9d	read the advanced cursor low byte
2d9f	keep the column bits
2da1	set the bit that forms the next column base
2da3	move it into X as the next column base
2da4	back the base off by one
2da5	restore the record index
2da7	step to the next record
2da8	done all records at index 0x18?
2daa	more records -- loop for the next column
2dac	return
2dae	save the caller's index
2db0	load the active-object selector
2db2	tick this object's delay-bank entry down by one
2db4	restore the caller's index
2db6	read the enable/sign cell
2db8	disabled (negative) -- return
2dba	save the caller's index
2dbc	enter decimal (BCD) mode
2dbd	load the active-object selector
2dbf	clear carry for the add
2dc0	add the step into the accumulator low byte (BCD)
2dc2	store the low byte back
2dc4	read the accumulator mid byte
2dc6	add the step's high part (BCD)
2dc8	store the mid byte back
2dca	no decimal carry -- skip the companion roll
2dcc	carry: read the companion counter
2dce	step it down by two (BCD)
2dd0	store it back
2dd2	read the second companion counter
2dd4	clear carry
2dd5	bump it up by one (BCD)
2dd7	store it back
2dd9	leave decimal mode
2dda	reload the active-object selector
2ddc	read the accumulator mid byte
2dde	compare against the target low byte
2de0	read the accumulator high byte
2de2	finish the 16-bit compare against the target high byte
2de4	accumulator still below the target -- not there yet, return
2de6	fetch the table-step low byte and its index
2de9	enter decimal mode
2dea	clear carry
2deb	advance the target low byte by the table step (BCD)
2ded	store the target low byte
2def	read the target-step high byte from the config table
2df2	advance the target high byte (BCD)
2df4	store the target high byte
2df6	leave decimal mode
2df7	read the phase index
2df9	phase at 0x06?
2dfb	exactly 0x06 -- done, return
2dfd	phase past 0x06 -- out of range, spin here forever (the watchdog resets the board)
2dff	phase below 0x06 -- bump it
2e01	load the tone-timer value
2e03	arm the channel-2 priority SFX timer to 0x11
2e05	repaint the grid side borders
2e08	restore the caller's index
2e0a	return
2e0b	read the head's folded orientation
2e0d	fold it through the orientation mask
2e0f	at the top of the orientation range (0x34 or above)?
2e11	below the top -- continue
2e13	at the top -- guard the orientation wrap
2e16	within the narrow top band (0x30 or above)?
2e18	in the band -- go straight to the velocity-commit stage
2e1a	read the head's folded position
2e1c	fold it through the position mask
2e1e	near the top of the position range (0xf8 or above)?
2e20	not near the top -- skip the reseed
2e22	read the frame counter
2e24	only on the zero tick phase consider re-seeding the head
2e26	nothing to steer this tick -- jump to the shared return
2e29	load the active object slot index
2e2b	read that slot's centipede length counter
2e2d	compare the length against 0x0b
2e2f	segment already too long -- bail to the shared return
2e31	read the POKEY random register
2e34	keep the low two bits of the roll
2e36	roll did not permit a reseed -- bail
2e38	load 0x14
2e3a	stash it into the head cell $b8
2e3c	load a fresh orientation constant 0x30
2e3e	fold it with the orientation mask $ef
2e40	write the head's new orientation into $40
2e42	read the slot's width byte from the $ab table
2e44	compare width against 2
2e46	narrow slot -- take the small-velocity path
2e48	read the POKEY random register
2e4b	keep the low two bits
2e4d	roll withheld the wide step -- take the small-velocity path
2e4f	pick velocity magnitude 2 for the wide slot
2e51	test the random register's sign bit
2e54	sign clear -- keep the positive velocity and store it
2e56	sign set -- flip to velocity -2
2e58	go store the signed velocity
2e5a	pick velocity magnitude 1
2e5c	test the random register's sign bit
2e5f	sign clear -- keep the positive velocity
2e61	sign set -- flip to velocity -1
2e63	store the random small velocity into the head-velocity seed $50
2e65	load zero
2e67	clear the running head velocity $60
2e69	clear the shared column limit $80
2e6b	read the POKEY random register
2e6e	keep bits 6..3 of the roll
2e70	clear carry for the add
2e71	bias the random value up by 0x70
2e73	fold it with the orientation mask $f0
2e75	write the head's fresh random position into $70
2e77	read the $43 mode/control byte
2e79	mask its active mode bits
2e7b	a mode bit is live -- reseed the whole wave
2e7d	read the running head velocity $60
2e7f	load the direction selector $ef
2e81	selector zero -- add the seed velocity
2e83	set carry for the subtract
2e84	subtract the seed velocity $50 from the running velocity
2e86	go commit the new velocity
2e89	clear carry for the add
2e8a	add the seed velocity $50 onto the running velocity
2e8c	commit the head's new velocity into $60
2e8e	mirror the velocity into the $8b scratch cell
2e90	velocity nonzero -- advance the head's orientation
2e92	velocity zero -- reseed the wave
2e94	unfold the forwarded orientation byte with $ef
2e96	compare against the top of the orientation range 0xfa
2e98	orientation topped out -- return
2e9a	reseed the wave state
2e9d	read the frame counter $00
2e9f	keep its low two bits
2ea1	not the 4th tick -- skip the orientation rotate
2ea3	read the folded head orientation $40
2ea5	clear carry for the rotate
2ea6	rotate the orientation by one
2ea8	keep it within the low two bits
2eaa	fold it back into the 0x30..0x33 range
2eac	apply the orientation mask $ef
2eae	store the rotated orientation
2eb0	target row 0 for the cell probe
2eb2	load the head's position $70
2eb4	resolve the tile cell the head faces
2eb7	compare the cell against 0x40
2eb9	cell above the mushroom band -- return
2ebb	compare the cell against 0x3c
2ebd	cell below the mushroom band -- return
2ebf	clear a bit of the eaten-mushroom marker
2ec1	fold it with the orientation mask $ef
2ec3	stamp the marker into the cell -- the head eats the mushroom
2ec5	return
2ec6	read the head coordinate $72
2ec8	load the vertical selector $ef
2eca	selector zero -- skip the fold
2ecc	clear carry for the add
2ecd	bias the coordinate up by 7
2ecf	invert it to mirror the coordinate for the flipped orientation
2ed1	compare the coordinate against the top band 0xf3
2ed3	head off the top of the field -- exit through the shared tail
2ed5	load the row bias constant 0x04
2ed7	fold it with the orientation mask $f0
2ed9	clear carry for the add
2eda	add the biased row coordinate $73
2edc	compare it against the head coordinate $72
2ede	head not on its target row -- roll the head forward
2ee0	read the $43 state gate
2ee2	mask its active mode bits
2ee4	state busy -- drop the sweep into the spawn tick
2ee6	read the IN1 input port
2ee9	read the owner slot $86
2eeb	owner non-negative -- keep the input reading
2eed	owner negative -- read the POKEY random register instead
2ef0	is the selector 0xc0?
2ef2	no -- test the ordinary control bit
2ef4	test bit 3 of the probe
2ef6	bit clear -- arm the footstep sound
2ef8	bit set -- drop into the spawn tick
2efa	test bit 2 of the probe
2efc	bit clear -- arm the footstep sound
2efe	drop the sweep into the spawn-cadence tick
2f01	load the channel-3 SFX reload value 0x0b
2f03	arm the channel-3 SFX timer $b4
2f05	read the prior row coordinate $62
2f07	publish it into the $8b scratch cell
2f09	load the step constant 0x07
2f0b	fold it with the orientation byte $f4
2f0d	stash the current head coordinate $72 in Y
2f0f	clear carry for the add
2f10	step the head coordinate forward by $72
2f12	write the advanced head coordinate back to $72
2f14	publish the prior head coordinate into $8d
2f16	load the row-step constant 0x01
2f18	fold it with the orientation byte $f3
2f1a	clear carry for the add
2f1b	add the prior coordinate $8d
2f1d	target row 0 for the cell probe
2f1f	resolve the destination grid cell ahead of the head
2f22	destination empty -- continue into the per-segment router
2f24	keep the low six bits of the occupied cell
2f26	compare against the boundary band 0x38
2f28	below the band -- exit through the shared tail
2f2a	drop the cell code by one
2f2c	is it boundary code 0x3b?
2f2e	yes -- take the boundary-cell special path
2f30	is it boundary code 0x37?
2f32	no -- skip straight to the stamp
2f34	load zero
2f36	clear the step cell $8b
2f38	load 1 for the accumulator step
2f3a	roll the path accumulator forward
2f3d	target row 0
2f3f	load the orientation mask $ef
2f41	fold the stamp byte with $ef
2f43	stamp the cell empty through the working tile pointer
2f45	stamp nonzero -- exit through the shared tail
2f47	cell blanked -- decrement the matching mushroom tally
2f4a	jump to the shared exit-tail routine
2f4d	seed the segment index at the last slot 0x0d
2f4f	read this slot's coordinate from the $34 array
2f51	compare against the coarse X-band lower rail 0x76
2f53	below the near band -- take the range test
2f55	compare against 0xb9
2f57	inside the far dead band -- skip this slot
2f59	compare against the top rail 0xf8
2f5b	off the top -- skip this slot
2f5d	read the slot's column coordinate from the $64 array
2f5f	fold it with the orientation mask $f0
2f61	compare the folded column against 0xf8
2f63	off the horizontal edge -- skip this slot
2f65	unfold the column back
2f67	set carry for the subtract
2f68	take the horizontal distance to the head $72
2f6a	fold that distance to its magnitude
2f6d	hold the horizontal distance in Y
2f6e	is this the active head slot 0x0c?
2f70	no -- take the ordinary near-window test
2f72	read the slot coordinate again
2f74	fold it with the orientation mask $ef
2f76	compare against 0x20
2f78	coordinate high -- take the ordinary near-window test
2f7a	read the shared column limit $80
2f7c	fold it with the orientation mask $f0
2f7e	compare against 4
2f80	limit low -- take the ordinary near-window test
2f82	compare the horizontal distance against 7
2f84	too far horizontally -- skip this slot
2f86	within range -- go to the vertical distance test
2f88	compare the horizontal distance against 5
2f8a	too far horizontally -- skip this slot
2f8c	read the slot's row coordinate from the $54 array
2f8e	set carry for the subtract
2f8f	take the vertical distance to the reference $62
2f91	fold that distance to its magnitude
2f94	hold the vertical distance in Y
2f95	is this the last slot 0x0d?
2f97	yes -- take the ballistic finish
2f99	is this a trailing slot (X below 0x0c)?
2f9b	yes -- take the trailing-slot handler when the slot is below 0x0c
2f9d	read the head-slot coordinate again
2f9f	fold it with the orientation mask $ef
2fa1	compare against 0x20
2fa3	coordinate high -- take the wider vertical gate
2fa5	compare the vertical distance against 6
2fa7	too far vertically -- skip this slot
2fa9	set the collision result index to 2
2fab	load 4
2fad	compare 4 against the shared column limit $80
2faf	already at the limit -- go seed the mover
2fb1	bump the shared column limit $80 to 4
2fb3	branch to the shared exit-tail routine
2fb5	compare the vertical distance against 0x0a
2fb7	too far vertically -- skip this slot
2fb9	set the collision result index to 0x10
2fbb	jump to the mover seed
2fbe	last slot: is the vertical distance under 0x0a?
2fc0	yes -- take the ballistic finish
2fc2	skip this slot -- jump to the slot-loop step
2fc5	seed the shot origin cell $d7 to 0xb6
2fc7	stash 0xb6 into the shot origin $d7
2fc9	set the redraw index to 3
2fcb	read the fired-from coordinate $71
2fcd	set carry for the subtract
2fce	subtract $73 to form the fired distance
2fd0	fold the fired distance to its magnitude
2fd3	compare against 0x40
2fd5	long shot -- take the far ballistic branch
2fd7	bump the shot origin $d7
2fd9	set the redraw index to 9
2fdb	compare the fired distance against 0x16
2fdd	short shot -- take the near ballistic branch
2fdf	bump the shot origin $d7 again
2fe1	set the redraw index to 6
2fe3	load 0x80 to arm the ballistic-shot sweep cells
2fe5	arm the shot sweep cell 0x9f
2fe7	arm the companion sweep cell 0xa1
2fe9	load zero to silence the channel-4 footstep timer
2feb	silence the channel-4 SFX timer 0xb5
2fed	load the high vertical rail 0xf0
2fef	compare it against the shared vertical limit 0x61
2ff1	limit sits above 0xf0 -- go clamp it down
2ff3	load the low vertical rail 0x10
2ff5	compare it against the vertical limit 0x61
2ff7	limit already inside the band -- skip the clamp store
2ff9	store the clamped vertical limit back into 0x61
2ffb	limit is nonzero -- head on into the path advance
2ffd	is the vertical distance 6 or beyond?
2fff	past the trailing range -- step the slot loop
3001	load zero
3003	clear the scratch step cell 0x8b
3005	preset the step addend to 0x10
3007	read this slot's phase byte 0x34,x
3009	isolate the bit-6 heading flag
300b	flag set -- keep the 0x10 step
300d	clear the step addend to zero instead
300f	bump the scratch step cell 0x8b
3011	move the chosen step addend into A
3012	tick this active object's spawn delay down
3015	is X at slot 0x0b?
3017	head slot -- skip the heading-bit clear
3019	read the slot's heading byte 0x35,x
301b	already negative -- leave it be
301d	clear bit 6 of the heading byte
301f	store the cleared heading back
3021	marshal this object's tile-probe inputs
3024	resolve the grid cell under the object
3027	stash the slot index across the stamp
3029	stamp a mushroom into the empty cell
302c	restore the slot index
302e	jump into the row-redraw tail
3031	step the segment cursor to the previous slot
3032	ran past the first slot -- end the sweep at the cadence tick
3034	loop back to route the next segment slot
3037	stash the row step addend into 0x8b
3039	seed the path accumulator with zero
303b	advance the segment's BCD path toward its target
303e	load the channel-1 effect arm value 0x13
3040	arm the channel-1 effect timer 0xb2
3042	load the slot-retired marker 0xff
3044	retire slot X's row byte (high bit set frees it)
3046	run the 0x72/0x62 zero-page fixup
3049	load the active-object slot selector 0x88
304b	read this slot's spawn-tally byte 0x94,x
304d	fold in the shared arm byte 0x87
304f	both clear -- slot is idle, go advance its phase
3051	read the folded timing key 0x41
3053	fold it against the orientation mask 0xef
3055	is the timing key at least 0x9c?
3057	below threshold -- nothing due, return
3059	tick the shared segment-spawn countdown 0x9f down
305b	countdown not yet spent -- return
305d	countdown hit zero -- seed the next segment spawn
3060	return from the cadence tick
3061	step this idle slot's phase counter 0x9c,x
3063	load the arm value 0x40
3065	re-arm the shared gate byte 0x87
3067	return from the phase advance
3068	read the master audio flag 0x86
306a	audio is live -- go drive the voices
306c	load zero for the mute
306e	zero the channel-1 volume register
3071	zero the channel-2 volume register
3074	zero the channel-3 volume register
3077	zero the channel-4 volume register
307a	all voices muted -- return
307b	read the frame counter 0x00
307d	shift the low bit into carry (odd/even frame)
307e	even frame -- skip the channel-4 voice
3080	read the channel-4 footstep timer 0xb5
3082	move it into A to test
3083	timer spent -- leave channel 4 silent
3085	tick the channel-4 timer down
3087	not yet zero -- emit its current step
3089	load the channel-4 reload value 0x14
308b	reload the free-running channel-4 timer
308d	fetch this step's channel-4 frequency from ROM
3090	write it to the channel-4 frequency register
3093	fetch this step's channel-4 volume from ROM
3096	write the channel-4 volume (or silence)
3099	read the channel-3 timer 0xb4
309b	move it into A to test
309c	timer spent -- leave channel 3 silent
309e	tick the channel-3 timer down
30a0	fetch this step's channel-3 frequency from ROM
30a3	write it to the channel-3 frequency register
30a6	load the fixed channel-3 volume 0x64
30a8	write the channel-3 volume
30ab	read the channel-2 pitched pre-empt timer 0xb6
30ad	pre-empt idle -- fall to the collision decision
30af	read the frame counter 0x00
30b1	gate on every eighth frame
30b3	not this frame -- leave channel 2 alone
30b5	tick the pitched pre-empt timer down
30b7	pre-decrement its table index
30b8	pre-empt just expired -- release to the decision
30ba	fetch the pitched-effect value from the 0x31af table
30bd	write it to the channel-2 frequency register
30c0	load the pitched-effect volume 0xa4
30c2	go store the channel-2 volume
30c4	read the channel-2 skitter sweep counter 0xb8
30c6	step the sweep counter down
30c7	not wrapped -- keep going
30c9	reload the free-running sweep counter to 0x14
30cb	store the sweep counter back
30cd	fetch the sweep value from the 0x31c0 table
30d0	write it to the channel-2 frequency register
30d3	load the sweep volume 0xa4
30d5	go store the channel-2 volume
30d7	read the head position 0x70
30d9	fold it against the orientation byte 0xf0
30db	is the folded position at the top band 0xf8?
30dd	near the wall -- play the ordinary channel-2 effect
30df	read the state gate 0x43
30e1	mask its mode bits
30e3	a mode bit is set -- play the ordinary channel-2 effect
30e5	read the head orientation 0x40
30e7	fold it against the orientation mask 0xef
30e9	is the orientation at 0x34 or more?
30eb	yes -- play the ordinary channel-2 effect
30ed	is it at least 0x20?
30ef	in the 0x20..0x34 band -- play the skitter sweep
30f1	read the head position 0x70
30f3	fold it against 0xf4 for a noise pitch
30f5	halve it
30f6	complement it
30f8	force the top bit so the noise stays high-register
30fa	write the noise pitch to the channel-2 frequency register
30fd	load the noise volume 0xa4
30ff	go store the channel-2 volume
3101	read the channel-1 background timer 0xb2
3103	move it into A to test
3104	timer spent -- leave channel 1 silent
3106	tick the channel-1 background timer down
3108	fetch this step's channel-1 frequency from ROM
310b	write it to the channel-1 frequency register
310e	fetch this step's channel-1 volume from ROM
3111	write the channel-1 volume (or silence)
3114	return -- channel 1 done
3115	read the channel-2 collision timer 0xb3
3117	move it into A to test
3118	timer spent -- silence channel 2
311a	tick the channel-2 collision timer down
311c	fetch this step's channel-2 frequency from ROM
311f	write it to the channel-2 frequency register
3122	fetch this step's channel-2 volume from ROM
3125	write the channel-2 volume (or silence)
3128	read the channel-1 priority timer 0xb7
312a	priority idle -- use the plain background voice
312c	read the frame counter 0x00
312e	gate the priority effect on every fourth frame
3130	not this frame -- return
3132	tick the channel-1 priority timer down
3134	pre-decrement its table index
3135	priority effect spent -- return
3137	fetch this step's channel-1 frequency from ROM
313a	write it to the channel-1 frequency register
313d	fetch this step's channel-1 volume from ROM
3140	volume is zero -- store it as-is
3142	clear carry for the volume bump
3143	nudge the priority volume up by 2 (louder than background)
3145	write the channel-1 priority volume
3148	return from the sound update
31d5	load zero for the low pointer byte
31d7	seat the tile pointer low byte at 0
31d9	load the video base page 0x04
31db	seat the tile pointer high byte at page 4
31dd	clear the scratch column index
31df	load zero
31e1	clear the packed column-mask accumulator 0x8b
31e3	save the row-start position into 0x8e
31e5	count eight tiles per column group
31e7	read one tile cell through the pointer
31e9	keep only the low six bits (glyph code)
31eb	compare against the solid glyph band 0x38
31ed	roll the solid/blank bit into the mask 0x8b
31ef	step to the next tile
31f0	count this tile off
31f1	loop for the whole eight-tile group
31f3	load the scratch column index
31f5	read the buffered column from the 0x0100 scratch
31f8	advance the scratch column index
31fa	hold the old buffered byte
31fb	load the freshly packed mask
31fd	store the new mask into the column scratch
3200	move the old buffered byte in to be written out
3202	restore the row-start position
3204	count eight tiles per column group
3206	load a blank tile
3208	roll the top bit of the swapped-in mask into carry
320a	bit clear -- write the blank
320c	load the solid glyph 0x3f
320e	fold it against the orientation mask for the solid tile
3210	write the tile (blank or solid) back through the pointer
3212	step to the next tile
3213	count this tile off
3214	loop for the whole eight-tile group
3216	move the pointer low position into A
3217	not wrapped past zero -- skip the page bump
3219	page the pointer high byte up on the row wrap
321b	has the low pointer reached 0xc0?
321d	no -- go pack the next group
321f	read the pointer high byte
3221	has it reached page 7?
3223	not the last page -- keep transposing
3225	whole grid covered -- return
3226	compare the signed delta against the low rail 0x08
3228	below 0x08 -- pass the extreme through untouched
322a	compare against the high rail 0xf8
322c	at or above 0xf8 -- pass the extreme through
322e	test which half the delta lies in
3230	load the low rail 0x08
3232	delta below 0x80 -- fold to the low rail
3234	delta at or above 0x80 -- fold to the high rail 0xf8
3236	compare the clamped delta against 0x80 to capture its sign bit in carry
3238	rotate right -- arithmetic halve of the delta, copying the sign back into bit7
3239	park the halved delta in Y for the caller's accumulate
323a	clear A to build the dropped-fraction byte
323c	rotate the bit shifted out of the halve into A's top bit -- the carried sub-pixel fraction
323d	return with the halved delta in Y and the fraction in A, carry left clear for the follow-on add
323e	load 0xff to mark the object-table high-water cells
3240	seed the object loop index to the second object (X=1)
3242	stamp the high-water mark loc_c1 to 0xff
3244	stamp the high-water mark loc_c2 to 0xff
3246	enter decimal mode for the BCD rate accumulators
3247	read the low byte of the frame delta loc_fb
3249	clear carry before the multi-byte add
324a	add it into the wide rate accumulator low byte
324d	store the wide accumulator low byte
3250	read the frame delta high byte loc_fc
3252	add it with carry into the next accumulator byte
3255	store it
3258	read the wide accumulator byte loc_0190
325b	propagate the carry up
325d	store it
3260	read the wide accumulator top byte loc_0191
3263	propagate the carry up
3265	if the wide accumulator overflowed its top, skip advancing the narrow one
3267	store the wide accumulator top byte
326a	read the narrow rate accumulator low byte loc_018b
326d	clear carry
326e	add the score rate loc_89 into it
3270	store the narrow accumulator low byte
3273	read the narrow accumulator byte loc_018c
3276	propagate the carry up
3278	store it
327b	read the narrow accumulator top byte loc_018d
327e	propagate the carry up
3280	store it
3283	leave decimal mode
3284	begin the record scan at the head of the object table
3286	read the record's low key byte at loc_02+y
3289	compare it against the object's low field loc_a8+x
328b	read the record's middle key byte loc_03+y
328e	subtract the object's middle field loc_aa+x with borrow
3290	read the record's high key byte loc_04+y
3293	subtract the object's high field loc_ac+x with borrow
3295	record key smaller than the object -- insert the object at this slot
3297	step to the next 3-byte record
3298	step over the second key byte
3299	step over the third key byte
329a	reached the end of the 0x18-byte table?
329c	no -- keep scanning for the insertion slot
329e	move to the previous object
329f	loop while objects remain
32a1	read the high-water mark loc_c2
32a3	negative (unused) -- skip the clamp
32a5	compare it against loc_c1
32a7	below loc_c1 -- skip the clamp
32a9	bump the mark forward by one record (three bytes; carry is set here so +2 becomes +3)
32ab	reached the 0x18 record cap?
32ad	below the cap -- keep the mark
32af	else clamp the mark to 0xff
32b1	store the updated high-water mark loc_c2
32b3	clear A
32b5	clear loc_c0
32b7	read the high-water mark loc_c2
32b9	AND it with loc_c1
32bb	either mark non-negative -- skip the grid redraw
32bd	clear A
32bf	clear loc_01 before redrawing
32c1	redraw the whole record grid via plotRecordFieldColumns
32c4	return
32c5	save the object index for the insert
32c7	save the insertion point index
32c9	record the insertion point into the loc_c1+x high-water cell
32cb	start shifting from the top record (index 0x17)
32cd	read the record byte at loc_17+x
32cf	move it up one 3-byte record to loc_1a+x
32d1	read the parallel key byte just below the table base
32d4	move it up one record to loc_02+x
32d6	step down one byte
32d7	reached the insertion point?
32d9	no -- keep shifting records up
32db	load 1 to seed the vacated head record
32dd	write 01 into the freed record's first byte
32df	clear A
32e1	write 00 into the freed record's second byte
32e3	write 00 into the freed record's third byte
32e5	clear the trackball accumulator loc_b9
32e7	restore the object index
32e9	read the object's high key byte loc_ac+x
32eb	write it into the freed slot's high key
32ee	read the object's middle key byte loc_aa+x
32f0	write it into the freed slot's middle key
32f3	read the object's low key byte loc_a8+x
32f5	write it into the freed slot's low key
32f8	load the inserted flag value 0xf0
32fa	flag loc_01 that a record was inserted
32fc	go back to advance the object loop
32fe	load the score-row cursor low mask 0x1f
3300	fold in the flip byte loc_f5
3302	seed the draw cursor low byte loc_91
3304	load the cursor high mask 0x04
3306	fold in the flip byte loc_f7
3308	seed the draw cursor high byte loc_92
330a	read the object's high coordinate byte loc_ac
330c	set carry -- digit mode with leading-zero blanking
330d	plot it as two decimal digits (plotByteAsTwoDigits)
3310	read the object's middle coordinate byte loc_aa
3312	plot it as two digits, carry threaded from the prior pair
3315	read the object's low coordinate byte loc_a8
3317	clear carry so the final pair prints plain
3318	plot it as two digits
331b	read the slot count loc_89
331d	decrement it
331e	if only one slot, skip the second object
3320	load the second object's cursor high mask 0x07
3322	fold in the flip byte loc_f7
3324	seed the cursor high byte loc_92
3326	load the cursor low mask 0x1f
3328	fold in the flip byte loc_f5
332a	seed the cursor low byte loc_91
332c	read the second object's high coordinate loc_ad
332e	set carry -- digit mode
332f	plot it as two digits
3332	read the second object's middle coordinate loc_ab
3334	plot it as two digits
3337	read the second object's low coordinate loc_a9
3339	clear carry
333a	plot it as two digits
333d	load the score-line cursor low mask 0x9f
333f	fold in the flip byte loc_f5
3341	seed the draw cursor low byte loc_91
3343	load the cursor high mask 0x05
3345	fold in the flip byte loc_f7
3347	seed the draw cursor high byte loc_92
3349	read the score high byte loc_04
334b	set carry -- digit mode
334c	plot it as two digits
334f	read the score middle byte loc_03
3351	plot it as two digits
3354	read the score low byte loc_02
3356	clear carry for the final pair
3357	tail into the two-digit plotter for the last pair
335e	preload the column cursor to the last column (index 2)
3360	read input port IN1 for the per-column control bits
3363	which column is this?
3365	column 1 -- take the two-shift path toward bit 6
3367	column 2 -- take the single-shift path toward bit 7
3369	column 0 -- one extra shift so bit 5 becomes the control bit
336a	shift again toward the selected control bit
336b	shift the per-column control bit out into carry
336c	load this column's body/step cell SEGMENT_COL_BODY (0xcf array)
336e	keep the low 5-bit step index
3370	control bit set -- take the wrap/reset branch
3372	step index already zero -- store it unchanged
3374	step index past 0x1b?
3376	yes -- back it off by one toward the clamp
3378	stash the step index in Y
3379	read the movement frame counter SEGMENT_MOVE_FRAME_COUNTER (0xd4)
337b	keep its low 3 bits
337d	are they all set -- every 8th frame?
337f	restore the step index into A
3380	not the 8th frame -- store the step unchanged
3382	nudge the step index back toward its clamp by one
3384	store the updated body/step cell
3386	read input port IN1 again
3389	isolate bit 4
338b	bit 4 set -- skip refilling the reload timer
338d	load the reload value 0xf0
338f	refill the shared reload timer SEGMENT_RELOAD_TIMER (0xd2)
3391	read the reload timer
3393	timer resting at zero -- nothing to blank
3395	count the reload timer down
3397	load zero
3399	blank this column's body cell
339b	blank this column's life slot SEGMENT_COL_LIFE_TIMER (0xcc array)
339d	clear the motion-contribution carry
339e	read this column's life timer
33a0	life timer already zero -- no motion this pass
33a2	count the life timer down
33a4	not yet zero -- no motion this pass
33a6	life timer hit zero this pass -- set the contribution carry
33a7	take the motion-contribution path
33a9	step index past 0x1b?
33ab	yes -- clamp the body to 0x1f
33ad	reload the full body/step cell
33af	add 0x20 to advance one wrap unit
33b1	no carry out -- store the wrapped value
33b3	wrapped exactly to zero -- clamp to 0x1f
33b5	else clear carry for the plain store
33b6	load the clamp value 0x1f
33b8	carry set -- store the clamp value
33ba	store 0x1f into the body/step cell
33bc	read this column's life timer
33be	timer zero -- reload it fresh
33c0	else mark a motion contribution
33c1	load the life-timer reload value 0x78
33c3	load the life timer directly to 0x78
33c5	no contribution this pass -- skip the accumulate
33c7	start the per-column row delta at 0
33c9	which column is this?
33cb	column 0 -- leave the row delta at 0
33cd	column 1 -- derive the delta from bit 4 of loc_d3
33cf	column 2 -- read the phase cell loc_d3
33d1	keep bits 3-2
33d3	shift them down
33d4	down to a small row delta
33d5	zero -- no add
33d7	else bias the row delta by 2
33d9	go accumulate the row delta
33db	column 1 -- read the phase cell loc_d3
33dd	keep bit 4
33df	clear -- leave the row delta at 0
33e1	set -- row delta of 1
33e3	set carry so the fold adds delta+1
33e4	save the row delta on the stack
33e5	fold row-delta+1 into SEGMENT_MOVE_ACCUM (0xca)
33e7	store the shared movement accumulator
33e9	restore the row delta
33ea	set carry so the fold adds delta+1
33eb	fold row-delta+1 into the parallel accumulator SEGMENT_MOVE_ACCUM_B (0xc9)
33ed	store the second movement accumulator
33ef	bump this column's progress counter in the loc_c5 array
33f1	step the column cursor down to the next centipede body column
33f2	past the first column -- go measure the movement accumulator
33f4	more columns left -- loop back to walk the next body column
33f7	read the row-phase byte that says which row the creature is crossing
33f9	shift the phase down
33fa	shift again
33fb	shift again
33fc	shift again
33fd	five shifts leave the row-phase index (phase >> 5)
33fe	hold that as the row index into the threshold table
33ff	read the segment-movement accumulator
3401	prep for the subtract
3402	subtract this row's crossing threshold from the accumulator
3405	still short of the threshold -- leave the accumulator and fall to the phased tail
3407	threshold met -- commit the reduced accumulator
3409	bump the row-crossing counter: the creature has stepped one row down
340b	is this the top row (index 3)?
340d	not the top row -- go do the phased bookkeeping
340f	top row -- bump the crossing counter a second time so the top row marches faster
3411	off to the phased tail (a wrap to zero here would fall through as the table guard)
341b	read the row-phase byte
341d	keep the low two phase bits
341f	hold the phase as the sub-step selector
3420	phase 0 -- no sub-step to subtract, go store the accumulator
3422	halve the phase
3423	round the sub-step up with the carry (yields 0, 1, or 1->2)
3425	one's-complement the sub-step to set up the subtract
3427	prep for the subtract
3428	subtract the sub-step from the accumulator low byte
342a	no borrow -- skip the high byte
342c	borrow -- pull it out of the accumulator high byte
342e	underflow past zero -- floor the accumulator so motion never runs backward
3430	store the accumulator high byte
3432	low byte becomes zero at the floor
3434	was the phase 2 or more?
3436	phase 2+ -- take only one wrap-counter bump
3438	lower phase -- bump the wrap counter an extra time
343a	bump the wrap counter
343c	store the accumulator low byte
343e	tick the free-running segment movement frame counter
3440	read the frame counter back
3442	shift out its low bit
3443	odd frame -- nothing more to normalise this pass, return
3445	clear the change tally for the normalise sweep
3447	start at the last of the three column progress cells
3449	read this column's progress cell
344b	empty -- skip it
344d	is it 0x10 or more?
344f	below 0x10 -- skip it
3451	subtract 0x10 to fold the progress cell into the 0x10 grid
3453	count that this cell changed
3454	store the folded progress value back
3456	step to the previous progress cell
3457	loop over all three columns
3459	pull the change tally into A
345a	pass 1 changed something -- done for this frame
345c	nothing changed -- run pass 2 from the last progress cell
345e	read this column's progress cell
3460	empty -- skip it
3462	prep for the subtract
3463	subtract 0x11 from the nonzero progress cell
3465	store it back
3467	result went negative -- stop the sweep here
3469	step to the previous progress cell
346a	loop over the progress cells
346c	done -- return
37d5	double the row selector
37d6	rotate the carry into the sign latch (marks whether the row should be blanked)
37d8	hold the selector as an index
37d9	double it again
37da	stash the doubled selector
37dc	read the config/mode byte
37de	keep its low two bits (the ROM table variant)
37e0	fold the variant into the selector
37e2	double for a word-sized table stride
37e3	hold as the descriptor-table index
37e4	read the row descriptor's pointer low byte from the ROM table
37e7	store the descriptor pointer low byte
37e9	read the descriptor's pointer high byte
37ec	store the descriptor pointer high byte
37ee	start at descriptor offset 0
37f0	read the direction selector
37f2	selector clear -- use the first destination pair
37f4	selector set -- use the second destination pair (offset 2)
37f6	read the screen destination low byte from the descriptor
37f8	seat the draw cursor low byte
37fa	step to the next descriptor byte
37fb	read the screen destination high byte
37fd	seat the draw cursor high byte
37ff	skip to offset 4 -- the start of the row's text bytes
3801	remember the current text-byte index
3803	load the text-byte index
3805	read a character code from the descriptor row
3807	mask to the 6-bit glyph code
3809	is it a space?
380b	space -- blank this cell
380d	read the sign latch
380f	positive -- keep the character
3811	blank glyph
3813	glyph code 0x30 or above?
3815	below -- keep it
3817	fold the high glyph code down into range
3819	write the glyph and step the draw cursor along the row
381c	reload the text-byte index
381e	advance to the next character
3820	re-read the original descriptor byte
3822	high bit clear -- more of the row to write, loop
3824	high bit marks end of the row -- return
3825	start at offset 0
3827	clear the sign latch so no cell gets blanked
3829	jump into the row writer to redraw the row unblanked
382b	already positive -- nothing to negate, return
382d	one's-complement the value
382f	prep for the add
3830	add one -- the two's-complement negation
3832	return the (possibly negated) value
3833	read a byte from the zero-page table indexed by Y
3836	test the glyph value
3837	zero -- write it straight through
3839	fold the glyph with the direction selector (flips its attribute)
383b	write into cell offset 0
383d	poke the glyph into the cell the draw cursor points at
383f	stride of 0x20 -- one step along the row/column
3841	fold the stride with the direction selector
3843	prep for the add
3844	add the stride to the draw cursor low byte
3846	store the draw cursor low byte
3848	read the high stride
384a	carry it into the draw cursor high byte
384c	store the draw cursor high byte
384e	return
384f	save the byte to plot
3850	save the carry (leading-zero suppression flag)
3851	shift the high nibble down
3852	shift again
3853	shift again
3854	four shifts leave the tens digit
3855	restore the suppression flag
3856	plot the tens digit
3859	restore the whole byte
385a	keep the units nibble
385c	carry clear -- plot this digit
385e	keep the low nibble
3860	leading zero -- suppress it (skip the cell)
3862	prep the digit
3863	map the digit value to its glyph code
3865	save the carry
3866	glyph code 0x2a or above?
3868	below -- keep it
386a	fold the high code down into range
386c	write the digit glyph and step the draw cursor
386f	restore the carry
3870	return
3871	save A across the frame interrupt
3872	move X into A
3873	save X
3874	move Y into A
3875	save Y
3876	clear decimal mode for the ordinary bookkeeping
3877	read the shared segment reload timer
3879	timer idle -- skip the tone poke
387b	tone value 0x10
387d	write it to the POKEY channel-2 frequency register
3880	control value 0xaf
3882	write it to the POKEY channel-2 control register (sound the marching tone)
3885	test the vblank/service input port
3888	vblank edge present -- service this frame
388a	no vblank yet -- jump to the trackball accumulate and return from interrupt
388d	bump the frame heartbeat latch the main loop waits on
388f	step the low frame counter
3891	no carry -- skip the high byte
3893	carry into the high frame counter
3895	set decimal mode for the BCD add
3896	read the BCD time counter low byte
3898	prep for the add
3899	add one in BCD
389b	store the time counter low byte
389d	read the time counter high byte
389f	carry into it
38a1	store the time counter high byte
38a3	back to binary mode
38a4	read the frame heartbeat latch
38a6	compare against 8
38a8	spin here while the latch is 8 or more -- wait for the main loop to catch up
38aa	read the wrap counter
38ac	compare against 0x25
38ae	spin here while the wrap counter is 0x25 or more
38b0	is the wrap counter 0x13 or more?
38b2	below -- skip the clamp
38b4	clamp value 0x12
38b6	store the clamped wrap counter
38b8	read the current slot index
38ba	read input port IN3
38bd	is this slot 2?
38bf	no -- take the trackball reading as-is
38c1	shift the low nibble up
38c2	shift again
38c3	shift again
38c4	four shifts align the alternate trackball axis into the high nibble
38c5	read the axis-0 trackball step state
38c8	step the trackball axis from its selector bits
38cb	store the updated axis-0 step state
38ce	save the axis-0 delta
38cf	move the step into A
38d0	prep for the add
38d1	accumulate the axis-0 trackball delta
38d3	store the axis-0 accumulator
38d5	restore the delta
38d6	read the axis-1 trackball step state
38d9	step the trackball axis from its selector bits
38dc	store the updated axis-1 step state
38df	move the step into A
38e0	negate the axis-1 delta (its axis reads reversed)
38e3	prep for the add
38e4	accumulate the axis-1 trackball delta
38e6	store the axis-1 accumulator
38e8	read this slot's object-active flag
38ea	negative -- the slot is free/retired, branch away
38ec	is the flag 0x40 or more?
38ee	below -- branch on
38f0	mask off the high control bits
38f2	positive now -- branch on
38f4	mask the object's angle cell down to its low six bits
38f6	clear carry before the angle add
38f7	advance the animating angle by 3
38f9	compare the angle against 42, its wrap point
38fb	still under 42 -- keep the angle
38fd	reached 42 -- wrap the angle back to zero
38ff	store the normalized angle back into the object's angle cell
3901	use the angle as the palette-record index
3902	fan a colour record out to refresh the object's palette pair
3905	start the shadow-build sweep at the top object slot
3907	read this object's vertical field
3909	copy it into the object's vertical sprite-shadow row
390c	read the object's horizontal coordinate source
390e	default the heading-sign carry to zero
3910	is this object slot 13?
3912	slot 13 skips the sign fold
3914	read the object's heading field
3916	heading positive -- no shadow adjustment
3918	clear carry before the nudge
3919	heading negative -- nudge the horizontal shadow up by one
391b	store the object's horizontal sprite-shadow coordinate
391e	bring the heading into A
391f	keep just its sign bit
3921	latch that sign for the shadow-code fold
3923	read input port IN0
3926	isolate the service/self-test bit
3928	switch idle (normal play) -- go build the derived picture code
392a	self-test held -- take the tile/attribute source as-is
392c	hand the code to the shadow-store tail
392f	normal play -- read the tile/attribute source to build the derived picture code
3931	is this object slot below 12?
3933	high slots keep the source code unchanged
3935	low slots keep the low six bits
3937	already in the solid-glyph band?
3939	if so, keep it as the code
393b	otherwise keep the low nibble
393d	stash that low nibble
393f	read the vertical field again
3941	take its low three bits
3943	low three bits zero -- combine with a zero offset (just the stashed nibble)
3945	hold the three-bit value
3946	default offset of 8
3948	value 6 or more?
394a	then keep offset 8
394c	value below 3?
394e	then keep offset 8
3950	values 3 through 5 take offset 0x0c
3952	combine the offset with the stashed low nibble
3954	fold in the latched heading sign
3956	store the object's sprite-shadow picture code
3959	read the tile/attribute source for the attribute byte
395b	isolate bit 6 of the source
395d	bit clear -- no attribute floor
395f	is this object slot below 12?
3961	high slots skip the floor
3963	low slots floor the attribute to 0x0c
3965	OR in the fixed attribute base
3967	store the object's sprite-shadow attribute
396a	step down to the next object slot
396b	loop until every object's shadow is rebuilt
396d	read input port IN0
3970	isolate the self-test bit
3972	switch idle (normal play) -- run the segment-service and ROM-checksum branch
3974	self-test held -- read the diagnostic ramp counter
3976	high bit set -- skip the colour ramp
3978	climb the ramp counter
397a	test IN0's vblank bit
397d	not the 32V edge -- leave the counter running
397f	load zero
3981	on the 32V edge reset the ramp counter
3983	read the ramp counter
3985	shift it up one place for the colour ramp
3986	shift it up a second place
3987	four diagnostic palette cells to write
3989	write the ramp value into a diagnostic palette cell
398c	step the value up for the next palette cell
398e	step down the palette-cell index
398f	loop across the four palette cells
3991	join the trackball integration
3993	normal play -- run the segment-column service pass
3996	three counter cells to mirror out
3998	read a segment-column progress counter
399a	mirror it to the output latch
399d	step down the mirror index
399e	loop across the three counters
39a0	eleven ROM bytes to fold for the checksum
39a2	seed the checksum accumulator
39a4	fold one byte of the ROM check table into the sum
39a7	step down the fold index
39a8	loop across the ROM check table
39aa	test the folded checksum
39ab	a good ROM image sums to zero
39ad	bad checksum -- grab the stack pointer
39ae	fault marker value
39b0	stash the fault marker in dead stack scratch
39b3	start the trackball integration at axis 2
39b5	read this axis's raw trackball counter
39b8	keep the raw count to become the new sample
39b9	set carry for the subtract
39ba	subtract the previous sample to get the delta
39bc	refresh the sample cell with the raw count
39be	keep the low-nibble delta
39c0	is the delta in the negative half?
39c2	positive delta needs no sign-extend
39c4	sign-extend the negative nibble delta
39c6	hold the signed delta
39c7	zero delta -- nothing to integrate this axis
39c9	compare its sign against the last committed delta
39cb	same direction -- accept the delta
39cd	reversal -- bring the delta back into A
39ce	check it against the raw counter's own sign
39d1	consistent reversal -- accept it
39d3	jittery reversal -- reuse the last committed delta
39d5	move the chosen delta into A
39d6	commit it as this axis's last delta
39d8	clear carry before the accumulate
39d9	fold the delta into this axis's accumulator
39db	store the updated accumulator
39dd	step the index down one
39de	step down again to reach the next axis
39df	loop over both trackball axes
39e1	write the interrupt-acknowledge port to clear the frame IRQ
39e4	pull the saved Y off the stack
39e5	restore Y
39e6	pull the saved X off the stack
39e7	restore X
39e8	restore A from the stack
39e9	return from the frame interrupt
39ea	shift the selector's top bit into carry
39eb	a 0x selector steps the value down
39ed	shift the next selector bit
39ee	a 10 selector steps the value up
39f0	an 11 selector zeroes the step value
39f2	return with the zeroed value
39f3	is the step value already at the low clamp?
39f5	at the floor -- hold it
39f7	above the window -- step it down
39f9	below the window -- snap into range
39fb	step the value down one
39fc	shift the selector byte on for the next axis
39fd	return the stepped value
39fe	is the step value already at the high clamp?
3a00	at the ceiling -- hold it
3a02	below the window -- step it up
3a04	above the window -- snap into range
3a06	step the value up one
3a07	return the stepped value
3a08	index the 61 high-score table bytes from the top
3a0a	seed the checksum accumulator
3a0c	fold one high-score table byte into the checksum
3a0f	step down the table index
3a10	loop across the whole high-score table
3a12	read the previously stored checksum
3a15	publish the freshly folded checksum
3a18	bring the old checksum into A
3a19	form old-XOR-new -- the change delta
3a1c	return the checksum delta
3a1d	index the 48-byte ROM high-score template
3a1f	read a template byte
3a22	stage it into the zeropage copy
3a24	step down the template index
3a25	loop across the whole template
3a27	fold the table checksum to test integrity
3a2a	nonzero delta -- table corrupt, go reset it
3a2c	read the option/config byte
3a2e	keep the relevant DIP bits
3a30	compare against the stored config snapshot
3a33	overwrite the snapshot with the current config
3a36	config changed -- keep the scores but bail
3a38	read the leading high-score entry
3a3b	empty entry -- reset the table
3a3d	nine bytes of the top entry to validate
3a3f	read a top-entry byte
3a42	stage it into the zeropage copy
3a44	is the byte out of BCD range?
3a46	too high -- garbage, reset the table
3a48	isolate the low nibble
3a4a	is the low nibble an illegal BCD digit?
3a4c	illegal -- reset the table
3a4e	read the paired secondary entry byte
3a51	promote it into the zeropage working copy
3a53	step down the entry index
3a54	loop across the top entry
3a56	return -- table validated
3a57	reset path -- value to clear the table with
3a59	index the 63 table bytes to wipe
3a5b	zero one high-score table byte
3a5e	step down the wipe index
3a5f	loop until the whole table is blank
3a61	read the option/config byte
3a63	keep the relevant DIP bits
3a65	stamp the config snapshot on the blank table
3a68	return -- table reset
3a99	index the 64 NVRAM cells from the top
3a9b	read one cell out of the EAROM
3a9e	store it into the RAM high-score mirror
3aa1	step down the cell index
3aa2	loop across the whole table
3aa4	park the 0xff sentinel into the writeback cursor
3aa6	return -- mirror loaded fresh from NVRAM
3aa7	latch cell address X into the EAROM
3aaa	read mode with the clock held low
3aac	drive that onto the EAROM control register
3aaf	step to the clock-high value
3ab0	pulse the EAROM clock high
3ab3	step back to the clock-low value
3ab4	the falling clock edge latches the cell out
3ab7	control value to release the chip
3ab9	read the addressed cell from the data-out window
3abc	release EAROM chip-select and clock
3abf	return the fetched cell byte
3ac0	read the frame counter
3ac2	only act every fourth frame
3ac4	other frames -- nothing to flush
3ac6	release the EAROM control lines before starting
3ac9	load the writeback cursor
3acb	high bit set -- no dirty slot pending
3acd	shift the phase word to consume this pass's bit
3acf	bit clear -- take the scan/erase half
3ad1	arm-write control value
3ad3	arm the EAROM for a write
3ad6	commit-strobe control value
3ad8	strobe the freshly-erased cell to commit it
3adb	step the writeback cursor down to the next slot
3add	nothing to write back this pass -- return
3ade	lock out interrupts while the high-score NVRAM is driven
3adf	read one cell out of the high-score EAROM
3ae2	compare it against that slot of the high-score table mirror in RAM
3ae5	they differ -- go commit this cell back to the EAROM
3ae7	step down to the previous high-score slot
3ae8	keep scanning the whole high-score block
3aea	every cell matched -- let interrupts back in
3aeb	remember the scan finished clean (index underflowed)
3aed	done -- return
3aee	let interrupts back in before the write
3aef	stash the index of the slot that needs rewriting
3af1	load the EAROM control setup value
3af3	prime the EAROM control latch to accept a write
3af6	read the fresh byte from the RAM high-score mirror
3af9	latch it into the EAROM data window at this slot
3afc	load the EAROM write-commit pulse value
3afe	pulse the EAROM control latch to burn the byte in
3b01	flip the erase/write phase word so the next pass performs the commit
3b03	done -- return
3b04	clear decimal mode so all arithmetic is plain binary
3b05	set the index to the top of a page
3b07	seat the stack pointer before handing off to boot
3b08	roll the index to zero
3b09	zero the accumulator -- the fill value for the RAM wipe
3b0a	wipe this low-page cell
3b0c	wipe the matching stack-page cell
3b0f	wipe the matching video/object page-4 cell
3b12	wipe the matching page-5 cell
3b15	wipe the matching page-6 cell
3b18	wipe the matching page-7 cell
3b1b	step to the previous cell
3b1c	loop until every plane of work RAM is blank
3b1e	silence the POKEY serial/keyboard control latch
3b21	clear the POKEY audio control latch so no sound leaks
3b24	dead store the board ignores -- kept so the mirror matches
3b27	drop the flip-screen latch so the display orientation is defined
3b2a	read the input port carrying the service switch
3b2d	isolate the service-switch bit
3b2f	switch held -- drop into the operator self-test
3b31	normal boot -- read the option DIP bank
3b34	snapshot the DIP config into the mode/control byte
3b36	roll the index to 0xff
3b37	seed the pending-wave flag to its power-on value
3b39	seed a boot flag to its power-on value
3b3b	seed a second boot flag to its power-on value
3b3d	load the power-on value for the next flag
3b3f	seed that flag to 1
3b41	load the high-score mirror out of the NVRAM
3b44	validate the high-score table, resetting it if corrupt
3b47	hand the machine to the game entry -- never returns
3b4a	self-test start -- clear the first playfield color cell
3b4d	silence POKEY channel 1
3b50	silence POKEY channel 2
3b53	silence POKEY channel 3
3b56	silence POKEY channel 4
3b59	bump the color value to 1
3b5a	paint color 1 into palette cell 05
3b5d	paint color 1 into palette cell 0d
3b60	bump the color value to 2
3b61	paint color 2 into palette cell 06
3b64	paint color 2 into palette cell 0e
3b67	bump the color value to 3
3b68	paint color 3 into palette cell 07
3b6b	paint color 3 into palette cell 0f
3b6e	start the zeropage march at cell zero
3b70	read this zeropage cell
3b72	it should still read zero from the wipe -- else fault
3b74	load the walking-bit test pattern
3b76	write the pattern into the cell
3b78	keep a copy of the pattern
3b79	read it back and compare
3b7b	the cell did not echo -- march fault
3b7d	restore the pattern
3b7e	walk the single set bit up one place
3b7f	keep walking the bit through the whole byte
3b81	advance to the next zeropage cell
3b82	loop across the whole zeropage
3b84	pet the watchdog so it cannot reset the board mid-test
3b87	drop the index into the accumulator
3b88	clear the page-march pointer low byte
3b8a	shift a page number into place
3b8b	set the page-march pointer high byte to this page
3b8d	start at the first cell of the page
3b8f	load the walking-bit pattern for the page march
3b91	read this page cell
3b93	it should read zero -- else page fault
3b95	move the pattern into the accumulator
3b96	write the pattern into the page cell
3b98	read it back and compare
3b9a	the cell did not echo -- page fault
3b9c	move the pattern into the accumulator
3b9d	walk the single set bit up one place
3b9e	hold the shifted pattern back in the index
3b9f	keep walking the bit through the whole byte
3ba1	advance to the next cell in the page
3ba2	loop across the whole 256-byte page
3ba4	pet the watchdog between pages
3ba7	move to the next page number
3ba9	read the current page number
3bab	reached page 2?
3bad	not page 2 -- carry on
3baf	skip the unmapped pages 2-3, jump ahead to page 4
3bb1	past the last tested page (7)?
3bb3	still within pages 1-7 -- march the next page
3bb5	all pages passed -- leave the memory march
3bb7	classify the fail flag for the beep count
3bb9	clear the accumulator for the count build
3bbb	go set up the beep-and-halt reporter
3bbd	page fault -- read which page failed
3bbf	page below 4? report it in the simpler low-page style
3bc1	low page -- fold the count the zeropage way
3bc3	stash the pattern in the index
3bc4	pull the failing byte position into the accumulator
3bc5	keep the position bits that encode the fault
3bc7	shift the position down toward the low nibble
3bc8	shift it down again
3bc9	shift it down again
3bca	shift it into the low nibble
3bcb	bump the beep count by one
3bcd	fold the pattern bit into carry for the count
3bcf	roll that bit into the beep count
3bd0	hold the beep count in Y
3bd1	load the diagnostic tone frequency
3bd3	set POKEY channel-1 frequency for the beep
3bd6	load the serial/keyboard control arm value
3bd8	arm the POKEY control latch for the tone
3bdb	load the vblank-edge count for one half-beep
3bdd	load the tone-on control/volume value
3bdf	turn the beep tone on
3be2	read the beam's vblank edge
3be5	wait for the vblank edge to arrive
3be7	read the beam's vblank edge again
3bea	wait for the edge to clear
3bec	pet the watchdog so the beep can play out
3bef	count down one vblank edge of the tone-on half
3bf0	loop for the whole tone-on half of the beep
3bf2	turn the beep tone off
3bf5	load the vblank-edge count for the tone-off half
3bf7	read the beam's vblank edge
3bfa	wait for the vblank edge to arrive
3bfc	read the beam's vblank edge again
3bff	wait for the edge to clear
3c01	pet the watchdog so the silent half can play out
3c04	count down one vblank edge of the tone-off half
3c05	loop for the whole tone-off half of the beep
3c07	one beep done -- count it off
3c08	repeat until the beep count underflows
3c0a	pet the watchdog while waiting to halt
3c0d	read the input port carrying the service switch
3c10	isolate the service-switch bit
3c12	still held -- keep petting and waiting
3c14	hang the processor forever -- only a power cycle clears the fault
3c16	marches passed -- read the coin/option input port
3c19	isolate the coin/option bit
3c1b	clear -- build the on-screen diagnostic
3c1d	set -- jump to the checksum-display screen (does not return)
3c20	roll the index to zero for the re-clear
3c21	re-clear this zeropage cell
3c23	advance to the next cell
3c24	loop across the whole zeropage
3c26	index the top of a 16-cell block
3c28	load the fill glyph
3c2a	seed this cell of the loc_64 row with the fill glyph
3c2c	step down one cell
3c2d	fill all sixteen row cells
3c2f	start at video page 7
3c31	set the page pointer high byte to page 7
3c33	seed the offset near the top of the page
3c35	load the starting glyph code for this row
3c37	set the run length to eight cells
3c39	paint the glyph into this screen cell
3c3b	step back one cell
3c3c	count down the run
3c3d	loop for a run of eight
3c3f	prepare a clean subtract
3c40	step to the next glyph code down
3c42	floor the glyph code at 0x2a
3c44	keep painting descending glyph runs across the row
3c46	whole page painted (offset wrapped)?
3c48	not yet -- start the next row
3c4a	move down to the previous page
3c4c	read the current page number
3c4e	reached page 4?
3c50	still pages 7 down to 4 -- keep painting
3c52	enable interrupts for the input-response screen
3c53	read the input port carrying the service switch
3c56	isolate the service-switch bit
3c58	keep spinning while the service switch is idle; proceed once it is pressed
3c5a	shift the pacing value one place
3c5c	pet the watchdog each pass
3c5f	read the control input port
3c62	keep the top three control bits
3c64	flip them so an actuated control reads nonzero
3c66	nothing actuated yet -- keep waiting
3c68	load the response fill color
3c6a	lock out interrupts to flood the screen
3c6b	flood video page 4 with the response color
3c6e	flood video page 5 with the response color
3c71	flood video page 6 with the response color
3c74	advance to the next cell
3c75	flood the whole 256 cells
3c77	flood this cell of page 7 with the response color
3c7a	advance to the next cell
3c7b	reached the 0xc0 stopping point?
3c7d	keep flooding page 7 up to the limit
3c7f	load a bright palette value
3c81	brighten palette cell 05
3c84	load another bright palette value
3c86	brighten the first playfield color cell
3c89	read IN0, where the operator service switch lives, to hold the self-test review screen
3c8c	isolate bit 5, the service switch (low only while held)
3c8e	switch released -- spin at the top without petting the watchdog, so letting go resets the board out of the test
3c90	switch still held -- pet the watchdog so the review screen stays alive
3c93	shift the pacing byte 8a to time the hold
3c95	loop the review hold forever; only a watchdog reset leaves it
3c97	start the wipe index at 0
3c99	copy the index into A
3c9a	paint an ascending tile-code ramp across the sprite/object page at 0x0700
3c9d	load zero for the clears
3c9f	clear this zero-page cell
3ca1	clear the matching page-4 object cell
3ca4	clear the matching page-5 object cell
3ca7	clear the matching page-6 object cell
3caa	step to the next cell
3cab	loop until all 256 cells are wiped
3cad	roll the index down to 0xff
3cae	seed loc_d5 to 0xff
3cb0	seed loc_e3 to 0xff
3cb2	clear output latch 3
3cb5	clear output latch 4
3cb8	start the object-slot seed index at 0x0f
3cba	copy the slot index into A
3cbb	set bit 7 to mark the slot free/retired
3cbd	seed object coordinate slot 0x54+x as free
3cbf	seed object coordinate slot 0x64+x as free
3cc1	step to the next slot
3cc2	loop over all sixteen object slots
3cc4	read the POKEY random register
3cc7	fold in a second read of the random register (the pair cancels at rest)
3cca	stash the mixed random value in loc_e5
3ccc	load 3 for the POKEY control latch
3cce	arm the POKEY control latch (SKCTL) so sound can play
3cd1	clear the pointer low index
3cd3	set the checksum pointer low byte 8b to 0
3cd5	load 0x20 for the pointer high byte
3cd7	point the checksum pointer at ROM page 0x20
3cd9	count 0x1f pages to checksum
3cdb	seed the running checksum accumulator to 0xff
3cdd	start each page at byte 0
3cdf	pet the watchdog with the page counter while checksumming
3ce2	fold one ROM byte into the running checksum
3ce4	step to the next byte in the page
3ce5	loop over all 256 bytes of the page
3ce7	save the running checksum into Y
3ce8	pull the page counter into A
3ce9	keep its low three bits to spot a bank boundary
3ceb	test whether a bank has just finished
3ced	restore the checksum into A
3cee	not a bank boundary yet -- keep summing
3cf0	bank complete: push this bank's checksum onto the stack
3cf1	reseed the accumulator for the next bank
3cf3	advance the pointer to the next ROM page
3cf5	step to the next page
3cf6	loop through every ROM page
3cf8	set the plot cursor row to 4
3cfa	store the cursor high byte
3cfc	four ROM banks to report
3cfe	copy the bank index into A
3cff	turn the bank index into its screen column
3d01	store the cursor low byte
3d03	pull one bank's checksum off the stack
3d04	checksum zero means the bank is good -- skip its line
3d06	bad bank: keep the checksum
3d07	copy the bank index into A
3d08	build the bank's label glyph
3d0a	plot the bank label
3d0d	load a blank
3d0f	plot the separator space
3d12	pull the bank checksum back
3d13	clear carry before the digit plot
3d14	plot the checksum as two hex digits
3d17	step to the next bank
3d18	loop over all four banks
3d1a	load the high-score table out of the EAROM
3d1d	seven high-score header bytes to copy
3d1f	read a high-score table byte
3d22	mirror it into the working block at 0x8e
3d25	step to the previous byte
3d26	loop until all seven are copied
3d28	switch to decimal (BCD) arithmetic
3d29	read the score's low byte (test the 3-byte score for all-zero)
3d2c	OR in the next score byte
3d2f	OR in the last score byte to test for an all-zero score
3d32	no score set -- skip the ranking
3d34	seed the iteration counter
3d35	advance the iteration counter
3d36	counter wrapped -- give up ranking
3d38	load the working value low byte
3d3a	set carry for the subtract
3d3b	subtract the score low byte (BCD)
3d3d	store the low byte back
3d3f	load the next working byte
3d41	subtract the next score byte with borrow
3d43	store it back
3d45	load the next working byte
3d47	subtract the next score byte with borrow
3d49	store it back
3d4b	load the top working byte
3d4d	subtract the borrow through the top byte
3d4f	store it back
3d51	still non-negative -- subtract the score again
3d53	leave decimal mode
3d54	store the derived rank count into loc_8d
3d56	re-enable interrupts
3d57	shift the frame-pacing byte 8a right, waiting for the heartbeat bit
3d59	loop until a frame heartbeat lands in carry
3d5b	read IN0
3d5e	isolate the service switch bit
3d60	spin here while the service switch reads set
3d62	pet the watchdog
3d65	read the control port IN1
3d68	drop bit 0 of IN1 into carry
3d69	rotate that bit into the loc_ea edge-history shift register
3d6b	load the edge history
3d6d	keep its low two bits
3d6f	test for the just-actuated edge pattern
3d71	no fresh edge on this control -- skip to the next
3d73	load the channel cursor e6
3d75	copy it into X to index the sound register
3d76	clear carry
3d77	add 2
3d79	wrap it into the 0,2,4,6 cycle
3d7b	store the advanced channel cursor e6
3d7d	load a silence value
3d7f	silence the selected POKEY channel volume register
3d82	load counter e7
3d84	clear carry
3d85	add 1
3d87	wrap it to a nibble
3d89	store the advanced counter e7
3d8b	load palette counter e8
3d8d	step it up
3d8e	copy it into A
3d8f	wrap it to a nibble
3d91	move it back into X
3d92	write the cycling colour into palette cell 04
3d95	store the palette counter e8
3d97	read the control port IN1
3d9a	drop bit 0
3d9b	shift bit 1 into carry
3d9c	rotate it into the loc_eb edge-history register
3d9e	load the edge history
3da0	keep the low two bits
3da2	test for the just-actuated edge pattern
3da4	no fresh edge on this control -- skip on
3da6	bump counter e9
3da8	load it
3daa	start the palette fill at index 1
3dac	clear carry
3dad	add 1
3daf	wrap to a nibble
3db1	write the colour ramp into palette cells 05..07
3db4	write the same into palette cells 0d..0f
3db7	step to the next palette cell
3db8	four cells done?
3dba	loop until the palette triple is filled
3dbc	read the control port IN1
3dbf	drop bit 0
3dc0	drop bit 1
3dc1	shift bit 2 into carry
3dc2	rotate it into the loc_ec edge-history register
3dc4	load the edge history
3dc6	keep the low two bits
3dc8	fold against the edge pattern
3dca	no fresh edge on this control -- skip on
3dcc	clear loc_bd
3dce	clear loc_bf
3dd0	dead store the machine ignores at 0x2400
3dd3	load 1
3dd5	drive the flip-screen latch to normal orientation
3dd8	set loc_88 to 1
3dda	sixteen object cells to bump
3ddc	bump object cell 0x34+x
3dde	step to the previous cell
3ddf	loop over all sixteen
3de1	read the control port IN1
3de4	drop bit 0
3de5	drop bit 1
3de6	drop bit 2
3de7	shift bit 3 into carry
3de8	rotate it into the loc_ed edge-history register
3dea	load the edge history
3dec	keep the low two bits
3dee	fold against the edge pattern
3df0	no fresh edge on this control -- skip on
3df2	clear loc_bd
3df4	clear loc_bf
3df6	dead store the machine ignores at 0x2400
3df9	set loc_88 to 2
3dfb	store it
3dfd	load 0xff
3dff	drive the flip-screen latch to flipped orientation
3e02	load the plot cursor row value 5
3e04	set the cursor high byte
3e06	load the plot cursor column value 0x38
3e08	set the cursor low byte
3e0a	read the option DIP bank DSW1
3e0d	keep bits 3-2
3e0f	shift them down
3e10	shift again
3e11	add 1 to make a 1..4 count
3e13	store the count into 8b
3e15	five columns to plot
3e17	load the filled block glyph
3e19	test the countdown byte 8b
3e1b	still positive -- keep the block glyph
3e1d	else use a blank glyph
3e1f	plot the glyph at the cursor
3e22	step the countdown byte 8b
3e24	next column
3e25	loop the five columns
3e27	load the plot cursor column value 0x37
3e29	set the cursor low byte
3e2b	load the label glyph 0x21
3e2d	plot the label
3e30	read DIP bank DSW2
3e33	keep bit 4
3e35	shift it down
3e36	shift again
3e37	shift again
3e38	shift bit 4 to bit 0
3e39	add 1
3e3b	build the option glyph code
3e3d	plot the option glyph
3e40	read DIP bank DSW2 again
3e43	keep bits 3-2
3e45	shift them down
3e46	shift again
3e47	nonzero option -- branch onward
3e49	else load the 0xfe marker
3e4b	add 3 to the tallied value to bias it into the glyph range
3e4d	set bit 5 so the value reads as a printable character code
3e4f	emit that glyph and step the screen write pointer forward
3e52	aim the write cursor low byte at cell 0x36
3e54	seat the draw cursor
3e56	load zero
3e58	Y = 0, the base offset
3e59	blank the cell the cursor sits on
3e5b	step the offset 0x40 further down the column
3e5d	blank that cell too
3e5f	read the DSW2 option bank
3e62	shift the option bits right one
3e63	shift right again
3e64	shift right again
3e65	shift right again
3e66	fifth shift drops the top three option bits to the bottom
3e67	if that option field is zero, skip the bonus glyph
3e69	stash the option value as the table index
3e6a	compare it against 6
3e6c	out of range -- skip the bonus glyph
3e6e	read the bonus glyph from the option table by that index
3e71	emit the bonus glyph
3e74	load a blank
3e76	emit the blank spacer after it
3e79	load glyph 0x21
3e7b	is the option value exactly 3?
3e7d	no -- keep glyph 0x21
3e7f	yes -- use glyph 0x22 instead
3e81	emit that trailing glyph
3e84	load the ROM text-row pointer high byte 0x3f
3e86	set the row pointer high byte
3e88	default the row pointer low byte to 0xee
3e8a	test the DSW1 option bank
3e8d	option bit 6 clear -- keep the default text row
3e8f	bit 6 set -- select the alternate text row at 0xf2
3e91	set the row pointer low byte
3e93	load draw cursor 0x35
3e95	seat the draw cursor for the row
3e97	draw that option text row onto the screen
3e9a	read input port IN1
3e9d	snapshot IN1
3e9f	read the DSW1 option bank
3ea2	snapshot DSW1
3ea4	read the DSW2 option bank
3ea7	snapshot DSW2
3ea9	read input port IN0
3eac	keep only the meaningful IN0 bits
3eae	snapshot masked IN0
3eb0	read input port IN2
3eb3	keep only the meaningful IN2 bits
3eb5	snapshot masked IN2
3eb7	read input port IN3
3eba	snapshot IN3
3ebc	read the POKEY random register
3ebf	stash the random sample
3ec0	AND it into the stuck-high accumulator (a bit stays set only if every sample read 1)
3ec2	store the running AND of random samples
3ec4	recover the random sample
3ec5	OR it into the stuck-low accumulator (a bit stays clear only if no sample ever read 1)
3ec7	store the running OR of random samples
3ec9	clear the bit-position counter
3ecb	read input port IN1 again
3ece	set carry as the walking sentinel
3ecf	rotate the sentinel into the value
3ed0	if the top bit is set, stop counting
3ed2	count one more empty bit position
3ed3	shift the next bit up
3ed4	keep scanning until the value empties
3ed6	move the highest-set-bit index into A
3ed7	load the tone channel offset
3ed9	scale the index up (x2)
3eda	scale again (x4)
3edb	scale again (x8) into a tone pitch
3edc	set the POKEY tone frequency for the actuated input
3edf	reload the bit index
3ee0	set the volume and distortion bits
3ee2	sound the tone through the POKEY control register
3ee5	load the trackball object index
3ee7	Y = 0, the clear value
3ee9	read the pending trackball delta on this axis
3eeb	clear the pending delta now that it is consumed
3eed	clear carry for the add
3eee	add the delta into the object's coordinate
3ef0	store the advanced coordinate
3ef2	read the object's other-axis coordinate
3ef4	set carry for the subtract
3ef5	subtract the second pending trackball delta
3ef7	clear that pending delta too
3ef9	store the adjusted coordinate
3efb	point the screen offset at 0xd0
3efd	load the row counter -- six snapshot bytes to show
3eff	park the row index in the stack pointer as a scratch index
3f00	load the bit counter -- eight bits
3f02	save the bit counter in A
3f03	pull the row index back out of the stack pointer
3f04	rotate the top bit of this snapshot byte into carry
3f06	restore the bit counter into X
3f07	load the "bit set" glyph
3f09	bit was set -- keep it
3f0b	bit was clear -- use the "bit clear" glyph
3f0d	step to the next screen cell
3f0e	write the on/off glyph into the switch-state row
3f11	next bit
3f12	loop across all eight bits of the byte
3f14	move the screen offset into A
3f15	set carry for the subtract
3f16	back up one full screen row (0x28)
3f18	restore the screen offset
3f19	pull the row index from the stack pointer
3f1a	next snapshot byte
3f1b	loop down through all the snapshot rows
3f1d	aim the write pointer at screen page 4 (cursor high byte)
3f1f	store it for the digit plotter
3f21	load draw cursor 0x3a
3f23	seat the draw cursor
3f25	read the stuck-low (OR) random accumulator
3f27	invert it -- healthy bits should all have been set
3f29	fold in the stuck-high (AND) accumulator
3f2b	fold in the extra random-health flag
3f2d	all bits toggled -- random test passes, skip the fault glyph
3f2f	stuck bit found -- load the fault glyph
3f31	emit the random-test result glyph
3f34	service the deferred high-score EAROM write
3f37	fold the high-score table checksum
3f3a	store the checksum into the high-score checksum cell
3f3d	checksum zero (table valid) -- go show the high score
3f3f	save the checksum byte
3f40	load draw cursor 0x3b
3f42	seat the draw cursor
3f44	load glyph 0x24
3f46	emit it
3f49	load a blank
3f4b	emit the blank spacer
3f4e	recover the checksum byte
3f4f	plot the bad checksum as two digits
3f52	jump to the loop tail
3f55	aim the write pointer at screen page 4 (cursor high byte)
3f57	store it for the digit plotter
3f59	load draw cursor 0xe9
3f5b	seat the draw cursor at the high-score field
3f5d	set carry -- leading digit pair
3f5e	read the high byte of the high score
3f61	plot it as two digits
3f64	read the middle high-score byte
3f67	plot it as two digits
3f6a	read the low high-score byte
3f6d	clear carry -- trailing digit pair
3f6e	plot it as two digits
3f71	load the ROM text-row pointer low byte 0xde
3f73	set the row pointer low byte
3f75	load the ROM text-row pointer high byte 0x3f
3f77	set the row pointer high byte
3f79	draw that text row (0x3fde) onto the screen
3f7c	aim the write pointer at screen page 5 (cursor high byte)
3f7e	store it for the digit plotter
3f80	load draw cursor 0x08
3f82	seat the draw cursor
3f84	read the derived high-score rank count (0x8d)
3f86	shift its high nibble down one
3f87	shift right again
3f88	shift right again
3f89	fourth shift brings the high nibble to the bottom
3f8a	enter decimal mode
3f8b	clear carry
3f8c	adjust the nibble into a BCD digit
3f8e	leave decimal mode
3f8f	set carry -- leading digit pair
3f90	plot the high-nibble value as two digits
3f93	load the separator glyph 0x2e
3f95	emit the separator
3f98	read the config byte again
3f9a	keep only its low nibble
3f9c	enter decimal mode
3f9d	clear carry
3f9e	adjust the nibble into a BCD digit
3fa0	stash it
3fa2	add it back (x2)
3fa4	stash the doubled value
3fa6	add it once more (x3 total)
3fa8	leave decimal mode
3fa9	compare the tripled value against 0x60
3fab	below 0x60 -- keep it
3fad	at or above -- clamp to 0x59
3faf	clear carry -- trailing digit pair
3fb0	plot the scaled value as two digits
3fb3	load the ROM text-row pointer low byte 0xe4
3fb5	set the row pointer low byte
3fb7	load the ROM text-row pointer high byte 0x3f
3fb9	set the row pointer high byte
3fbb	draw that text row (0x3fe4) onto the screen
3fbe	read status cell 0xea
3fc0	fold in 0xeb
3fc2	fold in 0xec
3fc4	any set -- skip the checksum toggle
3fc6	read the high-score checksum
3fc9	invert it
3fcb	write the toggled checksum back
3fce	load 0x3d
3fd0	seed the pointer low byte at 0xf9
3fd2	load zero
3fd4	seed the pointer high byte at 0xfa
3fd6	jump back to the top of the test-display loop
3ff6	spin here forever -- the NMI vector's target; no instruction jumps here
