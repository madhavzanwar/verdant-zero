/**
 * Lightweight toast notifications for the HUD.
 * Toasts stack at the top-centre, at most three at a time, and fade out on their own.
 */
const MAX_TOASTS = 3;

let stackEl = null;

export function showToast(text, variant = 'info', duration = 2400) {
  if (!stackEl) stackEl = document.getElementById('toast-stack');
  if (!stackEl) return;

  while (stackEl.children.length >= MAX_TOASTS) {
    stackEl.firstElementChild.remove();
  }

  const el = document.createElement('div');
  el.className = `toast toast-${variant}`;
  el.textContent = text;
  stackEl.appendChild(el);

  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

export function clearToasts() {
  if (!stackEl) stackEl = document.getElementById('toast-stack');
  if (stackEl) stackEl.innerHTML = '';
}
