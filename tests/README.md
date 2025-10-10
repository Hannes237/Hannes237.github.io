Sound Tests
===========

This folder contains a simple, browser-based test harness to exercise the sound functions used by the Interval Workout Timer.

What’s included
- sound-tests.html — An HTML page you can open locally in a browser.
- sound-tests.js — The test harness logic (smoke tests + manual controls).

How to run locally
1) Open tests/sound-tests.html in your browser (double-click the file or drag it into a tab).
   - If your browser blocks autoplay audio, click anywhere in the page, then click "Run Tests".
2) Optionally, click the manual buttons to hear the sounds:
   - Play Blink Chime: calls playBlinkSound().
   - Play Countdown Beep: calls playCountdownBeep().
   - Play Custom Harmonic: calls playHarmonicChime() with parameters you set.
   - Sweep 440→880Hz: plays a quick frequency sweep for listening checks.

What the automated tests do
- Verify that the Web Audio API is available (AudioContext).
- Verify that playHarmonicChime, playBlinkSound, and playCountdownBeep are defined.
- Call each function to ensure it executes without throwing (smoke tests), including edge-case parameters.
- Run a burst of rapid calls to ensure multiple quick invocations don’t throw.

Notes
- The tests are intentionally simple and do not verify sound quality—only that calls succeed without errors and basic API presence.
- Audio playback often requires a user gesture; click somewhere on the page first if you don’t hear anything.
- The page loads the app’s existing ../script.js, so no changes to the main app code are needed.
