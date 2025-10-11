// --- Workout Data ---
const workoutRoutines = {
    "morning": {
        name: "Morning Mobility Mantra",
        exercises: [
            { name: "Molassa Squat", duration: 30, color: "bg-neutral" },
            { name: "Standing Forward Fold", duration: 30, color: "bg-neutral" },
            { name: "Deep Calf Stretch", duration: 30, color: "bg-neutral" },
            { name: "Downward Dog", duration: 30, color: "bg-neutral" },
            { name: "Low Lunge to Half Split", duration: 30, color: "bg-neutral", isTwoSided: true },
            { name: "Swan Rises", duration: 30, color: "bg-neutral", reps: 10 },
            { name: "Relaxed Child's Pose", duration: 30, color: "bg-neutral" },
        ]
    }
};

// --- Global State Variables ---
let currentRoutineKey = "morning"; // Default routine
let exercises = []; // Will hold the expanded list of steps
let currentExerciseIndex = 0;
let timeRemaining = 0;
let timerInterval = null;
let isRunning = false;
let totalWorkoutDuration = 0;

// --- DOM elements ---
const routineSelector = document.getElementById('routine-selector');
const routineTitleEl = document.getElementById('routine-title');
const currentExerciseEl = document.getElementById('current-exercise');
const timerDisplayEl = document.getElementById('timer-display');
const totalTimeDisplayEl = document.getElementById('total-time-display');
const startButton = document.getElementById('start-button');
const resetButton = document.getElementById('reset-button');
const exerciseListEl = document.getElementById('exercise-list');
const bodyEl = document.body;
const interSetBreakInput = document.getElementById('inter-set-break-input'); // NEW DOM element

// --- Audio (iOS-friendly) ---
let audioCtx = null;
let audioUnlocked = false;

// HTMLAudioElement-based iOS strategy
let htmlAudio = null; // created synchronously from user gesture
let soundEnabled = false; // toggle state
const SoundURLs = { blink: null, beep: null }; // object URLs to pre-rendered tones

function ensureAudioContext() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return null;
        if (!audioCtx) {
            audioCtx = new AudioContext();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    } catch (e) {
        console.warn('AudioContext unavailable:', e);
        return null;
    }
}

function setupAudioUnlock() {
    const unlock = () => {
        try {
            const ctx = ensureAudioContext();
            if (ctx) {
                // Play a near-silent tick to satisfy iOS gesture requirement
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.00001, now);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.01);
                audioUnlocked = true;
            }
        } catch (e) {
            // ignore
        } finally {
            window.removeEventListener('touchstart', unlock);
            window.removeEventListener('mousedown', unlock);
            window.removeEventListener('pointerdown', unlock);
            if (startButton) startButton.removeEventListener('click', unlock);
        }
    };
    window.addEventListener('touchstart', unlock, { once: true });
    window.addEventListener('mousedown', unlock, { once: true });
    window.addEventListener('pointerdown', unlock, { once: true });
    if (startButton) startButton.addEventListener('click', unlock, { once: true });
}

// --- Utility Functions ---

/**
 * Encode an AudioBuffer to a WAV Blob (PCM 16-bit mono/stereo)
 */
function audioBufferToWavBlob(buffer) {
    const numOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const samples = buffer.getChannelData(0);
    const numFrames = buffer.length;
    const blockAlign = numOfChannels * bitDepth / 8;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numFrames * blockAlign;
    const bufferSize = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    let offset = 0;
    // RIFF header
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;

    // fmt chunk
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // SubChunk1Size
    view.setUint16(offset, format, true); offset += 2; // AudioFormat
    view.setUint16(offset, numOfChannels, true); offset += 2; // NumChannels
    view.setUint32(offset, sampleRate, true); offset += 4; // SampleRate
    view.setUint32(offset, byteRate, true); offset += 4; // ByteRate
    view.setUint16(offset, blockAlign, true); offset += 2; // BlockAlign
    view.setUint16(offset, bitDepth, true); offset += 2; // BitsPerSample

    // data chunk
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, dataSize, true); offset += 4;

    // Interleave channels if needed and convert to 16-bit PCM
    if (numOfChannels === 2) {
        const channelData0 = buffer.getChannelData(0);
        const channelData1 = buffer.getChannelData(1);
        let idx = 0;
        for (let i = 0; i < numFrames; i++) {
            // Left
            let s = Math.max(-1, Math.min(1, channelData0[i]));
            view.setInt16(offset + idx, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            idx += 2;
            // Right
            s = Math.max(-1, Math.min(1, channelData1[i]));
            view.setInt16(offset + idx, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            idx += 2;
        }
    } else {
        let idx = 0;
        for (let i = 0; i < numFrames; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset + idx, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            idx += 2;
        }
    }

    return new Blob([view], { type: 'audio/wav' });
}

/**
 * Render a simple tone to a WAV Blob via OfflineAudioContext
 */
async function renderToneBlob({ frequency = 440, duration = 0.2, sampleRate = 44100, type = 'sine', gain = 0.12 }) {
    const length = Math.max(1, Math.floor(duration * sampleRate));
    const offline = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, length, sampleRate);
    const osc = offline.createOscillator();
    const g = offline.createGain();

    osc.type = type;
    osc.frequency.value = frequency;

    // Simple envelope
    const now = 0;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.02, duration * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, Math.max(duration - 0.01, 0.03));

    osc.connect(g).connect(offline.destination);
    osc.start(now);
    osc.stop(duration);
    const rendered = await offline.startRendering();
    return audioBufferToWavBlob(rendered);
}

/**
 * Sets up the sound enable/disable toggle that builds a shared HTMLAudioElement
 * and pre-renders tone files for reliable iOS playback.
 */
function setupSoundToggle() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;

    const setBtn = (enabled) => {
        btn.textContent = enabled ? 'Disable Sounds' : 'Enable Sounds (iOS)';
        const hint = document.getElementById('sound-toggle-hint');
        if (hint) hint.textContent = enabled ? 'Sounds enabled. Toggle to disable.' : 'Tap once to enable sounds on iPhone browsers. You can disable again anytime.';
    };
    setBtn(soundEnabled);

    btn.addEventListener('click', async () => {
        // Toggle off
        if (soundEnabled) {
            soundEnabled = false;
            try { if (htmlAudio) { htmlAudio.pause(); htmlAudio.src = ''; } } catch(_) {}
            if (SoundURLs.blink) { URL.revokeObjectURL(SoundURLs.blink); SoundURLs.blink = null; }
            if (SoundURLs.beep) { URL.revokeObjectURL(SoundURLs.beep); SoundURLs.beep = null; }
            setBtn(false);
            return;
        }

        // Toggle on: create the HTMLAudioElement synchronously in this user gesture
        htmlAudio = new Audio();
        htmlAudio.preload = 'auto';
        htmlAudio.crossOrigin = 'anonymous';

        // Pre-render tones
        try {
            const [blinkBlob, beepBlob] = await Promise.all([
                renderToneBlob({ frequency: 220, duration: 0.22, type: 'sine', gain: 0.12 }),
                renderToneBlob({ frequency: 880, duration: 0.12, type: 'square', gain: 0.10 }),
            ]);
            SoundURLs.blink = URL.createObjectURL(blinkBlob);
            SoundURLs.beep = URL.createObjectURL(beepBlob);
        } catch (e) {
            console.warn('Tone pre-render failed, falling back to WebAudio only.', e);
        }

        soundEnabled = true;
        setBtn(true);

        // Play a confirmation beep using the shared element if we have it
        try {
            if (SoundURLs.beep) {
                htmlAudio.src = SoundURLs.beep;
                const p = htmlAudio.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        } catch (_) { /* ignore */ }
    });
}

/**
 * Formats seconds into MM:SS string.
 */
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

/**
 * Plays a short harmonic chime using additive synthesis (fundamental + supporting partials).
 * Creates a natural harmonic with an overlay of supporting frequencies.
 */
function playHarmonicChime(options = {}) {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();

        const fundamental = Number(options.fundamental) || 440;
        const duration = Math.max(0.06, Number(options.duration) || 0.35);
        const attack = Math.max(0.003, Number(options.attack) || 0.008);
        const gain = Math.min(0.4, Math.max(0.02, Number(options.gain) || 0.12));
        const now = ctx.currentTime;

        // Master envelope
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, now);
        master.gain.exponentialRampToValueAtTime(gain, now + attack);
        master.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        // Gentle low-pass to keep it pleasant
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.min(8000, fundamental * 8), now);
        master.connect(lp).connect(ctx.destination);

        // Default partials: fundamental + harmonic series with a perfect fifth support
        const partials = (options.partials && options.partials.length ? options.partials : [
            { ratio: 1.0, gain: 1.00, type: 'sine', detune: 0 },
            { ratio: 2.0, gain: 0.35, type: 'sine', detune: -4 },
            { ratio: 3.0, gain: 0.22, type: 'sine', detune: 3 },
            { ratio: 1.5, gain: 0.18, type: 'sine', detune: 0 }, // perfect fifth support
            { ratio: 4.0, gain: 0.12, type: 'sine', detune: 0 },
        ]);

        // Build oscillators
        partials.forEach(p => {
            const osc = ctx.createOscillator();
            osc.type = p.type || 'sine';
            osc.frequency.setValueAtTime(fundamental * p.ratio, now);
            if (osc.detune && typeof p.detune === 'number') {
                osc.detune.setValueAtTime(p.detune, now);
            }
            const g = ctx.createGain();
            const partGain = Math.max(0.0001, gain * (p.gain || 0.1));
            // Let partials rise slightly after the master attack for bloom
            g.gain.setValueAtTime(0.0001, now);
            g.gain.exponentialRampToValueAtTime(partGain, now + Math.min(attack * 1.2, 0.03));
            g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            osc.connect(g).connect(master);
            osc.start(now);
            osc.stop(now + duration + 0.02);
        });

        // Cleanup
        setTimeout(() => { try { ctx.close(); } catch (e) {} }, (duration + 0.06) * 1000);
    } catch (error) {
        console.error('Failed to play harmonic chime:', error);
    }
}

/**
 * Acoustic blink (transition) using a pleasant harmonic chime.
 */
function playBlinkSound() {
    // Prefer HTMLAudioElement strategy if enabled and URL ready
    try {
        if (soundEnabled && htmlAudio && SoundURLs.blink) {
            htmlAudio.src = SoundURLs.blink;
            const p = htmlAudio.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            return;
        }
        // Fallback: Web Audio
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now); // Deep A3

        // Envelope: quick attack, short decay
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);

        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
    } catch(e) {
        console.error('Blink sound failed:', e);
    }
}

/**
 * Bright countdown beep (last 3 seconds) with harmonic support.
 */
function playCountdownBeep() {
    // Higher, bright short beep for last 3 seconds (prefer HTMLAudio when enabled)
    try {
        if (soundEnabled && htmlAudio && SoundURLs.beep) {
            htmlAudio.src = SoundURLs.beep;
            const p = htmlAudio.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
            return;
        }
        // Fallback: Web Audio
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(880, now); // A5 high note

        // Snappy envelope
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.10, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);

        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
    } catch(e) {
        console.error('Countdown beep failed:', e);
    }
}

/**
 * Expands exercises marked as two-sided and multi-set into individual steps.
 * Inserts a rest steps of duration `interSetRestDuration` between sets.
 * @param {Array} rawExercises - The list of exercises from the routine data.
 * @param {number} interSetRestDuration - The custom duration for rest between sets.
 * @returns {Array} The flattened list of all individual workout steps.
 */
function getExpandedExercises(rawExercises, interSetRestDuration) {
    const expanded = [];

    for (const ex of rawExercises) {
        const isRestStep = ex.name.toLowerCase().includes("rest") || ex.name.toLowerCase().includes("cool down");
        const sets = ex.sets || 1;

        if (isRestStep || (sets === 1 && !ex.isTwoSided)) {
            // Simple single step (Rest, Cool Down, or 1-set, 1-sided exercise)
            expanded.push(ex);
            continue;
        }

        // Handle multi-set or two-sided exercises
        for (let s = 1; s <= sets; s++) {
            const setSuffix = sets > 1 ? ` (Set ${s}/${sets})` : '';
            const baseName = ex.name;
            const breakNote = (sets > 1 && s < sets && interSetRestDuration > 0) ? ` (break: ${interSetRestDuration}s)` : '';

            if (ex.isTwoSided) {
                const sideDuration = Math.round(ex.duration / 2);

                // Left Side (no break note here; break comes after Right side)
                expanded.push({
                    name: `${baseName}${setSuffix} - Left`,
                    duration: sideDuration,
                    color: ex.color,
                });
                // Right Side (append break note if another set follows)
                expanded.push({
                    name: `${baseName}${setSuffix} - Right${breakNote}`,
                    duration: sideDuration,
                    color: ex.color,
                });
            } else {
                // Single-sided/standard exercise with multiple sets
                expanded.push({
                    name: `${baseName}${setSuffix}${breakNote}`,
                    duration: ex.duration,
                    color: ex.color,
                });
            }

            // Insert rest *only if* there are more sets coming up
            if (sets > 1 && s < sets) {
                expanded.push({
                    name: `Rest between sets`,
                    duration: interSetRestDuration, // Using the dynamic value
                    color: "bg-gray-300",
                    isInterSetRest: true // Flag for special styling
                });
            }
        }
    }
    return expanded;
}


/**
 * Initializes the UI list and state based on the current exercises array.
 */
function initializeWorkout() {
    // 1. Calculate Total Time based on the expanded list
    totalWorkoutDuration = exercises.reduce((sum, ex) => sum + ex.duration, 0);
    totalTimeDisplayEl.textContent = `Total Time: ${formatTime(totalWorkoutDuration)}`;

    // 2. Update Routine Title
    routineTitleEl.textContent = `Workout Plan (${workoutRoutines[currentRoutineKey].name})`;

    // 3. Render Exercise List (using the expanded list for accurate display)
    exerciseListEl.innerHTML = exercises.map((ex, index) => {
        // Determine styling based on step type
        const isInterSetRest = ex.isInterSetRest;
        const isSideSplit = ex.name.includes(' - Left') || ex.name.includes(' - Right');

        let nameClasses = 'font-medium text-gray-700';
        let listItemClasses = 'bg-gray-100 shadow-sm hover:shadow-md hover:bg-emerald-50 transform hover:scale-[1.01]';

        if (isInterSetRest) {
            nameClasses = 'text-gray-600 text-sm italic';
            listItemClasses = 'bg-gray-200 text-gray-600 shadow-sm';
        } else if (isSideSplit) {
            nameClasses = 'text-gray-700 text-base';
        }

        return `
            <li id="item-${index}" class="flex justify-between items-center p-4 rounded-xl transition-all duration-300 ${listItemClasses}">
                <span class="${nameClasses} transition-colors duration-300">${ex.name}</span>
                <span class="font-mono text-sm text-gray-500 transition-colors duration-300">${ex.reps ? `${ex.reps} reps` : formatTime(ex.duration)}</span>
            </li>
        `;
    }).join('');

    // 4. Set initial state
    currentExerciseIndex = 0;
    // Handle case where exercises list might be empty
    timeRemaining = exercises.length > 0 ? exercises[0].duration : 0;
    updateUI();
}

// --- Timer Logic ---

/**
 * Advances to the next exercise or finishes the workout.
 */
function nextExercise() {
    // Remove highlighting from the current item
    const prevItem = document.getElementById(`item-${currentExerciseIndex}`);
    if (prevItem) {
        // Reset classes for completed item
        prevItem.classList.remove('bg-active', 'text-white', 'scale-105', 'shadow-md', 'shadow-xl');
        prevItem.classList.add('opacity-50', 'bg-gray-100');
        // Ensure text color is reset
        prevItem.querySelectorAll('span').forEach(span => span.style.color = '');
    }

    currentExerciseIndex++;

    if (currentExerciseIndex < exercises.length) {
        // Move to the next exercise
        timeRemaining = exercises[currentExerciseIndex].duration;
        updateUI();
    } else {
        // Workout finished
        clearInterval(timerInterval);
        timerInterval = null;
        isRunning = false;
        finishWorkout();
    }
}

/**
 * Main timer loop, called every second.
 */
function timerTick() {
    if (!isRunning) return;

    timeRemaining--;

    // Play bright beeps at the last 3 seconds for exercise steps (not rests)
    const currentEx = exercises[currentExerciseIndex];
    const name = (currentEx?.name || '').toLowerCase();
    const isRestStep = name.includes('rest') || name.includes('cool down') || currentEx?.isInterSetRest;
    if (timeRemaining > 0 && timeRemaining <= 3 && !isRestStep) {
        playCountdownBeep();
    }

    if (timeRemaining <= 0) {
        playBlinkSound();
        nextExercise();
    } else {
        updateUI();
    }
}

/**
 * Updates all dynamic UI elements (timer, current exercise name, list highlighting).
 */
function updateUI() {
    const currentEx = exercises[currentExerciseIndex];

    // 1. Update Current Exercise and Timer
    timerDisplayEl.textContent = formatTime(timeRemaining);
    currentExerciseEl.textContent = currentEx.name.toUpperCase();

    // Change timer text color when running low
    const isRestOrCoolDown = currentEx.name.toLowerCase().includes("rest") || currentEx.name.toLowerCase().includes("cool down");

    if (timeRemaining <= 10 && !isRestOrCoolDown && isRunning) {
        timerDisplayEl.classList.add('text-red-500');
    } else if (isRestOrCoolDown) {
         // Set rest periods to look neutral/calm
        timerDisplayEl.classList.remove('text-red-500');
        timerDisplayEl.classList.add('text-gray-500');
    } else {
        // Default color during exercise
        timerDisplayEl.classList.remove('text-red-500', 'text-gray-500');
    }

    // 2. Update List Highlighting
    const item = document.getElementById(`item-${currentExerciseIndex}`);
    if (item) {
        exerciseListEl.querySelectorAll('li').forEach((li, index) => {
            // Mark completed exercises
            if (index < currentExerciseIndex) {
                li.classList.add('opacity-50');
                li.classList.remove('bg-active', 'text-white', 'scale-105', 'shadow-md', 'shadow-xl', 'bg-gray-100', 'bg-gray-200');
                // Ensure span colors are reset to default
                li.querySelectorAll('span').forEach(span => span.style.color = '');
            } else if (index === currentExerciseIndex) {
                // Highlight current exercise
                li.classList.remove('opacity-50', 'bg-gray-100', 'bg-gray-200');
                li.classList.add('bg-active', 'text-white', 'scale-[1.02]', 'shadow-xl');
                // Ensure spans inside highlighted item are white
                li.querySelectorAll('span').forEach(span => span.style.color = 'white');
            } else {
                // Upcoming exercises
                li.classList.remove('opacity-50', 'bg-active', 'text-white', 'scale-[1.02]', 'shadow-xl');
                // Reset to default look for upcoming items (handles inter-set rest background)
                li.classList.add(exercises[index].isInterSetRest ? 'bg-gray-200' : 'bg-gray-100');
                // Reset span colors for upcoming items
                li.querySelectorAll('span').forEach(span => span.style.color = '');
            }
        });
    }

    // 3. Update Button State
    const isInitialState = currentExerciseIndex === 0 && timeRemaining === exercises[0].duration;

    if (isRunning) {
        startButton.textContent = "Pause";
        startButton.classList.remove('bg-primary');
        startButton.classList.add('bg-gray-500');
        resetButton.disabled = false;
        routineSelector.disabled = true;
        interSetBreakInput.disabled = true; // Disable input while running
    } else {
        startButton.textContent = "Resume";
        if (isInitialState) {
            startButton.textContent = "Start Workout";
        }
        startButton.classList.add('bg-primary');
        startButton.classList.remove('bg-gray-500');
        resetButton.disabled = isInitialState;
        routineSelector.disabled = false;
        interSetBreakInput.disabled = false; // Enable input when paused or reset
    }
}

/**
 * Starts or pauses the workout.
 */
function toggleTimer() {
    if (isRunning) {
        // Pause
        clearInterval(timerInterval);
        timerInterval = null;
        isRunning = false;
    } else {
        // Start
        isRunning = true;
        timerInterval = setInterval(timerTick, 1000);
    }
    updateUI();
}

/**
 * Resets the entire workout to the starting state.
 */
function resetWorkout() {
    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;

    // Remove blink effect
    bodyEl.classList.remove('page-blink');
    bodyEl.style.backgroundColor = '';

    // Re-initialize state based on current routine key
    loadRoutine(currentRoutineKey, true);

    // Clear finish message
    currentExerciseEl.textContent = "GET READY";
    currentExerciseEl.classList.remove('text-active');
    timerDisplayEl.classList.remove('text-active');
    timerDisplayEl.classList.remove('text-red-500', 'text-gray-500');


    // Update button states
    startButton.textContent = "Start Workout";
    startButton.disabled = false;
    resetButton.disabled = true;
    routineSelector.disabled = false;
    interSetBreakInput.disabled = false; // Ensure input is enabled on reset

    console.log("Workout Reset.");
}

/**
 * Handles the visual and audio feedback when the full workout is complete.
 */
function finishWorkout() {
    currentExerciseEl.textContent = "WORKOUT COMPLETE!";
    currentExerciseEl.classList.add('text-active');
    timerDisplayEl.textContent = "00:00";
    timerDisplayEl.classList.remove('text-red-500', 'text-gray-500');
    timerDisplayEl.classList.add('text-active');

    // Blinking effect on the page body
    bodyEl.classList.add('page-blink');
    playBlinkSound(); // Play sound immediately

    startButton.disabled = true;
    resetButton.disabled = false;
    routineSelector.disabled = false; // Re-enable selector after finishing
    interSetBreakInput.disabled = false; // Re-enable input after finishing
    console.log("Workout Finished!");
}

/**
 * Loads a new workout routine based on the key selected in the dropdown.
 * @param {string} key - The key of the routine to load (e.g., 'hiit', 'mobility').
 * @param {boolean} isReset - If true, only reset without reloading the whole routine object.
 */
function loadRoutine(key, isReset = false) {
    if (isRunning && !isReset) return; // Prevent changing routine while timer is running

    currentRoutineKey = key;
    const rawExercises = workoutRoutines[currentRoutineKey].exercises;

    // NEW: Get custom break duration, defaulting to 3 if input is invalid
    const rawDuration = parseInt(interSetBreakInput.value);
    // Ensure duration is a positive number, min 1 second, default 3
    const breakDuration = Math.max(1, rawDuration || 3);
    
    // 1. Get the expanded list of steps, handling two-sided and multi-set exercises
    exercises = getExpandedExercises(rawExercises, breakDuration); // Pass duration

    // 2. Initialize the UI and state
    initializeWorkout();

    // Ensure timer is stopped and buttons are in initial state if not a reset
    if (!isReset) {
        clearInterval(timerInterval);
        timerInterval = null;
        isRunning = false;
    }
}

// --- Custom Workouts Integration ---
const CUSTOM_STORAGE_KEY = 'customWorkoutsV1';

function loadCustomWorkoutsFromStorage() {
    try {
        const raw = localStorage.getItem(CUSTOM_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch (e) {
        console.warn('Failed to load custom workouts:', e);
        return [];
    }
}

function ensureCustomWorkoutsInRoutinesAndSelector() {
    const customs = loadCustomWorkoutsFromStorage();
    const existingOptions = new Set(Array.from(routineSelector.options).map(o => o.value));

    customs.forEach(w => {
        const key = `custom:${w.id}`;
        // Add to in-memory routines map if not present
        if (!workoutRoutines[key]) {
            workoutRoutines[key] = {
                name: w.name || 'Custom Workout',
                exercises: (w.exercises || []).map(ex => ({
                    name: ex.name,
                    duration: Number(ex.duration) || 0,
                    color: 'bg-neutral',
                    ...(ex.sets ? { sets: Number(ex.sets) } : {})
                }))
            };
        }
        // Add option to selector if not present
        if (!existingOptions.has(key)) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = `${w.name}`;
            routineSelector.appendChild(opt);
            existingOptions.add(key);
        }
    });
}

// --- Event Listeners and Initialization ---

startButton.addEventListener('click', toggleTimer);
resetButton.addEventListener('click', resetWorkout);

// Listener for routine selection change
routineSelector.addEventListener('change', (event) => {
    // Remove blink effect on selection change
    bodyEl.classList.remove('page-blink');
    loadRoutine(event.target.value);
});

// NEW: Listener for inter-set break change
interSetBreakInput.addEventListener('change', () => {
    // Re-load the routine to update the exercise list, total time, and state with the new break duration
    loadRoutine(currentRoutineKey, true);
});

// Initialize the app when the window loads
window.onload = () => {
    // Prepare audio unlock for iOS (bind to first gesture and Start click)
    try { setupAudioUnlock(); } catch(e) { /* ignore */ }

    // Initialize iOS HTMLAudioElement toggle
    try { setupSoundToggle(); } catch (e) { console.warn('Sound toggle init failed', e); }

    // First, integrate any custom workouts created on the Manage Workouts page
    ensureCustomWorkoutsInRoutinesAndSelector();
    // Then set the initial routine based on the selector's default value
    loadRoutine(routineSelector.value);
};


// Helper: quickly enable iOS-safe HTMLAudioElement without extra UI (for test page)
function enableSoundsForIOSQuick() {
    try {
        if (soundEnabled && htmlAudio) return true;
        // Create the shared HTMLAudioElement synchronously within a user gesture
        htmlAudio = new Audio();
        htmlAudio.preload = 'auto';
        htmlAudio.crossOrigin = 'anonymous';
        soundEnabled = true;
        // Start pre-rendering tones in the background
        (async () => {
            try {
                if (!SoundURLs.blink || !SoundURLs.beep) {
                    const [blinkBlob, beepBlob] = await Promise.all([
                        renderToneBlob({ frequency: 220, duration: 0.22, type: 'sine', gain: 0.12 }),
                        renderToneBlob({ frequency: 880, duration: 0.12, type: 'square', gain: 0.10 }),
                    ]);
                    if (!SoundURLs.blink) SoundURLs.blink = URL.createObjectURL(blinkBlob);
                    if (!SoundURLs.beep) SoundURLs.beep = URL.createObjectURL(beepBlob);
                }
            } catch (e) {
                // Ignore; Web Audio fallback will still work
            }
        })();
        return true;
    } catch (e) {
        return false;
    }
}
// Expose to window for tests page
window.enableSoundsForIOSQuick = enableSoundsForIOSQuick;
