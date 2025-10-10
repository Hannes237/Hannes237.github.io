Sound Tests
===========

This folder contains a minimal page to manually trigger the app’s two sounds.

Included
- sound-tests.html — Minimal HTML page with exactly two buttons.
- sound-tests.js — Wires the buttons to the sound functions.

How to use
1) Open tests/sound-tests.html in your browser (double-click the file or drag it into a tab).
2) Click one of the two buttons:
   - Play Blink Sound — plays the deep transition tone used on exercise change.
   - Play Countdown Beep — plays the higher beep used in the last 3 seconds.

Notes
- Some browsers require a user gesture before audio plays; clicking either button satisfies this.
- The page loads the app’s existing ../script.js to access the sound functions.
