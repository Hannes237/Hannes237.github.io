(function(){
  const btnBlink = document.getElementById('btn-blink');
  const btnBeep = document.getElementById('btn-beep');
  const btnGong = document.getElementById('btn-gong');

  if (btnBlink) btnBlink.addEventListener('click', () => {
    try { if (window.enableSoundsForIOSQuick) window.enableSoundsForIOSQuick(); } catch(_) {}
    try { playBlinkSound(); } catch (e) { console.error(e); }
  });

  if (btnBeep) btnBeep.addEventListener('click', () => {
    try { if (window.enableSoundsForIOSQuick) window.enableSoundsForIOSQuick(); } catch(_) {}
    try { playCountdownBeep(); } catch (e) { console.error(e); }
  });

  if (btnGong) btnGong.addEventListener('click', () => {
    try { if (window.enableSoundsForIOSQuick) window.enableSoundsForIOSQuick(); } catch(_) {}
    try { playGongSound(); } catch (e) { console.error(e); }
  });
})();
