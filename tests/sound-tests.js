(function(){
  const btnBlink = document.getElementById('btn-blink');
  const btnBeep = document.getElementById('btn-beep');

  if (btnBlink) btnBlink.addEventListener('click', () => {
    try { if (window.enableSoundsForIOSQuick) window.enableSoundsForIOSQuick(); } catch(_) {}
    try { playBlinkSound(); } catch (e) { console.error(e); }
  });

  if (btnBeep) btnBeep.addEventListener('click', () => {
    try { if (window.enableSoundsForIOSQuick) window.enableSoundsForIOSQuick(); } catch(_) {}
    try { playCountdownBeep(); } catch (e) { console.error(e); }
  });
})();
