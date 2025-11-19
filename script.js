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
            duration: Math.max(1, dur), // Always use the actual duration
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
        // Estimate duration if missing and reps exist
        let baseDuration = 0;
        if (hasDuration) {
            baseDuration = Math.round(Number(item.duration));
        } else if (reps) {
            baseDuration = reps * 3; // 3 seconds per rep
        }

        for (let s = 1; s <= sets; s++) {
            const setSuffix = sets > 1 ? ` (Set ${s}/${sets})` : '';

            if (bilateral) {
                const sideDuration = baseDuration;
                // Left
                pushStep(`${title}${setSuffix} - Left`, sideDuration, reps);
                pushStep('Rest between bilateral', interSetRestDuration, undefined, {
                            isInterSetRest: true,
                            color: 'bg-gray-300'
                        })
                // Right
                pushStep(`${title}${setSuffix} - Right`, sideDuration, reps);

            } else {
                pushStep(`${title}${setSuffix}`, baseDuration, reps);
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
                // Removed build-time gong playback here too.
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
let isPaused = false; // True when user paused mid-workout
let totalWorkoutDuration = 0;
let wakeLock = null; // Wake Lock API object
const workoutElapsedTimeEl = document.getElementById('workout-elapsed-time');
let workoutElapsedTime = 0;
let workoutElapsedInterval = null;
let workoutElapsedStartMs = null;
let heartbeatInterval = null;
let workoutRemainingSeconds = 0;

// --- DOM elements ---
const routineSelector = document.getElementById('routine-selector');
const routineTitleEl = document.getElementById('routine-title');
const currentExerciseEl = document.getElementById('current-exercise');
const timerDisplayEl = document.getElementById('timer-display');
const totalTimeDisplayEl = document.getElementById('total-time-display');
const workoutRemainingTimeEl = document.getElementById('workout-remaining-time'); // New element for workout countdown
const startButton = document.getElementById('start-button');
const resetButton = document.getElementById('reset-button');
const nextRepsButton = document.getElementById('next-reps-button');
const exerciseListEl = document.getElementById('exercise-list');
const bodyEl = document.body;
const interSetBreakInput = document.getElementById('inter-set-break-input'); // NEW DOM element

// --- Helper to access audio functions safely ---
function playBlinkSound() { if (window.SoundManager) window.SoundManager.playBlinkSound(); }
function playCountdownBeep() { if (window.SoundManager) window.SoundManager.playCountdownBeep(); }
function playGongSound() { if (window.SoundManager) window.SoundManager.playGongSound(); }
function setupSoundToggle() { if (window.SoundManager) window.SoundManager.setupSoundToggle(); }
function setupAudioUnlock(btn) { if (window.SoundManager) window.SoundManager.setupAudioUnlock(btn); }
function enableSoundsForIOSQuick() { return window.SoundManager ? window.SoundManager.enableSoundsForIOSQuick() : false; }
function ensureAudioContext() { return window.SoundManager ? window.SoundManager.ensureAudioContext() : null; }

// --- Wake Lock Helpers ---
function requestWakeLock() {
    // Ensure we always hold a wake lock at important moments (exercise start or pause)
    if (wakeLock) return Promise.resolve(wakeLock);
    if ('wakeLock' in navigator) {
        return navigator.wakeLock.request('screen').then(lock => {
            wakeLock = lock;
            lock.addEventListener('release', () => { wakeLock = null; });
            return lock;
        }).catch(e => { console.warn('WakeLock request failed', e); return null; });
    }
    return Promise.resolve(null);
}
function releaseWakeLock() { if (wakeLock) { try { wakeLock.release(); } catch(_){} wakeLock = null; } }

// --- Reset & Finish ---
function resetWorkout() {
    clearInterval(timerInterval); timerInterval = null; isRunning = false; isPaused = false; releaseWakeLock();
    stopWorkoutElapsedTimer();
    stopHeartbeat();
    bodyEl.classList.remove('page-blink'); bodyEl.style.backgroundColor='';
    loadRoutine(currentRoutineKey, true);
    currentExerciseEl.textContent = 'GET READY'; currentExerciseEl.classList.remove('text-active');
    timerDisplayEl.classList.remove('text-active','text-red-500','text-gray-500');
    startButton.textContent = 'Start Workout'; startButton.disabled = false; resetButton.disabled = true;
    routineSelector.disabled = false; interSetBreakInput.disabled = false;
}
function finishWorkout() {
    currentExerciseEl.textContent = 'WORKOUT COMPLETE!'; currentExerciseEl.classList.add('text-active');
    timerDisplayEl.textContent = '00:00'; timerDisplayEl.classList.remove('text-red-500','text-gray-500'); timerDisplayEl.classList.add('text-active');
    bodyEl.classList.add('page-blink');
    try { playCountdownBeep(); } catch(e) { console.error(e); }
    startButton.disabled = true; resetButton.disabled = false; routineSelector.disabled = false; interSetBreakInput.disabled = false;
    isPaused = false;
    stopWorkoutElapsedTimer();
    workoutRemainingSeconds = 0;
    stopHeartbeat();
    releaseWakeLock(); console.log('Workout Finished!');
}

// --- Routine Loader ---
function loadRoutine(key, isReset = false) {
    if (isRunning && !isReset) return; // prevent changing while running
    stopHeartbeat();
    currentRoutineKey = key;
    const routine = workoutRoutines[currentRoutineKey] || {};
    const rawBreak = parseInt(interSetBreakInput?.value || '3', 10);
    const breakDuration = Math.max(1, rawBreak || 3);
    if (Array.isArray(routine.schemaExercises)) {
        exercises = buildStepsFromSchema(routine.schemaExercises, breakDuration);
    } else {
        exercises = [];
    }
    currentExerciseIndex = 0;
    timeRemaining = exercises.length ? exercises[0].duration : 0;
    initializeWorkout();
    if (!isReset) { clearInterval(timerInterval); timerInterval = null; isRunning = false; }
    startButton.disabled = false;
    startButton.textContent = 'Start Workout';
    resetButton.disabled = false;
    if (nextRepsButton) nextRepsButton.classList.add('hidden');
}

// --- Helper ---
function getWorkoutRemainingTime() {
    if (!exercises.length || currentExerciseIndex >= exercises.length) return 0;
    let sum = timeRemaining;
    for (let i = currentExerciseIndex + 1; i < exercises.length; i++) {
        sum += exercises[i].duration;
    }
    return sum;
}

// --- Formatting Helper ---
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// Elapsed seconds helper (authoritative, second-precision)
function getElapsedSeconds() {
    const base = Math.max(0, Math.floor(workoutElapsedTime));
    const delta = workoutElapsedStartMs != null ? Math.max(0, Math.floor((Date.now() - workoutElapsedStartMs) / 1000)) : 0;
    return base + delta;
}

// --- Elapsed Workout Timer (overall runtime) ---
function resetWorkoutElapsedTimer() {
    // Clear any running interval (legacy)
    if (workoutElapsedInterval) {
        clearInterval(workoutElapsedInterval);
        workoutElapsedInterval = null;
    }
    workoutElapsedStartMs = null;
    workoutElapsedTime = 0;
    if (workoutElapsedTimeEl) workoutElapsedTimeEl.textContent = formatTime(0);
}

function startWorkoutElapsedTimer() {
    // Start a new measurement window if not already started
    if (workoutElapsedStartMs == null) {
        workoutElapsedStartMs = Date.now();
    }
}

function stopWorkoutElapsedTimer() {
    // Add the current span to the accumulated time
    if (workoutElapsedStartMs != null) {
        const delta = Math.max(0, Math.floor((Date.now() - workoutElapsedStartMs) / 1000));
        workoutElapsedTime += delta;
    }
    workoutElapsedStartMs = null;
    // No interval to clear; heartbeat drives UI updates
    if (workoutElapsedTimeEl) workoutElapsedTimeEl.textContent = formatTime(Math.floor(workoutElapsedTime));
}

// --- Visibility / Expansion Helpers ---
function getNextBreakIndex(startIdx, list) { for (let i = startIdx + 1; i < list.length; i++) if (list[i].isInterSetRest) return i; return -1; }
function getVisibleExercises(currentIdx, list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
        const step = list[i];
        if (!step.isInterSetRest) {
            out.push({ ...step, originalIndex: i });
            if (i === currentIdx && !list[currentIdx].isInterSetRest) {
                const nb = getNextBreakIndex(currentIdx, list);
                if (nb !== -1 && nb > currentIdx) out.push({ ...list[nb], originalIndex: nb });
            }
        } else if (i === currentIdx) {
            out.push({ ...step, originalIndex: i });
        }
    }
    return out;
}

// --- UI Initialization ---
function initializeWorkout() {
    totalWorkoutDuration = exercises.reduce((sum, ex) => sum + ex.duration, 0);
    workoutRemainingSeconds = totalWorkoutDuration;
    if (totalTimeDisplayEl) totalTimeDisplayEl.textContent = formatTime(totalWorkoutDuration);
    if (workoutRemainingTimeEl) workoutRemainingTimeEl.textContent = formatTime(totalWorkoutDuration);
    const routineName = (workoutRoutines[currentRoutineKey] && workoutRoutines[currentRoutineKey].name) || 'Workout';
    routineTitleEl.textContent = `Workout Plan (${routineName})`;
    const visible = getVisibleExercises(0, exercises); // Always start from index 0
    exerciseListEl.innerHTML = visible.map(ex => {
        const isRest = ex.isInterSetRest;
        const isSide = ex.name.includes(' - Left') || ex.name.includes(' - Right');
        let nameClasses = 'font-medium text-gray-700';
        let liClasses = 'bg-gray-100 shadow-sm hover:shadow-md hover:bg-emerald-50 transform hover:scale-[1.01]';
        if (isRest) { nameClasses = 'text-gray-600 text-sm italic'; liClasses = 'bg-gray-200 text-gray-600 shadow-sm'; }
        else if (isSide) { nameClasses = 'text-gray-700 text-base'; }
        return `<li id="item-${ex.originalIndex}" class="flex justify-between items-center p-4 rounded-xl transition-all duration-300 ${liClasses}">
            <span class="${nameClasses}">${ex.name}</span>
            <span class="font-mono text-sm text-gray-500">
        </li>`;
    }).join('');
    currentExerciseIndex = 0; while (currentExerciseIndex < exercises.length && exercises[currentExerciseIndex].isInterSetRest) currentExerciseIndex++;
    timeRemaining = exercises.length ? exercises[currentExerciseIndex].duration || 0 : 0;
    resetWorkoutElapsedTimer();
    updateUI();
}

// --- Update UI ---
function updateUI() {
    if (!exercises.length) {
        timerDisplayEl.textContent = formatTime(0);
        currentExerciseEl.textContent = 'NO WORKOUT LOADED';
        exerciseListEl.innerHTML='';
        startButton.textContent = 'Start Workout';
        startButton.disabled = true; resetButton.disabled = true;
        if (nextRepsButton) nextRepsButton.classList.add('hidden');
        routineSelector.disabled = false; interSetBreakInput.disabled = false;
        return;
    }
    const visible = getVisibleExercises(currentExerciseIndex, exercises);
    exerciseListEl.innerHTML = visible.map(ex => {
        const isRest = ex.isInterSetRest;
        const isSide = ex.name.includes(' - Left') || ex.name.includes(' - Right');
        let nameClasses = 'font-medium text-gray-700';
        let liClasses = 'bg-gray-100 shadow-sm hover:shadow-md hover:bg-emerald-50 transform hover:scale-[1.01]';
        if (isRest) { nameClasses='text-gray-600 text-sm italic'; liClasses='bg-gray-200 text-gray-600 shadow-sm'; }
        else if (isSide) { nameClasses='text-gray-700 text-base'; }
        return `<li id="item-${ex.originalIndex}" class="flex justify-between items-center p-4 rounded-xl transition-all duration-300 ${liClasses}">
            <span class="${nameClasses}">${ex.name}</span>
            <span class="font-mono text-sm text-gray-500">${ex.reps ? `${ex.reps} reps` : formatTime(ex.duration)}</span>
        </li>`;
    }).join('');
    const cur = exercises[currentExerciseIndex];
    const isReps = cur && Number(cur.reps) > 0 && !cur.isInterSetRest;
    timerDisplayEl.textContent = isReps ? '--:--' : formatTime(timeRemaining);
    if (workoutRemainingTimeEl) workoutRemainingTimeEl.textContent = formatTime(Math.max(0, workoutRemainingSeconds));
    currentExerciseEl.textContent = cur.name.toUpperCase();
    const isRest = cur.name.toLowerCase().includes('rest') || cur.name.toLowerCase().includes('cool down');
    if (!isReps && timeRemaining <= 10 && !isRest && isRunning) { timerDisplayEl.classList.add('text-red-500'); timerDisplayEl.classList.remove('text-gray-500'); }
    else if (isRest) { timerDisplayEl.classList.remove('text-red-500'); timerDisplayEl.classList.add('text-gray-500'); }
    else { timerDisplayEl.classList.remove('text-red-500','text-gray-500'); }
    exerciseListEl.querySelectorAll('li').forEach(li => {
        const idx = Number(li.id.replace('item-',''));
        if (idx < currentExerciseIndex) {
            li.classList.add('opacity-50'); li.classList.remove('bg-active','text-white','scale-[1.02]','shadow-xl');
            li.querySelectorAll('span').forEach(s => s.style.color='');
        } else if (idx === currentExerciseIndex) {
            li.classList.remove('opacity-50'); li.classList.add('bg-active','text-white','scale-[1.02]','shadow-xl');
            li.querySelectorAll('span').forEach(s => s.style.color='white');
        } else {
            li.classList.remove('opacity-50','bg-active','text-white','scale-[1.02]','shadow-xl');
            li.querySelectorAll('span').forEach(s => s.style.color='');
        }
    });
    const initial = exercises.length && currentExerciseIndex === 0 && timeRemaining === exercises[0].duration;
    if (isReps) {
        if (nextRepsButton) nextRepsButton.classList.remove('hidden');
        // Allow starting the overall elapsed timer even during reps-based steps
        startButton.disabled = false; startButton.textContent = initial ? 'Start Workout' : 'Resume';
        resetButton.disabled = false; routineSelector.disabled = false; interSetBreakInput.disabled = false;
    } else if (isRunning) {
        if (nextRepsButton) nextRepsButton.classList.add('hidden');
        startButton.textContent = 'Pause'; startButton.disabled = false; resetButton.disabled = false;
        routineSelector.disabled = true; interSetBreakInput.disabled = true;
    } else {
        if (nextRepsButton) nextRepsButton.classList.add('hidden');
        startButton.textContent = initial ? 'Start Workout' : 'Resume'; startButton.disabled = false;
        resetButton.disabled = initial; routineSelector.disabled = false; interSetBreakInput.disabled = false;
    }
    if (workoutElapsedTimeEl) workoutElapsedTimeEl.textContent = formatTime(getElapsedSeconds());
}

// --- Exercise Progression ---
function nextExercise() {
    const prev = document.getElementById(`item-${currentExerciseIndex}`);
    if (prev) {
        prev.classList.remove('bg-active','text-white','scale-[1.02]','shadow-xl');
        prev.classList.add('opacity-50');
        prev.querySelectorAll('span').forEach(s => s.style.color='');
    }
    currentExerciseIndex++;
    if (currentExerciseIndex < exercises.length) {
        const cur = exercises[currentExerciseIndex];
        timeRemaining = cur.duration;
        const isReps = cur && Number(cur.reps) > 0 && !cur.isInterSetRest;
        // Acquire wake lock at the start of each exercise (including rests and reps-based)
        try { requestWakeLock(); } catch(_) {}
        try {
            if (cur && !cur.isInterSetRest) {
                const lname = (cur.name||'').toLowerCase();
                if (!lname.includes('rest') && !lname.includes('cool down')) playGongSound();
            }
        } catch(e){ console.warn('Gong error nextExercise', e); }
        if (isReps) { isRunning = false; }
        updateUI();
    } else {
        isRunning = false; finishWorkout();
    }
}

function heartbeatTick() {
    if (!exercises.length) { updateUI(); return; }
    const cur = exercises[currentExerciseIndex];
    const isReps = cur && Number(cur.reps) > 0 && !cur.isInterSetRest;

    // Decrement overall remaining when elapsed is running
    if (workoutElapsedStartMs != null && workoutRemainingSeconds > 0) {
        workoutRemainingSeconds--;
    }

    // Decrement current exercise countdown only for timed steps while running
    if (!isReps && isRunning) {
        timeRemaining--;
        const lname = (cur?.name||'').toLowerCase();
        const isRest = lname.includes('rest') || lname.includes('cool down') || cur?.isInterSetRest;
        if (timeRemaining > 0 && timeRemaining <= 3 && !isRest) { try { playBlinkSound(); } catch(e){ console.error(e); } }
        if (timeRemaining <= 0) { nextExercise(); updateUI(); return; }
    }
    // Sync UI once per tick so all timers update together
    updateUI();
}

function startHeartbeat() { if (heartbeatInterval) return; heartbeatInterval = setInterval(heartbeatTick, 1000); }
function stopHeartbeat() { if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; } }

function toggleTimer() {
    if (isRunning) {
        // Pause: keep screen awake so the plan remains visible while paused
        clearInterval(timerInterval); timerInterval = null; isRunning = false; isPaused = true; updateUI();
        try { requestWakeLock(); } catch(_){}
        stopWorkoutElapsedTimer();
        stopHeartbeat();
        return;
    }
    // Start/Resume
    try { ensureAudioContext(); } catch(_){}
    try { if (typeof enableSoundsForIOSQuick === 'function') enableSoundsForIOSQuick(); } catch(_){}
    const cur = exercises[currentExerciseIndex];
    const isReps = cur && Number(cur.reps) > 0 && !cur.isInterSetRest;
    if (isReps) {
        // If user presses Start on a reps-based step, start the overall elapsed timer but stay on the reps step.
        // User should use the "Next (Complete Reps)" button to advance when done.
        startWorkoutElapsedTimer();
        try { requestWakeLock(); } catch(_) {}
        isPaused = false;
        startHeartbeat();
        updateUI();
        return;
    }
    isRunning = true; isPaused = false; requestWakeLock();
    startWorkoutElapsedTimer();
    try {
        if (cur && !cur.isInterSetRest) {
            const lname = (cur.name||'').toLowerCase();
            if (!lname.includes('rest') && !lname.includes('cool down')) playGongSound();
        }
    } catch(e){ console.warn('Gong start error', e); }
    startHeartbeat();
    updateUI();
}

function onNextRepsClick() {
    try { playBlinkSound(); } catch(_){}
    nextExercise();
    const cur = exercises[currentExerciseIndex];
    const timed = cur && (!cur.reps || cur.isInterSetRest) && Number(cur.duration) > 0;
    if (timed) { isRunning = true; }
    else { isRunning = false; }
    startHeartbeat();
    updateUI();
}

// --- Event Listeners ---
startButton.addEventListener('click', toggleTimer);
resetButton.addEventListener('click', resetWorkout);
if (nextRepsButton) nextRepsButton.addEventListener('click', onNextRepsClick);
routineSelector.addEventListener('change', e => { bodyEl.classList.remove('page-blink'); loadRoutine(e.target.value); startButton.disabled=false; startButton.textContent='Start Workout'; resetButton.disabled=false; if (nextRepsButton) nextRepsButton.classList.add('hidden'); });
interSetBreakInput.addEventListener('change', () => { loadRoutine(currentRoutineKey, true); });
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && (isRunning || isPaused) && !wakeLock) {
        try { await requestWakeLock(); } catch(_){}
    }
});

// --- Initialization ---
window.onload = async () => {
    try { setupAudioUnlock(startButton); } catch(_){}
    try { setupSoundToggle(); } catch(e){ console.warn('Sound toggle init failed', e); }
    const allWorkouts = await loadAllWorkoutsJSON();
    if (Array.isArray(allWorkouts) && allWorkouts.length) {
        routineSelector.innerHTML='';
        allWorkouts.forEach((w,i)=>{ const key='json_'+i; workoutRoutines[key]={ name:w.name, schemaExercises:w.exercises }; const opt=document.createElement('option'); opt.value=key; opt.textContent=w.name; routineSelector.appendChild(opt); });
        routineSelector.value='json_0'; currentRoutineKey='json_0'; loadRoutine('json_0');
    } else {
        routineSelector.innerHTML='<option value="">No workouts found</option>';
        exercises=[]; initializeWorkout();
    }
};
