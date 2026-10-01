// The league owns the context so a gesture in the hangar also unlocks the next fight.
// Same-origin broadcast frames use this host rather than creating a fresh locked context.
export function audioHost() {
  try { if (parent !== window && parent.__hbAudioHost) return parent.__hbAudioHost; } catch { /* standalone viewer */ }
  return window.__hbAudioHost ||= {
    context: null, muted: false,
    getContext() {
      if (!this.context || this.context.state === 'closed') {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) return null;
        this.context = new Context();
      }
      return this.context;
    },
    resume() {
      try {
        const context = this.getContext();
        if (context && context.state !== 'running') context.resume().catch(() => {});
        return context;
      } catch { return null; }
    },
  };
}

export function captureAudioInteractions(retry) {
  // Keep these listeners for the session: a rejected first attempt, a phone interruption,
  // or a newly mounted viewer must never consume the only chance to unlock audio.
  const attempt = event => { if (event.isTrusted) retry(event); };
  for (const type of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown', 'input', 'change', 'focusin', 'wheel']) {
    window.addEventListener(type, attempt, { capture: true, passive: true });
  }
  window.addEventListener('focus', () => retry());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retry(); });
}
