(function(){
  const STORAGE_KEY = 'customWorkoutsV1';

  // Elements
  const workoutListEl = document.getElementById('workout-list');
  const newBtn = document.getElementById('new-workout-btn');
  const nameInput = document.getElementById('workout-name');
  const addExerciseBtn = document.getElementById('add-exercise-btn');
  const rowsTbody = document.getElementById('exercise-rows');
  const saveBtn = document.getElementById('save-workout-btn');
  const deleteBtn = document.getElementById('delete-workout-btn');
  const statusMsg = document.getElementById('status-msg');
  // Import elements
  const importText = document.getElementById('import-text');
  const importFile = document.getElementById('import-file');
  const importCsvBtn = document.getElementById('import-csv-btn');
  const importJsonBtn = document.getElementById('import-json-btn');

  // State
  let workouts = [];
  loadAllWorkouts().then(ws => {
    workouts = ws;
    renderWorkoutList();
    if (workouts.length) {
      onSelectWorkout(workouts[0].id);
    } else {
      addExerciseRow();
    }
  });
  let currentId = null; // currently edited workout id

  // Helpers
  function uuid(){
    return 'w_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function loadWorkouts(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch(e) {
      console.warn('Failed to parse custom workouts, resetting.', e);
      return [];
    }
  }

  function saveWorkouts(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workouts));
  }

  function renderWorkoutList(){
    if (!workouts.length){
      workoutListEl.innerHTML = '<li class="text-gray-500">No workouts yet</li>';
      return;
    }
    workoutListEl.innerHTML = workouts.map(w => (
      `<li>
        <button data-id="${w.id}" class="w-full text-left px-3 py-2 rounded-lg hover:bg-emerald-50 border border-transparent hover:border-emerald-200">${escapeHtml(w.name)}</button>
      </li>`
    )).join('');
  }

  function escapeHtml(str){
    return String(str).replace(/[&<>"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[s]));
  }

  function clearEditor(){
    currentId = null;
    nameInput.value = '';
    rowsTbody.innerHTML = '';
    deleteBtn.classList.add('hidden');
    status('');
  }

  function status(text, ok=true){
    statusMsg.textContent = text;
    statusMsg.className = 'mt-3 text-sm ' + (ok ? 'text-emerald-700' : 'text-red-600');
  }

  function addExerciseRow(data){
    // Map external schema to editor format
    const name = data?.name || data?.exercise_name || '';
    const duration = data?.duration ?? '';
    const sets = data?.sets ?? data?.reps ?? '';
    const tr = document.createElement('tr');
    tr.className = 'border-b last:border-b-0';
    tr.innerHTML = `
      <td class="py-2 pr-2">
        <input type="text" class="w-full p-2 border border-gray-300 rounded-lg" placeholder="e.g., Push-ups" value="${escapeHtml(name)}" />
      </td>
      <td class="py-2 pr-2">
        <input type="number" min="1" class="w-full p-2 border border-gray-300 rounded-lg" placeholder="30" value="${duration}" />
      </td>
      <td class="py-2 pr-2">
        <input type="number" min="1" class="w-full p-2 border border-gray-300 rounded-lg" placeholder="1" value="${sets}" />
      </td>
      <td class="py-2">
        <button class="text-red-600 hover:bg-red-50 px-2 py-1 rounded">Remove</button>
      </td>
    `;
    const removeBtn = tr.querySelector('button');
    removeBtn.addEventListener('click', () => tr.remove());
    rowsTbody.appendChild(tr);
  }

  function readExercises(){
    const rows = Array.from(rowsTbody.querySelectorAll('tr'));
    const list = [];
    for (const tr of rows){
      const [nameEl, durEl, setsEl] = tr.querySelectorAll('input');
      const name = nameEl.value.trim();
      const duration = parseInt(durEl.value, 10);
      const sets = parseInt(setsEl.value, 10);
      if (!name) continue;
      if (!Number.isFinite(duration) || duration <= 0) continue;
      const entry = { name, duration };
      if (Number.isFinite(sets) && sets > 1) entry.sets = sets; // only persist when >1
      list.push(entry);
    }
    return list;
  }

  function expandExercises(exercises) {
    const expanded = [];
    for (const ex of exercises) {
      // Handle superset
      if (ex.superset && Array.isArray(ex.superset)) {
        const sets = Number.isFinite(ex.sets) && ex.sets > 0 ? ex.sets : 1;
        for (let i = 0; i < sets; i++) {
          for (const s of ex.superset) {
            // Use exercise_name, name, or fallback to 'Exercise' if missing
            const label = s.exercise_name || s.name || 'Exercise';
            expanded.push({
              ...s,
              name: label + ' (SuperSet)',
              exercise_name: undefined // remove to avoid confusion
            });
          }
        }
      } else if (Number.isFinite(ex.sets) && ex.sets > 1) {
        // Repeat exercise for number of sets
        const label = ex.exercise_name || ex.name || 'Exercise';
        for (let i = 0; i < ex.sets; i++) {
          expanded.push({
            ...ex,
            name: label
          });
        }
      } else {
        // Single exercise
        const label = ex.exercise_name || ex.name || 'Exercise';
        expanded.push({
          ...ex,
          name: label
        });
      }
    }
    return expanded;
  }

  function populateEditor(w){
    nameInput.value = w.name || '';
    rowsTbody.innerHTML = '';
    const expanded = expandExercises(w.exercises || []);
    expanded.forEach(ex => addExerciseRow(ex));
    deleteBtn.classList.toggle('hidden', !w.id);
  }

  function onSelectWorkout(id){
    const w = workouts.find(x => x.id === id);
    if (!w) return;
    currentId = id;
    populateEditor(w);
    status('Loaded workout.');
  }

  function saveCurrent(){
    const name = nameInput.value.trim();
    if (!name){
      status('Please provide a workout name.', false);
      return;
    }
    const exercises = readExercises();
    if (exercises.length === 0){
      status('Please add at least one valid exercise (name and duration).', false);
      return;
    }
    if (currentId){
      const idx = workouts.findIndex(w => w.id === currentId);
      if (idx >= 0){
        workouts[idx] = { ...workouts[idx], name, exercises };
      }
    } else {
      const id = uuid();
      workouts.push({ id, name, exercises });
      currentId = id;
    }
    saveWorkouts();
    renderWorkoutList();
    status('Saved! You can now select this workout in the Timer page.');
    deleteBtn.classList.remove('hidden');
  }

  function deleteCurrent(){
    if (!currentId) return;
    const idx = workouts.findIndex(w => w.id === currentId);
    if (idx >= 0){
      workouts.splice(idx, 1);
      saveWorkouts();
      renderWorkoutList();
      clearEditor();
      status('Workout deleted.');
    }
  }

  // Event bindings
  newBtn.addEventListener('click', () => {
    clearEditor();
    addExerciseRow();
  });

  addExerciseBtn.addEventListener('click', () => addExerciseRow());
  saveBtn.addEventListener('click', saveCurrent);
  deleteBtn.addEventListener('click', deleteCurrent);

  workoutListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    onSelectWorkout(btn.dataset.id);
  });

  // Import helpers
  function csvSplitLine(line){
    // Simple CSV split (no quoted commas support). Good for simple input.
    return line.split(',').map(s => s.trim());
  }

  function parseCsvToExercises(text){
    const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (!lines.length) return [];
    let start = 0;
    // Detect header
    const header = csvSplitLine(lines[0]).map(h => h.toLowerCase());
    const hasHeader = header.includes('title') || header.includes('name') || header.includes('duration');
    const fields = hasHeader ? header : ['title','sets','duration'];
    if (hasHeader) start = 1;
    const idx = {
      name: Math.max(fields.indexOf('name'), fields.indexOf('title')),
      duration: fields.indexOf('duration'),
      sets: fields.indexOf('sets'),
      reps: fields.indexOf('reps')
    };
    const out = [];
    for (let i = start; i < lines.length; i++){
      const cols = csvSplitLine(lines[i]);
      const name = cols[idx.name] || '';
      const duration = parseInt(cols[idx.duration] || '', 10);
      const setsRaw = cols[idx.sets] ?? cols[idx.reps] ?? '';
      const sets = parseInt(setsRaw, 10);
      if (!name || !Number.isFinite(duration) || duration <= 0) continue;
      const ex = { name, duration };
      if (Number.isFinite(sets) && sets > 1) ex.sets = sets;
      out.push(ex);
    }
    return out;
  }

  function parseJsonToExercises(text){
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.exercises) ? data.exercises : []);
      const out = [];
      for (const item of arr){
        if (!item) continue;
        const name = item.name || item.title || '';
        const duration = parseInt(item.duration, 10);
        const setsCandidate = item.sets ?? item.reps;
        const sets = parseInt(setsCandidate, 10);
        if (!name || !Number.isFinite(duration) || duration <= 0) continue;
        const ex = { name, duration };
        if (Number.isFinite(sets) && sets > 1) ex.sets = sets;
        out.push(ex);
      }
      return out;
    } catch(e){
      return [];
    }
  }

  function populateRowsWithExercises(exercises){
    if (!exercises || !exercises.length){
      status('Nothing to import or invalid format.', false);
      return;
    }
    rowsTbody.innerHTML = '';
    exercises.forEach(ex => addExerciseRow(ex));
    status(`Imported ${exercises.length} exercises. Remember to Save Workout.`, true);
  }

  function importFromText(kind){
    const text = (importText && importText.value) ? importText.value : '';
    const exs = kind === 'csv' ? parseCsvToExercises(text) : parseJsonToExercises(text);
    populateRowsWithExercises(exs);
  }

  async function loadDefaultWorkouts() {
    try {
      const res = await fetch('workouts.json', {cache: 'no-store'});
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && Array.isArray(data.workouts)) {
        // Assign unique IDs for selection
        return data.workouts.map((w, i) => ({...w, id: 'default_' + i}));
      }
    } catch (e) {
      console.warn('Failed to load default workouts:', e);
    }
    return [];
  }

  async function loadAllWorkouts() {
    const custom = loadWorkouts();
    const defaults = await loadDefaultWorkouts();
    return [...defaults, ...custom];
  }

  // Event bindings
  newBtn.addEventListener('click', () => {
    clearEditor();
    addExerciseRow();
  });

  addExerciseBtn.addEventListener('click', () => addExerciseRow());
  saveBtn.addEventListener('click', saveCurrent);
  deleteBtn.addEventListener('click', deleteCurrent);

  workoutListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    onSelectWorkout(btn.dataset.id);
  });

  if (importCsvBtn){
    importCsvBtn.addEventListener('click', () => importFromText('csv'));
  }
  if (importJsonBtn){
    importJsonBtn.addEventListener('click', () => importFromText('json'));
  }
  if (importFile){
    importFile.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const name = (file.name || '').toLowerCase();
        let exs = [];
        if (name.endsWith('.json')){
          exs = parseJsonToExercises(text);
        } else {
          exs = parseCsvToExercises(text);
        }
        populateRowsWithExercises(exs);
      };
      reader.readAsText(file);
    });
  }

  // Initial render
  renderWorkoutList();
  // Start with a fresh editor if none exists
  if (!workouts.length){
    addExerciseRow();
  } else {
    // Auto-load first workout for convenience
    onSelectWorkout(workouts[0].id);
  }
})();
