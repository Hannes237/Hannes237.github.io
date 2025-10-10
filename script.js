// --- Workout Data ---
const workoutRoutines = {
    "hiit": {
        name: "HIIT Blast (Multi-Set Demo)",
        exercises: [
            { name: "Jumping Jacks", duration: 30, color: "bg-neutral" },
            { name: "Rest", duration: 10, color: "bg-gray-300" },
            { name: "Squats", duration: 45, color: "bg-neutral", sets: 3 }, // 3 sets of 45s, with 5s rest in between
            { name: "Rest", duration: 10, color: "bg-gray-300" },
            { name: "Push-ups", duration: 30, color: "bg-neutral", sets: 2 }, // 2 sets of 30s, with 5s rest in between
            { name: "Rest", duration: 10, color: "bg-gray-300" },
            { name: "Plank", duration: 60, color: "bg-neutral" },
            { name: "Cool Down", duration: 30, color: "bg-active" },
        ]
    },
    "mobility": {
        name: "Joint Mobility Flow (Two-Sided Demo)",
        exercises: [
            { name: "Neck Circles", duration: 30, color: "bg-neutral" },
            { name: "Shoulder Rolls", duration: 45, color: "bg-neutral" },
            { name: "Hip Flexor Stretch", duration: 40, color: "bg-neutral", isTwoSided: true }, // 20s Left, 20s Right
            { name: "Cat-Cow Stretch", duration: 60, color: "bg-neutral" },
            { name: "Single Leg Calf Raise", duration: 60, color: "bg-neutral", isTwoSided: true }, // 30s Left, 30s Right
        ]
    },
    "endurance": {
        name: "Endurance Test",
        exercises: [
            { name: "High Knees", duration: 120, color: "bg-neutral" },
            { name: "Rest", duration: 30, color: "bg-gray-300" },
            { name: "Mountain Climbers", duration: 90, color: "bg-neutral" },
            { name: "Rest", duration: 30, color: "bg-gray-300" },
            { name: "Single Arm Rows", duration: 120, color: "bg-neutral", isTwoSided: true }, // 60s Left, 60s Right
            { name: "Jog in Place", duration: 180, color: "bg-neutral" },
        ]
    }
};

// --- Global State Variables ---
let currentRoutineKey = "hiit"; // Default routine
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

// --- Utility Functions ---

/**
 * Formats seconds into MM:SS string.
 */
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

/**
 * Generates a short, simple acoustic blink (tone burst) using Web Audio API.
 */
function playBlinkSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContext();
        const duration = 0.5; // seconds
        const gainValue = 0.1;

        const oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);

        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(gainValue, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);

        oscillator.connect(gainNode).connect(audioCtx.destination);
        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + duration);

    } catch (error) {
        console.error("Web Audio API not supported or failed to play sound:", error);
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

            if (ex.isTwoSided) {
                const sideDuration = Math.round(ex.duration / 2);

                // Left Side
                expanded.push({
                    name: `${baseName}${setSuffix} - Left`,
                    duration: sideDuration,
                    color: ex.color,
                });
                // Right Side
                expanded.push({
                    name: `${baseName}${setSuffix} - Right`,
                    duration: sideDuration,
                    color: ex.color,
                });
            } else {
                // Single-sided/standard exercise with multiple sets
                expanded.push({
                    name: `${baseName}${setSuffix}`,
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
                <span class="font-mono text-sm text-gray-500 transition-colors duration-300">${formatTime(ex.duration)}</span>
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

    // NEW: Get custom break duration, defaulting to 5 if input is invalid
    const rawDuration = parseInt(interSetBreakInput.value);
    // Ensure duration is a positive number, min 1 second, default 5
    const breakDuration = Math.max(1, rawDuration || 5);
    
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
    // First, integrate any custom workouts created on the Manage Workouts page
    ensureCustomWorkoutsInRoutinesAndSelector();
    // Then set the initial routine based on the selector's default value
    loadRoutine(routineSelector.value);
};
