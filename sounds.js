// sounds.js - Audio generation and playback module

// --- Audio Core (Web Audio + iOS unlock) ---
let audioCtx = null;
let audioUnlocked = false;
let htmlAudio = null; // shared element for iOS autoplay reliability
let soundEnabled = true; // user toggle (default ON)
const SoundURLs = { blink: null, beep: null }; // object URLs for pre-rendered tones

function ensureAudioContext() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        if (!audioCtx) audioCtx = new AC();
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
    const bitDepth = 16;
    const numFrames = buffer.length;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numFrames * blockAlign;
    const bufferSize = 44 + dataSize;
    const ab = new ArrayBuffer(bufferSize);
    const view = new DataView(ab);
    let offset = 0;
    const writeString = (str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); offset += str.length; };
    writeString('RIFF');
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeString('WAVE');
    writeString('fmt ');
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, numOfChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitDepth, true); offset += 2;
    writeString('data');
    view.setUint32(offset, dataSize, true); offset += 4;
    for (let i = 0; i < numFrames; i++) {
        for (let ch = 0; ch < numOfChannels; ch++) {
            let sample = buffer.getChannelData(ch)[i];
            sample = Math.max(-1, Math.min(1, sample));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }
    return new Blob([view], { type: 'audio/wav' });
}

function renderToneBlob({ frequency = 440, duration = 0.2, sampleRate = 44100, type = 'sine', gain = 0.12 }) {
    return new Promise((resolve, reject) => {
        try {
            const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
            const length = Math.max(1, Math.floor(duration * sampleRate));
            const offline = new Offline(1, length, sampleRate);
            const osc = offline.createOscillator();
            const g = offline.createGain();
            osc.type = type;
            osc.frequency.value = frequency;
            g.gain.setValueAtTime(0.0001, 0);
            g.gain.exponentialRampToValueAtTime(gain, Math.min(0.02, duration * 0.25));
            g.gain.exponentialRampToValueAtTime(0.0001, Math.max(duration - 0.01, duration * 0.85));
            osc.connect(g).connect(offline.destination);
            osc.start(0);
            osc.stop(duration);
            offline.startRendering().then(buffer => {
                try {
                    const blob = audioBufferToWavBlob(buffer);
                    resolve(blob);
                } catch (e) { reject(e); }
            }).catch(reject);
        } catch (e) { reject(e); }
    });
}

function setupSoundToggle() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;
    const hint = document.getElementById('sound-toggle-hint');
    const update = () => {
        btn.textContent = soundEnabled ? 'Disable Sounds' : 'Enable Sounds (iOS)';
        if (hint) hint.textContent = soundEnabled ? 'Sounds enabled. Toggle to disable.' : 'Tap once to enable sounds on iPhone browsers.';
    };
    update();
    btn.addEventListener('click', async () => {
        if (soundEnabled) {
            soundEnabled = false;
            try { if (htmlAudio) { htmlAudio.pause(); htmlAudio.src = ''; } } catch (_) {}
            if (SoundURLs.blink) { URL.revokeObjectURL(SoundURLs.blink); SoundURLs.blink = null; }
            if (SoundURLs.beep) { URL.revokeObjectURL(SoundURLs.beep); SoundURLs.beep = null; }
            update();
            return;
        }
        // Enable
        htmlAudio = new Audio(); htmlAudio.preload = 'auto'; htmlAudio.crossOrigin = 'anonymous';
        soundEnabled = true; update();
        try {
            const [blinkBlob, beepBlob] = await Promise.all([
                renderToneBlob({ frequency: 220, duration: 0.22, type: 'sine', gain: 0.12 }),
                renderToneBlob({ frequency: 880, duration: 0.12, type: 'square', gain: 0.10 }),
            ]);
            SoundURLs.blink = URL.createObjectURL(blinkBlob);
            SoundURLs.beep = URL.createObjectURL(beepBlob);
            // Confirmation beep
            if (SoundURLs.beep) {
                htmlAudio.src = SoundURLs.beep;
                const p = htmlAudio.play(); if (p && p.catch) p.catch(() => {});
            }
        } catch (e) { console.warn('Tone pre-render failed', e); }
    });
}

function playBlinkSound() {
    try {
        if (!soundEnabled) return;
        if (soundEnabled && htmlAudio && SoundURLs.blink) {
            htmlAudio.src = SoundURLs.blink; const p = htmlAudio.play(); if (p && p.catch) p.catch(() => {}); return;
        }
        const ctx = ensureAudioContext(); if (!ctx) return; const now = ctx.currentTime;
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(220, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.20);
        osc.connect(gain).connect(ctx.destination); osc.start(now); osc.stop(now + 0.22);
    } catch (e) { console.error('Blink sound failed:', e); }
}

function playCountdownBeep() {
    try {
        if (!soundEnabled) return;
        if (soundEnabled && htmlAudio && SoundURLs.beep) {
            htmlAudio.src = SoundURLs.beep; const p = htmlAudio.play(); if (p && p.catch) p.catch(() => {}); return;
        }
        const ctx = ensureAudioContext(); if (!ctx) return; const now = ctx.currentTime;
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'square'; osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.10, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.10);
        osc.connect(gain).connect(ctx.destination); osc.start(now); osc.stop(now + 0.12);
    } catch (e) { console.error('Countdown beep failed:', e); }
}

function playGongSound() {
    try {
        if (!soundEnabled) return;
        const ctx = ensureAudioContext(); if (!ctx) return; const now = ctx.currentTime;
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(440, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
        osc.connect(gain).connect(ctx.destination); osc.start(now); osc.stop(now + 0.40);
    } catch (e) { console.error('Gong sound error:', e); }
}

function enableSoundsForIOSQuick() {
    try {
        // Prepare an HTMLAudio element and pre-render blobs if missing, but do not change user toggle.
        if (!htmlAudio) { htmlAudio = new Audio(); htmlAudio.preload = 'auto'; htmlAudio.crossOrigin = 'anonymous'; }
        (async ()=>{ try { if (!SoundURLs.blink) SoundURLs.blink = URL.createObjectURL(await renderToneBlob({frequency:220,duration:0.22,type:'sine',gain:0.12})); if (!SoundURLs.beep) SoundURLs.beep = URL.createObjectURL(await renderToneBlob({frequency:880,duration:0.12,type:'square',gain:0.10})); } catch(_){ } })();
        return true;
    } catch(_) { return false; }
}

// Export functions for use in script.js
window.SoundManager = {
    playBlinkSound,
    playCountdownBeep,
    playGongSound,
    setupSoundToggle,
    setupAudioUnlock,
    enableSoundsForIOSQuick,
    ensureAudioContext,
    get soundEnabled() { return soundEnabled; }
};

// Also expose enableSoundsForIOSQuick directly for backward compatibility
window.enableSoundsForIOSQuick = enableSoundsForIOSQuick;

