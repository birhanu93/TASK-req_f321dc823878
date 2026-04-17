import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpsConsolePage } from '../../js/ui/pages/ops-console-page.js';
import { router } from '../../js/core/router.js';
import { store } from '../../js/core/store.js';
import { opsService } from '../../js/services/ops-service.js';
import { resetAll, setCurrentUser } from '../helpers.js';

function mount(section = 'announcements') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const page = new OpsConsolePage(container, { section });
  page.mount();
  return { page, container };
}
async function waitFor(pred, ms = 500) {
  for (let i = 0; i < ms / 10; i++) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  return false;
}

describe('OpsConsolePage (real ops-service, real db)', () => {
  let navSpy;
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    document.body.innerHTML = '';
    navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});
  });
  afterEach(() => {
    navSpy.mockRestore();
    document.body.innerHTML = '';
  });

  describe('gated render: role !== "ops"', () => {
    it('shows a gated empty state with a "Switch to Ops" button when the user is in "user" role', () => {
      store.set('role', 'user');
      const { container, page } = mount();

      expect(page.state.role).toBe('user');
      expect(container.querySelector('.empty-state__title').textContent).toBe('Ops Console');
      // The gated shell offers a role-toggle CTA (its class includes js-role-toggle)
      const toggleBtn = container.querySelector('.js-role-toggle');
      expect(toggleBtn).toBeTruthy();

      // The section tabs are NOT rendered
      expect(container.querySelectorAll('.js-section-tab').length).toBe(0);
    });

    it('clicking the role toggle flips to ops and unlocks the section tabs', async () => {
      store.set('role', 'user');
      const { container, page } = mount();

      // The CTA button in the gated body is the first .js-role-toggle
      const toggleBtn = container.querySelector('.js-role-toggle');
      toggleBtn.click();

      await waitFor(() => page.state.role === 'ops');
      expect(page.state.role).toBe('ops');
      // Section tabs now rendered
      expect(container.querySelectorAll('.js-section-tab').length).toBeGreaterThan(0);
    });
  });

  describe('render: ops role, section tabs', () => {
    beforeEach(() => {
      store.set('role', 'ops');
    });

    it('renders 7 section tabs with "Announcements" active by default', () => {
      const { container, page } = mount();

      const tabs = container.querySelectorAll('.js-section-tab');
      expect(tabs.length).toBe(7);
      expect(Array.from(tabs).map(t => t.dataset.section)).toEqual([
        'announcements', 'templates', 'sensitive-words', 'rules',
        'analytics', 'canary-flags', 'booking-policies'
      ]);

      // Announcements active (btn--primary)
      const primaries = Array.from(tabs).filter(t => t.classList.contains('btn--primary'));
      expect(primaries.length).toBe(1);
      expect(primaries[0].dataset.section).toBe('announcements');

      expect(container.querySelector('.page-title').textContent).toBe('Ops Console');
      expect(container.querySelector('.page-subtitle').textContent).toBe('Announcements');
      // _loadSectionData was kicked off; state tracks section
      expect(page.state.section).toBe('announcements');
    });

    it('honors the section prop (e.g. booking-policies) on initial render', () => {
      const { container, page } = mount('booking-policies');
      expect(page.state.section).toBe('booking-policies');
      expect(container.querySelector('.page-subtitle').textContent).toBe('Booking Policies');
      const primary = container.querySelector('.js-section-tab.btn--primary');
      expect(primary.dataset.section).toBe('booking-policies');
    });

    it('clicking a section tab updates state.section', async () => {
      const { container, page } = mount();
      container.querySelector('.js-section-tab[data-section="templates"]').click();
      await waitFor(() => page.state.section === 'templates');
      expect(page.state.section).toBe('templates');
    });
  });

  describe('announcements section: real service integration', () => {
    beforeEach(() => {
      store.set('role', 'ops');
    });

    it('renders existing announcements from the DB with title and body text', async () => {
      await opsService.createAnnouncement('Heads up', 'Deploy at 3pm', '#333333', '#ffffff');
      await opsService.createAnnouncement('Reminder', 'Standup moved', '#1e40af', '#ffffff');

      const { container, page } = mount();
      await waitFor(() => page.state.announcements.length === 2);

      expect(container.textContent).toContain('Heads up');
      expect(container.textContent).toContain('Deploy at 3pm');
      expect(container.textContent).toContain('Reminder');
      expect(container.textContent).toContain('Standup moved');
    });
  });
});
