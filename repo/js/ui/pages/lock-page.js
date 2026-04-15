import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { escapeHTML, initial } from '../../core/utils.js';
import { unlockSession, logout } from '../../services/auth-service.js';

export class LockPage extends Component {
  constructor(container, props) {
    super(container, props);
    const currentUser = store.get('currentUser');
    this.state = {
      displayName: currentUser?.displayName || 'User',
      username: currentUser?.username || '',
      password: '',
      error: '',
      loading: false
    };
  }

  mount() {
    super.mount();
    this._bindEvents();
  }

  render() {
    const { displayName, password, error, loading } = this.state;
    const avatarLetter = initial(displayName);

    this.container.innerHTML = `
      <div class="centered-page">
        <div class="centered-card" style="text-align: center">
          <div class="avatar avatar--lg" style="
            margin: 0 auto var(--sp-4);
            width: 64px;
            height: 64px;
            font-size: var(--text-2xl);
          ">
            ${escapeHTML(avatarLetter)}
          </div>

          <h2 style="font-size: var(--text-lg); font-weight: var(--fw-semibold); margin-bottom: var(--sp-1)">
            ${escapeHTML(displayName)}
          </h2>
          <p style="color: var(--c-text-muted); font-size: var(--text-sm); margin-bottom: var(--sp-6)">
            Session locked
          </p>

          ${error ? `
            <div style="
              padding: var(--sp-3);
              margin-bottom: var(--sp-4);
              background: var(--c-danger-light);
              color: #dc2626;
              font-size: var(--text-sm);
              border-radius: var(--radius-md);
              text-align: left;
            ">${escapeHTML(error)}</div>
          ` : ''}

          <form id="unlock-form" autocomplete="off" style="text-align: left">
            <div class="form-group">
              <label class="form-label" for="lock-password">Password</label>
              <input
                id="lock-password"
                class="form-input"
                type="password"
                placeholder="Enter your password"
                value="${escapeHTML(password)}"
                autocomplete="current-password"
                required
                style="width: 100%"
              />
            </div>

            <button
              type="submit"
              class="btn btn--primary btn--lg"
              style="width: 100%; margin-top: var(--sp-2)"
              ${loading ? 'disabled' : ''}
            >
              ${loading
                ? '<span class="spinner" style="width: 16px; height: 16px; border-width: 2px"></span>'
                : 'Unlock'
              }
            </button>
          </form>

          <div style="margin-top: var(--sp-6)">
            <button
              id="switch-user-btn"
              class="btn btn--ghost btn--sm"
              type="button"
              style="color: var(--c-text-muted)"
            >
              Switch User
            </button>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    const form = this.$('#unlock-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this._handleUnlock();
      });
    }

    this.on('#lock-password', 'input', (e) => {
      this.state.password = e.target.value;
    });

    this.on('#switch-user-btn', 'click', () => {
      this._handleSwitchUser();
    });
  }

  async _handleUnlock() {
    const { password } = this.state;

    if (!password) {
      this.setState({ error: 'Password is required' });
      return;
    }

    this.setState({ error: '', loading: true });

    try {
      await unlockSession(password);
      store.set('locked', false);
      router.navigate('/rooms');
    } catch (err) {
      this.setState({ error: err.message, loading: false, password: '' });
    }
  }

  async _handleSwitchUser() {
    await logout();
    router.navigate('/login');
  }
}
