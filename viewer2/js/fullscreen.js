// Fullscreen the embedded simulation, retaining its HUD and camera controls.
export function fightFullscreenTarget() {
  return window.frameElement || document.documentElement;
}
export function toggleFightFullscreen(target) {
  const doc = target.ownerDocument;
  if (doc.fullscreenElement) return doc.exitFullscreen();
  if (!target.requestFullscreen) return Promise.reject(new Error('Fullscreen is unavailable in this browser.'));
  return target.requestFullscreen();
}
export function bindFightFullscreen(button) {
  if (!button) return;
  const target = fightFullscreenTarget(), doc = target.ownerDocument;
  const available = !!target.requestFullscreen && doc.fullscreenEnabled !== false;
  const sync = () => {
    const active = doc.fullscreenElement === target;
    button.hidden = !available || (!!window.frameElement && !active);
    button.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? 'Exit fullscreen (Esc)' : 'Expand the fight simulation';
  };
  doc.addEventListener('fullscreenchange', sync);
  window.addEventListener('pagehide', () => doc.removeEventListener('fullscreenchange', sync), {once:true});
  button.addEventListener('click', () => {
    // Call synchronously from the trusted click so browser activation is retained.
    toggleFightFullscreen(target).catch(() => {
      button.title = 'Fullscreen was blocked by your browser. Try again.';
    });
  });
  sync();
}
