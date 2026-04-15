import { Component } from '../../core/component.js';
import { store } from '../../core/store.js';
import { router } from '../../core/router.js';
import { escapeHTML } from '../../core/utils.js';
import { createProfile, login } from '../../services/auth-service.js';

export class LoginPage extends Component {
  constructor(container, props) {
    super(container, props);
    this.state = {
      mode: 'signin',     // 'signin' | 'signup'
      username: '',
      displayName: '',
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
    const { mode, username, displayName, password, error, loading } = this.state;
    const isSignup = mode === 'signup';

    this.container.innerHTML = `
      <div class="centered-page">
        <div class="centered-card">
          <div style="text-align: center; margin-bottom: var(--sp-8)">
            <h1 style="font-size: var(--text-2xl); font-weight: var(--fw-bold); color: var(--c-primary); margin-bottom: var(--sp-2)">
              AlignSpace
            </h1>
            <p style="color: var(--c-text-secondary); font-size: var(--text-sm)">
              ${isSignup ? 'Create your local account' : 'Sign in to continue'}
            </p>
          </div>

          <div class="tabs" style="margin-bottom: var(--sp-6)">
            <button class="tab ${mode === 'signin' ? 'tab--active' : ''}" data-mode="signin" type="button">
              Sign In
            </button>
            <button class="tab ${mode === 'signup' ? 'tab--active' : ''}" data-mode="signup" type="button">
              Create Account
            </button>
          </div>

          ${error ? `
            <div style="
              padding: var(--sp-3);
              margin-bottom: var(--sp-4);
              background: var(--c-danger-light);
              color: #dc2626;
              font-size: var(--text-sm);
              border-radius: var(--radius-md);
            ">${escapeHTML(error)}</div>
          ` : ''}

          <form id="auth-form" autocomplete="off">
            <div class="form-group">
              <label class="form-label" for="login-username">Username</label>
              <input
                id="login-username"
                class="form-input"
                type="text"
                placeholder="Enter username"
                value="${escapeHTML(username)}"
                autocomplete="username"
                required
              />
            </div>

            ${isSignup ? `
              <div class="form-group">
                <label class="form-label" for="login-displayname">Display Name</label>
                <input
                  id="login-displayname"
                  class="form-input"
                  type="text"
                  placeholder="How others will see you"
                  value="${escapeHTML(displayName)}"
                  autocomplete="name"
                />
              </div>
            ` : ''}

            <div class="form-group">
              <label class="form-label" for="login-password">Password</label>
              <input
                id="login-password"
                class="form-input"
                type="password"
                placeholder="${isSignup ? 'Min 6 characters' : 'Enter password'}"
                value="${escapeHTML(password)}"
                autocomplete="${isSignup ? 'new-password' : 'current-password'}"
                required
              />
              ${isSignup ? '<span class="form-hint">Must be at least 6 characters</span>' : ''}
            </div>

            <button
              type="submit"
              class="btn btn--primary btn--lg"
              style="width: 100%; margin-top: var(--sp-2)"
              ${loading ? 'disabled' : ''}
            >
              ${loading
                ? '<span class="spinner" style="width: 16px; height: 16px; border-width: 2px"></span>'
                : (isSignup ? 'Create Account' : 'Sign In')
              }
            </button>
          </form>
        </div>
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    // Tab switching
    this.delegate('click', '.tab', (e, target) => {
      const mode = target.dataset.mode;
      if (mode && mode !== this.state.mode) {
        this.setState({ mode, error: '', password: '' });
      }
    });

    // Form submission
    const form = this.$('#auth-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this._handleSubmit();
      });
    }

    // Track input values so they survive re-renders
    this.on('#login-username', 'input', (e) => {
      this.state.username = e.target.value;
    });
    this.on('#login-displayname', 'input', (e) => {
      this.state.displayName = e.target.value;
    });
    this.on('#login-password', 'input', (e) => {
      this.state.password = e.target.value;
    });
  }

  _validate() {
    const { mode, username, password } = this.state;
    if (!username.trim()) {
      return 'Username is required';
    }
    if (!password) {
      return 'Password is required';
    }
    if (mode === 'signup' && password.length < 6) {
      return 'Password must be at least 6 characters';
    }
    return null;
  }

  async _handleSubmit() {
    const validationError = this._validate();
    if (validationError) {
      this.setState({ error: validationError });
      return;
    }

    this.setState({ error: '', loading: true });

    try {
      const { mode, username, displayName, password } = this.state;

      if (mode === 'signup') {
        const name = displayName.trim() || username.trim();
        const profile = await createProfile(username.trim(), name, password);
        // Auto-login after signup
        await login(username.trim(), password);
      } else {
        await login(username.trim(), password);
      }

      router.navigate('/rooms');
    } catch (err) {
      this.setState({ error: err.message, loading: false });
    }
  }
}
