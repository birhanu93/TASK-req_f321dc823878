import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RelationshipsPage } from '../../js/ui/pages/relationships-page.js';
import { router } from '../../js/core/router.js';
import { relationshipService } from '../../js/services/relationship-service.js';
import { createProfile } from '../../js/services/auth-service.js';
import { store } from '../../js/core/store.js';
import { resetAll, setCurrentUser } from '../helpers.js';

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const page = new RelationshipsPage(container, {});
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

describe('RelationshipsPage (real relationship-service, real db)', () => {
  let navSpy;
  beforeEach(async () => {
    await resetAll();
    // Create "me" as a real profile, set as currentUser
    const me = await createProfile('me', 'Me', 'password123');
    setCurrentUser({ id: me.id, username: me.username, displayName: me.displayName, sessionId: 's1' });
    document.body.innerHTML = '';
    navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});
  });
  afterEach(() => {
    navSpy.mockRestore();
    document.body.innerHTML = '';
  });

  describe('render: empty state', () => {
    it('shows Friends (0), Pending, Blocked (0) tabs and "No friends yet" empty state', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);

      const tabs = Array.from(container.querySelectorAll('.js-tab')).map(b => b.textContent.trim());
      expect(tabs[0]).toBe('Friends (0)');
      expect(tabs[1].replace(/\s+/g, ' ')).toBe('Pending');
      expect(tabs[2]).toBe('Blocked (0)');

      expect(container.querySelector('.empty-state__title').textContent).toBe('No friends yet');
    });
  });

  describe('render: with real data', () => {
    it('shows accepted friends with display name, username, remove button — and reflects count in Friends tab', async () => {
      const alice = await createProfile('alice', 'Alice', 'password123');
      const rel = await relationshipService.sendFriendRequest(alice.id);
      await relationshipService.acceptRequest(rel.id);

      const { container, page } = mount();
      await waitFor(() => page.state.friends.length === 1);

      // Friends tab count reflects 1
      expect(container.querySelector('.js-tab[data-tab="friends"]').textContent.trim()).toBe('Friends (1)');
      // Row renders Alice's info (scope to the wrapper div that also carries data-rel-id,
      // to avoid matching the nested .js-remove-friend button which also has data-friend-id)
      const rows = container.querySelectorAll('div[data-rel-id][data-friend-id]');
      expect(rows.length).toBe(1);
      expect(rows[0].dataset.friendId).toBe(alice.id);
      expect(rows[0].textContent).toContain('Alice');
      expect(rows[0].textContent).toContain('@alice');
      expect(rows[0].querySelector('.js-remove-friend')).toBeTruthy();
    });

    it('Pending tab shows both incoming and sent requests', async () => {
      const bob = await createProfile('bob', 'Bob', 'password123');
      const carol = await createProfile('carol', 'Carol', 'password123');

      // I send a request to Bob (sent)
      await relationshipService.sendFriendRequest(bob.id);

      // Carol sends a request to me (pending/incoming) — simulate by directly creating
      // the relationship via the service as if Carol were logged in.
      const me = store.get('currentUser');
      // Swap to Carol, send request to me, swap back
      store.set('currentUser', { id: carol.id, username: 'carol', displayName: 'Carol', sessionId: 'sc' });
      await relationshipService.sendFriendRequest(me.id);
      store.set('currentUser', me);

      const { container, page } = mount();
      await waitFor(() => page.state.sent.length === 1 && page.state.pending.length === 1);

      // Switch to Pending tab
      container.querySelector('.js-tab[data-tab="pending"]').click();
      await waitFor(() => page.state.tab === 'pending');

      // Incoming section shows Carol with Accept + Reject buttons
      expect(container.textContent).toContain('Incoming Requests (1)');
      expect(container.textContent).toContain('Carol');
      expect(container.querySelector('.js-accept-request')).toBeTruthy();
      expect(container.querySelector('.js-reject-request')).toBeTruthy();

      // Sent section shows Bob with Withdraw button
      expect(container.textContent).toContain('Sent Requests (1)');
      expect(container.textContent).toContain('Bob');
      expect(container.querySelector('.js-withdraw-request')).toBeTruthy();
    });

    it('Blocked tab lists blocked users with Unblock button', async () => {
      const evil = await createProfile('evil', 'Evil', 'password123');
      await relationshipService.blockUser(evil.id);

      const { container, page } = mount();
      await waitFor(() => page.state.blocked.length === 1);

      // Click Blocked tab
      container.querySelector('.js-tab[data-tab="blocked"]').click();
      await waitFor(() => page.state.tab === 'blocked');

      expect(container.querySelector('.js-tab[data-tab="blocked"]').textContent.trim()).toBe('Blocked (1)');
      expect(container.textContent).toContain('Evil');
      expect(container.querySelector('.js-unblock')).toBeTruthy();
    });
  });

  describe('tab switching: state transitions', () => {
    it('clicking a tab changes state.tab and re-renders the content', async () => {
      const { container, page } = mount();
      await waitFor(() => !page.state.loading);
      expect(page.state.tab).toBe('friends');

      container.querySelector('.js-tab[data-tab="pending"]').click();
      expect(page.state.tab).toBe('pending');

      container.querySelector('.js-tab[data-tab="blocked"]').click();
      expect(page.state.tab).toBe('blocked');
    });
  });
});
