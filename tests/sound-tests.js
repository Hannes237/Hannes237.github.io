(function(){
  const btnBlink = document.getElementById('btn-blink');
  const btnBeep = document.getElementById('btn-beep');
  const btnGong = document.getElementById('btn-gong');

  if (btnBlink) btnBlink.addEventListener('click', () => {
    try { if (window.enableSoundsForIOSQuick) window.enableSoundsForIOSQuick(); } catch(_) {}
    try { SoundManager.playBlinkSound(); } catch (e) { console.error(e); }
  });

  if (btnBeep) btnBeep.addEventListener('click', () => {
    try { if (window.enableSoundsForIOSQuick) window.enableSoundsForIOSQuick(); } catch(_) {}
    try { SoundManager.playCountdownBeep(); } catch (e) { console.error(e); }
  });

  if (btnGong) btnGong.addEventListener('click', () => {
    try { if (window.enableSoundsForIOSQuick) window.enableSoundsForIOSQuick(); } catch(_) {}
    try { SoundManager.playGongSound(); } catch (e) { console.error(e); }
  });
})();
