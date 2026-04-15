export class Drawer {
  constructor(options = {}) {
    this.title = options.title || '';
    this.side = options.side || 'right';
    this.width = options.width || '360px';
    this.content = options.content || '';
    this.onClose = options.onClose || null;
    this.el = null;
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  render() {
    this.el = document.createElement('div');
    this.el.className = `drawer-backdrop`;
    this.el.innerHTML = `
      <div class="drawer drawer--${this.side}" style="width: ${this.width}">
        <div class="drawer__header">
          <h3 class="drawer__title">${this.title}</h3>
          <button class="drawer__close btn btn--ghost btn--icon" aria-label="Close">&times;</button>
        </div>
        <div class="drawer__body">${typeof this.content === 'string' ? this.content : ''}</div>
      </div>
    `;

    if (typeof this.content !== 'string' && this.content instanceof HTMLElement) {
      this.el.querySelector('.drawer__body').innerHTML = '';
      this.el.querySelector('.drawer__body').appendChild(this.content);
    }

    this.el.querySelector('.drawer__close').addEventListener('click', () => this.close());
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });

    document.addEventListener('keydown', this._onKeyDown);
    document.body.appendChild(this.el);
    requestAnimationFrame(() => this.el.classList.add('drawer-backdrop--open'));
    return this;
  }

  getBody() {
    return this.el?.querySelector('.drawer__body');
  }

  close() {
    if (!this.el) return;
    this.el.classList.remove('drawer-backdrop--open');
    document.removeEventListener('keydown', this._onKeyDown);
    setTimeout(() => {
      this.el.remove();
      this.el = null;
      if (this.onClose) this.onClose();
    }, 300);
  }

  _onKeyDown(e) {
    if (e.key === 'Escape') this.close();
  }

  static styles = `
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: var(--z-drawer);
      opacity: 0;
      transition: opacity var(--transition-base);
    }
    .drawer-backdrop--open { opacity: 1; }
    .drawer {
      position: absolute;
      top: 0;
      bottom: 0;
      background: var(--c-surface);
      box-shadow: var(--shadow-xl);
      display: flex;
      flex-direction: column;
      transition: transform var(--transition-slow);
    }
    .drawer--right {
      right: 0;
      transform: translateX(100%);
    }
    .drawer--left {
      left: 0;
      transform: translateX(-100%);
    }
    .drawer-backdrop--open .drawer--right { transform: translateX(0); }
    .drawer-backdrop--open .drawer--left { transform: translateX(0); }
    .drawer__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-4);
      border-bottom: 1px solid var(--c-border);
      flex-shrink: 0;
    }
    .drawer__title {
      font-size: var(--text-base);
      font-weight: var(--fw-semibold);
    }
    .drawer__close { font-size: 20px; }
    .drawer__body {
      flex: 1;
      overflow-y: auto;
      padding: var(--sp-4);
    }
  `;
}
