// --- Workout Data ---
// Always loaded from workouts.json (or localStorage cache). No hardcoded exercises here.
const workoutRoutines = {
    "morning": {
        name: "Morning Mobility Mantra"
        // schemaExercises will be populated from JSON at runtime
    }
};

// JSON-based default/custom workout storage key
const WORKOUT_JSON_STORAGE_KEY = 'workoutJSONv1';

/**
 * Load all workouts from workouts.json (or localStorage cache).
 * Expected shape: { workouts: Array<{ name, exercises, ... }> }
 */
async function loadAllWorkoutsJSON() {
    try {
        const res = await fetch('workouts.json', {cache: 'no-store'});
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data && Array.isArray(data.workouts)) {
            localStorage.setItem(WORKOUT_JSON_STORAGE_KEY, JSON.stringify(data));
            return data.workouts;
        }
    } catch (e) {
        console.warn('Fetching workouts.json failed, falling back to cached copy if available.', e);
    }
    try {
        const raw = localStorage.getItem(WORKOUT_JSON_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && Array.isArray(parsed.workouts)) {
                return parsed.workouts;
            }
        }
    } catch (e) {}
    return [];
}

/**
 * Build final expanded steps from schema-based exercises, supporting:
 * - exercise_name, duration (seconds), reps, sets, bilaterally
 * - super_set: list of exercises; optional sets on the superset container
 * Inter-set rests are inserted between sets (or superset rounds) using provided rest duration.
 */
function buildStepsFromSchema(items, interSetRestDuration) {
    const expanded = [];

    // Helper to push a step
    const pushStep = (name, duration, reps, opts = {}) => {
        const hasReps = Number(reps) > 0;
        const dur = Number(duration) || 0;
        const step = {
            name,
            // Allow duration 0 for reps-driven manual steps; keep >0 for timed steps
            duration: hasReps ? 0 : Math.max(1, dur),
            color: opts.color || 'bg-neutral'
        };
        if (hasReps) step.reps = Number(reps);
        if (opts.isInterSetRest) step.isInterSetRest = true;
        expanded.push(step);
    };

    const asArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);

    function processExercise(item, ctx) {
        const title = String(item.exercise_name || item.name || '').trim();
        if (!title) return;
        let hasDuration = Number.isFinite(Number(item.duration)) && Number(item.duration) > 0;
        const reps = Number.isFinite(Number(item.reps)) && Number(item.reps) > 0 ? Number(item.reps) : undefined;
        const sets = Math.max(1, Number(item.sets) || 1);
        const bilateral = !!item.bilaterally;

        // Enforce mutual exclusivity: if reps and duration are provided, prefer reps (manual progression)
        if (reps && hasDuration) {
            hasDuration = false; // ignore duration when reps exist
        }
        const baseDuration = hasDuration ? Math.round(Number(item.duration)) : 0;

        for (let s = 1; s <= sets; s++) {
            pushGongSound(); // Gong at start of each set
            const setSuffix = sets > 1 ? ` (Set ${s}/${sets})` : '';

            if (bilateral) {
                const sideDuration = hasDuration ? baseDuration : 0;
                // Left
                pushStep(`${title}${setSuffix} - Left`, sideDuration, reps);
                // Right
                pushStep(`${title}${setSuffix} - Right`, sideDuration, reps);
                // Insert break after bilateral pair, except after last set
                if (s < sets || (!ctx.inSuperset && s === sets)) {
                    if (interSetRestDuration > 0) {
                        pushStep('Rest after bilateral', interSetRestDuration, undefined, {
                            isInterSetRest: true,
                            color: 'bg-gray-300'
                        });
                    }
                }
            } else {
                const d = hasDuration ? baseDuration : 0; // reps-driven steps use 0s to disable timer
                pushStep(`${title}${setSuffix}`, d, reps);
            }

            // Add inter-set rest only for standalone exercises
            if (!ctx.inSuperset && s < sets && !bilateral) {
                pushStep('Rest between sets', interSetRestDuration, undefined, {
                    isInterSetRest: true,
                    color: 'bg-gray-300'
                });
            }
        }
    }

    function processItem(item) {
        if (!item) return;
        // Support both 'superset' and 'super_set' keys
        const supersetBlock = Array.isArray(item.superset) ? item.superset : (Array.isArray(item.super_set) ? item.super_set : null);
        if (supersetBlock) {
            const groupSets = Math.max(1, Number(item.sets) || 1);
            for (let gs = 1; gs <= groupSets; gs++) {
                pushGongSound(); // Gong at start of each superset round
                const roundStart = expanded.length;
                supersetBlock.forEach((child, idx) => {
                    processExercise(child, {inSuperset: true});
                    // Insert rest between superset exercises except after last
                    if (idx < supersetBlock.length - 1 && interSetRestDuration > 0) {
                        pushStep('Rest between superset exercises', interSetRestDuration, undefined, {
                            isInterSetRest: true,
                            color: 'bg-gray-300'
                        });
                    }
                });
                // After finishing a round, insert an inter-set rest (no annotation in names)
                if (gs < groupSets && interSetRestDuration > 0 && expanded.length > roundStart) {
                    pushStep('Rest between sets', interSetRestDuration, undefined, {
                        isInterSetRest: true,
                        color: 'bg-gray-300'
                    });
                }
            }
        } else {
            processExercise(item, {inSuperset: false});
        }
    }

    const topLevelItems = asArray(items);
    for (let i = 0; i < topLevelItems.length; i++) {
        const beforeLen = expanded.length;
        processItem(topLevelItems[i]);
        const produced = expanded.length - beforeLen;
        const hasNext = i < topLevelItems.length - 1;
        // After finishing each top-level item (exercise or superset), add a rest before the next item
        if (produced > 0 && hasNext && interSetRestDuration > 0) {
            const lastIdx = expanded.length - 1;

            // Insert actual rest between exercises
            pushStep('Rest between exercises', interSetRestDuration, undefined, {
                isInterSetRest: true,
                color: 'bg-gray-300'
            });
        }
    }
    return expanded;
}

// --- Global State Variables ---
let currentRoutineKey = "morning"; // Default routine
let exercises = []; // Will hold the expanded list of steps
let currentExerciseIndex = 0;
let timeRemaining = 0;
let timerInterval = null;
let isRunning = false;
let totalWorkoutDuration = 0;
let wakeLock = null; // Wake Lock API object

// --- DOM elements ---
const routineSelector = document.getElementById('routine-selector');
const routineTitleEl = document.getElementById('routine-title');
const currentExerciseEl = document.getElementById('current-exercise');
const timerDisplayEl = document.getElementById('timer-display');
const totalTimeDisplayEl = document.getElementById('total-time-display');
const startButton = document.getElementById('start-button');
const resetButton = document.getElementById('reset-button');
const nextRepsButton = document.getElementById('next-reps-button');
const exerciseListEl = document.getElementById('exercise-list');
const bodyEl = document.body;
const interSetBreakInput = document.getElementById('inter-set-break-input'); // NEW DOM element

// --- Audio (iOS-friendly) ---
/**
 * SoundManager encapsulates all sound generation, playback, and toggling logic.
 */
const SoundManager = (() => {
    let audioCtx = null;
    let audioUnlocked = false;
    let htmlAudio = null;
    let soundEnabled = false;
    const SoundURLs = { blink: null, beep: null };

    function ensureAudioContext() {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return null;
            if (!audioCtx) audioCtx = new AudioContext();
            if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
            return audioCtx;
        } catch (e) {
            console.warn('AudioContext unavailable:', e);
            return null;
        }
    }

    function unlockAudio() {
        try {
            const ctx = ensureAudioContext();
            if (ctx) {
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(0.00001, now);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.01);
                audioUnlocked = true;
            }
        } catch (e) {}
    }

    function setupAudioUnlock(startButton) {
        const unlock = () => {
            unlockAudio();
            window.removeEventListener('touchstart', unlock);
            window.removeEventListener('mousedown', unlock);
            window.removeEventListener('pointerdown', unlock);
            if (startButton) startButton.removeEventListener('click', unlock);
        };
        window.addEventListener('touchstart', unlock, { once: true });
        window.addEventListener('mousedown', unlock, { once: true });
        window.addEventListener('pointerdown', unlock, { once: true });
        if (startButton) startButton.addEventListener('click', unlock, { once: true });
    }

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
        writeString(view, offset, 'RIFF');
        offset += 4;
        view.setUint32(offset, 36 + dataSize, true);
        offset += 4;
        writeString(view, offset, 'WAVE');
        offset += 4;

        // fmt chunk
        writeString(view, offset, 'fmt ');
        offset += 4;
        view.setUint32(offset, 16, true);
        offset += 4; // SubChunk1Size
        view.setUint16(offset, format, true);
        offset += 2; // AudioFormat
        view.setUint16(offset, numOfChannels, true);
        offset += 2; // NumChannels
        view.setUint32(offset, sampleRate, true);
        offset += 4; // SampleRate
        view.setUint32(offset, byteRate, true);
        offset += 4; // ByteRate
        view.setUint16(offset, blockAlign, true);
        offset += 2; // BlockAlign
        view.setUint16(offset, bitDepth, true);
        offset += 2; // BitsPerSample

        // data chunk
        writeString(view, offset, 'data');
        offset += 4;
        view.setUint32(offset, dataSize, true);
        offset += 4;

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

        return new Blob([view], {type: 'audio/wav'});
    }

    /**
     * Render a simple tone to a WAV Blob via OfflineAudioContext
     */
    async function renderToneBlob({frequency = 440, duration = 0.2, sampleRate = 44100, type = 'sine', gain = 0.12}) {
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

    function setupSoundToggle(btnId = 'sound-toggle', hintId = 'sound-toggle-hint') {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const setBtn = (enabled) => {
            btn.textContent = enabled ? 'Disable Sounds' : 'Enable Sounds (iOS)';
            const hint = document.getElementById(hintId);
            if (hint) hint.textContent = enabled ? 'Sounds enabled. Toggle to disable.' : 'Tap once to enable sounds on iPhone browsers. You can disable again anytime.';
        };
        setBtn(soundEnabled);
        btn.addEventListener('click', async () => {
            // Toggle off
            if (soundEnabled) {
                soundEnabled = false;
                try {
                    if (htmlAudio) {
                        htmlAudio.pause();
                        htmlAudio.src = '';
                    }
                } catch (_) {
                }
                if (SoundURLs.blink) {
                    URL.revokeObjectURL(SoundURLs.blink);
                    SoundURLs.blink = null;
                }
                if (SoundURLs.beep) {
                    URL.revokeObjectURL(SoundURLs.beep);
                    SoundURLs.beep = null;
                }
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
                    renderToneBlob({frequency: 220, duration: 0.22, type: 'sine', gain: 0.12}),
                    renderToneBlob({frequency: 880, duration: 0.12, type: 'sine', gain: 0.10}),
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
                    if (p && typeof p.catch === 'function') p.catch(() => {
                    });
                }
            } catch (_) { /* ignore */
            }
        });
    }

    function playBlinkSound() {
        try {
            if (soundEnabled && htmlAudio && SoundURLs.blink) {
                htmlAudio.src = SoundURLs.blink;
                const p = htmlAudio.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
                return;
            }
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
        } catch (e) {
            console.error('Blink sound failed:', e);
        }
    }

    function playCountdownBeep() {
        try {
            if (soundEnabled && htmlAudio && SoundURLs.beep) {
                htmlAudio.src = SoundURLs.beep;
                const p = htmlAudio.play();
                if (p && typeof p.catch === 'function') p.catch(() => {});
                return;
            }
            const ctx = ensureAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now); // A5 high note

            // Snappy envelope
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.10, now + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);

            osc.connect(gain).connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.12);
        } catch (e) {
            console.error('Countdown beep failed:', e);
        }
    }

    function playGongSound() {
        try {
            const ctx = ensureAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, now); // 440Hz
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.13, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
            osc.connect(gain).connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.22);
        } catch (e) { console.error('Gong sound error:', e); }
    }

    return {
        setupAudioUnlock,
        setupSoundToggle,
        playBlinkSound,
        playCountdownBeep,
        playGongSound,
        get soundEnabled() { return soundEnabled; },
    };
})();

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
    writeString(view, offset, 'RIFF');
    offset += 4;
    view.setUint32(offset, 36 + dataSize, true);
    offset += 4;
    writeString(view, offset, 'WAVE');
    offset += 4;

    // fmt chunk
    writeString(view, offset, 'fmt ');
    offset += 4;
    view.setUint32(offset, 16, true);
    offset += 4; // SubChunk1Size
    view.setUint16(offset, format, true);
    offset += 2; // AudioFormat
    view.setUint16(offset, numOfChannels, true);
    offset += 2; // NumChannels
    view.setUint32(offset, sampleRate, true);
    offset += 4; // SampleRate
    view.setUint32(offset, byteRate, true);
    offset += 4; // ByteRate
    view.setUint16(offset, blockAlign, true);
    offset += 2; // BlockAlign
    view.setUint16(offset, bitDepth, true);
    offset += 2; // BitsPerSample

    // data chunk
    writeString(view, offset, 'data');
    offset += 4;
    view.setUint32(offset, dataSize, true);
    offset += 4;

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

    return new Blob([view], {type: 'audio/wav'});
}

/**
 * Render a simple tone to a WAV Blob via OfflineAudioContext
 */
async function renderToneBlob({frequency = 440, duration = 0.2, sampleRate = 44100, type = 'sine', gain = 0.12}) {
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
            try {
                if (htmlAudio) {
                    htmlAudio.pause();
                    htmlAudio.src = '';
                }
            } catch (_) {
            }
            if (SoundURLs.blink) {
                URL.revokeObjectURL(SoundURLs.blink);
                SoundURLs.blink = null;
            }
            if (SoundURLs.beep) {
                URL.revokeObjectURL(SoundURLs.beep);
                SoundURLs.beep = null;
            }
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
                renderToneBlob({frequency: 220, duration: 0.22, type: 'sine', gain: 0.12}),
                renderToneBlob({frequency: 880, duration: 0.12, type: 'sine', gain: 0.10}),
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
                if (p && typeof p.catch === 'function') p.catch(() => {
                });
            }
        } catch (_) { /* ignore */
        }
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
            {ratio: 1.0, gain: 1.00, type: 'sine', detune: 0},
            {ratio: 2.0, gain: 0.35, type: 'sine', detune: -4},
            {ratio: 3.0, gain: 0.22, type: 'sine', detune: 3},
            {ratio: 1.5, gain: 0.18, type: 'sine', detune: 0}, // perfect fifth support
            {ratio: 4.0, gain: 0.12, type: 'sine', detune: 0},
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
        setTimeout(() => {
            try {
                ctx.close();
            } catch (e) {
            }
        }, (duration + 0.06) * 1000);
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
            if (p && typeof p.catch === 'function') p.catch(() => {
            });
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
    } catch (e) {
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
            if (p && typeof p.catch === 'function') p.catch(() => {
            });
            return;
        }
        // Fallback: Web Audio
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now); // A5 high note

        // Snappy envelope
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.10, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);

        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
    } catch (e) {
        console.error('Countdown beep failed:', e);
    }
}

// --- Gong Synth ---
function playGongSound() {
    try {
        const ctx = ensureAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now); // 440Hz
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.13, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.22);
    } catch (e) { console.error('Gong sound error:', e); }
}

// Render all exercises in the expanded list
function renderExerciseList() {
    exerciseListEl.innerHTML = exercises.map((ex, index) => {
        // Show name and reps if present
        let label = ex.name;
        if (ex.reps) label += ` x${ex.reps}`;
        return `<li>${label}</li>`;
    }).join('');
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
        // Do NOT release wake lock here
    } else {
        // Start
        // Ensure iOS-safe audio is initialized synchronously within this user gesture
        try {
            if (typeof enableSoundsForIOSQuick === 'function') enableSoundsForIOSQuick();
        } catch (_) {}
        const currentEx = exercises[currentExerciseIndex];
        const isRepsStep = currentEx && Number(currentEx.reps) > 0 && !currentEx.isInterSetRest;
        if (isRepsStep) {
            // Do not start timer on reps-driven steps; user must press Next
            clearInterval(timerInterval);
            timerInterval = null;
            isRunning = false;
            updateUI();
            // Do NOT release wake lock here
        } else {
            isRunning = true;
            requestWakeLock(); // Request wake lock when timer starts
            timerInterval = setInterval(timerTick, 1000);
        }
    }
    updateUI();
}

/**
 * Requests a wake lock to prevent the device from sleeping.
 */
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
            });
        } catch (err) {
            console.warn('Wake Lock request failed:', err);
        }
    }
}

/**
 * Releases the wake lock if active.
 */
function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
}

/**
 * Resets the entire workout to the starting state.
 */
function resetWorkout() {
    clearInterval(timerInterval);
    timerInterval = null;
    isRunning = false;
    releaseWakeLock(); // Release wake lock on reset

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
    releaseWakeLock(); // Release wake lock ONLY on workout completion
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
    const routine = workoutRoutines[currentRoutineKey] || {};

    // Debug: Log loaded routine and exercises
    console.log('Selected routine:', routine);
    console.log('Schema exercises:', routine.schemaExercises);

    // NEW: Get custom break duration, defaulting to 3 if input is invalid
    const rawDuration = parseInt(interSetBreakInput.value);
    // Ensure duration is a positive number, min 1 second, default 3
    const breakDuration = Math.max(1, rawDuration || 3);

    // Build final steps strictly from JSON-backed schema
    if (Array.isArray(routine.schemaExercises)) {
        exercises = buildStepsFromSchema(routine.schemaExercises, breakDuration);
        console.log('Expanded exercises:', exercises);
    } else {
        // No schema available: empty plan (no hardcoded fallback)
        exercises = [];
        console.log('No exercises found for routine');
    }

    // Initialize the UI and state
    initializeWorkout();

    // Ensure timer is stopped and buttons are in initial state if not a reset
    if (!isReset) {
        clearInterval(timerInterval);
        timerInterval = null;
        isRunning = false;
    }

    // After initializing workout, always reset UI state
    startButton.disabled = false;
    startButton.textContent = "Start Workout";
    resetButton.disabled = false;
    if (nextRepsButton) nextRepsButton.classList.add('hidden');
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
                    ...(ex.sets ? {sets: Number(ex.sets)} : {})
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

function onNextRepsClick() {
    // User confirms completion of reps, move to next step
    try {
        playBlinkSound();
    } catch (_) {
    }
    nextExercise();
    const cur = exercises[currentExerciseIndex];
    // If the next step is timed, resume timer automatically
    const isTimed = cur && (!cur.reps || cur.isInterSetRest) && Number(cur.duration) > 0;
    if (isTimed) {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        isRunning = true;
        timerInterval = setInterval(timerTick, 1000);
    } else {
        // Ensure not running for another reps step
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        isRunning = false;
    }
    updateUI();
}

startButton.addEventListener('click', toggleTimer);
resetButton.addEventListener('click', resetWorkout);
if (nextRepsButton) nextRepsButton.addEventListener('click', onNextRepsClick);

// Listener for routine selection change
routineSelector.addEventListener('change', (event) => {
    // Remove blink effect on selection change
    bodyEl.classList.remove('page-blink');
    loadRoutine(event.target.value);
    // Force UI to initial state: Start enabled, Reset enabled, Next hidden
    startButton.disabled = false;
    startButton.textContent = "Start Workout";
    resetButton.disabled = false;
    if (nextRepsButton) nextRepsButton.classList.add('hidden');
});

// NEW: Listener for inter-set break change
interSetBreakInput.addEventListener('change', () => {
    // Re-load the routine to update the exercise list, total time, and state with the new break duration
    loadRoutine(currentRoutineKey, true);
});

// Ensure wakelock is re-acquired if needed when returning to the app

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
        if (isRunning && wakeLock == null) {
            await requestWakeLock();
        }
    }
});

// Initialize the app when the window loads
window.onload = async () => {
    // Prepare audio unlock for iOS (bind to first gesture and Start click)
    try {
        setupAudioUnlock();
    } catch (e) { /* ignore */ }

    // Initialize iOS HTMLAudioElement toggle
    try {
        setupSoundToggle();
    } catch (e) {
        console.warn('Sound toggle init failed', e);
    }

    // Load all workouts from workouts.json
    let allWorkouts = await loadAllWorkoutsJSON();
    if (Array.isArray(allWorkouts) && allWorkouts.length > 0) {
        // Populate selector and routines
        routineSelector.innerHTML = '';
        allWorkouts.forEach((w, i) => {
            const key = 'json_' + i;
            workoutRoutines[key] = {
                name: w.name,
                schemaExercises: w.exercises
            };
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = w.name;
            routineSelector.appendChild(opt);
        });
        // Select first workout by default
        routineSelector.value = 'json_0';
        currentRoutineKey = 'json_0';
        loadRoutine('json_0');
    } else {
        // Fallback: no workouts found
        routineSelector.innerHTML = '<option value="">No workouts found</option>';
        exercises = [];
        initializeWorkout();
    }

    // Integrate any legacy custom workouts (kept for backward compatibility)
    ensureCustomWorkoutsInRoutinesAndSelector();
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
                        renderToneBlob({frequency: 220, duration: 0.22, type: 'sine', gain: 0.12}),
                        renderToneBlob({frequency: 880, duration: 0.12, type: 'sine', gain: 0.10}),
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

// Replace HTMLAudioElement playback with Web Audio API for beep and blink
function playBeep() {
    if (!soundEnabled) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.10;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
    };
}

function playBlink() {
    if (!soundEnabled) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 220;
    gain.gain.value = 0.12;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
    osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
    };
}

