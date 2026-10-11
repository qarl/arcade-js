0008	step the byte-table pointer on by the index
000A	no carry out of the low byte -- the pointer's high half stands
000C	carry into the table pointer's high byte
000D	read the byte the pointer now lands on
0010	double the entry number to reach its two-byte entry
0011	add that offset onto the word-table pointer
0012	read the entry's low byte
0014	and its high byte
0015	leave the pointer just past the entry
0018	add the unsigned byte offset onto the address
001A	no carry -- the address's high half stands
001B	carry into the address's high byte
0021	drop the cursor thirty-two addresses on to the next cell of the line
0024	no borrow -- the cursor's high byte stands
0025	borrow into the cursor's high byte
0029	push the cursor thirty-two addresses back, one cell along the line
002C	no carry -- the cursor's high byte stands
002D	carry into the cursor's high byte
0030	take the inline word table the caller left behind -- its return address points straight at it
0031	index that table by the selector in A and read the entry it picks
0032	bring the selected arm's address into the jump register
0033	jump to the selected arm -- control never returns to the table
0039	point the high byte at the command ring's page
003B	fetch the ring's write cursor
003E	complete the pointer to the target cell
003F	is that cell free? -- a free cell carries its high bit set
0041	still occupied -- drop this command and return
0043	write the command byte
0045	write its argument
0048	wrap the cursor inside the sixty-four-cell ring
004A	store the advanced write cursor
0066	hand the per-frame interrupt straight on to the frame-service handler
0069	kick the watchdog
006C	point at the sprite-bank run
006F	forty-eight bytes of it to clear
0071	clear this sprite-bank byte
0074	on across the whole run
0076	kick the watchdog
0079	point one byte lower in the same sprite bank, for a second forty-eight-byte clear
007C	another forty-eight bytes to clear
007E	clear this sprite-bank byte
0081	on across the run
0083	kick the watchdog
0086	point at the base of work RAM
0089	one cell on -- the block-fill destination
008C	two kilobytes, less the seed cell, to clear
008F	seed the first cell with zero
0091	copy the zero forward through the whole of work RAM
0093	kick the watchdog
0096	two hundred fifty-six bytes to fold
0098	point at the fixed program run to fold -- the frame service's own bytes
009B	clear the running total
009C	fold this byte into the total
009E	on across all two hundred fifty-six bytes
00A0	weigh the total against a genuine image's value
00A2	on a tampered image, run the frame service out of band
00A5	hand off to the screen-RAM clear and image verify
00A8	raise the interrupt-enable line from the low bit the caller carries
00AB	kick the watchdog
00AE	fall into the foreground command loop, never to return
00B1	point the cursor one line above the lattice's first band
00B4	fourteen bands to lay down
00B9	step down a line before this band -- from the seat line 0xA420 to 0xA440 the first time, past the previous band's lower row after that, so the bands come out contiguous
00BA	sixteen boxes across the band
00BC	stamp one box at the cursor
00BF	step the cursor two cells on to the next box
00C1	on across all sixteen boxes of the band
00C3	one band done
00C4	go lay the next band
00C7	remember the cursor so it comes back unmoved
00C8	stamp the box's top-left corner tile
00CB	stamp the top-right corner, one cell along
00CD	step down to the row below
00D1	stamp the bottom-left corner
00D4	stamp the bottom-right corner
00D6	put the cursor back where it was found
00D8	save the interrupted program's registers -- both banks and the index pair
00E6	copy the sprite shadow out to the hardware first, so the picture lands during blanking
00E9	flush both deferred character-cell lists into the planes
00ED	disarm this interrupt's own enable line
00F0	kick the watchdog
00F4	provisionally mark the screen unflipped this frame
00F7	read which player is up
00FB	player one is up: leave the screen unflipped
00FD	read the cabinet type -- upright or cocktail
0101	upright cabinet: leave the screen unflipped
0103	player two on a cocktail cabinet: clear the mark, turning the screen round
0106	take the frame's flip decision
0109	drive the screen-flip latch line
010C	read the dip-switch bank
010F	invert it -- the ports read active-low
0110	store the mirror the game reads instead of the live port
0113	read the IN0 port -- coins and start buttons
0117	store the IN0 mirror
011A	read the next input port
011E	store its mirror
0121	read the next input port
0125	store its mirror
0128	read the last input port
012C	store its mirror
0132	bump the plain binary frame counter
0137	step the decimal frame counter
0138	keep it counting in decimal
013A	point at the first frame-countdown timer
013F	already run out: leave it at zero
0141	otherwise tick it down one frame
0142	point at the second countdown timer
0147	already at zero: leave it
0149	tick it down one frame
014A	point at the third countdown timer
014F	already at zero: leave it
0151	tick it down one frame
0152	run the coin service
0158	push the epilogue's address as the dispatched arm's return
0159	read the game-mode selector
015C	keep its low two bits -- one of four modes
015E	dispatch through the inline table that follows, entering the selected mode handler
0174	hand one queued byte off to the sound processor
0184	read the interrupt-enable pattern from the program image
0187	re-arm this interrupt for the next frame
018C	double the index to reach its two-byte entry
018F	the doubling overflowed -- carry into the table's high byte so it may run past 128 entries
0190	add the doubled index onto the table pointer
0194	carry into the pointer's high byte
0195	read the entry's low byte
0197	and its high byte
0198	leave the pointer just past the entry
019A	the character plane's first cell
019D	seat the wipe cursor there
01A0	thirty-two lines -- the whole plane
01A2	set that as the lines-left count
01A5	two hundred forty bytes of the image to fold
01A7	point at the checked run of the program image
01AA	clear the running total
01AB	fold this byte into the total
01AD	on across all two hundred forty bytes
01AF	weigh the total against a genuine image's value
01B1	on a tampered image, transfer into bytes that carry no routine
01B5	the plane's fifth cell, where this wipe starts
01B8	seat the wipe cursor there
01BB	take the line count from a fixed cell of the program image
01BE	set it as the lines-left count
01C2	fetch the wipe cursor -- where this line starts
01C5	thirty-two cells across the line
01C7	the step from one cell to the next
01CA	lay a blank glyph in this cell
01CC	cross to the colour plane for the same cell
01CE	set its colour
01D0	cross back to the glyph plane
01D2	step to the next cell of the line
01D3	on across all thirty-two cells
01D5	reload the wipe cursor
01D8	step it on to the start of the next line
01D9	store the advanced cursor
01DF	count the lines still owed down by one
01E2	send the pen back to leg zero of its route
01E5	the route's first row coordinate, from the program image
01E8	seat the pen's row -- whole cell and fraction together
01EB	the route's first column coordinate
01EE	seat the pen's column the same way
01F1	two hundred fifty-six bytes to fold
01F3	point at the checked run of the program image
01F6	clear the running total
01F7	fold this byte into the total
01F9	on across all two hundred fifty-six bytes
01FB	weigh the total against a genuine image's value
01FD	on a tampered image, drop into the cold start, which never returns here
0201	stamp the pen glyph at the run's start cell
0204	the run's target row, from the program image
0207	the pen's current row
020C	target row minus current row
0211	the difference times sixteen
0214	carry the difference's sign into the top byte
0217	keep the top byte, sign-extended -- the per-step row increment
0218	store the row step
021B	the run's target column
021E	the pen's current column
0223	target column minus current column
0228	the difference times sixteen
022B	carry the difference's sign into the top byte
022E	keep the top byte, sign-extended -- the per-step column increment
022F	store the column step
0232	take the pen's current row
0235	the row step
0239	advance the row by one step
023A	store it back
023D	take the pen's current column
0240	the column step
0244	advance the column by one step
0245	store it back
0248	stamp the pen glyph at the new cell
024B	the run's end cell, from the program image
0250	has the stamped cell reached the run's end?
0252	not yet -- step and stamp again
0258	advance to the next run of the route
0259	take the new run index
025A	point at the route's start-point word table
025D	read the new run's start point
0261	clear the row's fraction
0264	seat the row's whole cell from the start point
0268	clear the column's fraction
026B	seat the column's whole cell from the start point
026D	test the new run's row cell -- callers keep drawing runs until it reaches zero
026F	read the pen's row cell
0272	scale the row up toward its offset down the plane -- a byte-wide doubling, so a row past the thirty-second folds back to the top
0278	finish scaling the row to thirty-two cells, one whole plane row
027A	read the pen's column cell
027E	fold the column into the low half of the address, with no carry into the high half
0282	land the address in the character plane
0283	read the pen glyph
0286	stamp the glyph into the cell
0287	cross to the colour plane for the same cell
0289	read the pen colour
028C	paint the cell that colour
028D	cross back to the glyph cell -- the address handed back to the caller
0365	point at the sprite shadow, the working copy of the sprites
0368	point at the first hardware sprite bank
036B	read the screen-unflipped mark
036F	picture turned round: take the flipped copy path
0372	copy the six sprite bytes of scenery slots zero to two straight into the bank
037E	point at the object band's thirty-two sprite bytes, the player's entry first
0381	copy them straight in
03C1	point at the ten sprite bytes of scenery slots three to seven
03C4	copy them straight in
03D8	point at the sprite-attribute shadow
03DB	point at the second hardware sprite bank
03DE	pass this sprite's first attribute byte through unchanged
03E0	read its second attribute byte
03E1	bias it by fourteen
03E3	complement it -- the upright transform for the second attribute half
03E4	store it -- the run carries on this way, one attribute pair at a time
03F9	move the source on to the player's attribute block
048C	move the source on to scenery slot three's attributes
04BC	read the sequence phase
04BF	is the sequence in phase 3, the round engine?
04C1	other phase: leave the sprites untouched
04C2	read the sequence sub-step
04C5	point at the sub-step floor value
04C8	below the floor sub-step?
04C9	yes: nothing to raise
04CA	at or past sub-step eight?
04CC	yes: nothing to raise
04CD	read this sprite's second bank byte
04D0	add its own top bit back to probe it
04D2	already raised: skip to the next sprite
04D4	raise the second byte's top bit
04D7	point at the matching first-bank byte
04DB	raise its top bit too
04DE	same top-bit raise for the next of the eight sprites
04EF	same raise for the next sprite
0500	same raise for the next sprite
0511	same raise for the next sprite
0522	same raise for the next sprite
0533	same raise for the next sprite
0544	same raise for the last of the eight sprites
0555	done: return
0556	read this sprite's first byte
0557	bias it by fifteen
0559	complement it -- the flipped transform for the first half
055A	store it
055D	pass the second byte through unchanged
0571	move the source on to the object band's thirty-two sprite bytes, the player's entry first
0604	move the source on to the ten bytes of scenery slots three to seven
0634	point at the sprite-attribute shadow
0637	point at the second hardware sprite bank
063A	read this attribute's first byte
063B	toggle its top two bits -- the flipped transform for the first attribute half
063D	store it
0640	read its second byte
0641	step it on by one -- the flipped transform for the second attribute half
0642	store it -- the run carries on this way, one attribute pair at a time
065B	move the source on to the player's attribute block
070E	move the source on to scenery slot three's attributes
0748	go raise the eight sprites, then return
074B	two hundred fifty-six program bytes to fold -- a zero count means the full round
074D	point at the program run to be checksummed
0750	clear the running total
0751	add the next program byte into the total
0755	subtract the genuine total
0757	any other total means a tampered image: derail to the failure landing
075A	read the current pen colour
075D	was the pen colour already the set value?
0762	set the pen colour to five
0767	set the stamp glyph to the blanking glyph, so the pen erases
076A	arm the pen to the start of its route
076E	step the sequence sub-step an extra time when the pen colour already held five
0771	step the sequence sub-step
0774	two hundred fifty-six program bytes to fold -- a zero count means the full round
0776	point at the program run to verify
0779	clear the running total
077A	fold the next byte into the total by exclusive-or
077E	add the genuine total's complement -- zero only when the fold matches
0780	step the sequence phase when the fold does not match -- the image-tamper response
0783	read the play-active flag
0787	nothing set: skip to the shared tail
0789	read a fixed command pair from the program image
078D	read which player is up
0791	player one: leave the argument as is
0793	player two: bump the command argument
0794	post the command pair to the ring
0795	read the round-armed flag
0799	clear: skip to the shared tail
079B	set the command to number seven
079D	post that command to the ring
079E	skip command two and join the tail at the kill-meter repaint
07A0	command two, argument two
07A3	post it to the ring
07A4	repaint the kill meter
07A7	reset the playfield and arm a new round
07AA	step the sequence sub-step
07AD	set the folded program total aside for the tamper verdict
07AE	hand on to the verdict
07B1	read the expansion socket
07B4	is an expansion board fitted?
07B6	fitted: hand control to the expansion -- on a stock board nothing is mapped at 0x6000
07B9	seat the stack just below sprite RAM, so it grows down through work RAM
07BC	kick the watchdog
07BF	point at the control latch
07C2	eight latch addresses to clear
07C4	clear this latch line
07C9	read a byte of the program image
07CC	drive the video-enable line from it
07CF	hand on to the cold start
07D2	point at the first cell of the run
07D5	step of minus thirty-two -- walk one plane row back each cell
07D8	fourteen cells to blank
07DA	blank this cell's glyph
07DC	cross to the colour plane
07DE	give it the fixed colour
07E0	cross back to the glyph plane
07E2	step back one plane row
07E6	re-stamp the copyright caption strip
07E9	re-request the flashing copyright line
07EC	point at the title cell to sample
07EF	and where to stash its glyph and colour
07F2	sample the cell
07F5	read the IN0 mirror -- coins and start buttons
07F8	is the one-player start held?
07FA	held: begin a one-player game
07FD	read the credit count
0801	just one credit: hold on this screen rather than advancing
0802	command one, caption argument twenty-five
0805	post it to the command ring
0806	step the attract sequence
0809	read the era
080C	scale the era by ten to reach its row in the glyph table
0811	point at the table of per-era glyph rows
0814	index into it by the era offset
0815	take the first bar glyph
0817	and the second bar glyph
0818	step past to the eight end glyphs
0819	read how many kills are still owed
081D	its low three bits choose which end glyph
081F	read that end glyph from the row
0820	set the end glyph aside
0821	bring the count back
0822	point at the fixed end of the meter line
0825	step of minus thirty-two -- one cell back per bar cell laid
0828	divide the count by four -- one bar cell per four kills
082A	keep count/4 in five bits -- the remainder bits the rotates carried round to the top drop out
082C	no full cells: skip straight to the end glyph
082E	lay a first-glyph bar cell
0831	count exhausted: lay the end glyph
0833	lay a second-glyph bar cell
0836	more cells to lay: go back for another pair
0838	bring the end glyph back
0839	lay the end glyph
083B	blank the cell past the end glyph
083E	request the flashing copyright line
0841	stamp the copyright caption strip
0844	command one, first caption argument
0847	two captions to post in this run
0849	post this caption command
084A	step to the next caption argument
084D	skip an argument
084E	five more captions to post
0850	post this caption command
0854	the twentieth caption argument
0856	post it
0857	step to the twenty-first caption argument
0858	post it
0859	point at the program block to verify
085C	twenty-four bytes to fold
085E	clear the running total
085F	fold the next byte in by exclusive-or
0863	subtract the genuine total
0865	any other total means a tampered image: derail to the failure landing
0868	step the sequence sub-step
08AE	point at the program block to fold
08B1	thirty bytes of it to take
08B4	draw the interpolated pen run
08B7	leave if the run has not finished
08B8	two hundred fifty-six bytes to fold -- zero count means the full round
08BA	point at the program run to verify
08BD	clear the running total
08BE	fold the next byte in by exclusive-or
08C2	add the genuine total's complement
08C4	mismatch means a tampered image: derail
08C7	command one, caption argument nineteen
08CA	post it to the ring
08CB	command one, caption argument zero
08CD	post it
08CE	caption argument twenty
08D0	post it
08D1	caption argument twenty-one
08D2	post it
08D3	caption argument twelve
08D5	post it
08D6	paint the five labelled numeric readouts
08D9	point at the five bytes to clear
08DC	the value to clear them with: zero
08DD	five bytes to clear
08DF	clear this byte
08E3	set the sixth byte to three
08E5	read the destination pointer
08E9	read the index
08EC	point at the lookup table
08EF	read the entry the index selects
08F0	store it at the destination
08F1	cross to the other plane for the same cell
08F3	read what stands there
08F4	keep it
08F7	step the sequence sub-step
0B06	point at the strip's four display-list entries
0B0A	four pieces to lay
0B0C	first shape number, counting up one per piece
0B0E	the leading edge on the stepping axis
0B10	the shared position on the fixed axis
0B12	set this piece's position on the stepping axis
0B15	set its position on the fixed axis
0B18	set its shape number
0B1B	set its colour and attributes
0B23	next shape number
0B25	step the leading edge back by sixteen for the next piece
0B2B	point at the first caption sprite's position
0B2E	step two slots at a time
0B31	four caption sprites to hide
0B33	the value that hides them: zero
0B34	push this sprite above the top line by zeroing its vertical byte
0B39	read the frame counter
0B3C	test its low bit, which flips every frame
0B3E	even frame: queue the other version of the line
0B40	command one, this frame's argument
0B43	post it to the command ring, so the line flashes frame to frame
0B46	command one, argument thirty-one -- the other version of the copyright line
0B49	post it to the command ring
0B4C	clear the running total before folding the run
0B4D	add the next byte into the total
0B51	does the total match the byte the caller named?
0B52	yes: answer that it matches
0B53	no: answer that it does not
0B90	back to the top of the command-ring drain
0B93	the command ring lives on page $AC
0B95	read the ring's read cursor
0B98	point at the cell it names
0B99	take that cell's command byte
0B9A	rotate its top bit out
0B9B	top bit set means the cell is empty: wait a frame and look again
0B9E	keep the command
0B9F	free the cell so it can be filled again
0BA1	step to the argument cell
0BA2	take the argument
0BA3	free that cell too
0BA7	keep the cursor inside the sixty-four-cell ring
0BA9	save the advanced read cursor
0BAD	the command's low nibble picks one of sixteen handlers
0BAF	point at the handler table
0BB2	read this handler's address from it
0BB5	hand the argument to the handler
0BB9	make the loop top the handler's return
0BBB	run the handler
0BF2	point at the caption-record table
0BF5	read the record pointer this caption index selects
0BF8	point at that record
0BF9	read the low byte of the cell the caption starts at
0BFA	step to the high byte
0BFB	read the high byte -- the caption's first cell
0BFC	step on
0BFD	read the colour every cell of the caption takes
0BFE	step to the glyph run, then fall into the painter
0BFF	read the next glyph of the run
0C00	is it the run-ending code?
0C02	end reached: stop, leaving the pointer on the terminator
0C03	write the glyph into the character cell
0C04	drop to the colour plane beneath it
0C06	fetch the caption's colour
0C07	give the cell its colour
0C08	back up to the character plane
0C0A	step to the next glyph
0C0B	step the cursor one cell along the line
0C0C	round the loop for the next glyph
0D6B	the leftmost digit lands here
0D6E	print from the high score's top byte -- the field is walked downward
0D71	colour for every digit, then fall into the printer
0D73	zero the significant-digit flag, shared by the two suppressing digit pairs, so leading zeros blank until the first non-zero digit
0D75	print the top two digits, suppressing leading zeros
0D78	step back one source byte
0D79	print the next two, still suppressing
0D7D	print the last two plainly, so they always show
0D81	read the packed byte
0D82	rotate the high nibble down into the low four bits
0D86	print the high digit
0D89	step the cursor one cell on
0D8A	read the byte again for the low digit
0D8B	print the low digit
0D8E	step the cursor on
0D90	keep the low four bits -- the digit value
0D92	save the caller's run pointer
0D93	point at the digit-glyph table
0D96	look up this digit's glyph (zero prints a '0' here)
0D97	restore the run pointer
0D98	write the glyph into the cell
0D99	drop to the colour plane
0D9B	take the caller's colour
0D9C	colour the cell
0D9D	back to the character plane
0DA0	read the packed byte
0DA1	rotate the high nibble down into the low four bits
0DA5	print the high digit, suppressing a leading zero
0DA8	step the cursor on
0DA9	read the byte again for the low digit
0DAA	print the low digit, still suppressing
0DAD	step the cursor on
0DAF	keep the low four bits -- the digit
0DB1	a zero digit: decide blank versus '0'
0DB3	non-zero: mark that a significant digit has been seen
0DB4	and print it by its own value
0DB6	a zero: take the blank-glyph index from the program image
0DB9	momentarily bump the seen-digit count
0DBA	drop it back, setting the flags: has a significant digit been seen yet?
0DBB	none yet: print the blank
0DBD	one already seen: print '0' instead
0DBE	save the caller's run pointer
0DBF	point at the digit-glyph table
0DC2	look up the glyph for this index
0DC3	restore the run pointer
0DC4	write the glyph into the cell
0DC5	drop to the colour plane
0DC7	take the caller's colour
0DC8	colour the cell
0DC9	back to the character plane
0DD7	point at the start of the pictogram row
0DDA	is the count 100 or more?
0DDC	under 100: keep the value
0DDE	clamp to 99
0DE0	tally the denominations in the spare registers, leaving the row cursor alone
0DE1	no thirties yet
0DE3	subtract thirty
0DE5	gone negative: no more thirties
0DE7	one more thirty
0DE8	keep subtracting
0DEA	add the last thirty back
0DEC	no tens yet
0DEE	subtract ten
0DF0	gone negative: no more tens
0DF2	one more ten
0DF3	keep subtracting
0DF5	add the last ten back
0DF7	no fives yet
0DF9	subtract five
0DFB	gone negative: no more fives
0DFD	one more five
0DFE	keep subtracting
0E00	add the last five back
0E02	what remains is the count of ones
0E03	return to the drawing registers
0E04	dip into the spare registers for the ones count
0E05	take the count of ones
0E06	back to the drawing registers
0E07	any ones to draw?
0E08	none: on to the fives
0E0A	ones tile code
0E0C	ones colour
0E0E	park the remaining count out of the way
0E0F	draw one 'ones' block
0E12	take the count back
0E13	one fewer to draw
0E14	more ones? round again
0E16	dip into the spare registers
0E17	take the count of fives
0E18	back to the drawing registers
0E19	any fives to draw?
0E1A	none: on to the tens
0E1C	fives tile code
0E1E	fives colour
0E20	park the count
0E21	draw one 'fives' block (a two-tile mark)
0E24	take the count back
0E25	one fewer
0E26	more fives? round again
0E28	dip into the spare registers
0E29	take the count of tens
0E2A	back to the drawing registers
0E2B	any tens to draw?
0E2C	none: on to the thirties
0E2E	tens tile code
0E30	tens colour
0E32	park the count
0E33	draw one 'tens' block (a four-tile mark)
0E36	take the count back
0E37	one fewer
0E38	more tens? round again
0E3A	dip into the spare registers
0E3B	take the count of thirties
0E3C	back to the drawing registers
0E3D	any thirties to draw?
0E3E	none: on to padding the row
0E40	thirties tile code
0E42	thirties colour
0E44	park the count
0E45	draw one 'thirties' block (a four-tile mark)
0E48	take the count back
0E49	one fewer
0E4A	more thirties? round again
0E4C	blank glyph in B, its colour in C
0E4F	load the end-of-row test value
0E52	reached the end of the row?
0E53	row full: run the integrity check
0E55	blank the next slot
0E58	keep padding
0E5A	start the running total at zero
0E5B	take the first integrity word from the program image
0E5E	take the second integrity word
0E62	take the third integrity word
0E66	fold the words together
0E67	fold in the third
0E68	add in the low half
0E69	add in the high half
0E6A	a genuine image nets to this constant
0E6C	tampered: restart the machine from the reset entry
0E70	take the base tile code
0E71	the top-right quarter is base+1
0E72	lay it in the cursor cell
0E73	back to the base code
0E74	step one cell back
0E75	lay the top-left quarter (the base code)
0E76	drop down one line
0E77	the base code again
0E78	the bottom-left quarter is base+2
0E7A	lay it in
0E7B	the bottom-right quarter is base+3
0E7C	step one cell on
0E7D	lay it in
0E7E	offset down to the colour plane
0E81	point at the bottom-right quarter's colour cell
0E82	leave the cursor two lines on, clear of the block
0E83	colour the bottom-right quarter
0E84	step back one cell
0E85	colour the bottom-left quarter
0E87	step up to the top row's colour cells
0E89	colour the top-left quarter
0E8A	step on one cell
0E8B	colour the top-right quarter
0E8D	work with the cursor in HL
0E8E	write the glyph into the cell
0E8F	step one cell back
0E90	blank that cell
0E92	drop to the colour plane
0E94	colour the blanked cell
0E95	step one cell on
0E96	colour the glyph cell
0E97	back to the character plane
0E99	cursor back into place
0E9A	step on to the next slot
0E9C	work with the cursor in HL
0E9D	the upper tile code is base+1
0E9E	lay it in the cursor cell
0E9F	back to the base code
0EA0	step one cell back, to the cell before the cursor
0EA1	lay the lower tile (the base code)
0EA2	drop to the colour plane
0EA4	colour the base-code cell
0EA5	step on to the cursor cell
0EA6	colour the base+1 cell
0EA7	back to the character plane
0EA9	cursor back into place
0EAA	step on past the block
0F11	point at the sequence phase
0F14	step to the next phase
0F16	restart the inner sub-step at zero for the new phase
0F1A	point at the sequence sub-step
0F1D	step it on by one
0F1F	the continuation to run once the arm returns
0F22	park it as the arm's return
0F23	take the sub-step
0F26	its low nibble picks the arm
0F28	jump into that arm through the inline table just past here
0F54	read the play-active flag
0F58	a game is running: nothing to do here
0F59	read the credit count
0F5D	a credit is waiting: arm the start
0F5F	read the free-play flag
0F63	not free play: nothing to start
0F64	read the control inputs
0F67	mask the two start buttons
0F69	neither held: wait
0F6A	hide all the sprites
0F6D	start the free-play game
0F70	clear the sequence sub-step
0F74	take the "credit taken" phase from the program image
0F77	set the sequence phase to it
0F7B	double the index...
0F7C	...and again: x4 for the four-byte record (kept to a byte, so index 64+ wraps onto a wrong record)
0F7D	point at the difficulty-record table
0F80	point at the live difficulty settings
0F83	step to the selected record
0F84	copy the first setting byte
0F86	copy the second
0F88	copy the third
0F8A	copy the fourth
0F97	read the first scenery slot's Y byte -- bit 7 marks a slot wanting a second image this frame
0F9A	test that request bit
0F9C	clear -- move on to the next slot
0F9F	read the live scanline counter
0FA2	add the slot's line -- carry once the beam has passed it
0FA3	beam not past yet -- leave this slot untouched this pass
0FAA	clear bit 7 -- shifts the slot half a screen and clears its request
0FAC	store the moved Y byte
0FAF	read the slot's paired X byte
0FB2	add half a screen across
0FB4	store it -- the same sprite draws again half a screen away, with no extra hardware slot
0FB7	read the next slot's Y byte
0FBA	test its request bit
0FBC	clear -- next slot
0FBF	read the scanline counter
0FC2	carry once the beam is past this slot's line
0FC3	beam not past -- skip this slot this pass
0FCA	clear bit 7 -- shift half a screen, clear the request
0FCC	store the moved Y byte
0FCF	read the paired X byte
0FD2	add half a screen across
0FD4	store it -- second image placed
0FD7	read the next slot's Y byte
0FDA	test its request bit
0FDC	clear -- next slot
0FDF	read the scanline counter
0FE2	carry once the beam is past this slot's line
0FE3	beam not past -- skip this slot this pass
0FEA	clear bit 7 -- shift half a screen, clear the request
0FEC	store the moved Y byte
0FEF	read the paired X byte
0FF2	add half a screen across
0FF4	store it -- second image placed
0FF7	read the next slot's Y byte
0FFA	test its request bit
0FFC	clear -- next slot
0FFF	read the scanline counter
1002	carry once the beam is past this slot's line
1003	beam not past -- skip this slot this pass
100A	clear bit 7 -- shift half a screen, clear the request
100C	store the moved Y byte
100F	read the paired X byte
1012	add half a screen across
1014	store it -- second image placed
1017	read the next slot's Y byte
101A	test its request bit
101C	clear -- next slot
101F	read the scanline counter
1022	carry once the beam is past this slot's line
1023	beam not past -- skip this slot this pass
102A	clear bit 7 -- shift half a screen, clear the request
102C	store the moved Y byte
102F	read the paired X byte
1032	add half a screen across
1034	store it -- second image placed
1037	read the next slot's Y byte
103A	test its request bit
103C	clear -- next slot
103F	read the scanline counter
1042	carry once the beam is past this slot's line
1043	beam not past -- skip this slot this pass
104A	clear bit 7 -- shift half a screen, clear the request
104C	store the moved Y byte
104F	read the paired X byte
1052	add half a screen across
1054	store it -- second image placed
1057	read the next slot's Y byte
105A	test its request bit
105C	clear -- next slot
105F	read the scanline counter
1062	carry once the beam is past this slot's line
1063	beam not past -- skip this slot this pass
106A	clear bit 7 -- shift half a screen, clear the request
106C	store the moved Y byte
106F	read the paired X byte
1072	add half a screen across
1074	store it -- second image placed
1077	read the last slot's Y byte
107A	test its request bit
107C	clear -- done
107F	read the scanline counter
1082	carry once the beam is past this slot's line
1083	beam not past -- skip this slot this pass
108A	clear bit 7 -- shift half a screen, clear the request
108C	store the moved Y byte
108F	read the paired X byte
1092	add half a screen across
1094	store it -- second image placed
1098	read the first scenery slot's Y byte -- this pass waits on the beam rather than skipping
109B	test its request bit
109D	clear -- next slot
10A0	read the scanline counter
10A3	carry once the beam is past this slot's line
10A4	beam not past -- hold here until it is
10AB	clear bit 7 -- shift the slot half a screen, clear its request
10AD	store the moved Y byte
10B0	read the paired X byte
10B3	add half a screen across
10B5	store it -- second image placed
10B8	read the next slot's Y byte
10BB	test its request bit
10BD	clear -- next slot
10C0	read the scanline counter
10C3	carry once the beam is past this slot's line
10C4	beam not past -- hold here until it is
10CB	clear bit 7 -- shift half a screen, clear the request
10CD	store the moved Y byte
10D0	read the paired X byte
10D3	add half a screen across
10D5	store it -- second image placed
10D8	read the next slot's Y byte
10DB	test its request bit
10DD	clear -- next slot
10E0	read the scanline counter
10E3	carry once the beam is past this slot's line
10E4	beam not past -- hold here until it is
10EB	clear bit 7 -- shift half a screen, clear the request
10ED	store the moved Y byte
10F0	read the paired X byte
10F3	add half a screen across
10F5	store it -- second image placed
10F8	read the next slot's Y byte
10FB	test its request bit
10FD	clear -- skip ahead to the following slot
1100	read the scanline counter
1103	carry once the beam is past this slot's line
1104	beam not past -- hold here until it is
110B	clear bit 7 -- shift half a screen, clear the request
110D	store the moved Y byte
1110	read the paired X byte
1113	add half a screen across
1115	store it -- second image placed
1118	read the next slot's Y byte
111B	test its request bit
111D	clear -- next slot
1120	read the scanline counter
1123	carry once the beam is past this slot's line
1124	beam not past -- hold here until it is
112B	clear bit 7 -- shift half a screen, clear the request
112D	store the moved Y byte
1130	read the paired X byte
1133	add half a screen across
1135	store it -- second image placed
1138	read the next slot's Y byte
113B	test its request bit
113D	clear -- next slot
1140	read the scanline counter
1143	carry once the beam is past this slot's line
1144	beam not past -- hold here until it is
114B	clear bit 7 -- shift half a screen, clear the request
114D	store the moved Y byte
1150	read the paired X byte
1153	add half a screen across
1155	store it -- second image placed
1158	read the next slot's Y byte
115B	test its request bit
115D	clear -- next slot
1160	read the scanline counter
1163	carry once the beam is past this slot's line
1164	beam not past -- hold here until it is
116B	clear bit 7 -- shift half a screen, clear the request
116D	store the moved Y byte
1170	read the paired X byte
1173	add half a screen across
1175	store it -- second image placed
1178	read the last slot's Y byte
117B	test its request bit
117D	clear -- done
1180	read the scanline counter
1183	carry once the beam is past this slot's line
1184	beam not past -- hold here until it is
118B	clear bit 7 -- shift half a screen, clear the request
118D	store the moved Y byte
1190	read the paired X byte
1193	add half a screen across
1195	store it -- second image placed
1199	re-aim and animate the enemy craft for this phase tick
119C	update the player ship for this frame
119F	fire and advance the player's shots
11A2	drive the enemy wave for the current life phase
11A5	run a sprite-doubling pass -- called repeatedly through the frame so scenery sprites redraw as the beam descends
11A8	run the parachutist
11AB	arm or step the mother ship
11AE	step the seven enemy-craft slots
11B1	another sprite-doubling pass
11B4	draw the scenery for the current era
11B7	sweep the era-2-and-up object bank
11BA	another sprite-doubling pass
11BD	service the era-1 bomber
11C0	service the era-1 fixed object slot
11C3	step the four actor slots
11C6	another sprite-doubling pass
11C9	service the era-0 ballistic object bank
11CC	run the collision pass for this era
11CF	ask for a sound while the formation is clear
11D2	another sprite-doubling pass
11D5	grant a bonus life at the score mark
11D8	expire the hit chain
11DB	step difficulty up when the counter wraps
11DE	repaint the kill meter
11E1	a final sprite-doubling pass (the variant that waits on the beam)
11E4	read the player-state byte
11E7	0xFF (still alive) rolls to zero here
11E8	alive -- advance the round once the field is cleared
11EB	back to the raw state -- zero flags a dead player
11EC	neither alive nor dead -- nothing to resolve, return
11ED	blank the whole sprite band
11F0	read the round-transition hold
11F3	is it set?
11F4	set -- start the next round
11F7	queue this frame's fixed sound requests
11FA	point at the live context block -- its first byte is the lives count
11FD	drop the lives count by one
11FE	remember whether that reached zero
11FF	read the active-player selector
1202	which player is up?
1203	default the save slot to player 1's
1206	player 1 -- keep it
1208	player 2 -- use the other save slot
120B	source is the live context block
120E	sixteen bytes
1211	checkpoint the live block into the active player's save slot
1213	recall whether lives hit zero
1214	out of lives -- go post the game-over banner
1216	read the active-player selector again
1219	which player is up?
121A	point at player 2's save slot
121D	player 1 up -- the other player is player 2
121F	player 2 up -- the other player is player 1
1222	read the other player's saved lives count
1223	does the other player still have lives?
1224	no -- skip the flip and just re-arm the delay
1226	read the active-player selector
1229	flip it...
122A	...to the other player (one-bit index)
122C	store the new active player -- this flip is the hand-over itself
122F	hold value 90...
1231	...into the shared sequence delay
1234	take the inner sequence step from the program image
1237	reseat the inner sequence step for the next life
1253	read the in-play flag
1256	is a game running?
1257	not running -- hand the machine back to attract
125A	caption command 2, argument 9 -- the PLAYER 1 banner
125D	read the active-player selector
1260	player 1 or 2?
1261	player 1 -- keep argument 9
1263	player 2 -- bump the argument to 10 (PLAYER 2)
1264	queue that PLAYER-n banner command
1265	caption command 10, argument 11 -- the GAME OVER banner
1268	queue the GAME OVER banner command
1269	hold value 180 (about three seconds)...
126B	...into the sequence delay, holding the banners on screen
126E	step the sequence on
1271	read the kills still owed this round
1274	is it clear?
1275	not clear -- do nothing
1276	read the round-transition hold
1279	is it armed?
127A	clear -- do nothing
127B	point at the first of fifteen object slots
127E	sixteen bytes per slot
1281	fifteen slots to check
1283	read this slot's head byte
1284	is the slot empty?
1285	a slot is still occupied -- the field isn't clear, return
1287	check every one of the fifteen slots
1289	queue this frame's fixed sound requests
128C	read the in-play flag
128F	is a game running?
1290	attract mode -- take the reset arm
1292	point at a strided run of cells
1295	twenty-three of them
1297	the zero to write
1298	zero every other cell along the run
129B	clear all twenty-three
129D	start the next round
12A0	read the active-player selector
12A3	which player is up?
12A4	default the save slot to player 1's
12A7	player 1 -- keep it
12A9	player 2 -- use the other save slot
12AC	source is the live context block
12AF	sixteen bytes
12B2	checkpoint the live block into the player's save slot
12B4	take the inner sequence step from the program image
12B7	reseat the inner sequence step
12BB	take the hold's reset value (zero) from the program image
12BE	clear the round-transition hold
12C1	blank the whole sprite band
12C4	hand the machine back to attract
12E2	point at the sequence delay counter
12E5	tick it down one
12E6	still counting -- return; at zero it falls through into the turn-pass logic
12E7	read the active-player selector
12EA	which player is up?
12EB	point at player 2's saved block
12EE	player 1 up -- the other is player 2
12F0	player 2 up -- the other is player 1
12F3	read the other player's saved lives count
12F4	does the other player still have lives?
12F5	yes -- hand the turn to the other player
12F8	no -- just step the inner sequence step on
12FB	clear A
12FC	clear the in-play flag
12FF	clear the inner sequence step
1302	clear the active-player index
1305	take the outer sequence phase from the program image
1308	set the outer sequence phase -- top of attract
130B	read a program-image byte as an unsigned offset
130E	read a program-image address
1311	step that address on by the unsigned offset
1312	fold the stepped address's high byte into the offset byte
1313	subtract the bias -- on an untouched image this comes out zero
1315	write the inner step a second time -- agrees with the clear on an intact ROM, diverges if it was altered
1319	step of -32 -- one cell up the column per write
131C	thirteen cells to fill
131E	write the fill byte into this cell
131F	back up one native row (32 cells)
1320	fill all thirteen
1323	read the frame tick
1326	act only while bit 1 of the tick is clear -- two frames in every four
1328	bit 1 set -- skip this frame
1329	read the intro-animation step
132C	step 0?
132D	not step 0 -- try the next arm
132F	step 0 -- flash the player ship white
1333	step 1?
1334	no -- next arm
1336	flash the player ship white
1339	advance the character-plane band animation toward stage 2
133D	step 2?
133E	no -- next arm
1340	cycle the player ship's colour
1343	advance the character-plane band animation toward stage 4
1347	step 3?
1348	no -- next arm
134A	advance the character-plane band animation toward stage 4
134E	step 4?
134F	no -- final arm
1351	flood the colour plane with the player's saved colour
1355	hold value 90...
1357	...into the sequence delay
135A	blank the whole sprite band
135D	set up the active player's turn and post the round HUD
1360	take the sub-step reload from the program image (= 3)
1363	reseat the inner sequence step at 3
1367	read this flash animation's tick counter
136A	has it reached eight?
136C	not yet -- just recolour
136E	value 1...
1370	...into the intro-animation step -- move it on
1373	ask for the player-spawn flash sound
1376	read the tick again
1379	take its low bit
137B	colour 0x3E -- the white flash colour
137D	even tick -- keep it
137F	odd tick -- colour 0, the ship's normal colour
1381	hold the chosen colour
1382	read the player ship's sprite attribute
1385	keep only its two mirroring bits
1387	merge in the chosen colour
1388	write it back -- flips the ship white and back
138B	read the tick
138E	step it
138F	store it -- wraps at eight bits
1393	read the ship-colour cycle countdown
1396	is the countdown already at zero?
1397	not yet -- pick a colour from the count
1399	value 3...
139B	...into the intro-animation step -- countdown spent, move on to step 3
139E	use colour 0x3F
13A0	go apply it
13A2	test bit 2 of the count
13A4	bit set -- take the alternate colour
13A6	bit clear -- colour 0x3F
13A8	apply it
13AA	walk the selector toward the alternate colour
13AB	branch on
13AD	colour 0x36 -- an arm this path never reaches
13AF	apply it
13B1	walk the selector on
13B2	branch on
13B4	colour 0x3E -- also unreached on this path
13B6	apply it
13B8	the alternate colour 0x37
13BA	hold the chosen colour
13BB	read the player ship's sprite attribute
13BE	keep only the two mirroring bits
13C0	merge in the colour
13C1	write it back -- recolours the ship
13C4	read the countdown
13C7	step it down (wraps below zero)
13C8	store it
13CC	value 5...
13CE	...into the intro-animation step -- move on to step 5
13D1	read the active-player selector
13D4	which player is up?
13D5	read player 1's saved pen colour
13D8	hold it as the flood colour
13D9	player 1 -- use it
13DB	player 2 -- read player 2's saved pen colour
13DE	hold it instead
13DF	read the screen-orientation flag
13E2	is the screen turned round?
13E3	put the flood colour in A
13E4	turned round -- paint from the far corner backwards
13E6	forward: first cell of the colour-plane rectangle
13E9	copy destination one cell along
13ED	twenty-eight rows
13F0	twenty-six trailing copies per row
13F3	paint the row's first cell
13F4	flood the rest of the row with the same colour
13F6	skip forward six cells...
13F9	...to the start of the next row (27 painted, 32-cell stride)
13FE	paint all twenty-eight rows
1400	read the flood countdown
1403	step it down
1404	store it
1408	backwards: last cell of the rectangle
140B	copy destination one cell back
140F	twenty-eight rows
1412	twenty-six trailing copies per row
1415	paint the row's cell
1416	flood the rest of the row backwards with the same colour
1418	step back six cells...
141B	...to the previous row
1420	paint all twenty-eight rows
1422	read the flood countdown
1425	step it down
1426	store it
142A	read the pass countdown
142D	which pass -- odd draws, even blanks
142F	even -- go blank the band
1431	load the script cursor
1434	read the byte under it
1435	end-of-script marker (0xFF)?
1437	no -- draw this frame
1439	value 0...
143B	...clears the pass countdown -- script done
143E	value 2...
1440	...into the intro-animation step -- advance to stage 2
1443	reload the script cursor
1446	step it back one
1447	save it -- ending early with no decrement
144B	restore the working column from its saved run
144E	load the script cursor
1451	read the next script byte
1452	take its low bit
1455	step the cursor past it
1458	bit clear -- skip this nudge
145A	row stride 32
145D	point at the column's top counter
1460	nudge it up
1462	nudge the counter one row below
1463	point at another column counter
1466	nudge it up
1468	nudge the counter one row below
1469	load the cursor
146C	read the next script byte
146D	take its low bit
1470	step the cursor past it
1473	bit clear -- skip this nudge
1475	row stride 32
1478	point at a column counter
147B	nudge it up
147D	nudge the counter one row below
147E	direction bits 2 -- shapes step forward, cells climb the plane
1480	column of glyph cells
1483	step thirteen scripted glyph cells forward a shape, climbing the column from row 14
1486	load the cursor
1489	step of -13...
148C	...rewind the cursor thirteen bytes
148D	save it
1490	direction bits 0 -- shapes step forward, cells descend the plane
1492	the same column, three rows below the first run's start
1495	step those thirteen glyph cells forward a shape, descending the column
1498	gather the column back into its saved run
149B	on to the decrement
149D	the blank tile
149F	first column to blank
14A2	blank that thirteen-cell column
14A5	second column to blank
14A8	blank it too
14AB	point at a lead cell
14AE	blank it
14B0	blank the cell one row above it
14B1	next lead cell
14B4	blank it
14B6	blank the cell one row above it
14B7	last lead cell
14BA	blank it
14BC	blank the cell one row above it
14BD	read the pass countdown
14C0	step it down
14C1	store it
14C5	read the pass countdown
14C8	which pass -- odd draws, even blanks
14CA	even -- go blank the band
14CC	load the script cursor
14CF	read the byte under it
14D0	any bit above bit 0 set (terminator)?
14D2	no -- draw this frame
14D4	value 0...
14D6	...clears the pass countdown -- script done
14D9	value 4...
14DB	...into the intro-animation step -- advance to stage 4
14DE	request the inter-round sound pair
14E1	reload the cursor
14E5	step the cursor on -- ending early
14E9	restore the working column from its saved run
14EC	direction bits 1 -- shapes step back, cells descend the plane
14EE	column of glyph cells
14F1	step thirteen scripted glyph cells back a shape, walking down the column
14F4	load the cursor
14F7	step of +13...
14FA	...skip the cursor thirteen bytes forward
14FB	save it
14FE	direction bits 3 -- shapes step back, cells climb the plane
1500	the same column's bottom visible cell, row 29
1503	step those thirteen glyph cells back a shape, climbing the column
1506	load the cursor
1509	read the next script byte
150A	take its low bit
150D	step the cursor back
1510	bit clear -- skip this nudge
1512	row stride 32
1515	point at a lead counter
1518	lower it
151A	lower the counter one row below
151B	load the cursor
151E	read the next script byte
151F	take its low bit
1522	step the cursor back
1525	bit clear -- skip this nudge
1527	row stride 32
152A	point at a column counter
152D	lower it
152F	lower the counter one row below
1530	point at another column counter
1533	lower it
1535	lower the counter one row below
1536	gather the column back into its saved run
1539	on to the decrement
153B	the blank tile
153D	first column to blank
1540	blank the thirteen-cell column
1543	second column to blank
1546	blank it too
1549	point at a lead cell
154C	blank it
154E	blank the cell one row above it
154F	next lead cell
1552	blank it
1554	blank the cell one row above it
1555	last lead cell
1558	blank it
155A	blank the cell one row above it
155B	read the pass countdown
155E	step it down
155F	store it
1563	point at the saved thirty-two byte run
1566	point at the column of cells to repaint
1569	one cell-row stride
156D	twenty-eight cells down the column
1570	take the next saved byte
1571	lay it into the column cell
1572	next saved byte
1573	step down one row to the next cell
1575	repeat for all twenty-eight cells
1578	point at the first two-cell stub column
157B	take the next saved byte
157C	lay it into the stub cell
157D	step down one row
157E	next saved byte
157F	take the next saved byte
1580	lay it into the cell below
1581	next saved byte
1582	point at the second stub column
1585	take the next saved byte
1586	lay it in
1587	step down one row
1588	next saved byte
1589	take the last saved byte
158A	lay it into the last cell
158C	point at the thirty-two byte backing run
158F	point at the column of cells to read
1592	one cell-row stride
1596	twenty-eight cells down the column
1599	read this column cell
159A	store it into the run
159B	next run byte
159C	step down one row to the next cell
159E	repeat for all twenty-eight cells
15A1	point at the first two-cell stub column
15A4	read the stub cell
15A5	store it into the run
15A6	step down one row
15A7	next run byte
15A8	read the cell below
15A9	store it
15AA	next run byte
15AB	point at the second stub column
15AE	read the stub cell
15AF	store it
15B0	step down one row
15B1	next run byte
15B2	read the last cell
15B3	store it
15B6	point at the sprite vertical-position band
15B9	twenty-four sprite slots
15BB	zero -- the value that parks a slot
15BC	park this slot above the top line, hiding it
15BE	skip two cells to the next slot's vertical byte
15BF	over all twenty-four slots
15C2	take the inner sequence sub-step
15C5	keep its low three bits -- eight arms
15C7	jump to the selected arm through the inline word table
15E2	arm the whole-plane wipe -- derailing if the image was altered
15E5	read a program byte -- the low half of a call operand, so an edit moves it
15E8	seat it as the inner sequence sub-step
15EB	256 bytes to fold
15ED	point at that program-image block
15F0	take the outer sequence phase
15F3	fold: subtract each image byte from the phase
15F4	next image byte
15F6	over all 256 bytes
15F8	exclusive-or a fixed key into the result
15FA	write it back as the phase -- corrupts the sequence if the image was altered
15FE	blank one line of the character plane
1601	more lines still to blank -- leave until the block is cleared
1602	command 1, argument 5
1605	queue it on the request ring
1606	argument 6
1607	queue it
1608	argument 7
1609	queue it
160A	command 6, argument 1
160D	queue it
160E	marker glyph
1610	seed it into one cell
1613	and into another
1616	point at the six-entry patch list that follows
1619	six cells to patch
161B	read the destination address low byte
161D	and its high byte
161F	read the value
1620	write it into the destination cell
1621	the cell beside it
1623	stamp marker 5 next to it
1626	next patch entry
1627	over all six
1629	print the six-digit high-score readout
162E	set the outer sequence phase to 1
1632	set the inner sub-step to 2
1635	read the free-play flag
1639	leave unless free play
163A	command 1, argument 0x0D
163D	queue it
1651	point at the shared tail
1654	park it as the return each arm falls back to
1655	take the inner sequence sub-step
1658	jump to the selected arm through the inline word table
167B	read the credit count
167F	credits on hand: step the outer sequence phase and leave
1682	read the free-play flag
1686	not free play: leave
1687	read the panel input mirror
168A	keep the two start-button bits
168C	neither start held: leave
168D	sweep every sprite off the picture
1690	read the panel input mirror
1693	is the two-player start held?
1695	yes: start a two-player game
1697	is the one-player start held?
1699	yes: start a one-player game
169B	neither held: do nothing
169E	raise the play-active flag
16A1	raise the two-player flag
16A4	read the per-game life allowance
16A7	stock player one's lives
16AA	stock player two's lives
16AD	seat the round-start phase
16AF	256 bytes to fold
16B1	point at a program-image block
16B4	take the outer sequence phase
16B7	fold: subtract each image byte from the phase
16B8	next image byte
16B9	over all 256 bytes
16BB	exclusive-or a fixed key into the result
16BD	write it back as the phase -- corrupts the sequence if the image was altered
16C0	run the sprite multiplexer
16C3	advance the player this frame by its state
16C6	run the sprite multiplexer again
16C9	run the scenery for this era
16CC	run the sprite multiplexer
16CF	read the frame counter
16D4	even frame: skip the delay tick
16D6	point at this step's delay counter
16D9	count it down one frame
16DA	not expired yet
16DC	on expiry: command 3, argument 9
16DF	queue it on the request ring
16E0	argument 0x0E
16E2	queue it
16E3	argument 0x1A
16E5	queue it
16E7	clear the round-armed flag
16EC	reload the step-delay counter to 0x2A frames
16EF	step the sequence sub-index and leave
16F2	read the round-armed flag
16F6	not armed: leave
16F7	read the frame counter
16FA	keep its low nibble
16FC	frame nibble 0
1700	frame nibble 5
1704	frame nibble 0x0A
1706	any other frame: leave
1707	command 2
170B	command 0x0A
170F	command 0x0B
1711	read the era index
1714	offset it to the caption argument
1717	queue that command onto the request ring
1719	zero
171A	clear the two-player flag
171D	clear player two's lives
1721	raise the play-active flag
1724	read the per-game life allowance
1727	stock player one's lives
172C	seat the outer sequence at its last phase, 3
1730	restart the inner sub-step at zero
1734	draw and advance one interpolated pen run
1737	not yet reseated to a zero row -- leave
1738	point at the guarded code block
173B	its length -- thirty-four bytes
173D	start the running total at zero
173E	subtract each byte -- a two's-complement checksum
173F	next byte
1740	over all thirty-four bytes
1742	store the checksum -- zero on an untampered block
1745	step the sequence sub-index
1748	re-stamp the copyright caption strip
174B	flash the copyright line
174E	point at this step's delay counter
1751	count it down one frame
1752	still waiting -- leave
1753	point at the sampled copyright caption cell
1756	point at the tamper-witness pair
1759	read its glyph
175A	save the glyph
175C	cross to the colour plane of the same cell
175E	read its colour
175F	save the colour beside the glyph
1760	command 3, argument 3
1763	queue it -- erase one coin-invitation caption
1764	argument 4
1765	queue it -- erase the other
1766	step the sequence sub-index
176A	verify the copyright line's colours -- derail if wrong
176D	read a caption cell
1770	is its glyph the expected one?
1772	wrong glyph: derail into the mother-ship warp-flash handler
1775	command 1, argument 0x13
1778	queue it
1779	paint the five labelled numeric readouts
177C	point at a character cell
177F	point at a tamper-witness pair
1782	read its glyph
1783	save the glyph
1785	cross to the colour plane of the same cell
1787	read its colour
1788	save the colour beside it
1789	step the sequence sub-index
178C	re-stamp the copyright caption strip
178F	flash the copyright line
1792	point at this step's delay counter
1795	count it down one frame
1796	still waiting -- leave
1797	verify the copyright line's colours -- derail if wrong
179A	read a program byte
179D	offset it
179F	as the pointer low byte
17A0	offset it again
17A2	as the pointer high byte
17A3	read the addressed cell
17A4	is its glyph the expected one?
17A6	wrong glyph: derail into the jump-table bytes, run as code
17A9	point at a character cell
17AC	point at a tamper-witness pair
17AF	read its glyph
17B0	save the glyph
17B2	cross to the colour plane of the same cell
17B4	read its colour
17B5	save the colour beside it
17B6	step the sequence sub-index
17B9	read a byte of the program image
17BD	seed the running total from a program byte
17C0	point at the guarded block
17C3	fifty-one bytes to add
17C5	add each byte into the total
17C6	next byte
17C7	over all fifty-one bytes
17C9	does the total match the expected signature?
17CB	matches: step the sequence sub-index and leave
17CE	mismatch: take the display-off value from the image
17D1	switch the display off through the video-enable latch
17D4	point at one character cell
17D7	point at the tamper-witness pair
17DA	read its glyph
17DB	save the glyph
17DD	cross to the colour plane of the same cell
17DF	read its colour
17E0	save the colour beside it
17E4	raise a flag cell to all bits set
17E7	point a second pointer at a block of the program image
17EC	select the guarded block -- its start and thirty-byte length
17EF	seed the running total from a program byte
17F2	fold the block into the total
17F5	bank the result as the image signature
17F8	step the sequence sub-index
17FB	step the sequence sub-index
17FE	point at the mode's do-nothing tail
1801	park it as the arm's return
1802	take the inner sequence sub-step
1805	jump to the selected arm through the inline word table
181D	the mode's tail -- return at once, nothing runs after the arm
181E	sweep every sprite off the picture
1821	point at the character cell to sample
1824	point at the two-byte record to hold it
1827	copy the cell's glyph and colour into the record
182A	arm the line wipe from the plane's fifth line
182D	step the sequence sub-index
1830	re-stamp the copyright caption strip
1833	flash the copyright line
1836	command 1, argument 1
1839	queue it on the request ring
183A	argument 0x14
183C	queue it
183D	argument 0x15
183E	queue it
183F	default bonus-life caption
1841	read the bonus-life setting
1845	setting clear: keep the default caption
1847	setting set: step to the alternate caption pair
1849	queue the chosen caption
184A	the next caption
184B	queue it
184C	argument 0x16
184E	queue it
184F	argument 0
1851	queue it
1852	read the credit count
1855	two or more credits?
1857	yes: take the two-credit tail
1859	command 1, argument 0x17
185C	queue it
185D	step the sequence sub-index and leave
1860	command 1, argument 0x19
1863	queue it
1864	step the sequence sub-index
1867	step it again
188A	redraw the fixed copyright caption strip
188D	flash its line for this frame
1890	read the panel's start-button bits
1893	is two-player start held? -- bit 4
1895	two-player start held: begin a two-player game
1898	is one-player start held? -- bit 3
189A	one-player start held: begin a one-player game
189D	neither held: leave the copyright screen up
189E	park the caption sprites
18A3	raise the play-active flag
18A6	raise the two-player-game flag beside it
18A9	take the starting-lives setting
18AC	seat it as player one's life count
18AF	and as player two's life count
18B2	run the two-player-start object arm
18B5	point at the on-screen credit count
18B9	take two credits off it
18BB	fix the packed-decimal result
18BD	repaint the credit field
18C0	send the sequence machine to its last phase
18C3	read the frame counter
18C6	keep its low bit -- run this scan every other frame
18C8	on the off frames, hand over to the cursor-flash and game-over arm
18CB	read the entry panel's controls
18CE	point at the first of four rolling press-history bytes
18D2	roll the letter-back control into its history
18D6	roll the letter-forward control into its history
18DC	roll a commit button into its history
18E0	roll the other commit button into its history
18E3	keep the last three samples -- a fresh press reads as 001
18E6	a commit button just went down: lock in the current letter
18ED	the other commit button went down: lock in the letter
18F1	the letter-forward control held to saturation?
18F3	if so, clear its history so a held press repeats
18F9	a fresh forward press: step the shown letter forward
18FD	the letter-back control held to saturation?
18FF	if so, clear its history so a held press repeats
1905	a fresh back press: step the shown letter back
1907	nothing pressed: go tick the entry's time-out
1909	point at the letter index
190C	step the shown letter back one
190E	did the index run below the first letter?
1910	still in range: redraw it
1912	wrapped: set it to the last letter
1916	point at the letter index
1919	step the shown letter forward one
191B	past the last letter?
191D	still in range: redraw it
191F	wrapped: back to the first letter
1923	take the chosen letter index
1926	point at the letter-glyph table
1929	look up its glyph
192A	fetch the filed record's initials pointer
192D	fetch the on-screen cursor cell pointer
1931	stamp the glyph into the cursor cell on screen
1932	and into the filed record's initials
1933	take the colour a locked-in letter wears
1936	aim the pointer at the colour plane
1938	paint that colour under the glyph
193B	step the write pointer on to the next cell
193D	save the advanced record pointer
1940	save the advanced cursor cell pointer
1947	one fewer initial left to enter
1948	all initials in: finish the entry
194B	reset the letter index for the next slot
194E	fetch the cursor write pointer
1952	take the letter now being shown
1958	look up its glyph
1959	draw it at the cursor cell
195A	aim at the colour plane
195E	paint the cursor colour under it -- the flash's opening phase
1960	restart the cursor-flash counter
1963	read the frame counter
1966	act one frame in eight
1968	other frames: skip to the start-next-game poll
196D	count the entry's time-out (the sequence delay) down
196E	not fired yet: go to the tail
1970	fetch the cursor cell pointer
1973	time is up: blank the cursor cell
1977	re-arm the sequence delay at sixty
197D	step the sequence machine on
1980	empty the press-history byte the caller points at
1982	hand back zero
1984	point at the cursor-flash counter
1987	step it on one
1988	fetch the cursor cell pointer
198B	aim at the colour plane
1990	is the counter's slow bit set? -- picks the flash phase
1994	one phase: paint the cursor its bright colour
1998	the other phase: paint it its dim colour
199A	point at player two's life count
199D	take player one's life count
19A0	fold in player two's
19A1	either player still has a life: leave the entry running
19A2	read the free-play flag
19A6	free play: jump to the free-play start check
19A8	read the credit count
19AB	is it below one?
19AD	no credits: keep waiting
19AE	exactly one credit: go to the one-credit check
19B0	read the start-button bits
19B5	none held: keep waiting
19B6	the one-player start alone?
19B8	yes: begin a one-player game
19BA	hide every sprite
19BD	otherwise begin a two-player game
19C0	read the start-button bits
19C5	must be the one-player start alone
19C7	anything else: keep waiting
19C8	hide every sprite
19CB	begin a one-player game
19CE	read the start-button bits
19D3	none held: keep waiting
19D4	hide every sprite
19D7	begin a game charging no credit
19DA	point at the copyright line's first colour cell
19DD	thirteen cells to check
19DF	read this cell's colour
19E0	is it the first accepted colour?
19E2	yes: on to the next cell
19E4	is it the second accepted colour?
19E6	anything else: the line has been tampered -- transfer away and never return
19E9	the stride back one cell along the line
19EC	step back to the previous cell
19ED	loop over all thirteen
19EF	thirteen good cells: return having changed nothing
19F0	clear the value to write
19F3	zero the world-scroll Y
19F6	zero the world-scroll X
19F9	zero the base-sixty life-tick's middle and high places
19FD	clear the mother-ship-armed flag
1A00	clear the parachutist rung
1A03	clear the base-sixty life-tick's low place
1A09	reload the escalation-rung timer from its period
1A0F	copy the round's opening difficulty rung into the live rung cell
1A13	clear the pending shot-burst count
1A16	clear the round-transition hold
1A1B	seat the player heading to its start direction
1A1F	clear the player record's spare byte
1A24	set the player state to alive
1A29	seat the player's sprite Y to its start row
1A2E	seat the player's sprite entry to its start column
1A31	dress the player sprite for its heading
1A34	free every shot slot
1A3F	retire the first object slot into hold
1A42	seven sub-pixel slots to retire
1A54	retire the next object slot into shared cooldown
1A5F	retire the parachutist slot into cooldown
1A62	retire this slot and clear its sub-pixel fraction
1A65	the sixteen-byte record stride
1A6E	loop over the seven slots
1A70	free and number every object slot
1A73	point at the object sprite entries
1A77	clear eight entry cells across the two banks
1A97	seat the era's scenery band and run it
1A9A	take the era number
1A9D	shift it up into the high nibble
1AA1	keep just that nibble
1AA4	take the escalation rung
1AA7	combine them into the tuning-row index
1AA8	point at the table of tuning-row addresses
1AAB	fetch the chosen row's address
1AAD	first byte: a launch-bank slot cap
1AB2	the bank launch's heading half-window
1AB7	the bank's near-approach half-window, both axes
1ABC	the bank-launch cooldown
1ABF	-- into its paired reload cell too
1AC4	the craft-per-round count
1AC9	a script-pick threshold
1ACE	an attacker-spawn slot cap
1AD3	the attacker-spawn spread half-window
1AD8	the attacker-spawn aim half-window
1ADD	the attacker-spawn cooldown
1AE0	-- into its paired reload cell too
1AE4	point at the first object record
1AE8	record numbers start at one
1AEA	twenty-three records
1AEC	sixteen bytes apart
1AEF	clear this record's occupancy byte
1AF3	stamp its number into its sixteenth byte
1AF6	count on to the next number
1AF9	loop over all twenty-three
1AFC	read the cell's glyph
1AFD	store it into the record
1AFF	flip the pointer to the colour plane
1B01	read the same cell's colour
1B02	store it beside the glyph
1ED1	read the screen-orientation flag
1ED5	point at the first panel's control mirror
1ED8	unflipped: use that panel
1EDA	flipped: use the second panel's mirror
1EDD	hand back the chosen panel's control word
1EDF	point at the player record
1EE3	and its paired sprite entry
1EE7	read the player state
1EEB	state clear: nothing to do this frame
1EED	mid-count: run the multi-frame animation
1EF0	read the play-active flag
1EF4	not in play: fly the attract-demo pilot
1EF7	read the panel controls
1EFA	keep the stick nibble
1EFC	stick pushed: turn the ship toward it
1EFE	stick centred: just scroll the world
1F01	point at the wanted-heading table
1F04	look up the heading the stick asks for
1F05	hold that wanted heading
1F06	take the ship's current heading
1F09	subtract it -- how far from the target
1F0A	already there: just scroll the world
1F0D	hold the difference
1F0E	read the era number
1F13	from the fourth era on, turns step faster
1F17	three notches a turn
1F1B	four notches a turn
1F22	within one notch: snap straight onto the target
1F26	is the target the short way ahead?
1F28	ahead: step the heading up by the turn step
1F2B	behind: step the heading down by the turn step
1F3E	take the heading the turn was steering toward
1F3F	write it straight onto the ship's heading
1F42	the negate-into-scroll tail
1F45	push it as the return address
1F46	read the era number
1F4A	opening era: use its own velocity table
1F4F	the next two eras share a second table
1F52	the fourth era on shares the last table
1F6A	store the heading stepped down by the turn step
1F6D	re-run the world scroll
1F71	store the heading stepped up by the turn step
1F74	re-run the world scroll
200C	walk the address on by a wide step
200D	walk it on again by the byte in hand
200E	put the carried total where the tamper check reads its verdict
2010	read the animation phase from the record
2013	at or past the opening frame?
2015	mid-animation: step the phase down
2017	clamp the phase to the opening frame
201B	flag the paired sprite entry
201F	read the era number
2024	past the second era: cue the extra progress sound
2027	cue the destruction sound burst
202A	read the sampled caption glyph (tamper witness)
202D	is it the genuine glyph 0xa5?
202F	no: divert into the tamper trap
2035	read the sampled colour beside it
2038	one accepted colour: on to the phase step
203D	anything but the two accepted values: divert
2040	step the phase down one
2043	read the stepped phase
2046	a keyframe value? -- pick its shape strip
204A	another keyframe value
204E	another keyframe value
2052	another keyframe value
2056	another keyframe value
205A	another keyframe value
205E	the last keyframe value
2062	none matched -- between keyframes, draw nothing
2063	divert into the tamper trap at 0x1f2e -- table bytes run as code
2066	select this keyframe's shape strip
206B	select this keyframe's shape strip
2070	select this keyframe's shape strip
2075	select this keyframe's shape strip
207A	select this keyframe's shape strip
207F	select this keyframe's shape strip
2084	select this keyframe's shape strip
2089	the strip's first cell in video memory
208C	the colour-attribute bias
2091	the era offsets the strip's colour
2094	the strip's row count
2099	the tiles-per-row count
209D	read a tile from the strip
209E	write it into video memory
209F	aim at the colour plane
20A1	lay its colour attribute alongside in colour memory
20A6	across the row's tiles
20A8	the step from a row's end to the next row's start
20AA	carry the cursor on to the next row
20AC	down all the rows
20B3	the stride to the paired attribute table
20B6	take the ship's heading
20B9	round it to the nearest of thirty-two sectors
20BE	keep the five-bit sector number
20C0	point at the shape-by-sector table
20C3	index it by the sector
20C5	write the sprite shape for this heading
20C8	step to the paired attribute table
20CA	write the attribute byte beside it
210E	point at the script-pointer cell
2112	read the demo selector
2116	selector 0: take the first script
211A	selector 3: take the first script too
211E	selector 1: take the second script
2120	otherwise take the third script
2123	read the script's leading byte
2125	seat the dwell counter to one past it
2129	store the script pointer -- low byte
212B	-- then high byte
212C	point at the glyph tamper-readback cell
2130	does the glyph readback look tampered?
2132	yes: drop into the trap
2137	an untampered colour readback returns
213A	the other accepted colour returns
213D	otherwise drop into the trap
2140	the first script's address
2145	the second script's address
214B	point at the demo pilot's countdown byte -- low six bits are a dwell, the top two a turn command
214E	read it
214F	keep the whole byte so the turn command in the top bits survives the mask
2150	isolate the dwell in the low six bits
2152	dwell spent -- step to the next script entry
2155	a single remaining tick counts as spent too -- step the script
2157	tick the dwell down one frame
2158	store the counted-down command byte back
2159	act on this frame's turn command
215B	step to the script pointer that follows the countdown byte
215C	read the script pointer low
215E	read the script pointer high
215F	advance the pointer one entry along the script
2160	store the pointer high back
2162	store the pointer low back
2164	read the next script entry
2166	bias it up by one -- a count of one already reads as spent, so the entry gets its full dwell
2167	write it into the countdown byte
2168	re-examine the countdown
216A	take the command byte
216B	switch to the alternate register bank the world-scroll mover runs on
216D	rotate the two turn-command bits down to the bottom
216E	isolate the turn command
2170	no turn this frame -- hand straight to the world-scroll mover
2174	turn command one steers one way -- branch off to turn the heading down
2176	otherwise steer the other way: read the ship heading
2179	turn it by three
217B	store the new heading
217E	hand to the world-scroll mover
2181	read the ship heading
2184	turn it three the other way
2186	store the new heading
2189	hand to the world-scroll mover
23E3	read the player-state marker
23E7	not alive -- skip firing and just sweep the live shots
23EA	read the round-transition hold
23EE	mid-transition -- skip firing and just sweep
23F1	read the player controls
23F4	rotate the fire-button bit out into carry -- four turns bring it around
23F8	point at the fire-button edge history
23FB	shift the fire bit into the two-frame history
23FE	keep just the last two frames of it
2400	a value of one is a fresh press -- up last frame, down now
2402	point at the pending-shot-burst count
2405	no fresh press -- skip arming a burst
2407	fire pressed -- arm a burst of three shots
2409	read the play-active flag
240D	attract/idle -- spawn a shot regardless
240F	in play: read the pending-burst count
2411	nothing pending -- just sweep the live shots
2414	step to the spawn cooldown
2417	still cooling down -- just sweep
241A	point at the six-slot shot bank
241E	six slots to scan
2420	read this slot's occupancy
2424	free slot found -- seed a shot into it
2426	take the slot stride from the program image
242A	step to the next slot
242C	scan all six
242E	none free -- just sweep
2449	ask for the player-shot sound
244F	read the world scroll along one axis
2453	negate it
2456	scale it up four times
2457	seed the shot's per-frame step from it
2460	read the world scroll along the other axis
2464	negate it
2467	scale it up four times
2468	seed the shot's other per-frame step
246E	read the ship heading
2471	round the heading
2473	shift it down toward a direction index
2476	keep five bits -- one of thirty-two directions
2478	point at the shot spawn-position table
247B	fetch the muzzle-position word for this direction
247E	mark the slot occupied
2485	set the whole part of the shot's coordinate along one axis
248C	set the whole part of the shot's coordinate along the other axis
248F	point at the pending-burst count
2492	one shot fired -- count the burst down
2494	reset the spawn cooldown to six frames
2496	read the spawn cooldown
249A	already zero -- skip the tick
249C	count the cooldown down one frame
24A0	point at the six-slot shot bank
24A4	six slots to sweep
24A7	read the slot's head byte
24AB	empty slot -- on to the next
24AE	head is stale, not the live marker -- cull this shot
24B0	read the shot's per-frame step along one axis
24B6	add the world scroll to it
24BB	add the shot's current position
24C3	bias the high byte for the edge test
24C7	off the field edge -- cull this shot
24CA	store the advanced coordinate back
24D0	read the shot's per-frame step along the other axis
24D6	add the world scroll to it
24DB	add the shot's current position
24E3	bias for the edge test
24E7	off the field edge -- cull this shot
24EA	store the advanced coordinate back
24F0	queue this shot's character-cell tiles
24F6	step to the next slot
24F9	sweep all six
24FD	clear the slot's head byte
2500	clear the whole part of its coordinate along one axis
2503	clear the whole part of its coordinate along the other axis
2506	on to the next slot
2511	point at a 64-byte work-RAM block
2514	sixty-four bytes to paint
2516	set this byte all-ones
2519	over all sixty-four
251B	seed the random register
251E	kick the watchdog
2521	load the default high-score table
2524	kick the watchdog
2527	empty both deferred-cell lists
252A	kick the watchdog
252D	on into the settings and cold-start chain
2755	point at the first of the six shot slots
275C	take the slot stride's low byte from the program image
2760	take the fill byte from the program image -- zero on this build
2763	the fill byte doubles as the stride's high byte
2764	six slots to clear
2766	clear the slot's occupancy byte
2769	clear the slot's second-axis byte
276C	step to the next slot
276E	clear all six
27B1	ask for the round-start jingle
27B6	seed the enemy aim anchor
27BB	seed the enemy aim point
27C1	clear player 1's life-tick counter
27C4	clear player 2's life-tick counter
27C7	take the per-round kill quota
27CA	set player 1's kills-remaining
27CD	set player 2's kills-remaining
27D1	clear player 1's era index
27D4	clear player 2's era index
27D7	clear the active-player selector
27DA	clear player 1's bonus-life latch
27DD	clear player 2's bonus-life latch
27E0	clear player 1's mother-ship-armed cell
27E3	clear player 2's mother-ship-armed cell
27E6	clear the pen colour
27EA	set player 1's round number to one
27ED	set player 2's round number to one
27F0	arm player 1's round
27F3	arm player 2's round
27F6	read the play-active flag
27FA	no game being played -- take the attract-demo setup path
27FF	clear player 1's score low byte
2802	clear player 1's score mid and high bytes
2805	clear player 2's score low byte
2808	clear player 2's score mid and high bytes
280B	load command word $0400
280E	post it
280F	read the difficulty selector
2812	load the difficulty record in force
2815	two hundred fifty-six bytes to fold
2817	point at the checked program-image block
281A	seed the checksum to zero
281B	fold each byte in with exclusive-or
281D	over all two hundred fifty-six
281F	bias the sum by one
2821	drive the result into a control latch
2824	take the start rung
2827	set player 1's start rung
282A	set player 2's start rung
282F	arm the sequence delay with 0x96 frames
2832	step the attract/round sequence
2835	point at the 1..3 stage counter
2838	read it
2839	advance it
283A	past three?
283C	no -- keep it
283E	wrapped -- back to one
2840	store the stage
2841	set player 1's era index from the stage
2845	set player 1's round number to stage plus one
2849	clear a game-state cell
284C	clear the packed-decimal frame counter
284F	clear the in-turn script round-robin index
2852	reseed the random register
2855	point at the player-shot array
2860	clear it up through 0xAADF
2862	point at the main work-RAM bank
286D	clear it up through 0xA97F
286F	select difficulty record two
2871	load the difficulty record
2874	take the start rung
2877	set player 1's start rung
287A	set player 2's start rung
287D	two hundred fifty-six bytes to fold
287F	point at the checked program-image block
2882	seed the checksum
2885	subtract each byte in turn
2888	over all two hundred fifty-six
288A	scramble the sum
288C	store the checksum
288F	point at the sixteen-byte aim-coordinate block
2892	sixteen cells to seat
2894	seat an aim-coordinate cell to 0x80
2897	all sixteen
289B	arm the sequence delay with 0x5A frames
289E	step the attract/round sequence
28A1	service object slot 0
28A4	service object slot 1
28A7	service object slot 2
28AA	service object slot 3
28AD	service object slot 4
28B0	service the mother-ship slot -- skipped while its cell is armed
28B3	service object slot 6 -- skipped while the mother-ship cell is armed
28B7	point at slot 0's object record
28BB	point at slot 0's sprite entry
28BF	run the era-keyed handler over it
28C2	point at slot 1's object record
28C6	point at slot 1's sprite entry
28CA	run the era-keyed handler over it
28CD	point at slot 2's object record
28D1	point at slot 2's sprite entry
28D5	run the era-keyed handler over it
28D8	point at slot 3's object record
28DC	point at slot 3's sprite entry
28E0	run the era-keyed handler over it
28E3	point at slot 4's object record
28E7	point at slot 4's sprite entry
28EB	run the era-keyed handler over it
28EE	read the mother-ship armed cell
28F2	armed -- leave this slot unserviced this frame
28F3	point at the mother-ship object record
28F7	point at its sprite entry
28FB	run the era-keyed handler over it
28FE	read the mother-ship armed cell
2902	armed -- leave this slot unserviced this frame
2903	point at slot 6's object record
2907	point at its sprite entry
290B	run the era-keyed handler over it
290E	read the active era index
2911	keep the low three bits
2913	jump through the era table just below into the matching handler
291E	fold the next image byte into the running total
2920	read the byte the second pointer walks past
2922	step the total pointer
2923	step the second pointer alongside it
2924	over the whole block -- a count of zero means a full 256
2927	read this slot's status byte
292B	empty slot -- nothing to do
292D	a live craft -- fly it
2930	a held object -- release it
2933	otherwise step the dying object
2936	steer toward the aim heading
2939	fly at the slowest speed
293C	reached the retire line?
293F	yes -- retire the slot
2942	try a bank-enemy launch when aimed near the player
2945	refresh the sprite from the heading
2948	try to launch an attacker into a free slot
294C	read this slot's status byte
2950	empty slot -- nothing to do
2952	a live craft -- fly it
2955	a held object -- release it
2958	otherwise step the dying object
295B	steer toward the aim heading
295E	fly at this era's speed
2961	reached the retire line?
2964	yes -- retire the slot
2967	try a bank-enemy launch when aimed near the player
296A	refresh the sprite from the heading -- second-era sprite set
2984	read this slot's status byte
2988	empty slot -- nothing to do
298A	a live craft -- fly it
298D	a held object -- release it
2990	otherwise step the dying object
2993	read the frame phase counter
2996	keep its low two bits
299A	steer toward the aim heading -- on three frames of every four
299D	fly at the slowest speed
29A0	reached the retire line?
29A3	yes -- retire the slot
29A6	try a bank-enemy launch when aimed near the player
29A9	dress the sprite for its fine heading
29AC	try to launch an attacker into a free slot
29B0	read the slot's lifecycle byte
29B3	is the slot free?
29B4	free: nothing to do this frame
29B5	bump -- the live code 0xff wraps to zero here
29B6	live: steer and service this slot
29B8	bump again -- the held code 0xfe wraps to zero here
29B9	held: run its release-delay countdown
29BC	any other value: step its dying animation
29BF	turn its heading one step toward its aim
29C2	fly the slot a step along its heading
29C5	has it drifted onto a retire line?
29C8	yes: take the slot out of play
29CB	when aimed near the ship, try the bank launch
29CE	dress the sprite to face its heading
29D1	launch an attacker into a free slot
29D5	read the slot's lifecycle byte
29D8	is the slot free?
29D9	free: nothing to do this frame
29DA	bump -- the live code 0xff wraps to zero here
29DB	live: steer and service this slot
29DD	bump again -- the held code 0xfe wraps to zero here
29DE	held: run its release-delay countdown
29E1	any other value: step its dying animation
29E4	steer toward the ship, then fly a step
29E7	has it drifted onto a retire line?
29EA	yes: take the slot out of play
29ED	advance its shape's animation cycle
29F0	when aimed near the ship, try the bank launch
29F3	launch an attacker into a free slot
29F7	first reference point on the screen (0x78)
29F9	distance from the slot's screen-position probe
29FC	bias by half the window
29FE	is the probe within the window of it?
2A00	near it: turn with the rate index forced low
2A02	second reference point (0x84)
2A04	distance from the probe
2A07	bias by half the window
2A09	within the window of it?
2A0B	near it: turn with the rate index forced low
2A0D	otherwise turn toward aim at the standing rate
2A10	read the frame tick counter
2A14	isolate bit 1 of it
2A16	that bit clear: fly the slot at double velocity
2A19	otherwise fly it at single velocity
2A1D	force the era index to zero -- it keys the turn-rate table
2A20	turn toward aim at that forced rate
2A25	reseat the era index to four
2A28	go fly the step
2A3C	pick the shape and its mirror byte for this heading
2A3F	store the mirror byte into the sprite entry
2A43	store the shape byte into the sprite entry
2A47	pick the shape and its mirror byte for this heading
2A4A	take the mirror/attribute byte
2A4B	bias its colour by 53 into this era's block
2A4D	store it into the sprite entry
2A50	take the shape byte
2A51	bias it by 16 into this era's sprite block
2A53	store it into the sprite entry
2A57	the mirror table sits sixteen past the shape table
2A5A	read the object's heading
2A5D	add half a sector to round to nearest
2A63	top nibble: heading snapped to one of sixteen sectors
2A65	point at the shape-by-sector table
2A68	index it by the sector
2A69	take the shape byte
2A6A	step to the parallel mirror table
2A6B	take the mirror byte beside it
2A6C	read the frame tick counter
2A6F	test bit 1
2A71	half the frame pairs: keep the base shape
2A73	otherwise advance the shape by eight
2A97	read the object's heading
2A9A	add half a sector (of thirty-two) to round to nearest
2A9C	drop the low three bits
2AA0	form the sector as a doubled index -- two-byte entries
2AA2	point at the shape/attribute table
2AA5	index it by the doubled sector
2AA6	take the shape byte
2AA7	read the frame tick counter
2AAA	take bit 1
2AAC	set: add eight to the shape
2AAE	combine with the base shape -- zero or eight added
2AAF	store the shape into the sprite entry
2AB3	take the attribute byte from the next table cell
2AB4	store it into the sprite entry
2AB8	the eight to add
2ABA	join the store path
2AFC	the second table sits sixteen past the first
2AFF	read the object's heading
2B02	add half a sector to round to nearest
2B08	top nibble: heading snapped to one of sixteen sectors
2B0A	point at the shape table
2B0D	index it by the sector
2B0E	take the shape byte
2B0F	store it into the sprite entry
2B12	step to the parallel attribute table
2B13	take the attribute byte
2B14	store it into the sprite entry
2B38	read the frame tick counter
2B3D	two middle bits: the animation phase, turning over every fourth frame
2B3F	offset to the first shape in the block (0xd8)
2B42	read the object's shape-block selector
2B45	count it from one
2B48	shift up by two -- times four, a block of four shapes per selector
2B49	add the phased base shape
2B4A	store the shape into the sprite entry
2B4D	stamp the fixed attribute (0x61) beside it
2B52	count the release delay down one
2B55	reached zero: release it
2B58	step the state code on to the live one
2B5B	reload the delay with 128
2B60	the object's whole coordinate byte, first axis, from its sprite entry
2B63	its fraction from the record
2B66	the frame's world-scroll step for this axis
2B6A	add it into the 16-bit coordinate
2B6B	store the whole byte back
2B6E	store the fraction back
2B71	the object's whole coordinate byte, second axis
2B74	its fraction from the record
2B77	the frame's world-scroll step for this axis
2B7B	add it into the 16-bit coordinate
2B7C	store the whole byte back
2B7F	store the fraction back
2B83	the object's screen row byte
2B86	line up the retire row with a three-wide window
2B88	within a pixel of the retire row (0xf8)?
2B8A	yes: report reached, carry set
2B8B	the object's screen column byte
2B8E	line up the retire column with the window
2B90	within a pixel of the retire column (4)? -- carry now carries the answer
2B93	read the object's state byte
2B96	the re-arm value 0xf0?
2B98	yes: re-seat it and begin the death
2B9B	at the death-begins threshold 0x3c?
2B9D	exactly there: count the kill and grant the token
2BA0	at or above the threshold: fly it on
2BA3	below it: count the state byte down
2BA6	hit zero: take the slot out of play
2BA8	else move it for the frame and run its appearance
2BAC	re-seat the state byte to 0x3b
2BB0	count the kill and grant the token
2BB4	count the object's state byte down one
2BB7	fly it on at the slowest table speed
2BBA	ask for the pair of death sounds
2BBD	point at the round's kill quota
2BC1	already at zero?
2BC2	yes: leave it -- floor, do not wrap
2BC4	else take one kill off the quota
2BC5	read this record's cooldown byte
2BC8	is its top claim bit set?
2BCA	no: not a claimant, done
2BCB	read the shared arming cell
2BCF	not set: done
2BD0	point at the shared kill countdown
2BD3	spend a tick of it
2BD4	not zero yet: done -- every claimant spends a tick
2BD5	this record's slot ordinal
2BD8	mark it with the top bit
2BDA	grant it the single-holder token
2BDE	zero, to clear five cells
2BDF	clear the occupancy byte -- free the slot
2BE2	clear the row sub-pixel remainder
2BE5	clear the column sub-pixel remainder
2BE8	clear one sprite-entry coordinate
2BEB	clear the other sprite-entry coordinate
2BEF	the heading the object is turning toward
2BF2	minus its current heading -- how far round the aim lies
2BF5	keep that wrapped difference
2BF6	bias for the arrival test
2BF8	within one step ahead or two behind? already on the aim
2BFA	yes: stop turning
2BFB	hold the current heading
2BFE	the difference again
2BFF	is the aim more than half a turn away?
2C01	yes: the short way round is backward
2C03	point at the turn-rate table
2C06	the era index -- it keys the turn-rate table
2C09	fetch this era's step size
2C0A	add the step to the current heading -- turn forward
2C0B	write the new heading
2C0F	point at the turn-rate table
2C12	the era index
2C15	fetch this era's step size
2C17	current heading minus the step -- turn backward
2C19	write the new heading
2C22	point at the shared appearance step and...
2C25	...stack it as the return, so whichever move runs next falls straight on into it
2C26	read this object's state byte
2C29	is it thirty-two or more?
2C2B	yes -- count the state byte down one frame and fly on at the slowest table speed
2C2E	no -- only drift with the world scroll, leaving the state byte alone
2CBC	seat the scenery record cursor on the first slot
2CC0	seat the sprite-entry cursor on the first slot
2CC4	read the era index
2CC7	is it the first era?
2CC8	yes -- run the opening scenery order
2CCA	is it the fifth era?
2CCC	yes -- run the closing scenery order
2CCE	middle order: drift a diagonally-cornered scenery object at five quarters
2CD1	drift a two-tile scenery object at three quarters
2CD4	and another two-tile object at three quarters
2CD7	drift a one-tile object at half -- the farthest, slowest layer
2CDB	blank the next line of the wipe; comes back saying whether any lines are still owed
2CDE	lines still owed -- end the turn here
2CDF	four passes of...
2CE2	...the fixed 1024-byte program-image block at $4980
2CE5	clear the running total
2CE6	fold this byte into the total with exclusive-or
2CE7	next byte
2CE8	256 bytes per pass
2CEA	next pass
2CEB	1024 bytes folded in all
2CED	add $BD -- lands on zero only when the fold matches an untampered image
2CEF	mismatch (image tampered) -- step the outer sequence phase, derailing the sequence
2CF2	match -- step the sequence's inner index so it carries on
2CF5	opening order: drift a three-tile scenery strip at five quarters
2CF8	drift a two-tile object at three quarters
2CFB	and another two-tile object at three quarters
2CFE	drift a one-tile object at half -- the farthest layer
2D02	closing order: advance a two-tile scenery object at five quarters
2D05	and another two-tile object at five quarters
2D08	drift a one-tile object at three quarters
2D0B	and another one-tile object at three quarters
2D0E	drift a one-tile object at half
2D11	and another one-tile object at half
2D15	drift this scenery object at five quarters of the world scroll
2D18	lay a tile flush against it
2D1B	lay a second tile flush, extending the strip
2D1E	step both cursors onto the next slot
2D21	drift this scenery object at five quarters of the world scroll
2D24	lay the tile abutting it
2D27	lay the tile cornering it diagonally -- three corners of a square
2D2A	step both cursors onto the next slot
2D2D	drift this scenery object at five quarters of the world scroll
2D30	lay its second tile flush against the first
2D33	step both cursors past the pair
2D36	drift this scenery object at three quarters of the world scroll
2D39	lay a second tile flush against it
2D3C	step both cursors onto the next slot
2D3F	read the free-play switch
2D42	is it set?
2D43	free play -- just step the sequence's inner index and leave
2D46	repaint the credit-count panel
2D49	caption command 1, record 8 -- the CREDIT line
2D4C	post it to the command ring
2D4D	read the guard byte
2D50	is it set?
2D51	set -- jump to $2E3E, which holds table data, not a routine
2D54	stamp the copyright/caption strip into the display list
2D57	request the copyright line flashed in this frame's colour
2D5A	point at the twenty-byte image run at $086B...
2D5D	...twenty bytes...
2D5F	...and fold it into the tamper-check total
2D62	drift this scenery object at three quarters of the world scroll
2D65	step both cursors onto the next slot -- no further tile
2D68	drift this scenery object at half the world scroll -- the farthest, slowest layer
2D6B	step both cursors onto the next slot
2D6E	whole part of the first coordinate
2D71	its fraction -- together one sixteen-bit coordinate
2D74	this frame's vertical world-scroll
2D77	move the coordinate by five quarters of the scroll
2D7A	store the whole part back
2D7D	and its fraction
2D80	whole part of the second coordinate
2D83	its fraction
2D86	this frame's horizontal world-scroll
2D89	move the coordinate by five quarters of the scroll
2D8C	store the whole part back
2D8F	and its fraction
2D93	whole part of the first coordinate
2D96	its fraction
2D99	this frame's vertical world-scroll
2D9C	move the coordinate by three quarters of the scroll
2D9F	store the whole part back
2DA2	and its fraction
2DA5	whole part of the second coordinate
2DA8	its fraction
2DAB	this frame's horizontal world-scroll
2DAE	move the coordinate by three quarters of the scroll
2DB1	store the whole part back
2DB4	and its fraction
2DB8	point at the round counter
2DBB	step to the next round
2DBC	point at the era index
2DBF	take it
2DC0	roll it forward
2DC1	past the fifth era?
2DC3	no -- keep it
2DC5	yes -- wrap back to the first era
2DC6	store the era index
2DC7	read the round number
2DCA	rounds 1..5?
2DCC	yes -- take the low bracket's starting rung
2DCE	rounds 6..10?
2DD0	yes -- take the middle bracket's starting rung
2DD2	rounds 11 and up -- take the high bracket's starting rung
2DD7	rounds 1..5 -- the low bracket's starting rung
2DDC	rounds 6..10 -- the middle bracket's starting rung
2DDF	set this round's starting rung
2DE2	take the kill quota
2DE5	refill kills-remaining from it -- the same every round
2DE8	clear the accumulator
2DE9	clear the mother-ship-armed flag
2DEC	clear the round-transition hold
2DEF	flip to all-ones
2DF0	arm the round with it
2DF4	whole part of the first coordinate
2DF7	its fraction
2DFA	this frame's vertical world-scroll
2DFD	move the coordinate by half the scroll
2E00	store the whole part back
2E03	and its fraction
2E06	whole part of the second coordinate
2E09	its fraction
2E0C	this frame's horizontal world-scroll
2E0F	move the coordinate by half the scroll
2E12	store the whole part back
2E15	and its fraction
2E19	store the starting-lives setting the caller worked out
2E1C	take the packed switch byte
2E1D	rotate it...
2E1E	...down two bits
2E1F	keep the rotated byte
2E20	isolate one bit -- the cabinet type (upright/cocktail)
2E22	store it in its own cell
2E25	take the rotated byte again
2E26	rotate down one more bit
2E27	keep it
2E28	isolate the next bit -- the bonus-life setting
2E2A	store it in its own cell
2E2D	hand the remaining bits on...
2E2E	...to the continuation that peels the rest and cold-starts
2E31	copy the displacement aside to take a quarter of it
2E33	halve it, keeping its sign...
2E37	...and halve again: a quarter of the displacement
2E3B	displacement plus its quarter -- five quarters
2E3C	add that to the coordinate
303E	copy the displacement aside to take a quarter of it
3040	halve it, keeping its sign...
3044	...and halve again: a quarter of the displacement
3048	clear the carry for the subtract
3049	displacement minus its quarter -- three quarters
304B	add that to the coordinate
304D	copy the displacement into a scratch pair to halve it
304F	arithmetic-shift the copy right one, halving it and keeping its sign
3053	clear carry before the subtract
3054	displacement minus its half leaves the complementary half
3056	add that to the coordinate, so it advances at half the pace, the fraction carrying up into the whole
3058	read one coordinate byte of the current sprite entry
305B	read the other coordinate byte
305E	a sprite's width in pixels...
3060	...advances the first coordinate one tile on
3061	write it into the next sprite entry
3064	copy the other coordinate into the next entry unchanged
3067	step both cursors onto the entry just written
3074	read a byte at the pointer
3075	add the running coordinate
3076	write one coordinate byte into the next sprite entry
3079	and the summed one into its other field
307C	step both cursors onto the entry just written
307F	store the coordinate through the pointer
3080	fold it into the accumulator
3081	more slots to place: loop back
3083	fetch the two-byte entry A selects from the table at the pointer
3084	step the byte past the entry
3088	drop a word off the stack into the accumulator and flags
308A	read the current entry's high-axis coordinate
308D	read its low-axis coordinate
3090	a pitch back along the high axis (-16 in the high byte)...
3092	...and a pitch on along the low axis (+16)
3094	apply both in one add, so a low-axis wrap carries into the high axis
3095	write the high-axis coordinate into the next entry
3098	write the low-axis coordinate into the next entry
309B	one record stride...
309E	...steps the record cursor onto the next slot
30A0	step the entry cursor...
30A2	...by its two-byte stride onto the next slot
30A5	point at a fixed program run to checksum
30A8	the value it must sum to -- a tamper tripwire
30AA	sixteen bytes to fold
30AC	fold the run and compare -- the answer is discarded here
30AF	read the current era
30B2	scale the era up by eight -- one row of eight bytes per era
30B6	point at the era-keyed scenery-row table
30B9	index it by the era offset -- pointer at the row start
30BA	point at the object-code cells to seat (stride two)
30BD	eight bytes to copy
30BF	take a row byte
30C0	seat it into the object cell
30C2	advance to the next object cell -- two apart
30C4	repeat for all eight
30C6	read the era again
30C9	is it era four?
30CB	keep the era for the tail
30CC	era four: hand on with the 0x28 fill byte
30CF	otherwise use fill byte 0xCC
30D1	point at the object attribute cells
30D4	stride of two
30D7	eight cells
30D9	clear this cell to the fill byte
30DA	step two on
30DB	repeat for all eight
30DD	recall the era
30DE	below era four?
30E0	yes: seed four objects and run the scenery
30E3	point at the first runtime guard cell
30E6	read it
30E7	is it the expected value?
30E9	no: derail through 0x315B into the per-era scenery row table at 0x3176, run as code
30EC	step to the second guard byte
30ED	read it
30F0	value 5 is allowed: continue
30F5	not 5 or 16: derail through 0x315B into the per-era scenery row table at 0x3176, run as code
30F8	eight entries to seat
30FA	point at the entry-bank cells
30FE	point at the packed entry table
3101	take a table byte
3102	seat it into the entry's +0x31 (Y) coordinate
3106	take the next table byte
3107	seat it into the entry's +0x00 (X) coordinate
310B	step to the next entry...
310D	...two bytes on
310F	repeat for all eight
3111	run the frame's scenery
3114	hand off to the fill path at 0x307F
3117	point at the first sentinel byte
311A	read it
311B	is it the expected 0x68?
311D	no: seat nothing, hand off to the derail path
3120	step to the second sentinel byte
3121	read it
3122	is it 16?
3124	yes: seat the objects
3127	or 5?
3129	neither: seat nothing, hand off to the derail path
312C	point at the packed four-object table
312F	four objects
3131	point at the entry-bank cells
3135	take the object's Y coordinate
3136	seat it into the entry's +0x31 (Y) coordinate
3139	one tile on...
313B	...into the abutting entry's Y coordinate
313F	take the object's X coordinate
3140	seat it into the entry's +0x00 (X) coordinate
3143	and its neighbour
3147	one record stride...
314A	...steps the record cursor
314C	four-byte entry stride...
314F	...steps the entry cursor a row
3151	repeat for all four
3153	run the frame's scenery
3156	force the fill byte to 0x28
3158	hand on to clear the entries and run the era's scenery
315B	derail into the scenery-row data table when a guard reads wrong
31B4	read the packed-decimal life-tick
31B7	keep it
31B8	look at the tens digit
31BA	tens 0: service a craft slot
31BC	tens 3?
31BE	any other tens: lay out the aim points instead
31C1	read a fixed program-image byte as a guard
31C4	expect it to read 0x30
31C6	on to servicing the slot either way
31C9	recall the life-tick
31CA	take the units digit as a slot number
31CC	seven or more?
31CE	no such craft slot: leave
31CF	point at the craft records
31D3	point at the parallel craft entries
31D7	double the slot for the two-byte entry stride
31DB	step the entry cursor onto this slot
31DD	double three more times for the sixteen-byte record stride
31E1	step the record cursor onto this slot
31E3	read the record's head byte
31E6	is the head 0xFF?
31E7	any other head: leave
31E8	advance the craft's shape animation
31EB	read its state byte
31EE	held?
31F0	held: nothing more to do
31F1	the re-aim-then-hold state?
31F3	yes: aim at the table base and latch to held
31F5	state x 2 to index the aim table
31F6	point at the aim-point table
31F9	index it by the state
31FA	compute the heading toward that aim point
31FD	store it as the craft's heading
3201	point at the aim-point table base
3204	compute the heading toward it
3207	turn it a half-circle
3209	store as the craft's heading
320C	set the record to the held state
3210	clear its step timer
3215	park the caption sprites off-screen
3218	zero
3219	clear the two-player-game flag
321C	clear player two's life count
321F	all bits set
3220	raise the play-active flag
3223	read the starting life count from the settings
3226	seat it as player one's lives
3229	point at the packed-decimal credit count
322C	read it
322D	take one credit
322F	decimal-adjust so it stays valid packed decimal
3230	store the reduced count
3231	repaint the credit count on the panel
3234	copy three tilemap cells from both planes into their keeps
3237	send the sequence machine to its last phase
323A	read the record's step timer
323D	is it already zero?
323E	yes: leave the animation stopped
323F	count the timer down one
3240	store it
3243	hold the new count as the step index
3244	read the record's run selector
3247	point at the table of shape-run pointers
324A	fetch this record's run pointer
324C	recall the step index
324D	fetch the shape byte for this step
324E	store it as the record's shape
3252	768 bytes to fold
3255	starting at the program image
3258	clear the running exclusive-or
325B	fold the next byte into the running exclusive-or
325D	count it off
3260	loop until the whole span is folded
3263	the expected complement
3265	add it to the fold
3266	a tampered span nets non-zero: throw the sequence a phase forward
3269	otherwise step the sequence's sub-step
326C	recall the life-tick byte
326D	its units digit
326F	units digit 7?
3271	any other units digit: leave without writing
3272	point at the enemy aim-point block to fill
3276	read the player heading
3279	turn it a quarter-circle
327B	look up the velocity vector for that direction
327F	scale the vector left three places to an x8 radius
3283	offset the across component from screen centre
3285	store the first aim point's Y
3289	flip the component's sign to mirror it...
328B	...the same distance the other side of centre
328D	store the mirrored aim point's Y
3290	double again to an x16 radius
3292	offset from centre
3294	store the second aim point's Y
3298	mirror across centre...
329A	...back from centre
329C	store its mirror's Y
329F	take the down component of the vector
32A1	scale left three places to an x8 radius
32A5	offset from screen centre down
32A7	store the first aim point's X
32AB	mirror across centre...
32AD	...back from centre
32AF	store the mirrored X
32B2	double to an x16 radius
32B4	offset from centre
32B6	store the second aim point's X
32BA	mirror across centre...
32BC	...back from centre
32BE	store its mirror's X
32C1	read the player heading again -- not turned this time
32C4	look up its velocity vector
32C8	scale left three places to an x8 radius
32CC	offset from centre across
32CE	store the fifth aim point's Y
32D1	double to an x16 radius
32D3	offset from centre
32D5	store the sixth aim point's Y
32D8	take the down component
32DA	scale left three places to an x8 radius
32DE	offset from centre down
32E0	store the fifth aim point's X
32E3	double to an x16 radius
32E5	offset from centre
32E7	store the sixth aim point's X
32EB	kick the watchdog
32EE	point at the startup-delay cell
32F1	set it to twelve passes
32F3	reset the inner and outer tick counters
32F6	spin the inner counter down -- a pure time delay
32F8	kick the watchdog
32FB	count the outer loop
32FC	256 kicks per pass
32FE	count one pass off the startup-delay cell
32FF	twelve passes in all
3301	command 0...
3302	...tell the audio processor to go quiet
3305	pick up the byte that sets the interrupt-enable bit
3308	enable interrupts and drop into the foreground loop
330B	point at the delay cell
330E	count it down
330F	not yet elapsed: leave
3310	try to file the score into the high-score table
3313	it placed: branch to the filed-score path
3319	queue ring command 3 / argument 9
331C	queue ring command 3 / argument 11
331D	take a fixed byte from the program image
3320	seat it
3323	pass the turn to the other player if lives remain, else step the sequence
3329	zero...
332B	...clear the pen colour
332E	0xF1...
3330	...set the pen glyph
3333	re-arm the pen route
3336	256 bytes to fold
3338	starting at this program run
333B	clear the running sum
333C	fold the next byte in
333E	over all 256 bytes
3340	subtract the expected sum
3342	a tampered run: throw the sequence a phase forward
3345	then step the sequence's sub-step
335E	read the sequence-phase cell -- the tamper accumulator
3361	point at the image block to fold
3364	thirty bytes
3366	fold the next byte in
3368	over all thirty
336A	add the genuine-image bias
336C	store back into the phase cell -- nets to leave the phase standing on a genuine image
336F	read which player is up
3372	is it player one?
3373	point at player one's saved-pen record
3376	read player one's era
3379	player one: use those
337B	otherwise point at player two's saved-pen record
337E	read player two's era
3381	era x 2 to index the glyph/colour table
3382	point at the glyph/colour table
3385	fetch the era's glyph
3386	write it into the saved-pen record
3387	and onto the live pen glyph
338C	fetch the era's colour
338D	write it into the saved-pen record
338E	point at the live pen colour
3391	did the pen colour already hold this?
3392	set the live pen colour
3393	if it was unchanged, step the sub-step an extra time
3396	re-arm the pen route
3399	step the sub-step as a tail
339C	read which player is up
339F	player one?
33A0	point at player one's saved-pen record
33A3	read player one's era index
33A6	player one: use those
33A8	otherwise player two's saved-pen record
33AB	read player two's era index
33AE	era x 2 to index the table
33AF	point at the glyph/colour table
33B2	index it by the era
33B3	copy the glyph into the saved-pen record
33B5	copy the colour after it
33B8	start the sector code at zero
33BA	the object's second-axis position
33BD	the point's first-axis coordinate -- kept for later
33BE	step to the point's second-axis coordinate
33BF	read it
33C0	reach to the point along the second axis
33C1	already positive
33C3	take its magnitude
33C5	mark the second axis as running negative
33C7	hold the second-axis distance
33C8	the object's first-axis position
33CB	recall the point's first-axis coordinate
33CC	reach along the first axis
33CD	already positive
33CF	take its magnitude
33D1	mark the first axis as running negative
33D3	hold the first-axis distance
33D7	compare the two distances
33D8	equal: read a fixed diagonal heading
33DA	first axis is the longer
33DC	first axis is the shorter
33DE	clear the low byte of the dividend
33E0	which leg is the shorter?
33E4	shorter = second-axis distance
33E7	shorter = first-axis distance
33E8	longer = second-axis distance, the divisor
33E9	eight quotient bits
33EB	clear carry so the first bit shifted in is zero
33EC	shift the dividend up, carrying a quotient bit
33F1	does the divisor go into the running remainder?
33F4	subtract the divisor
33F7	shift the quotient bit in
33F8	eight bits in all
33FA	the quotient is the rung within the sector
33FB	the sector code
33FC	point at the sector-heading table
33FF	index it by the sector
3400	the rung...
3401	...scaled down to one of thirty-two rungs
3405	does this sector count its rungs backwards?
340C	reverse the rung within the sector
340D	add the sector's base heading
340F	point at the diagonal-heading table
3412	the sector code
3413	read the fixed heading for this diagonal
36AF	read the round-transition hold cell
36B2	test it
36B3	a round transition is under way: nothing to do this frame
36B4	read the era number
36B7	is this era 4?
36B9	era 4: spawn the wave straight into the free slots
36BC	point at the low life-tick byte -- the phase tails all read it
36BF	read the life-phase byte
36C2	keep its low nibble -- the phase
36C4	phase 7?
36C6	phase 7: settle the five slot animations
36C9	below 7: gate the free-slot search and pick its run
36CC	phase 8?
36CE	phase 8: spawn a craft while the band is under two
36D1	read the low life-tick
36D2	test it
36D3	not spent yet: wait
36D4	draw a random byte
36D7	roll its low bit into carry
36D8	read the era number
36DB	double it and fold the random bit in as the low bit -- the wave descriptor index
36DF	raise the wave mark
36E2	store the wave descriptor index
36E3	read the player heading
36E6	bias it by 8 -- round to the nearest sector
36E8	shift the biased heading down four to a 0-15 sector index
36EC	mask to the sixteen-sector index
36EE	point at the heading-bias table
36F1	index it by the sector
36F2	take the edge-position bias for this heading
36F3	read the wave descriptor index
36F6	times sixteen -- a sixteen-byte descriptor entry
36FA	point at the wave-descriptor table
36FD	index it by the descriptor number
36FE	keep the descriptor pointer aside
36FF	read the round's craft count
3702	use it as the slot loop count
3703	read the kills still owed
3706	test it
3707	some owed: keep the craft count
3709	none owed: fill a fixed five slots instead
370C	zero the filled-slot counter
370F	point at the first craft record
3713	point at its sprite entry
3717	read this slot's head byte
371A	test it
371B	slot busy: step to the next one
371E	read the descriptor's edge-position offset
371F	add the heading bias
3720	double it -- two-byte position entries
3721	point at the edge-position table
3724	fetch the position's first coordinate
3725	write it to the sprite entry's +0x31 coordinate
3729	read the position's second coordinate
372A	write it to the sprite entry's +0x00 coordinate
372D	read the player heading
3730	flip it half a turn
3732	store it as the craft's heading
3735	and as its facing
3738	pick a script at random or in turn
373B	offset the script number by nine
373D	store the script index
3740	advance to the descriptor's second field
3741	read the descriptor tail byte
3742	store it as the slot's tail
3745	advance the descriptor pointer for the next slot
3746	clear the sub-position
374A	clear the second sub-position
374E	prime the step counter
3752	set the working registers aside across the animation step
3753	step the shape animation once
3756	restore them
3757	mark the slot live (0xFE)
375B	read the slot's tail byte
375E	test it
375F	non-zero tail: leave the slot at 0xFE
3761	clear tail: bump the head to 0xFF -- fully settled
3764	point at the filled-slot counter
3767	count this filled slot
3769	a sixteen-byte record stride
376C	advance to the next craft record
376E	advance to the next two-byte sprite entry
3773	loop over the slots
3776	clear the wave mark
377B	stamp the wave-claim timer ready (0xE4)
377E	point at the filled-slot counter
3781	read how many filled
3782	five or more?
3784	enough filled: request the enemy-wave sound
3787	point at the round's craft count
378A	compare the filled count against it
378B	take the craft count
378C	store it over the filled count -- the wave's kill countdown
378F	filled met the count: request the enemy-wave sound
3793	a fixed run of five slots
3795	point at the fifth craft record
3799	point at its sprite entry
379D	fill the first free one
379F	read the life-tick byte the caller points at
37A0	test it
37A1	zero: a spawning tick, go count the band
37A3	the other open value?
37A5	any other value: not a spawning tick
37A6	point at the first craft record
37A9	the record stride
37AC	seven slots to scan, busy count starts at zero
37AF	read this slot's head byte
37B0	test it
37B1	free: skip
37B3	busy: count it
37B4	step to the next record
37B5	scan all seven
37B7	take the busy count
37B8	two or more busy?
37BA	band already full enough: stage nothing
37BB	fewer than two: pick the search run
37BD	read the gate byte the caller points at
37BE	test it
37BF	zero: a spawning tick
37C1	the other open value?
37C3	anything else: gate shut, stage nothing
37C4	read the kills still owed
37C7	test it
37C8	none owed: run the fixed five-slot search
37CA	read the round's craft count
37CD	use it as the search length
37CE	point at the seventh craft record
37D2	point at its sprite entry
37D6	read this slot's head byte
37D9	test it
37DA	busy: hand the turn to the search tail
37DD	claim the free slot -- head to 0xFF
37E0	read the player heading
37E3	shift it down two
37E5	keep a 0-63 heading base
37E7	hold the base
37E8	draw a random byte
37EB	keep a 0-15 jitter
37ED	centre it about zero
37EF	jitter the heading base
37F0	wrap to 0-63
37F2	point at the spawn-direction index table
37F5	fetch the direction's spawn-record number
37F6	times four -- four-byte spawn records
37F8	point at the spawn-record table
37FB	fetch the record's first coordinate
37FC	write it into the sprite entry
3800	read the spawn record's second coordinate byte
3801	write it to the entry head
3804	read the player heading
3807	flip it half a turn -- the craft's heading
3809	store the heading
380C	and the facing
380F	pick a script at random or in turn
3812	store the script index
3816	clear the spare byte nothing reads
3819	clear the sub-position
381D	clear the second sub-position
3821	prime the step counter
3825	step the shape animation once
3828	clear the slot's tail byte
382D	draw a random byte
3830	point at the script-pick threshold
3833	compare the draw against it
3834	at or above: take the random arm
3836	below: point at the script cycle counter
3839	read it
383A	step it on
383B	past the five-long cycle?
383D	still in range: keep it
383F	wrapped: back to zero
3840	store the stepped counter
3841	hand it back
3842	fold the random draw to 0-3
3844	lift it into the 5-8 band
3846	hand it back
3847	a backward record stride (minus sixteen)
384A	step the record cursor back one slot
384C	step the entry cursor back one two-byte entry
3850	strike one off the turn count
3851	turns left: try the next slot
3854	last turn: the search ends, nothing filled
3855	read the guard byte the caller points at
3856	test it
3857	non-zero: touch nothing
3858	point at the first craft record
385C	the record stride
385F	five records to settle
3861	set the resting shape
3865	clear the step timer -- freeze the animation
3869	step to the next record
386B	settle all five
386E	point at the first craft record
3872	point at its sprite entry
3876	read the round's craft count
3879	the wave size
387A	read MOTHER_SHIP_ARMED
387D	test it
387E	clear: keep the configured size
3880	Mother-Ship armed: fill a fixed five
3882	save the count and the ordinal
3883	read this slot's head byte
3886	test it
3887	busy: skip to the next slot
388A	draw a random byte
388D	mask it to a four-byte spawn record
388F	point at the spawn-record table
3892	fetch the record's first coordinate
3893	write it into the sprite entry
3897	read the record's second coordinate
3898	write it to the entry head
389C	read the slot field byte
389D	store it as the heading
38A0	and as the facing
38A3	read the round's craft count
38A6	subtract the remaining count -- the ordinal within the pass
38A7	point at the ordinal table
38AA	fetch this slot's per-slot byte
38AB	store the script index
38AE	prime the step counter
38B2	step the shape animation once
38B5	set the slot's active flag
38B9	clear the slot's tail byte
38BD	mark the slot live -- head to 0xFF
38C0	the record stride
38C3	step to the next record
38C5	step to the next sprite entry
38C9	restore the count and ordinal
38CA	walk the counted run of slots
38CE	stamp the wave-claim timer ready (0xE4)
3B5F	read the era number
3B62	is it era 1?
3B63	outside era 1: leave the object untouched
3B64	point at the era-1 object record
3B68	point at its sprite entry
3B6C	read the record head byte
3B6F	test it
3B70	empty: tick its arming countdown
3B73	is the head 0xFF (fully live)?
3B74	a partial count: soak hits toward death -- 0xFF runs the two-tile move
3B77	fly the object along its stored velocity
3B7A	read the top tile's Y
3B7D	drop sixteen -- one tile down
3B7F	place the second tile's Y under it
3B82	read the top tile's X
3B85	give the second tile the same X
3B88	has it reached a heading-selected boundary?
3B8B	reached: retire it and hold the slot
3B8E	dress the pair by heading
3B91	run the aimed-spawn attempt
3B94	recover the record head byte
3B96	point at the hits-remaining count
3B99	read it
3B9A	test it
3B9B	no hits left: begin the death sequence
3B9E	spend one hit
3B9F	force the record head live
3BA3	re-request the craft's two sounds
3BA6	run the ordinary two-tile move
3BA9	take the record head
3BAA	at or past the death cap?
3BAC	below: run it down
3BAE	cap the head at 0x61
3BB2	request the craft's two sounds
3BB5	set the death attribute on tile one
3BB9	and on tile two
3BBD	count the death animation down one
3BC0	reached zero: retire and hold the slot
3BC2	drift the object with the world scroll
3BC5	read tile one's Y
3BC8	drop sixteen
3BCA	place tile two's Y under it
3BCD	read tile one's X
3BD0	give tile two the same X
3BD3	read the record head
3BD6	measure it past 0x40
3BD8	exactly at 0x40: post the score command
3BDB	below 0x40: nothing more this frame
3BDD	on an eight-step boundary?
3BDF	not a boundary: wait
3BE0	take the distance past 0x40
3BE1	divide it by eight
3BE4	step back one -- the death-shape index
3BE5	point at the death-shape table
3BE8	fetch the shape byte
3BE9	write it to tile two
3BEC	the next shape
3BED	write it to tile one
3BF1	command 4 (score award), argument 0x0B
3BF4	queue it in the command ring
3BF5	set the burst shape on tile two
3BF9	and on tile one
3BFD	set the burst attribute on tile one
3C01	and on tile two
3C05	step the head past 0x40
3C0E	clear this record's head
3C11	clear the next record's head too
3C14	clear the sprite entry's first coordinate
3C17	clear its second coordinate
3C1A	clear a fixed entry's second coordinate
3C1D	clear that fixed entry's first coordinate
3C20	hold the slot -- set its hold byte non-zero
3C25	read the frame counter
3C28	odd frame?
3C2A	odd frame: only tick on even ones
3C2B	count the arming timer down
3C2E	fired: arm the slot
3C31	not yet
3C32	read MOTHER_SHIP_ARMED
3C35	test it
3C36	Mother-Ship armed: do not arm
3C37	read the player heading
3C3B	bias by 8
3C3D	within the half-circle
3C3F	within eight steps of heading 0x00 or 0x80?
3C41	near it: shift the lookup heading sixteen steps, forward or back by a frame-counter bit
3C43	take the heading
3C44	rotate the heading down two
3C46	to an even offset into the edge-position table
3C48	point at the screen-edge position table
3C4B	fetch the pair's first coordinate
3C4C	seat it as the sprite entry's native-Y coordinate
3C50	read the pair's second coordinate
3C51	seat it as the entry's native-X coordinate
3C54	take the heading again
3C55	rotate three quarters
3C57	keep the facing bit
3C59	store the facing
3C5C	look up the velocity pair for this facing
3C5F	store a velocity byte
3C62	store a velocity byte
3C65	store a velocity byte
3C68	store a velocity byte
3C6D	set the hits-remaining count to three
3C70	mark the slot live
3C75	read the frame counter
3C79	a sixteen-step nudge
3C7B	pick the nudge direction from the frame counter
3C7D	one way: keep +0x10
3C7F	the other way: negate to -0x10
3C81	nudge the heading
3C82	back to the edge-position lookup
3CC4	read the object's heading
3CC7	rotate a quarter turn
3CC9	which half of the compass?
3CCB	one half: test the vertical drift band
3CCE	read the entry's second coordinate
3CD1	bias toward the wrap
3CD3	inside the three-wide band?
3CD5	inside: reached the boundary -- carry set
3CD6	outside: test the horizontal edge window
3CD9	read the entry's second coordinate
3CDC	bias toward the wrap
3CDE	inside the three-wide band?
3CE0	inside: reached -- carry set; else fall to the horizontal test
3CE1	read the entry's head coordinate
3CE4	bias across the wrap
3CE6	inside the four-wide window straddling zero?
3CE8	carry answers whether it reached the edge
3CE9	read the frame counter
3CEC	take one alternating bit -- flicker between two shapes
3CEF	read the hits remaining
3CF3	the hit count it was armed with
3CF5	subtract the hits left -- the damage taken
3CF6	times four -- four shapes per damage step
3CF8	the first damage shape
3CFA	plus the flicker bit
3CFB	the pair's lower shape code
3CFC	read the object's heading
3CFF	rotate a quarter turn
3D01	which half of the compass?
3D03	one half: swap which entry takes the lower code
3D05	one entry takes the lower shape
3D08	the next shape
3D09	the other entry takes the upper shape
3D0C	set the forward attribute on tile one
3D10	and on tile two
3D15	the other entry takes the lower shape
3D18	the next shape
3D19	one entry takes the upper shape
3D1C	set the reversed attribute on tile one
3D20	and on tile two
3D25	read the caller's object record head
3D29	return unless the object is live ($FF)
3D2A	read the attacker-spawn cooldown timer
3D2E	return while the cooldown is still counting
3D2F	read the era bank's slot count
3D33	return if the count is zero
3D34	is the count exactly one?
3D36	a count of one -- require the primary attacker record free
3D39	read era-object slot 2's record head
3D3D	free -- go find a windowed object to launch from
3D40	read the primary attacker record's head
3D44	return unless it too is free
3D45	two bank slots to scan
3D47	read the spawn-window half-width
3D4B	double it -- the full window width
3D4D	screen X reference ($84)
3D4F	minus this object's X
3D52	re-centre by the half-width
3D53	within the doubled X window?
3D54	outside the window on X -- go launch from it
3D57	screen Y reference ($78)
3D59	minus this object's Y
3D5C	re-centre by the half-width
3D5D	within the doubled Y window?
3D5E	outside the window on Y -- go launch from it
3D62	record stride ($10)
3D65	step to the next bank record
3D67	step to the next sprite entry (two bytes)
3D6C	try the other slot
3D6E	both inside the window on both axes -- nothing to spawn
3D6F	request the enemy-launch sound
3D72	point at the standoff aim point
3D75	find the heading toward the standoff aim point
3D79	prepare the turn offset ($18)
3D7C	point at the aim-side toggle
3D7F	flip the aim side for this spawn
3D80	read the toggle
3D81	test its low bit
3D83	odd -- turn one way
3D85	even -- turn the other way (negate)
3D88	add the turn onto the heading -- the aimed angle
3D89	stash the aimed angle
3D8A	take the object's Y
3D8D	take the object's X
3D90	read the era bank's slot count again
3D93	count exactly one?
3D95	then seat into the primary era bank
3D98	read era-object slot 2's record head
3D9C	free -- seat into the second era bank
3D9F	point at the primary attacker record
3DA3	and its sprite entry
3DA7	seat the object's Y into the new entry
3DAA	seat the object's X
3DAD	recover the aimed angle
3DAE	look up the doubled velocity pair for that angle
3DB1	stock the record with the aimed velocity pair -- four bytes
3DBD	set the launch shape code
3DC1	set the launch sprite attribute
3DC5	count the record head down one -- mark it live
3DC8	read the cooldown reload period
3DCB	reload the attacker-spawn cooldown
3DCF	point at era-object slot 2's record
3DD3	and its sprite entry
3DD7	seat and stock it the same way
3DDA	read the era index
3DDE	service only in era 1
3DDF	point at the fixed era-object record
3DE3	and its sprite entry
3DE7	service that slot by its head byte
3DEB	read the slot's head byte
3DEF	empty slot -- nothing to do
3DF1	any value but $FF -- retire the slot on the spot
3DF4	$FF -- fly the object one step along its velocity
3DF7	has it reached a retire line?
3DFA	not yet -- leave it flying
3DFB	take the slot out of play
3DFE	read the shared cooldown period
3E01	stock the retired record's delay byte with it
3E05	take the object's stored Y velocity, high byte
3E08	and its low byte
3E0B	read the shared per-frame world scroll (Y)
3E0F	add the scroll onto the velocity
3E10	take the object's whole Y
3E13	and its Y fraction
3E16	advance the split Y coordinate
3E17	store the new whole Y
3E1A	store the new Y fraction
3E1D	take the object's stored X velocity, high byte
3E20	and its low byte
3E23	read the shared per-frame world scroll (X)
3E27	add the scroll onto the velocity
3E28	take the object's whole X
3E2B	and its X fraction
3E2E	advance the split X coordinate
3E2F	store the new whole X
3E32	store the new X fraction
3E36	point at actor record slot 0
3E3A	and its sprite entry
3E3E	step that slot by its head byte
3E41	actor record slot 1
3E45	and its sprite entry
3E49	step it
3E4C	actor record slot 2
3E50	and its sprite entry
3E54	step it
3E57	actor record slot 3
3E5B	and its sprite entry
3E5F	step it
3E63	read the slot's head byte
3E67	empty slot -- nothing to do
3E69	any value but $FF -- run its countdown/animate branch
3E6C	read the era index
3E6F	is it the last era (4)?
3E71	in that era, cycle the object's shape first
3E74	fly the object one step along its velocity
3E77	has it reached a retire line?
3E7A	not yet -- leave it flying
3E7B	reached the line -- retire the slot
3E7E	read the free-running frame tick
3E81	halve it -- advance every other tick
3E82	take it modulo eight -- one of eight frames
3E84	offset to the shape-code base ($40)
3E86	write the shape into the sprite entry
3E89	set the fixed control byte beside it
3E8E	read the era index
3E91	the last era (4)?
3E93	yes -- run the countdown
3E95	any other era -- retire the slot at once
3E98	read the slot's countdown
3E9B	down to one above the floor?
3E9D	then retire the slot
3EA0	otherwise drop the countdown by one
3EA3	was the count at or above $3C?
3EA5	if so, clamp the slot's state and ask for two sounds
3EA8	drift the object with the world scroll
3EAB	re-read the countdown -- the clamp may have moved it
3EAE	below the animate threshold ($1C)?
3EB0	yes -- leave the shape as it is
3EB1	offset above the threshold
3EB3	shift down by two -- four counts per shape
3EB5	one of eight shapes
3EB7	point at the shape table
3EBA	fetch the shape byte for this count
3EBB	write it into the sprite entry
3EBE	set the control byte beside it
3ECB	force the slot's head byte to $3B
3ECF	request the two sounds
3ED6	read the free-running frame tick
3ED9	take its low three bits
3EDB	form this frame's bank-phase key
3EDD	does it match this bank's phase key?
3EE0	wrong phase this frame -- nothing to do
3EE1	read the bank-launch cooldown
3EE5	return while the cooldown is still running
3EE6	point at the first actor record
3EE9	and its sprite entry
3EEC	read how many records to scan
3EF0	return if the scan bound is zero
3EF1	that count bounds the free-slot scan
3EF2	read this record's head
3EF4	free record found -- launch into it
3EF7	advance to the next record (stride $10)
3EFA	advance the sprite entry (two bytes)
3EFC	keep scanning the bank
3EFE	bank full -- nothing to launch
3EFF	remember the free record pointer
3F02	and its sprite entry pointer
3F06	read the near half-width, both axes
3F0A	double it -- the full near band
3F0C	screen Y reference ($78)
3F0E	minus the craft entry's Y
3F11	re-centre by the half-width
3F12	craft within the near Y band?
3F13	outside it -- this launch clears, go on
3F15	within Y -- also test X: screen X reference ($84)
3F17	minus the craft entry's X
3F1A	re-centre by the half-width
3F1B	within the near X band too?
3F1C	too close on both axes -- reject this launch
3F1D	read the heading half-width
3F21	double it -- the full band
3F23	read the player's heading
3F26	minus the craft's heading
3F29	re-centre by the half-width
3F2A	within the heading window?
3F2B	outside it -- reject this launch
3F2C	read the found entry's page byte
3F2D	is the entry page $02?
3F2F	if so, take the extra window check
3F32	point at the standoff aim point
3F35	compute the heading toward the standoff aim point
3F38	keep the heading
3F39	measure it against the object's own heading
3F3C	centre the difference
3F3E	within a sector either way?
3F40	not aligned -- give up this frame
3F41	request the era-keyed launch sound
3F48	take the craft entry's Y
3F4B	and its X
3F4E	point at the free record found earlier
3F52	and its sprite entry
3F56	seat the craft's Y into the new entry
3F59	seat its X
3F5C	read the era index
3F60	load the heading for the velocity lookup
3F61	past era 0 -- use the later-era velocity table
3F63	era 0 -- look up the velocity pair for the heading
3F68	later eras -- look up the velocity pair for the heading
3F6B	stock the record with the velocity pair -- four bytes
3F7D	set the launch shape code
3F81	set the launch sprite attribute
3F85	read the cooldown reload period
3F88	reload the bank-launch cooldown
3F8B	count the new record head down one -- mark it live
3F93	read the era index
3F96	before the fourth era (index 3)?
3F98	yes -- request the early-era launch sound
3F9B	fourth era on -- request the late-era launch sound
3F9E	read a near half-width
3FA2	double it -- the full band
3FA4	screen X reference ($84)
3FA6	minus the craft entry's X
3FA9	re-centre by the half-width
3FAA	within the band?
3FAB	outside it -- reject this launch
3FAC	within it -- carry on to the aim check
3FAF	read the object's heading byte
3FB2	add half a sector -- round to the nearest
3FB7	shift the top nibble down -- one of sixteen heading sectors
3FB8	keep the sector index
3FBA	point at the shape table
3FBD	fetch the shape for this sector
3FBE	write the shape into the sprite entry
3FC1	step sixteen entries on --
3FC4	to the parallel attribute table
3FC5	fetch the attribute byte for this sector
3FC6	write it beside the shape
3FEA	read the era index
3FEE	run only in era 0
3FEF	point at the ballistic bank's first record
3FF3	and its first sprite entry
3FF7	three slots in the bank
3FF9	read this slot's head byte
3FFD	empty slot -- step over it
4001	any value but $FF -- run its animate service
4003	$FF -- fly the ballistic object a frame along its arc
4006	then step to the next slot
4008	service this slot's shape-cycle
400B	the record stride -- sixteen bytes per slot
400E	step the record cursor to the next slot
4010	step the sprite-entry cursor two bytes to match
4014	strike one off the slot count and, while slots remain, loop back to the sweep head
4017	take the whole part of the object's position from the sprite entry
401A	and its fraction from the record -- one 16-bit coordinate
401D	read the record's across-direction flag
4021	flag zero: step this axis the positive way
4023	non-zero: a fixed negative step across
4028	a fixed positive step across
402B	add the step onto the object's position
402C	the frame's world scroll on this axis
4030	carry the object along with the world too
4031	store the new position back -- whole to the entry, fraction to the record
4037	take the object's accumulated speed's low byte from the record
403A	and its high byte -- a 16-bit speed
403D	the per-frame speed gain
4040	the object accelerates: add nine to its stored speed
4041	keep the grown speed in the record for next frame
4047	the whole part of the object's other-axis position
404A	and its fraction
404D	move that axis by the just-grown speed
404E	the world scroll on that axis
4052	carry it along with the world as well
4053	store the new position back to entry and record
4059	read the first axis's whole part
405C	shift the wrap point into view
405E	inside a 32-wide band at the edge?
4060	yes -- it has left the field: retire the slot
4063	read the other axis's whole part
4066	at or past the far limit (248)?
4068	yes: retire the slot
406C	read the slot's countdown
406F	at or above the reset mark (60)?
4071	yes -- re-stamp its state and ask for the paired sound
4074	count the slot down one frame
4077	reached zero: retire the slot
4079	drift the object with the world scroll
407C	read the countdown again
407F	below the animation window floor (28)?
4081	yes: nothing more to draw this frame
4082	measure how far into the window it is
4084	divide that distance by four
4086	keep the low nibble as a shape-table index
4088	point at the shape-cycle table
408B	fetch the shape byte for this frame
408C	write it as the sprite's shape code
408F	set the sprite's attribute
409D	stamp the object's state byte to fifty-nine
40A1	read the era index
40A5	ask for the accompanying sound
40A8	the other arm asks for it too -- the test above changes nothing
40AB	clear the slot's occupancy byte
40AF	zero one whole coordinate in the sprite entry
40B3	and the other -- the object leaves the screen
40B8	read the era index
40BB	below the third era (index 2)?
40BD	yes: ask for nothing
40BE	read the free-running frame counter
40C1	keep its low five bits
40C3	not the one frame in thirty-two: do nothing
40C4	first of the three era-object records
40C8	holds a live object (0xFF): ask for nothing
40C9	second era-object record
40CD	holds a live object: ask for nothing
40CE	third era-object record
40D2	holds a live object: ask for nothing
40D3	all clear from the third era on: ask for the progress sound
40D6	read the era index
40D9	below the third era (index 2)?
40DB	yes: this bank is idle before then
40DC	seat the record cursor at the first bank slot
40E0	seat the sprite-entry cursor to match
40E4	read the bank's slot count
40E8	no slots: nothing to do
40E9	use the count as the sweep's turn count
40EA	read this slot's marker byte
40EE	empty: skip to the next slot
40F1	test for the ballistic marker (0xFF)
40F2	any other marker: handle the drifting-countdown object
40F4	ballistic slot -- read the era index
40F7	the final era (index 4)?
40F9	yes: run the approach-then-breakaway handler
40FC	read the slot's own countdown at +0x0e
4100	still running: fly the live slot and tick that countdown
4103	else chase the aim point and retire at the line
4106	then close this turn of the sweep
4108	otherwise step the drifting countdown object for its era
410B	the record stride -- sixteen bytes
410E	step the record cursor to the next slot
4110	step the sprite-entry cursor two bytes to match
4114	strike one off the turn count and loop to the sweep head while slots remain
4117	save the sweep's turn count across the object work
4118	read the free-running frame counter
411B	its low four bits
411D	do they match this object's phase byte?
4120	no: keep last frame's aim, just turn and move
4122	point at the shared aim point
4125	compute the heading toward it
4128	store it as the heading to turn toward
412B	turn one step toward the aim
412E	move the object a frame
4131	dress the sprite's shape and attribute for its heading
4134	restore the sweep's turn count
4135	has it drifted onto a retire line?
4138	no: keep it in play
4139	yes: retire the slot
413C	read the object's countdown
413F	at or above the reset mark (60)?
4141	yes: re-stamp its state and ask for the paired sound
4144	drift the object with the world scroll
4147	count it down one frame
414A	reached zero: retire the slot
414D	read the countdown again
4150	below the animation window floor (28)?
4152	yes: draw nothing more this frame
4153	measure how far into the window it is
4155	divide that distance by four
4157	keep three bits -- a frame index 0..7
4159	hold the frame index
415A	read the era index
415D	the final era (index 4)?
415F	yes: use the far-era frame table
4161	the near-era frame table
4164	the frame index
4165	fetch the frame's shape byte
4166	write it as the sprite's shape code
4169	set the sprite's attribute (near)
4176	the far-era frame table
4179	the frame index
417A	fetch the frame's shape byte
417B	write it as the sprite's shape code
417E	set the sprite's attribute (far)
418B	fly the object a step and retire it if it crossed the retire line
418E	tick this slot's countdown at +0x0e down one
4191	close this turn of the sweep
4194	read the slot's approach countdown at +0x04
4198	it has expired: break away
419B	still approaching: count it down one
419E	fly it toward the standoff point
41A1	close this turn of the sweep
41A4	save the sweep's turn count
41A5	move the object
41A8	animate its shape from the frame counter
41AB	has it reached a retire line?
41AE	restore the turn count
41AF	no: leave it and close the turn
41B2	yes: retire the slot
41B5	close the turn
41B8	save the sweep's turn count
41B9	read the free-running frame counter
41BC	its low four bits
41BE	not the sixteenth frame: skip re-aiming
41C0	the default aim point
41C3	test bit 0 of the slot's identity byte
41C7	set: keep that point
41C9	clear: the other aim point
41CC	compute the heading toward the chosen point
41CF	hold the heading
41D0	the first axis's distance to the aim point
41D1	within sixteen of it?
41D3	no: still approaching, just store the heading
41D5	recover the second axis's distance
41D6	within sixteen on that axis too?
41D8	both close: it has arrived -- cut the approach countdown to zero
41DC	store the new heading to turn toward
41DF	turn toward the aim at the fixed rate
41E2	move the object
41E5	animate its shape
41E9	answer whether it reached a retire line
41EC	zero the approach countdown at +0x04, so the slot breaks away next frame
41F1	read the free-running frame counter
41F4	halve it
41F5	keep three bits -- a frame 0..7
41F7	offset into the eight-shape run at 0x50
41F9	write it as the sprite's shape code
41FC	set the sprite's attribute
4201	read the heading the object aims toward
4204	subtract its current heading -- the gap around the circle
4207	bias the gap by one
4209	on the aim, or one above it?
420B	yes: hold the heading still
420C	is the shorter way round to increase or decrease?
420E	the current heading
4211	turn the decreasing way
4213	turn one step up toward the aim
4215	store the new heading
4219	turn one step down toward the aim
421B	store the new heading
421F	read the free-running frame counter
4222	its low two bits
4224	one frame in four: do not turn
4225	the heading the object aims toward
4228	minus its current heading -- the gap
422B	bias the gap by one
422D	on the aim, or one above it?
422F	yes: hold still
4230	shorter way up or down?
4232	the current heading
4235	turn the decreasing way
4237	turn two steps up toward the aim
4239	store the new heading
423D	turn two steps down toward the aim
423F	store the new heading
4243	read the frame counter
4246	keep its low three bits -- which of the eight frames of the FRAME_TICK cycle this is
4248	bias it by five to form this object's spawn turn
424A	is it this object's turn to try a spawn?
424D	not its turn: leave
424E	point at the shared spawn cooldown
4251	read the cooldown
4252	is it still running?
4253	cooldown spent: go hunt a free slot
4255	still cooling down: tick it down one
4257	point at the first record in the spawn bank
425A	point at its paired sprite entry
425D	how many slots the bank holds
4260	any at all?
4261	none: leave
4262	set the loop count to the slot total
4263	read this record's occupancy byte
4264	is the slot free?
4265	free: take it
4269	step on to the next record -- records lie 0x10 apart
426C	step the paired sprite-entry pointer along too
426E	try the next slot
4271	stash the free record pointer
4274	stash its paired entry pointer
4278	read the spawn-window half-width
427C	double it to the full window width
427E	how far the spawner sits from the fixed line 0x78, offset into the window
4284	inside the window on this axis?
4285	far enough on the first axis: go ahead and launch
4287	else measure its distance from the fixed line 0x84 on the other axis
428D	inside that window too?
428E	too close on both axes: abandon the launch
428F	hand the spawner's facing to the launcher
4292	read the era index
4295	era zero?
4296	era 0: launch on the aligned-facing path
4299	else launch with the heading-follows path
429C	read the aim-window half-width
42A0	double it to the full window width
42A2	how far the spawner sits from the fixed line 0x84, offset into the window
42A8	inside the window on this axis?
42A9	outside: abandon the launch
42AA	measure its distance from the fixed line 0x78 on the other axis
42AF	past the line one way: mark the mirror flag
42B1	the other way: mirror flag clear
42B3	go commission the launch
42B5	mirror flag set -- the new sprite is drawn mirrored
42B7	grab the spawner's first coordinate
42BA	and that axis's low byte
42BD	grab its second coordinate
42C0	and that axis's low byte
42C3	tuck the copied coordinates into the alternate registers
42C4	save the spawner's record pointer
42C6	save the spawner's entry pointer
42C8	point at the staged free record
42CC	point at its paired entry
42D0	bring the copied coordinates back
42D1	seat the first coordinate's low byte in the new record
42D4	and its high byte in the new entry
42D7	seat the second coordinate's low byte
42DA	and its high byte
42DD	store C -- the facing, or era 0's mirror flag -- in the new record
42E0	read the era index
42E3	the final era?
42E5	era 4: seed the extra byte first, then aim
42E8	era zero?
42E9	other eras: the aimed / heading paths
42EC	era 0: give the new sprite its fixed shape code
42F0	take the mirror flag
42F1	spread its low bit up into the top bits
42F4	keep the two top bits
42F6	form the sprite's attribute code
42F8	store it
42FB	clear the velocity word's low byte
42FF	seed its high byte to $FF -- a starting velocity of minus one
4303	wind the new slot's active count down -- brings it live
4306	read the spawn-cooldown reload
4309	re-arm the shared spawn cooldown
430C	restore the spawner's entry pointer
430E	and its record pointer
4310	ask for the era-0 spawn sound and return
4313	read the era index again
4316	era three?
4318	era 3: the doubled-velocity offset path
431B	era 4: the straight-aim path
431E	point at the main standoff aim point -- eras 1-2
4321	work out the heading toward it
4324	store that heading
4327	take the new slot's phase byte
432A	rotate its low bit up to the top
432D	skew the heading a quarter-turn either way
4332	store the skewed heading as the object's facing
4335	dress the sprite's shape and colour for that heading
4338	wind the new slot live
433B	read the spawn-cooldown reload
433E	re-arm the shared spawn cooldown
4341	clear the slot's delay byte
4345	restore the spawner's entry pointer
4347	and its record pointer
4349	ask for the in-play spawn sounds and return
434C	point at the main standoff aim point
434F	work out the heading toward it
4352	store it as the object's heading
4355	and as its facing, unskewed
4358	dress the sprite for that heading
435B	wind the new slot live
435E	read the spawn-cooldown reload
4361	re-arm the shared spawn cooldown
4364	clear the slot's delay byte
4368	restore the spawner's entry pointer
436A	and its record pointer
436C	ask for the late-era spawn sound and return
436F	save the facing
4370	which half of the compass the facing lies in
4375	reload the facing
4376	back half: subtract the offset
4378	front half: add a fixed heading offset
437A	store the offset heading
437D	go build its velocity
437F	subtract the fixed heading offset
4381	store the offset heading
4384	look up the doubled velocity vector for that heading
4387	file the first velocity word
438D	file the second velocity word
4393	recover the facing
4394	restore the true facing over the offset one
4397	dress the sprite for the heading
439A	seed the slot's delay byte
439E	wind the new slot live
43A1	read the spawn-cooldown reload
43A4	re-arm the shared spawn cooldown
43A7	restore the spawner's entry pointer
43A9	and its record pointer
43AB	ask for the in-play spawn sounds and return
43AE	read the aim-window half-width
43B1	seed it as the new slot's countdown byte
43B4	then take the aim path
43B7	read the round-transition hold flag
43BA	is it holding?
43BB	held between rounds: do nothing
43BC	read the mother-ship armed flag
43BF	already active?
43C0	yes: step its live sequence
43C2	which frame of the eight-frame cycle
43C7	only on frame five
43C9	other frames: leave
43CA	point at the mother-ship record bank
43CE	and its sprite entry
43D2	read the kills-remaining quota
43D5	fold in the first bank record
43D8	and the second record
43DB	quota unspent or a slot still busy: not yet
43DC	raise the mother-ship armed flag
43E1	seed its seven-hit counter
43E5	clear its entry pair and set its spawn cooldown to bring it on
43E8	start the running total at zero
43E9	add this program-image byte into the total
43EA	step to the next byte
43EB	sum the whole block -- a length of zero means all 256 bytes
43ED	hand the total to the tamper-verdict check
43F0	point at the mother-ship record
43F4	and its sprite entry
43F8	read its state byte
43FB	in the idle / placement state?
43FC	state zero: tick its spawn delay or place it
43FF	is the state 0xFF -- in flight?
4400	other states: the hit-countdown handling
4403	take the object's first velocity word
4409	read the world-scroll for that axis
440D	add the scroll to the velocity
440E	take the object's current coordinate
4414	advance it
4415	store the new coordinate back
441B	take the second velocity word
4421	read the world-scroll for the other axis
4425	add the scroll
4426	take the other coordinate
442C	advance it
442D	store it back
4433	take the first coordinate
4436	offset it sixteen for the pair's second sprite
4438	write it to the second sprite entry
443B	take the second coordinate
443E	copy it to the second sprite entry
4441	dress the sprite for its heading, or retire it at the edge
4444	then try to fire a mother-ship shot at the player
4447	has the object reached the field-edge band its heading faces?
444A	at the edge: retire its entry pair into cooldown
444D	read the era index
4451	the flutter era?
4453	era 4: give it the flutter animation instead
4456	multiply the era by sixteen -- the shape-table row base
445C	take one bit of the frame counter -- the two-frame animation tick
4461	fold it into the row base
4463	seven minus the remaining hit count -- the hits taken
4468	halve it to a two-bit damage stage
446C	index = damage stage*4 + row base
446F	point at the shape-pair table
4472	offset into it by the index
4473	read the pair's two shape codes
4476	point at the per-era colour table
4479	index by era
447A	offset into it
447B	read this era's colour code
447C	which half of the compass the heading lies in
4483	one half: swap the pair, keep the plain colour
4485	seat the shape codes in order
448B	take the colour
448C	bias it by half a page
448E	seat the biased colour in both sprite slots
4495	seat the shape codes swapped
449B	seat the plain colour in both slots
44A2	read the object's remaining hit count
44A6	still at the full seven hits?
44A8	undamaged: steady colour, then dress the flutter
44AB	step the wind-down counter
44AE	read it
44B1	is its top marker bit set?
44B3	marked: take the second-colour arm, which restarts the counter once it reaches three
44B5	has the counter passed the hit count plus two?
44B9	not yet: dress the flutter
44BB	mark the counter closed out
44BF	set the flutter colour code in both slots
44C7	go dress the flutter's two shapes
44C9	drop the top marker bit from the counter
44CC	reached three?
44CE	below three: leave the counter alone
44D0	at three or more: restart the wind-down counter
44D4	set the sprite's attribute code in both slots
44DC	the step between the two flutter shape pairs
44DF	the first shape pair
44E2	test one bit of the frame counter -- which flutter frame
44E7	one phase: keep the first pair
44E9	other phase: take the second pair
44EA	seat the two shape codes in the sprite entry
4535	read the mother-ship's spawn delay
4538	counted out?
4539	time to place it: go position it
453C	else tick the delay down
4540	keep the raised state value
4541	read its remaining hit count
4544	any hits left?
4545	none: it is destroyed -- run the round-clear
4547	take one off the hit count
454A	keep it in flight
454E	play its hit sound
4551	and fly it on
4554	recall the state value
4555	is the head 0xEF -- the step after the killing hit?
4557	not yet: step the warp/flash frame
455A	clear HITS_REMAINING
455E	queue the transition sound burst
4561	cue the destruction sound burst for the Mother-Ship
4564	point at the object bank
4567	record stride
456A	fifteen records to sweep
456C	first fill value
456E	is this record live (0xFF)?
4570	not live: free it if it reads 0xFE, else move on
4572	stamp the record with the sweep value
4577	queue a display command for it
4579	step to the next record
457A	bump the fill value
457E	sweep the rest of the bank
4582	set the round-transition hold
4587	set the mother-ship's exit state
458B	set its exit colour in both slots
4594	was the record 0xFE?
4595	no: move on
4597	clear it
4599	move on
45A1	pull a stray word off the stack -- the misaligned entry
45A4	leave the stack pointer odd
45AD	pull a second stray word, taking the flags from it
45AF	on the stray carry -- rarely -- drop into the life-loss handover
45B3	drift the object along with the world scroll
45B6	take its first coordinate
45BA	is it inside the three-wide band at 0xED-0xEF?
45BE	in that band: blank its shapes
45C0	offset the coordinate sixteen for the pair's second sprite
45C3	write it to the second sprite entry
45C6	take its second coordinate
45CA	inside the edge band on that axis?
45CE	off that edge: blank its shapes
45D0	copy the second coordinate to the second sprite entry
45D3	carry on to the shape step
45D5	blank the sprite's two shapes -- off-screen
45DD	read the sequence counter
45E0	is this the flash-trigger frame?
45E2	the trigger frame: fire the warp/flash
45E4	below the trigger: skip the shape step
45E6	turn the frame number into a 0-7 shape index
45EE	point at the eight-frame warp animation
45F1	read this frame's shape
45F2	seat it as one shape
45F5	seat the next code as the other shape
45F9	count the sequence down one frame
45FC	sequence spent: end it
45FF	reached the halfway mark?
4604	not yet: leave
4605	blank its shapes at the halfway point
460E	point at the watched video cell
4611	read it
4613	compare against the mirror cell
4617	they disagree: run the start-object setup
461B	eight warp-flash shape codes -- also run off as harmless register churn when the start-object path jumps here and drops into 0x4623
4623	step the sequence counter
4626	set the flash shapes
462E	set the flash colour in both slots
4636	is the player alive (PLAYER_STATE reads 0xFF)?
4639	if so, sound the mother-ship warp
463D	the display command
4640	queue it and return
4643	jump on to the start-object setup
4646	raise the round-transition hold
464B	reset the object's state to idle
464F	point at the tamper-glyph copy
4652	is it the expected value?
4655	no: derail through the misaligned entry at 0x459B
4658	read the following cell
465A	one accepted value?
465C	yes: end here
465D	the other accepted value?
465F	yes: end here
4660	derail through the misaligned entry at 0x459B
4663	is a round transition holding?
4667	yes: wait
4668	take the player heading
466C	take the frame counter
4670	base step
4672	test a frame-counter bit
4674	one way: keep it positive
4676	other way: negate the step
4678	add it to the angle
4679	fold to an even table index
467D	point at the entry-position table
4680	read the first coordinate
4681	seat it
4684	read the second coordinate
4686	seat it
4689	which half of the compass the angle faces
468E	store it as the mother-ship's facing
4691	give it the velocity its heading picks
4694	is its hit count already high enough?
4699	yes: leave it
469B	else seed a minimum hit count
469F	mark the mother ship in flight
46A3	ask for the current-era sound and return
46BA	set the return to the record-filing step
46BD	lay it on the stack for the arm to return through
46BE	the era index picks which velocity arm
46C3	jump through the arm table below
46CE	file the first pair's high byte
46D1	and its low byte
46D4	file the second pair's high byte
46D7	and its low byte
46DB	zero
46DC	clear the record's occupancy byte
46DF	clear the first sprite entry's +0x00 coordinate
46E2	and the second sprite entry's
46E5	clear the first sprite entry's +0x31 coordinate
46E8	and the second sprite entry's
46EB	arm the record's cooldown delay
46F0	is the object fully in flight?
46F4	not yet: leave
46F5	is the bank-launch cooldown still running?
46F9	yes: hold fire
46FA	two entry slots to consider
46FC	read the fire-window half-width
4700	double it to the full window
4702	is this tile within the vertical band?
4709	off that band: skip this slot
470B	within the horizontal band?
4712	off it: skip this slot
4714	inside the near window round the player on one axis?
471B	no -- outside it: fire from this slot
471D	inside the near window on the other axis?
4724	no -- outside it: fire from this slot
4726	step to the next record
472C	step its paired entry
4731	try the other slot
4734	point at the shot record bank
4738	and its sprite entries
473B	two shot slots to search
473E	is this shot slot free?
4740	free: launch from it
4742	step to the next shot record
4747	and its entry
4749	try the other slot
474C	stash the free shot record
4750	and its entry
4753	play the enemy launch sound
4756	the main standoff aim point
4759	work out the heading toward it
475C	keep the heading
475E	step the alternating spread counter
4762	one bit of it picks the spread direction
4766	one way: keep the spread positive
4768	other way: negate it
476B	skew the heading by the spread
476C	take the firer's coordinates
4772	point at the new shot's record and entry
477A	store the shot's heading
477D	place it at the firer's position
4783	set the return to the velocity-store step
4787	the era index picks the shot's velocity arm
4795	file the first velocity word
479B	file the second velocity word
47A1	set the shot's shape code
47A5	and its colour
47A9	bring the shot live
47AC	re-arm the bank-launch cooldown from its period
47B3	read the era index
47B6	the final era, which has no parachutist?
47B8	yes: nothing to run
47B9	point at the parachutist record
47BD	and its sprite entry
47C1	is the slot free?
47C5	free: spawn one at the edge ahead
47C8	is its state in flight -- 0xFF?
47C9	other states: the drift / award handling
47CC	fly it along its stored velocity
47CF	has it reached the retire line?
47D2	yes: retire the slot into cooldown
47D5	turn the frame tick into a 0-7 shape index
47DE	point at the canopy-sway shape table
47E1	read this frame's shape
47E2	seat it
47E5	set the canopy colour
47F2	drift the parachutist with the world
47F5	is it at the post-bonus state?
47FA	yes: post its next bonus value
47FD	is it at or above the award state?
47FF	yes: show its award glyph
4802	else count its dying timer down
4805	still counting: leave
4806	timer spent: retire the slot into cooldown
4809	put the slot into its award / exit state
480D	play the parachutist award sound
4810	is the award index within the table?
4815	past the table: use the fixed award glyph
4818	read the award glyph for this rung
481C	seat it as the sprite shape
481F	set its colour
4824	use the fixed top-award glyph
4828	set its colour
4831	count the slot's timer down
4834	read the rung number
4837	step it on for next time
483A	past the four table rungs?
483C	yes: post the fixed top value
483F	index the rung-value table by the rung
4843	take this rung's value
4844	command 0x04
4846	queue the bonus command and return
4849	the fixed top command and value
484C	queue it and return
4853	is the mother ship armed?
4857	yes: hold this spawn off
4858	only act on alternate frames
485D	this frame: skip
485E	tick the slot's spawn delay down
4861	not yet zero: wait
4862	take the player's heading, rounded
4867	fold it to one of sixteen edge sectors -- an even index
486C	point at the edge-position table
486F	read the sector's first coordinate
4870	seat it
4873	read the second coordinate
4875	seat it
4878	clear its velocity sub-pixel
4880	set its downward drift speed
4888	mark the slot live last, so it never runs with stale contents
48AD	clear the record's occupancy byte -- the object leaves play
48B1	clear the sprite entry's first coordinate
48B5	clear its second coordinate
48B9	load the record's delay byte with 0xF0 -- hold the slot on a cooldown rather than freeing it at once
48BE	debounce the service-credit line and award a credit on its edge
48C1	run coin slot 1's accept-and-tally
48C4	run coin slot 2's accept-and-tally
48C7	pulse coin slot 1's mechanical counter for each coin still owed
48CA	pulse coin slot 2's mechanical counter for each coin still owed
48E7	read the input-port mirror
48EA	rotate it right three times, dropping bit 2 -- the service-credit line -- into the carry
48ED	point at the service-credit debounce history
48F0	shift that bit into the bottom of the rolling history
48F3	keep the last three samples
48F5	a clean leading edge reads idle, idle, pressed
48F7	not an edge -- nothing to do
48F8	blip the coin sound
48FB	award exactly one credit
48FD	fold it into the credit count and pulse the counter
4911	read the input-port mirror
4914	point at coin slot 2's debounce history
4917	rotate the slot-2 selector bit toward the carry
491B	read back the history the sample was just shifted into
491C	keep the last three samples
491E	act only on a clean leading edge
4920	otherwise nothing this frame
4922	blip the coin sound
4928	bump the slot-2 coins-accepted count
492C	step the coins-inserted accumulator up by one coin's worth (0x10)
492E	store it back
4931	read the coinage ratio byte
4932	compare the raised accumulator against it
4933	ratio not yet reached -- wait for more
4935	carry the whole ratio byte for crediting
4936	take its coins-per-credit high nibble
4938	plus one coin's worth
493B	negate
493D	pull the accumulator back by that much, carrying the overshoot forward
493E	store the reduced accumulator
493F	award the credit and pulse the counter
4941	read the input-port mirror
4944	point at coin slot 1's debounce shift register
4947	rotate the coin-1 line toward the carry
4948	clock it into the debounce register
494B	keep the last three samples
494D	a clean rising edge counts as one coin
494F	no edge -- done
4951	blip the coin sound
4957	bump the count of coins slot 1 still owes its mechanical counter
495B	step the coins-inserted accumulator up by one coin (0x10)
495D	store it
4960	read the coinage ratio byte
4961	compare the raised accumulator against it
4962	still short of a credit
4964	carry the coinage byte for crediting -- its low nibble is the credits awarded
4965	take the coins-per-credit high nibble
4967	plus one coin's worth
496A	negate
496C	pull the accumulator back, carrying the overshoot past the threshold forward
496D	store the reduced accumulator
496E	read the free-play flag
4972	free play -- skip crediting, just pulse the counter
4974	take the low decimal digit of the award
4977	point at the packed-decimal credit count
497A	add the digit in
497B	decimal-adjust the sum
497C	store the new credit count
497D	no overflow -- keep it
497F	clamp the credit count at 99
4981	repaint the credit panel
4984	read how many coins slot 1 still owes its mechanical counter
4988	nothing owed -- do nothing
4989	point at the pulse timer
498E	a pulse already under way -- fall through to its countdown
4990	arm the pulse for its full length (48 frames)
4993	drive the coin-counter line high
4997	count the pulse timer down one frame
4998	timer expired -- retire one coin from the debt
499B	at the half-way count (24)
499D	not yet
499F	drop the coin-counter line low again
49A3	point at the debt count
49A6	take one coin off it so the next pulse can start
49A8	rotate the decoded configuration byte
49AA	take three configuration bits
49AC	store them
49B0	shift down to the next configuration bit
49B5	store the attract-sound enable flag
49B8	kick the watchdog
49BB	take a fixed byte from the program image
49BE	drive a control-latch line from it
49C1	tile the character plane with the box lattice
49C4	256 bytes to sum
49C6	point at the block to checksum
49C9	clear the running total
49CA	add this byte into the sum
49CC	over all 256 bytes
49CE	compare the sum against its expected total (0xC5)
49D0	a tampered image derails into the frame handler
49D3	a good image cold-starts the machine and does not return
49D6	read how many coins slot 2 still owes its mechanical counter
49DA	nothing owed -- do nothing
49DB	point at the slot-2 pulse timer
49E0	a pulse already running -- fall through to its countdown
49E2	arm the pulse for its full length (48 frames)
49E5	drive the slot-2 coin-counter line high
49E9	count the pulse timer down one frame
49EA	timer expired -- retire one coin from the debt
49ED	at the half-way count (24)
49EF	not yet
49F1	drop the slot-2 line low again
49F5	point at the slot-2 debt count
49F8	take one coin off it so the next pulse can start
4A0F	take the animation's starting step from the program image
4A12	drop it into the head of an eight-byte display control block
4A17	clear the next field
4A1C	fixed field
4A21	fixed field
4A26	fixed field
4A2B	a count field
4A2E	the script pointer 0x56F1
4A31	park it as the shared glyph-script cursor
4A34	thirteen character cells to fill
4A36	point at the character plane's first row
4A39	the fill value
4A3B	lay one character cell
4A3D	fill all thirteen
4A41	then one blank cell -- the run continues in the shared band painter
4A43	lay the lead byte over one cell
4A45	a thirteen-cell run
4A47	fill each with the body byte
4A4B	the tail byte
4A4D	a four-cell tail
4A4F	lay each tail cell
4A53	a tilemap address...
4A56	...folded down into colour RAM
4A58	read the base pen colour
4A5B	keep it
4A5E	base plus a fixed offset
4A5F	fill a colour-RAM row with it
4A65	fold to colour RAM
4A69	base plus a fixed offset
4A6A	fill a second colour-RAM row
4A70	fold to colour RAM
4A74	base plus an offset
4A75	colour one cell
4A76	step one row up
4A79	base plus an offset
4A7A	colour the cell above it
4A7E	fold to colour RAM
4A82	base plus an offset
4A83	colour a cell
4A84	step one row up
4A87	base plus an offset
4A88	colour the cell above it
4A8C	fold to colour RAM
4A90	base plus an offset
4A91	colour a cell
4A92	step one row up
4A95	base plus an offset
4A96	colour the cell above it
4A97	seed the active player's saved pen from its era
4A9A	step the sequence sub-step on
4A9D	thirteen cells to step
4A9F	load the shared glyph-script cursor
4AA2	read this script byte
4AA5	a zero leaves this cell's shape alone
4AA7	read the plane cell's shape
4AA8	step the shape up one
4AA9	the low direction bit
4AAB	forward -- keep the step up
4AAE	backward -- step the shape down instead
4AAF	write the stepped shape back
4AB0	the row-direction bit
4AB2	one row down
4AB5	forward
4AB7	or one row up
4ABA	move to the next plane cell
4ABC	reload the script cursor
4ABF	step the script forward...
4AC0	the low direction bit
4AC4	...or backward when it is set
4AC6	leave the cursor where the walk ended
4AC9	over all thirteen cells
4ACC	read the packed coinage settings
4ACF	take the low nibble -- coin slot 1's setting
4AD1	is it the free-play code?
4AD8	raise the free-play flag
4ADA	point at the coinage value table
4ADD	look the setting's value up
4ADE	store it as coin slot 1's ratio byte
4AE1	re-read the coinage settings
4AE4	rotate the high nibble down -- coin slot 2's setting
4AE8	isolate that nibble
4AEA	free-play code?
4AF1	raise the same free-play flag
4AF3	point at the coinage value table
4AF6	look the setting's value up
4AF7	store it as coin slot 2's ratio byte
4AFB	select the panel pen colour
4AFD	the cell the first digit lands in
4B00	read the packed-decimal credit count
4B03	paint its two digits
4B19	point at the program block to sum
4B1C	256 bytes, starting the total at 0x89
4B1F	read the expected total from the program image
4B22	keep it
4B23	take a block byte
4B24	fold it into the running total
4B27	over all 256 bytes
4B29	compare against the expected total
4B2A	a mismatch advances the outer sequence phase -- derailing the sequence
4B2D	step the sequence sub-step on
4B30	point at a table of three address records
4B33	three cells to copy
4B35	read the source address low...
4B37	...and high
4B39	read the cell on the first plane
4B3D	step the source high byte to the other plane -- a fixed distance apart
4B3F	read the same cell on the second plane
4B40	read the destination keep low...
4B42	...and high
4B44	store the second-plane byte
4B45	next byte of the keep -- low half only, so it wraps in its own page
4B47	store the first-plane byte beside it
4B48	over all three cells
4B4C	source: the register's second-from-top byte
4B4F	destination: the top byte
4B52	sixteen bytes to move
4B55	shift the whole shift register one place along
4B5A	read one feedback tap
4B5D	exclusive-or it with the other tap
4B5E	drop the feedback into the vacated head
4B64	add the free-running frame counter to the result
4B67	point at the seventeen seed bytes in program space
4B6A	point at the random register
4B6D	seventeen bytes to copy
4B70	seed the random register from the fixed run
4B72	take a word of program space for the image check
4B76	take a second word of program space
4B79	start the check total with the first word's low byte
4B7B	add the first word's high byte
4B7D	add the second word's low byte
4B7E	add the fixed bias -- a sound program image brings the total to zero
4B80	any other total: this is not the image the constant was picked for, so jump outside the image -- never taken on a good board
4BA5	point at the default high-score block in program space
4BA8	point at the five-entry high-score table
4BAB	forty bytes -- the whole table
4BAE	stamp the default high scores in -- the only thing that ever fills the table
4BD9	hand on to the routine that picks a program block to fold
4BDC	first score record
4BDF	its cursor cell in the tile plane
4BE2	pen colour for this readout
4BE4	paint it as an upward column
4BE7	second score record
4BEA	its cursor cell
4BED	pen colour
4BEF	paint it
4BF2	third score record
4BF5	its cursor cell
4BF8	pen colour
4BFA	paint it
4BFD	fourth score record
4C00	its cursor cell
4C03	pen colour
4C05	paint it
4C08	fifth score record
4C0B	its cursor cell
4C0E	pen colour
4C10	paint it
4C1F	save the source record pointer
4C20	read the record's lead byte
4C21	times two
4C22	times three -- three tiles per pictogram, so the lead byte selects the pictogram
4C23	point at the pictogram table
4C26	fetch the indexed pictogram tile
4C27	stamp the tile
4C28	drop to the paired colour cell
4C2A	pen colour
4C2B	write the colour
4C2C	back to the tile cell
4C2E	next pictogram tile
4C2F	step the cursor up one cell
4C30	read the tile
4C31	stamp it
4C32	drop to the colour cell
4C34	pen colour
4C35	write the colour
4C36	back to the tile cell
4C38	next pictogram tile
4C39	step the cursor up one cell
4C3A	read the third pictogram tile
4C3B	stamp it
4C3C	drop to the colour cell
4C3E	pen colour
4C3F	write the colour
4C40	back to the tile cell
4C42	drop the cursor 0x80 down to the six-digit field
4C47	restore the source record pointer
4C48	step the source past its lead bytes to the digit field
4C4B	paint the six-digit score field, leading zeros suppressed
4C4E	save the source record pointer
4C4F	drop the cursor 0x60 down to the suffix
4C54	restore the source pointer
4C55	step the source to the suffix bytes
4C58	read the first suffix tile
4C59	stamp it
4C5A	drop to the colour cell
4C5C	pen colour
4C5D	write the colour
4C5E	back to the tile cell
4C60	next suffix tile
4C61	step the cursor up one cell
4C62	read the tile
4C63	stamp it
4C64	drop to the colour cell
4C66	pen colour
4C67	write the colour
4C68	back to the tile cell
4C6A	next suffix tile
4C6B	step the cursor up one cell
4C6C	read the third suffix tile
4C6D	stamp it
4C6E	drop to the colour cell
4C70	pen colour
4C71	write the colour
4C72	back to the tile cell
4C75	blank the fixed run of character cells
4C78	read the active-player flag
4C7B	test it
4C7C	default to player one's saved context block
4C7F	player one: keep it
4C81	otherwise player two's saved context block
4C84	point at the live context block
4C87	sixteen bytes -- the whole context
4C8A	copy the saved context into the live block
4C8C	read the play-active flag
4C8F	test it
4C90	not in play: just step the sequence sub-index and return
4C93	read the round number
4C96	command 6 -- the round number
4C98	as its argument
4C99	post it to the command ring
4C9A	read the lives-remaining count
4C9D	less one
4C9E	command 5 -- lives less one
4CA0	as its argument
4CA1	post it to the command ring
4CA2	two hundred fifty-six bytes to fold
4CA4	point at the fixed program span to fold
4CA7	start the fold at zero
4CA8	fold the next byte into the running total
4CAA	loop over the whole span
4CAC	less one
4CAE	drive the picture-enable latch with it -- a tampered image blanks the picture
4CB1	step the sequence sub-index and return
4CC3	point at the top standing score's high byte
4CC6	five records to consider
4CC8	read the active-player flag
4CCB	test it
4CCC	default to player one's finished score
4CCF	player one: keep it
4CD1	otherwise player two's finished score
4CD4	save the standing pointer
4CD5	save the score pointer
4CD6	is the new score below this standing score?
4CD9	not below: this is its slot
4CDB	restore the score pointer
4CDC	restore the standing pointer
4CDD	record stride is eight
4CDF	walk the standing pointer down one record
4CE0	try the next standing score
4CE2	beat none -- set carry to say so
4CE4	how many records lie below the slot
4CE5	slot is the bottom record: nothing to slide
4CE7	last byte of the block to slide
4CEA	last byte of its destination one slot down
4CED	record count
4CEE	times two
4CEF	times four
4CF0	times eight -- eight cells per record
4CF1	that many bytes
4CF4	slide the lower records down one slot
4CF6	point at the freed slot
4CF7	back up one cell
4CF8	blank a name cell
4CFA	back up one cell
4CFB	blank a name cell
4CFD	back up one cell
4CFE	blank a name cell
4D00	remember where the three name cells start
4D03	back up to the score field
4D04	restore the finished-score pointer
4D05	three score bytes
4D08	make the finished score the copy source
4D09	copy the new score into the slot
4D0B	read the rank byte the copy uncovered
4D0C	discard the saved standing pointer
4D0D	point at the screen base of the per-rank initials cells
4D10	rank times two -- each rank's initials cells sit two addresses apart
4D11	step to this rank's initials cell
4D12	remember it
4D15	point at the high-score table base
4D18	record stride is eight
4D1B	five records
4D1D	start the rank at zero
4D1E	write this record's rank number
4D1F	next record
4D20	next rank
4D21	renumber all five ranks top to bottom
4D23	set carry
4D24	then clear it -- carry clear says the score was filed
4D26	slot is the bottom record: point at its last byte
4D29	go blank the name cells and write the score -- nothing to slide
4D2B	three bytes to compare, most significant first
4D2D	read the candidate byte
4D2E	compare with the standing byte
4D2F	candidate lower: below -- return with carry set
4D30	they differ but candidate is higher: not below
4D32	same so far: step both down to the next byte
4D34	one fewer byte
4D35	compare the next byte
4D37	set carry
4D38	then clear it -- carry clear says not below
4D3A	point at the ones place of the base-sixty tick counter
4D3D	step it on by one
4D40	no roll-over: the whole pass ends here
4D41	move to the next place
4D42	step it on by one
4D45	it did not roll over: skip the top place
4D47	move to the top place
4D48	step it on by one
4D4B	point at the reload timer
4D4E	read it
4D4F	test it
4D50	timer already spent: nothing more to do
4D51	count the timer down one
4D52	not yet zero: done
4D53	read the reload value
4D56	rearm the timer with it
4D57	read the difficulty-escalation rung
4D5A	climb one step
4D5B	past the top rung?
4D5D	no: keep it
4D5F	clamp it to the top rung -- fifteen
4D61	store the escalation rung
4D64	apply this rung's tuning row and return
4D67	read the packed-decimal place
4D68	add one
4D6A	decimal-correct the result
4D6B	store the stepped value
4D6C	reached sixty?
4D6E	no: return with carry set -- did not roll over
4D6F	rolled over: store zero
4DDE	read the play-active flag
4DE1	test it
4DE2	not in play: award nothing
4DE3	read the bonus-life setting
4DE6	keep bit 0 -- picks which mark list
4DE8	default to the first mark list
4DEB	bit 0 clear: use it
4DED	otherwise the second mark list
4DF0	read the list length into the count
4DF3	step past the length byte to the marks
4DF4	read the active-player flag
4DF7	test it
4DF8	default to player one's score top byte
4DFB	player one: keep it
4DFD	otherwise player two's score top byte
4E00	scan the list for an exact match on that top byte
4E02	point at the bonus-life latch
4E05	no match: go clear the one-shot latch below
4E07	matched: is the latch already set?
4E09	already awarded this mark: do nothing
4E0A	set the one-shot latch
4E0C	point at the lives-remaining count
4E0F	read it
4E10	add one life
4E11	command 5 -- the award
4E13	argument is the count before the increment
4E14	post it to the command ring
4E15	request the bonus-life sound and return through it
4E18	no match: clear the one-shot latch
4E4F	read the era of play
4E52	era 4?
4E54	yes: take the era-4 collision path
4E57	era 1? -- test by decrement
4E58	yes: take the era-1 collision path
4E5B	read the frame tick
4E5E	its low bit -- frame parity
4E60	odd frame: run the shot sweeps; even frame runs the full pass below
4E63	sweep the player's shots against their targets
4E66	four objects
4E68	point the record cursor at the object run
4E6B	point the entry cursor at the object run
4E6F	collision box near bound
4E71	collision box far bound
4E73	destroy the player and the objects it is touching
4E76	read the mother-ship-armed flag
4E79	test it
4E7A	armed: take the mother-ship branch
4E7C	seven slots
4E7E	collision box near bound
4E80	collision box far bound
4E82	destroy the slots and the player on contact
4E85	three targets
4E87	collision box near bound
4E89	collision box far bound
4E8B	destroy the targets a fixed attacker has reached
4E8E	one object
4E90	collision box near bound
4E92	collision box far bound
4E94	mark the objects touching the player and return
4E97	armed branch: five slots
4E99	collision box near bound
4E9B	collision box far bound
4E9D	destroy the slots and the player on contact
4EA0	the mother-ship mutual-kill box
4EA3	three targets
4EA5	point the record cursor at the era-object run
4EA8	point the entry cursor at the era-object run
4EAC	collision box near bound
4EAE	collision box far bound
4EB0	destroy the targets a fixed attacker has reached
4EB3	one object
4EB5	collision box near bound
4EB7	collision box far bound
4EB9	mark the objects touching the player and return
4EBC	read the frame tick
4EBF	its low bit -- frame parity
4EC1	odd frame: run the shot sweeps and return
4EC4	even frame: destroy the fixed target the shots have reached
4EC7	four objects
4EC9	point the record cursor at the object run
4ECC	point the entry cursor at the object run
4ED0	collision box near bound
4ED2	collision box far bound
4ED4	destroy the player and the objects it is touching
4ED7	read the mother-ship-armed flag
4EDA	test it
4EDB	armed: take the mother-ship branch
4EDD	seven slots
4EDF	collision box near bound
4EE1	collision box far bound
4EE3	destroy the slots and the player on contact
4EE6	destroy the fixed target the player has reached
4EE9	one object
4EEB	point the record cursor at the second era-object run
4EEE	point the entry cursor at the second era-object run
4EF2	collision box near bound
4EF4	collision box far bound
4EF6	destroy the player and the objects it is touching
4EF9	one object
4EFB	collision box near bound
4EFD	collision box far bound
4EFF	mark the objects touching the player and return
4F02	armed branch: five slots
4F04	collision box near bound
4F06	collision box far bound
4F08	destroy the slots and the player on contact
4F0B	the mother-ship mutual-kill box
4F0E	destroy the fixed target the player has reached
4F11	one object
4F13	point the record cursor at the second era-object run
4F16	point the entry cursor at the second era-object run
4F1A	collision box near bound
4F1C	collision box far bound
4F1E	destroy the player and the objects it is touching
4F21	one object
4F23	collision box near bound
4F25	collision box far bound
4F27	mark the objects touching the player and return
4F2A	read the frame tick
4F2D	its low bit -- frame parity
4F2F	even frame: run the whole collision pass
4F32	odd frame: run the era-4 shot sweep
4F35	read the mother-ship-armed flag
4F38	test it
4F39	armed: run the sweep that also covers the standing craft, and return
4F3C	point the record cursor at the craft run
4F3F	point the entry cursor at the craft run
4F43	point at the player-shot array
4F48	seven targets
4F4A	stage the per-pass target count
4F4B	keep seven aside in the alternate accumulator to reload the count each pass
4F4C	six shots
4F4E	stage the record cursor the sweep reloads between passes
4F52	stage the entry cursor the sweep reloads between passes
4F56	collision box near bound
4F58	collision box far bound
4F5A	run the sweep of shots against the seven targets
4F5D	point the record cursor at the era-object run
4F60	point the entry cursor at the era-object run
4F64	point at the player-shot array
4F69	three targets
4F6B	stage the per-pass target count
4F6C	keep three aside in the alternate accumulator to reload the count each pass
4F6D	six shots
4F6F	stage the record cursor the sweep reloads between passes
4F73	stage the entry cursor the sweep reloads between passes
4F77	collision box near bound
4F79	collision box far bound
4F7B	run the sweep of six shots against the three targets
4F7E	the target's hit window -- first-axis slack
4F80	first-axis window width
4F82	second-axis slack
4F84	second-axis window width
4F86	point at the player-shot array
4F8A	six shot slots to sweep
4F8C	read the target's occupancy
4F8F	is it live?
4F90	target already gone: nothing to do
4F91	read this shot slot's occupancy
4F94	is the shot live?
4F95	empty slot: skip to the next
4F97	target's first-axis position
4F9A	minus the shot's first-axis position
4F9D	plus the first-axis slack
4F9E	within the first-axis window?
4F9F	outside: skip this shot
4FA1	target's second-axis position
4FA4	minus the shot's second-axis position
4FA7	plus the second-axis slack
4FA8	within the second-axis window?
4FA9	outside: skip this shot
4FAB	hit -- destroyed marker
4FAD	mark the target destroyed
4FB0	spend the shot that hit it
4FB3	post the score for this hit
4FB6	step to the next shot slot -- low half of the cursor only, so a wide array wraps in its page
4FBC	loop over all six shots
4FBF	point at the five ordinary craft's state records
4FC2	point at those craft's sprite entries
4FC6	point at the six player-shot records
4FCB	five craft to test per shot -- also stashed in the alternate accumulator to reload the count each pass
4FCF	six shots to sweep through the run
4FD1	stash the target-record pointer so each shot pass reloads it
4FD5	stash the sprite-entry pointer likewise
4FD9	box half-reach 7 on the first axis
4FDB	box span 15 on the first axis
4FDD	sweep the six shots against the five craft, destroying and scoring each hit -- then fall into the mother-ship sweep
4FE0	read the era index
4FE3	era 0?
4FE4	era 0: use the wider first-axis box
4FE6	era 4?
4FE8	era 4: use the wider box too
4FEA	narrow first-axis half-reach 6
4FEC	narrow first-axis span 13
4FEE	second-axis half-reach 23
4FF0	second-axis span 31
4FF2	point at the six player-shot records
4FF6	six shots to sweep
4FF8	read the mother ship's state
4FFC	return unless the mother ship is live (0xFF)
4FFD	read this shot's state
5001	dead shot -- skip
5003	the mother ship's first-axis coordinate
5006	minus this shot's first-axis
5009	add the first-axis half-reach
500A	inside the first-axis span?
500B	outside -- skip
500D	the mother ship's second-axis coordinate
5010	minus this shot's second-axis
5013	add the second-axis half-reach
5014	inside the second-axis span?
5015	outside -- skip
5017	the destroyed code
5019	destroy the mother ship
501C	destroy this shot
501F	post the chained hit score
5024	advance to the next shot record -- low byte only, so it wraps inside the page
5028	loop the six shots
502B	wider first-axis half-reach 8
502D	wider first-axis span 17
502F	run the sweep with the wider box
5032	read the flag that the mother ship is out
5035	set?
5036	mother ship out: run the nine-target sweep, then the mutual-hit pass
5039	point at the enemy-target state records
503C	point at their sprite entries
5040	point at the six player-shot records
5045	eleven targets per shot -- also stashed in the alternate accumulator to reload each pass
5049	six shots to sweep
504B	stash the target-record pointer for reload
504F	stash the sprite-entry pointer likewise
5053	box half-reach 7
5055	box span 15
5057	sweep the shots against the eleven targets, destroying and scoring each
505A	point at the enemy-target state records
505D	point at their sprite entries
5061	point at the six player-shot records
5066	nine targets per shot -- also stashed in the alternate accumulator to reload each pass
506A	six shots to sweep
506C	stash the target-record pointer for reload
5070	stash the sprite-entry pointer likewise
5074	box half-reach 7
5076	box span 15
5078	sweep the shots against the nine targets, destroying and scoring each
507B	then run the mother-ship-and-shot mutual-hit sweep
507E	point at the player's sprite entry
5082	read the player's state
5086	player gone -- nothing to do
5087	read the fixed target's state
508B	target gone -- nothing to do
508C	the fixed target's first-axis coordinate
508F	minus the player's first-axis
5092	add the first-axis slack (6)
5094	inside the first-axis window (13)?
5096	outside -- no contact
5097	the fixed target's second-axis coordinate
509A	minus the player's second-axis
509D	add the second-axis slack (24)
509F	inside the second-axis window (33)?
50A1	outside -- no contact
50A2	the destroyed code
50A4	destroy the player
50A7	destroy the fixed target
50AB	clear the target's remaining-hits count so the contact kills it outright rather than costing it a hit
50AE	post the chained hit score
50B1	read the era index
50B4	era 0?
50B5	era 0: use the wider-box mutual-kill check
50B7	era 4?
50B9	era 4: use the wider-box check too
50BB	point at the player's sprite entry
50BF	read the player's state
50C3	player gone -- nothing to do
50C4	read the mother ship's state
50C8	mother ship gone -- nothing to do
50C9	the mother ship's first-axis coordinate
50CC	minus the player's first-axis
50CF	add the narrow first-axis slack (6)
50D1	inside the first-axis window (13)?
50D3	outside -- no contact
50D4	the mother ship's second-axis coordinate
50D7	minus the player's second-axis
50DA	add the second-axis slack (25)
50DC	inside the second-axis window (35)?
50DE	outside -- no contact
50DF	the destroyed code
50E1	destroy the player
50E4	destroy the mother ship
50E8	clear the mother ship's hits-to-absorb count, four bytes into its record
50EB	post the chained hit score
50EE	point at the player's sprite entry
50F2	read the player's state
50F6	player gone -- nothing to do
50F7	read the mother ship's state
50FB	mother ship gone -- nothing to do
50FC	the mother ship's first-axis coordinate
50FF	minus the player's first-axis
5102	add the wider first-axis slack (8)
5104	inside the wider first-axis window (17)?
5106	outside -- no contact
5107	the mother ship's second-axis coordinate
510A	minus the player's second-axis
510D	add the second-axis slack (25)
510F	inside the second-axis window (35)?
5111	outside -- no contact
5112	the destroyed code
5114	destroy the player
5117	destroy the mother ship
511B	clear the mother ship's hits-to-absorb count, four bytes into its record
511E	post the chained hit score
5121	read the player's state -- the fixed attacker
5125	player gone -- nothing to do
5126	read this target's state
5128	dead target -- skip
512A	the player's first-axis coordinate
512D	minus this target's first-axis
5130	add the caller's slack
5131	inside the caller's window?
5132	outside -- skip
5134	the player's second-axis coordinate
5137	minus this target's second-axis
513A	add the same slack
513B	inside the same window?
513C	outside -- skip
513E	the destroyed code
5140	destroy the player
5143	destroy this target
5144	post the chained hit score
5148	advance to the next target record -- low byte only, so it wraps inside the page
514B	step to the next sprite entry (two bytes on)
514F	loop the run
5152	read the player's state
5156	player already hit -- nothing to do
5157	read this slot's state
5159	slot already hit -- skip
515B	the player's first-axis coordinate
515E	minus this slot's first-axis
5161	add the caller's first-axis bias
5162	inside the caller's first-axis width?
5163	outside -- skip
5165	the player's second-axis coordinate
5168	minus this slot's second-axis
516B	add the fixed second-axis bias (8)
516D	inside the fixed second-axis width (17)?
516F	outside -- skip
5171	the hit code
5173	mark the player hit
5176	mark this slot hit
5177	post the chained hit score
517B	advance to the next slot record -- low byte only, so it wraps inside the page
517E	step to the next sprite entry (two bytes on)
5182	loop the run
5185	read the player's state
5189	player gone -- nothing to do
518A	read this object's state
518C	dead object -- skip
518E	the player's first-axis coordinate
5191	minus this object's first-axis
5194	add the caller's slack
5195	inside the caller's window?
5196	outside -- skip
5198	the player's second-axis coordinate
519B	minus this object's second-axis
519E	add the same slack
519F	inside the same window?
51A0	outside -- skip
51A2	the destroyed code
51A4	destroy the player
51A7	destroy this object
51A9	advance to the next object record -- low byte only, so it wraps inside the page
51AC	step to the next sprite entry (two bytes on)
51B0	loop the run
51B3	read the player's state
51B7	player gone -- nothing to do
51B8	read this object's state
51BA	dead object -- skip
51BC	the player's first-axis coordinate
51BF	minus this object's first-axis
51C2	add the caller's offset
51C3	inside the caller's width?
51C4	outside -- skip
51C6	the player's second-axis coordinate
51C9	minus this object's second-axis
51CC	add the same offset
51CD	inside the same width?
51CE	outside -- skip
51D0	the marked code
51D2	mark this object -- the only cell written
51D4	advance to the next object state byte -- low byte only, so it wraps inside the page
51D7	step to the next sprite entry (two bytes on)
51DB	loop the run
51DE	save the caller's DE across the post
51DF	read the chain window
51E2	has it run out?
51E3	window closed -- post the first step
51E5	read the chain step
51E8	climb it one
51E9	store the climbed step
51EC	wrap it within the eight-long chain
51EE	the argument is that step plus one
51F0	scoring command group 4
51F2	queue the score request onto the command ring
51F3	restore the caller's DE
51F4	reload value 30
51F6	re-arm the chain window
51FA	scoring command 4, argument 1 -- the first step
51FD	queue it onto the command ring
51FE	restore the caller's DE
51FF	reload value 30
5201	re-arm the chain window
5205	point at the chain window
5208	read it
5209	already zero?
520A	run out -- clear the chain step instead
520C	count the window down one
520E	point at the next byte -- the chain step
520F	clear it, so the next hit starts the award from the bottom
5211	read this shot's state
5215	dead shot -- on to the next shot
5217	read this target's state
5219	dead target -- skip
521B	the target's first-axis coordinate
521E	shift the low end above zero
5220	in the dead band a blank slot leaves near zero?
5222	yes -- no real target here, skip
5224	the target's second-axis coordinate
5227	shift the low end above zero
5229	in the near-zero dead band?
522B	yes -- skip
522D	the shot's first-axis coordinate
5230	minus the target's first-axis
5233	add the half-reach
5234	inside the span?
5235	outside -- skip
5237	the shot's second-axis coordinate
523A	minus the target's second-axis
523D	add the half-reach
523E	inside the span?
523F	outside -- skip
5241	the destroyed code
5243	destroy the shot
5246	destroy the target
5247	post the chained hit score
524B	advance to the next target record -- low byte only, so it wraps inside the page
524E	step to the next target entry (two bytes on)
5252	loop the targets for this shot
5254	reload the sprite-entry cursor for the next shot
5258	reload the target-record cursor for the next shot
525D	reload the per-shot target count from the alternate accumulator
5261	advance to the next shot record -- low byte only, so it wraps inside the page
5265	one shot done
5266	loop the shots
526A	point at the erase list's first entry
526D	park the erase cursor there -- list emptied
5270	point at the pending list's first entry
5273	park the pending cursor there -- list emptied
5286	blank the cells the previous pass painted
5289	paint the cells now pending
528C	read the pending list's fill count -- its cursor's low byte
528F	still at the first entry -- nothing pending?
5291	nothing pending -- park both cursors and return
5293	set the block-copy length to the pending fill count
5294	high byte zero -- a length of zero would copy the whole address space
5296	source: the pending list from its cursor
5299	destination: the erase list
529C	copy the pending list wholesale onto the erase list
529E	flag the copied count with the top bit...
52A0	...and write it as the erase cursor, marking the list copied
52A3	point at the pending list's first entry
52A6	park the pending cursor there -- pending list emptied
52AA	take the boot default for the high-score high byte
52AD	seed it into its cell
52B0	take the boot default for the kill quota
52B3	seed it into its cell
52B6	read the first DIP-switch bank
52B9	complement it -- the switches read active-low
52BA	store it as the coin settings
52BD	unpack the coin ratios from it
52C0	read the second DIP-switch bank
52C3	complement it
52C4	keep the whole complemented bank for the peeler
52C5	take the low two switch bits
52C7	turn them into a lives count of 3, 4, 5 or 6
52C9	the setting that would give six...
52CB	...otherwise carry the lives count on
52CD	...folds to all-ones (255 starting lives)
52CF	hand the lives count and the whole bank to the switch-settings peeler
52D2	read the pen colour
52D5	keep its low nibble as the shared tint bias
52D8	read the pending list cursor
52DB	take its low byte
52DC	drop the four-byte header -- how many bytes are filled
52DE	nothing pending -- done
52DF	divide the byte count by four -- four bytes per entry -- into an entry count
52E1	keep it within one page (at most 31 entries)
52E4	point at the list's first entry
52E7	take the entry's colour-plane address low byte
52E9	and its high byte
52EB	read the colour cell there
52EC	is it flagged as drawn above the sprites?
52EE	yes -- leave this cell alone
52F0	take the entry's shape
52F1	aim one plane up -- the character plane
52F3	write the shape into the character plane
52F4	back to the colour plane
52F7	take the entry's colour
52F9	add the shared tint bias
52FA	write the colour into the colour cell
52FB	loop the pending entries
52FE	skip this passed-over entry's shape and colour bytes
5300	loop the pending entries
5303	run the image-checksum tamper test, returning the checksum
5306	is it the one value a genuine image gives?
5308	tampered -- spring the tamper trap
530B	genuine -- step the attract sequence on
530E	read the deferred-blank list's write cursor
5311	take its low byte -- how far the list has filled
5312	mask off the top bit the filler sets
5314	subtract the four-byte header -- leaves the bytes actually queued
5316	still at the first entry: nothing pending, done
5317	turn the byte count into an entry count -- four bytes each
5319	keep it within the list's page
531B	loop that many entries
531C	point at the first list entry
531F	this entry's target colour cell, low byte of the address
5321	and its high byte
5323	read that colour cell
5324	test its high-priority bit
5326	already high-priority: leave this cell, on to the next entry
5328	step past this entry's two spare bytes to the next
532A	aim the same address at the character plane (+$400)
532C	the blank glyph
532E	stamp it into the character cell, colour left as-is
532F	next queued entry
5332	step over the skipped entry's two spare bytes
5334	on to the next entry
5337	the object's first pixel coordinate
533A	bias by seven -- centres the block on the object
533C	keep the biased coordinate
533D	seed the colour-plane address high byte
5343	fold the coordinate's top bits into that high byte
5345	its tile-row bits for the address low byte
5348	the object's second pixel coordinate
534B	bias by seven
534D	keep it
5351	its tile column
5353	combine row and column -- the block's top-left cell, low byte
5355	back to the second coordinate
5359	its low three bits, the sub-cell shift
535C	the first coordinate again
535F	its bit that overflows the record index into the high byte
5363	set that high bit of the index
5366	the first coordinate's low bits for the index
5368	add the second coordinate's -- picks one of sixty-four sub-cell records
536A	the table of pre-shifted tile records
536D	index the chosen record -- four glyph/attribute pairs, one per cell
536E	first cell's glyph
5370	its colour attribute
5372	glyph zero?
5373	transparent: skip this cell
5376	the deferred-write list's tail
5379	write the cell address low byte
537B	the high byte
537D	the glyph
537F	the attribute
5381	store the advanced tail -- stays inside its page
5385	step the cell across one column
5386	second cell's glyph
5388	its attribute
538A	glyph zero?
538B	transparent: skip it
538E	the list tail
5391	cell address low byte
5393	high byte
5395	glyph
5397	attribute
5399	store the advanced tail
539E	step the cell down one row to the second row's first column
53A4	third cell's glyph
53A6	its attribute
53A8	glyph zero?
53A9	transparent: skip it
53AC	the list tail
53AF	cell address low byte
53B1	high byte
53B3	glyph
53B5	attribute
53B7	store the advanced tail
53BB	step the cell across one column
53BC	fourth cell's glyph
53BE	its attribute
53C0	glyph zero?
53C1	transparent: skip it
53C4	the list tail
53C7	cell address low byte
53C9	high byte
53CB	glyph
53CD	attribute
53CF	store the advanced tail
55D4	point at the pending-sound queue's count
55D7	how many are waiting
55D8	any?
55D9	none: nothing to send
55DA	drop the count by one
55DB	remember whether that emptied the queue
55DC	point at the head byte
55DD	the oldest queued sound code
55DE	hand it to the audio processor
55E1	recover the emptied-queue flag
55E2	that was the last: nothing to slide, done
55E3	one fewer byte still queued
55E6	that many bytes to slide
55E7	destination is the head slot
55E9	source is the byte after it
55EA	slide every remaining byte down one, so the head holds the next code
55F8	drop the byte into the audio processor's command latch
55FB	raise
55FD	the audio processor's attention line
5600	idle -- widen the attention pulse
5606	then drive
5608	the attention line back low, ready for the next pulse -- the low-to-high edge is what raises the audio interrupt
560C	save the caller's pointer
560D	hold the requested sound code
560E	the play-in-progress flag
5611	is a game running?
5612	running: go queue the code
5614	not running: drop the request silently and return
5617	save the caller's pointer
5618	hold the requested sound code
5619	the play-in-progress flag
561C	is a game running?
561D	running: go queue the code
561F	the attract-loop sound-enable flag
5622	set?
5623	set: queue it even with no game running
5625	neither: drop the request and return
5629	hold the sound code, then fall into the shared queue tail
562A	the pending-sound queue's count
562D	one more entry
562E	the new count
562F	index that many past the count -- the new tail slot
5630	recover the code
5631	store it at the tail
5634	a sound code from the program image
5637	queue it, no permission test
563A	the next code
563D	queue it
5640	the next code
5643	queue it
5646	the next code
5649	queue it
564C	the next code
564F	queue it
5652	the next code
5655	queue it
5658	the current era index
565B	offset it to an era-specific code
565D	queue that one too
565F	a sound code from the program image
5662	request it, only while a game is in progress
5664	a sound code from the program image
5667	request it, only while a game is in progress
5669	a sound code from the program image
566C	request it, only while a game is in progress
566E	first sound code from the program image
5671	request it while a game runs, then fall into the next request
5674	a sound code from the program image
5677	request it, only while a game is in progress
5679	a sound code from the program image
567C	request it, only while a game is in progress
567E	a sound code from the program image
5681	request it while a game runs or attract sound is enabled
5683	first sound code from the program image
5686	request it -- game or attract sound
5689	second sound code from the program image
568C	request it -- game or attract sound
568E	a sound code from the program image
5691	request it, only while a game is in progress
5696	a block of the program image
5699	start from the current sequence phase
569C	subtract each image byte in turn
56A1	fold in a trailing constant -- on an intact image this nets to the phase the sequence wants
56A3	store it back as the sequence phase -- a patched image lands in a different phase instead of failing
56A6	multiplex the object list onto the eight hardware sprite slots
56A9	advance the player by its state
56AC	multiplex the sprite slots again
56AF	run the era's scrolling scenery
56B2	advance the player's shots
56B5	multiplex the sprite slots once more
56B8	the sequence delay counter
56BB	count down one frame
56BC	not expired yet: done
56BF	a second block of the program image
56C2	the sequence phase again
56C5	subtract each byte
56CA	fold in its trailing constant
56CC	store back to the sequence phase
56CF	step the sequence to its next sub-step
56D2	first sound code from the program image
56D5	request it, only while a game is in progress
56D8	second sound code from the program image
56DB	request it, only while a game is in progress
56DE	third sound code from the program image
56E1	request it while a game runs, then fall into the inter-round pair
56E4	first sound code from the program image
56E7	request it -- game or attract sound
56EA	second sound code from the program image
56ED	request it -- game or attract sound
57F1	fetch the coin sound code from the program image
57F4	request it with no permission test -- it sounds whether or not a game is running
57F7	read the current era index
57FA	offset it twelve codes up -- each era selects its own sound
57FC	request that sound, only while a game is in progress
57FF	fetch the parachutist-award sound code from the program image
5802	request it, only while a game is in progress
5805	fetch the bonus-life sound code from the program image
5808	request it, only while a game is in progress
580B	fetch the mother-ship warp sound code from the program image
580E	request it, only while a game is in progress
5811	fetch the player-spawn flash sound code from the program image
5814	request it, only while a game is in progress
5817	fetch the enemy-wave sound code from the program image
581A	request it, only while a game is in progress
5834	fetch the round-start sound code from the program image
5837	request it, only while a game is in progress
583A	fetch another sound code from the program image
583D	request it, only while a game is in progress
5840	point at the slowest velocity table
5843	fly the object one step along its heading using that table
5854	point at a velocity table
5857	fly the object one step along its heading using that table
5860	point at a velocity table
5863	fly the object one step along its heading using that table
5866	take the colour-RAM base from the program image
5869	0x400 bytes to fill
586C	the colour fill value
586E	store the fill byte
5870	count one cell down
5872	test the 16-bit count for zero
5873	loop until colour RAM is filled
5875	kick the watchdog -- colour fill done
5878	take the video-RAM base from the program image
587B	0x400 bytes to fill
587E	the video fill value -- a blank tile
5880	store the fill byte
5882	count one cell down
5884	test the 16-bit count for zero
5885	loop until video RAM is filled
5887	point at the start of the program image
588A	seed the running total with the first program byte
588D	add this program byte into the total
588F	keep the total safe while the pointer is tested
5890	take the pointer's high byte
5891	past the last program page (0x60)?
5893	image exhausted: go check the total
5895	bring the total back
5896	kick the watchdog -- once per summed byte
5899	keep summing
589B	bring the total back
589C	subtract the value a genuine image sums to
589E	a tampered image derails into the velocity-table data
58A1	a genuine image hands on to cold-start init
58A4	point at a velocity table
58A7	fly the object one step along its heading using that table
58AA	point at the slowest velocity table
58AD	fly the object one step at double velocity using that table
58B6	point at a velocity table
58B9	fly the object one step at double velocity using that table
58BC	read this object's heading
58BF	hold the heading for the perpendicular sample
58C0	double the heading -- two bytes per table entry
58C9	read the low byte of the velocity component at the heading
58CB	read its high byte
58CC	recall the heading
58CD	step a quarter turn back -- the perpendicular partner
58CF	offset to that perpendicular sample
58D4	or offset back when the quarter-turn index wrapped
58D7	reach the perpendicular sample
58D8	read its high byte
58DA	read its low byte -- the second component
58DB	take the shared per-frame vertical world-scroll
58DE	add this object's first-axis component
58DF	read the fraction of the first coordinate
58E2	read its whole part from the sprite entry
58E5	add the displacement onto the coordinate
58E6	store the new fraction
58E9	store the new whole part into the sprite entry
58EC	take the shared per-frame horizontal world-scroll
58EF	add this object's second-axis component
58F0	read the fraction of the second coordinate
58F3	read its whole part from the sprite entry
58F6	add the displacement onto the coordinate
58F7	store the new fraction
58FA	store the new whole part into the sprite entry
58FE	read this object's heading
5901	hold the heading for the perpendicular sample
5902	double the heading -- two bytes per table entry
590B	read the low byte of the velocity component at the heading
590D	read its high byte
590E	recall the heading
590F	step a quarter turn back -- the perpendicular partner
5911	offset to that perpendicular sample
5916	or offset back when the quarter-turn index wrapped
5919	reach the perpendicular sample
591A	read its high byte
591C	read its low byte -- the second component
591D	take the shared per-frame vertical world-scroll
5920	add this object's first-axis component
5921	add it again -- twice this object's own speed
5922	read the fraction of the first coordinate
5925	read its whole part from the sprite entry
5928	add the displacement onto the coordinate
5929	store the new fraction
592C	store the new whole part into the sprite entry
592F	take the shared per-frame horizontal world-scroll
5932	add this object's second-axis component
5933	add it again -- twice this object's own speed
5934	read the fraction of the second coordinate
5937	read its whole part from the sprite entry
593A	add the displacement onto the coordinate
593B	store the new fraction
593E	store the new whole part into the sprite entry
5942	point at the slowest velocity table
5945	look up the velocity vector for the heading using that table
594E	point at a velocity table
5951	look up the velocity vector for the heading using that table
5965	point at a velocity table
5968	look up the velocity vector for the heading using that table
596B	point at a velocity table, then look up the velocity vector for the heading
596E	read this object's heading
5971	hold the heading for the perpendicular sample
5972	double the heading -- two bytes per table entry
597B	read the low byte of the velocity component at the heading
597D	read its high byte -- the component at the heading
597E	recall the heading
597F	step a quarter turn back -- the perpendicular partner
5981	offset to that perpendicular sample
5986	or offset back when the quarter-turn index wrapped
5989	reach the perpendicular sample
598A	read its high byte
598C	read its low byte -- the perpendicular component
598E	point at the slowest velocity table
5991	read that table's doubled velocity for this object's heading
5994	point at a velocity table
5997	read that table's doubled velocity for this object's heading
599D	read this object's heading, then take the doubled velocity for it
59A0	hold the heading for the perpendicular sample
59A1	double the heading -- two bytes per table entry
59AA	read the low byte of the velocity component at the heading
59AC	read its high byte -- the component at the heading
59AD	double the component low byte
59AF	carry into the high byte -- twice the table's length
59B1	recall the heading
59B2	step a quarter turn back -- the perpendicular partner
59B4	offset to that perpendicular sample
59B9	or offset back when the quarter-turn index wrapped
59BC	reach the perpendicular sample
59BD	read its high byte
59BF	read its low byte -- the perpendicular component
59C0	double the component low byte
59C2	carry into the high byte -- twice the table's length
59C5	point at the slowest velocity table
59C8	take that table's doubled velocity for the heading in A
59CB	point at a velocity table
59CE	take that table's doubled velocity for the heading in A
59D1	point at a velocity table
59D4	take that table's doubled velocity for the heading in A
5BD7	blank a fixed run of fourteen character cells
5BDA	advance the interpolated pen run one step
5BDD	return unless the pen run reseated to a whole row
5BDE	point at a 256-byte program block to fold
5BE1	clear the running fold
5BE2	256 bytes to fold -- a zero count runs the full round
5BE3	fold this byte into the running exclusive-or
5BE5	loop over all 256 bytes
5BE7	test the fold against its expected value
5BE9	on a mismatch, raise the sequence phase -- anti-tamper
5BEC	read the sequence phase -- the guard routes its checksum through it
5BEF	point at a 20-byte program block to sum
5BF2	20 bytes to sum
5BF4	add this byte into the running total
5BF6	loop over all 20 bytes
5BF8	add the bias -- on a clean image this returns the cell to its old value
5BFA	write the sequence phase back
5BFD	step the sequence sub-index
