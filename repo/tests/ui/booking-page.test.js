import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BookingPage } from '../../js/ui/pages/booking-page.js';
import { router } from '../../js/core/router.js';
import { bookingService } from '../../js/services/booking-service.js';
import { resetAll, setCurrentUser } from '../helpers.js';

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const page = new BookingPage(container, {});
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

describe('BookingPage (real booking-service, real db)', () => {
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

  describe('render', () => {
    it('renders empty state with "No bookings" when there are no bookings', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      expect(container.querySelector('.page-title').textContent).toBe('Bookings');
      expect(container.querySelector('.empty-state__title').textContent).toBe('No bookings');
      expect(container.querySelector('.js-create-booking')).toBeTruthy();
      expect(container.querySelector('.js-export-csv')).toBeTruthy();
    });

    it('renders all 8 status filter buttons with "All" selected initially', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      const filters = container.querySelectorAll('.js-status-filter');
      expect(filters.length).toBe(8);

      const labels = Array.from(filters).map(f => f.textContent.trim());
      expect(labels).toEqual([
        'All', 'Draft', 'Pending', 'Approved', 'Paid', 'Completed', 'Canceled', 'Refunding'
      ]);
      // "All" is the currently active filter (btn--primary)
      expect(filters[0].classList.contains('btn--primary')).toBe(true);
      for (let i = 1; i < filters.length; i++) {
        expect(filters[i].classList.contains('btn--primary')).toBe(false);
      }
    });
  });

  describe('renders booking cards from the real service', () => {
    it('renders one card per booking, with title, total, status badge, and correct transition buttons for the state machine', async () => {
      const draft = await bookingService.createBooking({
        title: 'Alpha', description: 'first', items: [], totalAmount: 42
      });
      const pending = await bookingService.createBooking({
        title: 'Beta', description: '', items: [], totalAmount: 100
      });
      await bookingService.transitionStatus(pending.id, 'pending');

      const { container, page } = mount();
      await waitFor(() => page.state.bookings.length === 2);

      const cards = container.querySelectorAll('.js-booking-card');
      expect(cards.length).toBe(2);

      // Draft card has a "Submit" transition (draft → pending)
      const draftCard = container.querySelector(`.js-booking-card[data-id="${draft.id}"]`);
      expect(draftCard.textContent).toContain('Alpha');
      expect(draftCard.textContent).toContain('$42.00');
      expect(draftCard.textContent).toContain('Draft');
      const draftTransitions = draftCard.querySelectorAll('.js-transition');
      expect(Array.from(draftTransitions).map(b => b.dataset.to)).toEqual(['pending']);

      // Pending card has Approve + Cancel
      const pendingCard = container.querySelector(`.js-booking-card[data-id="${pending.id}"]`);
      expect(pendingCard.textContent).toContain('Beta');
      expect(pendingCard.textContent).toContain('Pending');
      const pendingTransitions = pendingCard.querySelectorAll('.js-transition');
      expect(Array.from(pendingTransitions).map(b => b.dataset.to)).toEqual(['approved', 'canceled']);
      // Pending is also reschedulable
      expect(pendingCard.querySelector('.js-reschedule')).toBeTruthy();

      // Subtitle reflects count
      expect(container.querySelector('.page-subtitle').textContent).toBe('2 bookings');
    });
  });

  describe('status filter: state transition', () => {
    it('clicking a status filter updates state.statusFilter and marks only that button primary', async () => {
      const draft = await bookingService.createBooking({ title: 'D', items: [], totalAmount: 0 });
      const pending = await bookingService.createBooking({ title: 'P', items: [], totalAmount: 0 });
      await bookingService.transitionStatus(pending.id, 'pending');

      const { container, page } = mount();
      await waitFor(() => page.state.bookings.length === 2);

      container.querySelector('.js-status-filter[data-status="draft"]').click();
      await waitFor(() => page.state.statusFilter === 'draft' && !page.state.loading);

      expect(page.state.statusFilter).toBe('draft');
      // Real service returns only drafts
      expect(page.state.bookings.length).toBe(1);
      expect(page.state.bookings[0].title).toBe('D');

      // Only the Draft filter button is primary
      const filters = container.querySelectorAll('.js-status-filter');
      const primaries = Array.from(filters).filter(f => f.classList.contains('btn--primary'));
      expect(primaries.length).toBe(1);
      expect(primaries[0].dataset.status).toBe('draft');
    });
  });

  describe('detail view: click a card → detail', () => {
    it('clicking a booking card loads it into state.detailBooking and renders the detail layout', async () => {
      const b = await bookingService.createBooking({
        title: 'Detail Me', items: [{ name: 'Item A', quantity: 2, unitPrice: 5 }], totalAmount: 10
      });

      const { container, page } = mount();
      await waitFor(() => page.state.bookings.length === 1);

      container.querySelector('.js-booking-card').click();
      await waitFor(() => page.state.detailBooking?.id === b.id);

      // Detail header + back button appear
      expect(container.querySelector('.js-back-to-list')).toBeTruthy();
      expect(container.textContent).toContain('Detail Me');
      expect(container.textContent).toContain('Status History');
      // Item table is rendered
      expect(container.textContent).toContain('Item A');
      expect(container.textContent).toContain('$10.00');
    });
  });

  describe('navigation events', () => {
    it('role toggle switches user ↔ ops and shows the Administration section', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);
      expect(container.textContent).not.toContain('Administration');

      container.querySelector('.js-role-toggle').click();
      expect(page.state.role).toBe('ops');
      expect(container.textContent).toContain('Administration');
    });

    it('notifications header button navigates to /notifications', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);
      container.querySelector('.js-notifications-btn').click();
      expect(navSpy).toHaveBeenCalledWith('/notifications');
    });
  });
});
