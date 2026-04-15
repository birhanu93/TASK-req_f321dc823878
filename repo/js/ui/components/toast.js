let container = null;

function ensureContainer() {
  if (container && document.body.contains(container)) return;
  container = document.createElement('div');
  container.className = 'toast-container';
  document.body.appendChild(container);
}

export function showToast(message, options = {}) {
  ensureContainer();
  const type = options.type || 'info';
  const duration = options.duration || 4000;
  const action = options.action || null;

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <div class="toast__content">
      <span class="toast__icon">${getIcon(type)}</span>
      <span class="toast__message">${message}</span>
    </div>
    <div class="toast__actions">
      ${action ? `<button class="toast__action-btn">${action.label}</button>` : ''}
      <button class="toast__dismiss">&times;</button>
    </div>
  `;

  const dismiss = () => {
    el.classList.add('toast--exiting');
    setTimeout(() => el.remove(), 300);
  };

  el.querySelector('.toast__dismiss').addEventListener('click', dismiss);
  if (action) {
    el.querySelector('.toast__action-btn').addEventListener('click', () => {
      action.onClick();
      dismiss();
    });
  }

  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast--visible'));

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }

  return dismiss;
}

function getIcon(type) {
  switch (type) {
    case 'success': return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12L2.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    case 'error': return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    case 'warning': return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L14 13H2L8 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 7v2M8 11v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    default: return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/><path d="M8 7v4M8 5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  }
}

export const Toast = {
  styles: `
    .toast-container {
      position: fixed;
      bottom: var(--sp-4);
      right: var(--sp-4);
      display: flex;
      flex-direction: column-reverse;
      gap: var(--sp-2);
      z-index: var(--z-toast);
      pointer-events: none;
    }
    .toast {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-4);
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      min-width: 300px;
      max-width: 450px;
      pointer-events: auto;
      transform: translateX(110%);
      transition: transform var(--transition-slow);
      font-size: var(--text-sm);
    }
    .toast--visible { transform: translateX(0); }
    .toast--exiting { transform: translateX(110%); }
    .toast__content { display: flex; align-items: center; gap: var(--sp-2); flex: 1; }
    .toast__icon { flex-shrink: 0; display: flex; }
    .toast__actions { display: flex; align-items: center; gap: var(--sp-1); flex-shrink: 0; }
    .toast__action-btn {
      background: none; border: none; color: var(--c-primary); font-weight: var(--fw-semibold);
      font-size: var(--text-sm); cursor: pointer; padding: var(--sp-1) var(--sp-2);
    }
    .toast__dismiss {
      background: none; border: none; color: var(--c-text-muted); cursor: pointer;
      font-size: 18px; padding: 0 var(--sp-1); line-height: 1;
    }
    .toast--success { border-left: 3px solid var(--c-success); }
    .toast--success .toast__icon { color: var(--c-success); }
    .toast--error { border-left: 3px solid var(--c-danger); }
    .toast--error .toast__icon { color: var(--c-danger); }
    .toast--warning { border-left: 3px solid var(--c-warning); }
    .toast--warning .toast__icon { color: var(--c-warning); }
    .toast--info { border-left: 3px solid var(--c-info); }
    .toast--info .toast__icon { color: var(--c-info); }
  `
};
