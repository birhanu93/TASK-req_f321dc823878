export class Modal {
  constructor(options = {}) {
    this.title = options.title || '';
    this.content = options.content || '';
    this.size = options.size || 'md';
    this.closable = options.closable !== false;
    this.onClose = options.onClose || null;
    this.footer = options.footer || null;
    this.el = null;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  render() {
    const sizeClass = {
      sm: 'max-width: 400px',
      md: 'max-width: 560px',
      lg: 'max-width: 720px',
      xl: 'max-width: 900px',
      full: 'max-width: 95vw; max-height: 95vh'
    }[this.size] || 'max-width: 560px';

    this.el = document.createElement('div');
    this.el.className = 'modal-backdrop';
    this.el.innerHTML = `
      <div class="modal-container" style="${sizeClass}">
        <div class="modal-header">
          <h2 class="modal-title">${this.title}</h2>
          ${this.closable ? '<button class="modal-close btn btn--ghost btn--icon" aria-label="Close">&times;</button>' : ''}
        </div>
        <div class="modal-body">${typeof this.content === 'string' ? this.content : ''}</div>
        ${this.footer ? `<div class="modal-footer">${this.footer}</div>` : ''}
      </div>
    `;

    if (typeof this.content !== 'string' && this.content instanceof HTMLElement) {
      this.el.querySelector('.modal-body').innerHTML = '';
      this.el.querySelector('.modal-body').appendChild(this.content);
    }

    if (this.closable) {
      this.el.querySelector('.modal-close').addEventListener('click', () => this.close());
      this.el.addEventListener('click', (e) => {
        if (e.target === this.el) this.close();
      });
    }

    document.addEventListener('keydown', this._onKeyDown);
    document.body.appendChild(this.el);
    requestAnimationFrame(() => this.el.classList.add('modal-backdrop--open'));
    return this;
  }

  getBody() {
    return this.el?.querySelector('.modal-body');
  }

  getFooter() {
    return this.el?.querySelector('.modal-footer');
  }

  setContent(html) {
    const body = this.getBody();
    if (body) body.innerHTML = html;
  }

  close() {
    if (!this.el) return;
    this.el.classList.remove('modal-backdrop--open');
    document.removeEventListener('keydown', this._onKeyDown);
    setTimeout(() => {
      this.el.remove();
      this.el = null;
      if (this.onClose) this.onClose();
    }, 200);
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && this.closable) this.close();
  }

  static styles = `
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--z-modal-backdrop);
      opacity: 0;
      transition: opacity var(--transition-base);
      padding: var(--sp-4);
    }
    .modal-backdrop--open { opacity: 1; }
    .modal-container {
      background: var(--c-surface);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-xl);
      width: 100%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform var(--transition-base);
    }
    .modal-backdrop--open .modal-container { transform: scale(1); }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-4) var(--sp-6);
      border-bottom: 1px solid var(--c-border);
      flex-shrink: 0;
    }
    .modal-title {
      font-size: var(--text-lg);
      font-weight: var(--fw-semibold);
    }
    .modal-close { font-size: 20px; }
    .modal-body {
      padding: var(--sp-6);
      overflow-y: auto;
      flex: 1;
    }
    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--sp-3);
      padding: var(--sp-4) var(--sp-6);
      border-top: 1px solid var(--c-border);
      flex-shrink: 0;
    }
  `;
}
