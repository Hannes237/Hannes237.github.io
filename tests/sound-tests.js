(function(){
  const logEl = document.getElementById('tests-log');
  const summaryEl = document.getElementById('tests-summary');
  const btnRun = document.getElementById('run-tests');

  function log(message, ok=true){
    if (!logEl) return;
    const li = document.createElement('li');
    li.className = ok ? 'text-emerald-700' : 'text-red-600';
    li.textContent = (ok ? '✓ ' : '✗ ') + message;
    logEl.appendChild(li);
  }

  function clearLog(){
    if (logEl) logEl.innerHTML = '';
    if (summaryEl) summaryEl.textContent = '';
  }

  function getCtxClass(){
    return window.AudioContext || window.webkitAudioContext;
  }

  // Assertion helpers
  function assert(condition, message){
    if (condition){
      log(message, true);
      return true;
    } else {
      log(message, false);
      return false;
    }
  }

  function assertNoThrow(fn, label){
    try {
      fn();
      log(label + ' did not throw', true);
      return true;
    } catch(e){
      log(label + ' threw: ' + (e && e.message ? e.message : e), false);
      return false;
    }
  }

  async function delay(ms){
    return new Promise(res => setTimeout(res, ms));
  }

  async function runSmokeTests(){
    clearLog();
    let passed = 0, total = 0;

    total++; if (assert(!!getCtxClass(), 'Web Audio API present')) passed++;

    // API surface exists
    total++; if (assert(typeof window.playHarmonicChime === 'function', 'playHarmonicChime is defined')) passed++;
    total++; if (assert(typeof window.playBlinkSound === 'function', 'playBlinkSound is defined')) passed++;
    total++; if (assert(typeof window.playCountdownBeep === 'function', 'playCountdownBeep is defined')) passed++;

    // No-throw calls
    total++; if (assertNoThrow(() => playBlinkSound(), 'playBlinkSound()'), passed++);
    await delay(200);
    total++; if (assertNoThrow(() => playCountdownBeep(), 'playCountdownBeep()'), passed++);
    await delay(200);

    // Parameterized harmonic chime
    total++; if (assertNoThrow(() => playHarmonicChime({ fundamental: 440, duration: 0.2, attack: 0.005, gain: 0.08 }), 'playHarmonicChime(440Hz)'), passed++);
    await delay(250);

    // Edge handling (invalid/edge values should be clamped internally and not throw)
    total++; if (assertNoThrow(() => playHarmonicChime({ fundamental: NaN, duration: -1, attack: 0, gain: 10 }), 'playHarmonicChime(edge values)'), passed++);

    // Quick burst series to ensure rapid successive calls do not throw
    total++;
    try {
      for (let i=0;i<3;i++) playCountdownBeep();
      log('Rapid successive playCountdownBeep calls', true);
      passed++;
    } catch(e) {
      log('Rapid successive playCountdownBeep calls threw', false);
    }

    if (summaryEl) summaryEl.textContent = `Passed ${passed} / ${total} checks`;
  }

  // Manual controls
  const btnBlink = document.getElementById('btn-blink');
  const btnCountdown = document.getElementById('btn-countdown');
  const btnHarmonic = document.getElementById('btn-harmonic');
  const btnSweep = document.getElementById('btn-sweep');
  const inputFund = document.getElementById('fundamental');
  const inputDur = document.getElementById('duration');
  const inputAtk = document.getElementById('attack');
  const inputGain = document.getElementById('gain');

  if (btnRun) btnRun.addEventListener('click', runSmokeTests);
  if (btnBlink) btnBlink.addEventListener('click', () => {
    try { playBlinkSound(); } catch(e) { console.error(e); }
  });
  if (btnCountdown) btnCountdown.addEventListener('click', () => {
    try { playCountdownBeep(); } catch(e) { console.error(e); }
  });
  if (btnHarmonic) btnHarmonic.addEventListener('click', () => {
    const fundamental = parseFloat(inputFund.value) || 440;
    const duration = Math.max(0.06, parseFloat(inputDur.value) || 0.35);
    const attack = Math.max(0.003, parseFloat(inputAtk.value) || 0.01);
    const gain = Math.min(0.4, Math.max(0.02, parseFloat(inputGain.value) || 0.12));
    try {
      playHarmonicChime({ fundamental, duration, attack, gain });
    } catch(e) { console.error(e); }
  });
  if (btnSweep) btnSweep.addEventListener('click', async () => {
    const steps = 6;
    for (let i=0;i<=steps;i++){
      const f = 440 + (440 * (i/steps));
      try { playHarmonicChime({ fundamental: f, duration: 0.15, attack: 0.005, gain: 0.08 }); } catch(e){ console.error(e); }
      await delay(180);
    }
  });

  // Auto-run basic tests once after a user gesture (if any). Some browsers block autoplay.
  // We attach a one-time listener to run tests on the first click anywhere.
  let armed = true;
  window.addEventListener('click', () => {
    if (!armed) return;
    armed = false;
    if (btnRun) btnRun.click();
  }, { once: true, passive: true });
})();
