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
            // Removed build-time gong playback; will play at runtime when exercise actually starts.
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
    if ('wakeLock' in navigator) {
        return navigator.wakeLock.request('screen').then(lock => {
            wakeLock = lock;
            lock.addEventListener('release', () => { wakeLock = null; });
        }).catch(e => console.warn('WakeLock request failed', e));
    }
}
function releaseWakeLock() { if (wakeLock) { try { wakeLock.release(); } catch(_){} wakeLock = null; } }

// --- Reset & Finish ---
function resetWorkout() {
    clearInterval(timerInterval); timerInterval = null; isRunning = false; releaseWakeLock();
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
    releaseWakeLock(); console.log('Workout Finished!');
}

// --- Routine Loader ---
function loadRoutine(key, isReset = false) {
    if (isRunning && !isReset) return; // prevent changing while running
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

// --- Formatting Helper ---
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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
    totalTimeDisplayEl.textContent = `Total Time: ${formatTime(totalWorkoutDuration)}`;
    const routineName = (workoutRoutines[currentRoutineKey] && workoutRoutines[currentRoutineKey].name) || 'Workout';
    routineTitleEl.textContent = `Workout Plan (${routineName})`;
    const visible = getVisibleExercises(currentExerciseIndex, exercises);
    exerciseListEl.innerHTML = visible.map(ex => {
        const isRest = ex.isInterSetRest;
        const isSide = ex.name.includes(' - Left') || ex.name.includes(' - Right');
        let nameClasses = 'font-medium text-gray-700';
        let liClasses = 'bg-gray-100 shadow-sm hover:shadow-md hover:bg-emerald-50 transform hover:scale-[1.01]';
        if (isRest) { nameClasses = 'text-gray-600 text-sm italic'; liClasses = 'bg-gray-200 text-gray-600 shadow-sm'; }
        else if (isSide) { nameClasses = 'text-gray-700 text-base'; }
        return `<li id="item-${ex.originalIndex}" class="flex justify-between items-center p-4 rounded-xl transition-all duration-300 ${liClasses}">
            <span class="${nameClasses}">${ex.name}</span>
            <span class="font-mono text-sm text-gray-500">${ex.reps ? `${ex.reps} reps` : formatTime(ex.duration)}</span>
        </li>`;
    }).join('');
    currentExerciseIndex = 0; while (currentExerciseIndex < exercises.length && exercises[currentExerciseIndex].isInterSetRest) currentExerciseIndex++;
    timeRemaining = exercises.length ? exercises[currentExerciseIndex].duration || 0 : 0;
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
        startButton.disabled = true; startButton.textContent = initial ? 'Start Workout' : 'Resume';
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
        try {
            if (cur && !cur.isInterSetRest) {
                const lname = (cur.name||'').toLowerCase();
                if (!lname.includes('rest') && !lname.includes('cool down')) playGongSound();
            }
        } catch(e){ console.warn('Gong error nextExercise', e); }
        if (isReps) { clearInterval(timerInterval); timerInterval = null; isRunning = false; }
        updateUI();
    } else {
        clearInterval(timerInterval); timerInterval = null; isRunning = false; finishWorkout();
    }
}

function timerTick() {
    if (!isRunning) return;
    const cur = exercises[currentExerciseIndex];
    const isReps = cur && Number(cur.reps) > 0 && !cur.isInterSetRest;
    if (isReps) { clearInterval(timerInterval); timerInterval=null; isRunning=false; updateUI(); return; }
    timeRemaining--;
    const lname = (cur?.name||'').toLowerCase();
    const isRest = lname.includes('rest') || lname.includes('cool down') || cur?.isInterSetRest;
    if (timeRemaining > 0 && timeRemaining <= 3 && !isRest) { try { playBlinkSound(); } catch(e){ console.error(e); } }
    if (timeRemaining <= 0) { nextExercise(); } else { updateUI(); }
}

function toggleTimer() {
    if (isRunning) { clearInterval(timerInterval); timerInterval = null; isRunning = false; updateUI(); return; }
    try { ensureAudioContext(); } catch(_){}
    try { if (typeof enableSoundsForIOSQuick === 'function') enableSoundsForIOSQuick(); } catch(_){}
    const cur = exercises[currentExerciseIndex];
    const isReps = cur && Number(cur.reps) > 0 && !cur.isInterSetRest;
    if (isReps) { clearInterval(timerInterval); timerInterval=null; isRunning=false; updateUI(); return; }
    isRunning = true; requestWakeLock();
    try {
        if (cur && !cur.isInterSetRest) {
            const lname = (cur.name||'').toLowerCase();
            if (!lname.includes('rest') && !lname.includes('cool down')) playGongSound();
        }
    } catch(e){ console.warn('Gong start error', e); }
    timerInterval = setInterval(timerTick, 1000);
    updateUI();
}

function onNextRepsClick() {
    try { playBlinkSound(); } catch(_){}
    nextExercise();
    const cur = exercises[currentExerciseIndex];
    const timed = cur && (!cur.reps || cur.isInterSetRest) && Number(cur.duration) > 0;
    if (timed) { clearInterval(timerInterval); timerInterval = null; isRunning = true; timerInterval = setInterval(timerTick, 1000); }
    else { clearInterval(timerInterval); timerInterval = null; isRunning = false; }
    updateUI();
}

// --- Event Listeners ---
startButton.addEventListener('click', toggleTimer);
resetButton.addEventListener('click', resetWorkout);
if (nextRepsButton) nextRepsButton.addEventListener('click', onNextRepsClick);
routineSelector.addEventListener('change', e => { bodyEl.classList.remove('page-blink'); loadRoutine(e.target.value); startButton.disabled=false; startButton.textContent='Start Workout'; resetButton.disabled=false; if (nextRepsButton) nextRepsButton.classList.add('hidden'); });
interSetBreakInput.addEventListener('change', () => { loadRoutine(currentRoutineKey, true); });
document.addEventListener('visibilitychange', async () => { if (document.visibilityState==='visible' && isRunning && !wakeLock) { try { await requestWakeLock(); } catch(_){} } });

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
