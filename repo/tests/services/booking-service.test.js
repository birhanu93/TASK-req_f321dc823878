import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { bookingService } from '../../js/services/booking-service.js';
import { db } from '../../js/core/db.js';
import { bus } from '../../js/core/event-bus.js';

beforeEach(async () => {
  await resetAll();
  setCurrentUser();
});

describe('bookingService', () => {
  // ── createBooking ──────────────────────────────────────────────────

  describe('createBooking', () => {
    it('should create a booking in draft status', async () => {
      const booking = await bookingService.createBooking({
        title: 'Test Booking',
        description: 'A test booking',
        totalAmount: 100
      });

      expect(booking.id).toBeTruthy();
      expect(booking.profileId).toBe('u1');
      expect(booking.title).toBe('Test Booking');
      expect(booking.description).toBe('A test booking');
      expect(booking.status).toBe('draft');
      expect(booking.totalAmount).toBe(100);
      expect(booking.items).toEqual([]);
      expect(booking.createdAt).toBeTypeOf('number');
      expect(booking.updatedAt).toBeTypeOf('number');
    });

    it('should initialize statusHistory with draft entry', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });

      expect(booking.statusHistory).toHaveLength(1);
      expect(booking.statusHistory[0].status).toBe('draft');
      expect(booking.statusHistory[0].note).toBe('Created');
      expect(booking.statusHistory[0].timestamp).toBeTypeOf('number');
    });

    it('should persist booking to the database', async () => {
      const booking = await bookingService.createBooking({ title: 'Persisted' });
      const stored = await db.get('bookings', booking.id);
      expect(stored).toBeDefined();
      expect(stored.title).toBe('Persisted');
    });

    it('should emit booking:created event', async () => {
      const handler = vi.fn();
      bus.on('booking:created', handler);

      await bookingService.createBooking({ title: 'Event Test' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].title).toBe('Event Test');
    });

    it('should use defaults for optional fields', async () => {
      const booking = await bookingService.createBooking({ title: 'Minimal' });

      expect(booking.description).toBe('');
      expect(booking.items).toEqual([]);
      expect(booking.totalAmount).toBe(0);
      expect(booking.scheduledDate).toBeNull();
    });
  });

  // ── transitionStatus ───────────────────────────────────────────────

  describe('transitionStatus', () => {
    it('should transition draft to pending', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      const updated = await bookingService.transitionStatus(booking.id, 'pending', 'Submitted');

      expect(updated.status).toBe('pending');
      expect(updated.statusHistory).toHaveLength(2);
      expect(updated.statusHistory[1].status).toBe('pending');
      expect(updated.statusHistory[1].note).toBe('Submitted');
    });

    it('should transition pending to approved', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');
      const updated = await bookingService.transitionStatus(booking.id, 'approved');

      expect(updated.status).toBe('approved');
    });

    it('should transition approved to paid-marked', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');
      await bookingService.transitionStatus(booking.id, 'approved');
      const updated = await bookingService.transitionStatus(booking.id, 'paid-marked');

      expect(updated.status).toBe('paid-marked');
    });

    it('should transition paid-marked to completed', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');
      await bookingService.transitionStatus(booking.id, 'approved');
      await bookingService.transitionStatus(booking.id, 'paid-marked');
      const updated = await bookingService.transitionStatus(booking.id, 'completed');

      expect(updated.status).toBe('completed');
    });

    it('should throw on invalid transition (draft to completed)', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });

      await expect(bookingService.transitionStatus(booking.id, 'completed'))
        .rejects.toThrow('Cannot transition from "draft" to "completed"');
    });

    it('should throw on invalid transition (draft to approved)', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });

      await expect(bookingService.transitionStatus(booking.id, 'approved'))
        .rejects.toThrow('Cannot transition from "draft" to "approved"');
    });

    it('should update statusHistory with each transition', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending', 'Step 1');
      await bookingService.transitionStatus(booking.id, 'approved', 'Step 2');

      const history = await bookingService.getStatusHistory(booking.id);
      expect(history).toHaveLength(3);
      expect(history[0].status).toBe('draft');
      expect(history[1].status).toBe('pending');
      expect(history[1].note).toBe('Step 1');
      expect(history[2].status).toBe('approved');
      expect(history[2].note).toBe('Step 2');
    });

    it('should throw for non-existent booking', async () => {
      await expect(bookingService.transitionStatus('nonexistent', 'pending'))
        .rejects.toThrow('Booking not found');
    });

    it('should emit booking:status-changed event', async () => {
      const handler = vi.fn();
      bus.on('booking:status-changed', handler);

      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({
        bookingId: booking.id,
        from: 'draft',
        to: 'pending'
      });
    });

    it('should allow cancellation from pending', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');
      const updated = await bookingService.transitionStatus(booking.id, 'canceled');
      expect(updated.status).toBe('canceled');
    });
  });

  // ── getBooking ─────────────────────────────────────────────────────

  describe('getBooking', () => {
    it('should return a booking by id', async () => {
      const booking = await bookingService.createBooking({ title: 'Get Test' });
      const fetched = await bookingService.getBooking(booking.id);
      expect(fetched).toBeDefined();
      expect(fetched.title).toBe('Get Test');
    });

    it('should return undefined for non-existent booking', async () => {
      const fetched = await bookingService.getBooking('nonexistent');
      expect(fetched).toBeUndefined();
    });
  });

  // ── listBookings ───────────────────────────────────────────────────

  describe('listBookings', () => {
    it('should return bookings sorted by updatedAt descending', async () => {
      await bookingService.createBooking({ title: 'First' });
      await bookingService.createBooking({ title: 'Second' });
      await bookingService.createBooking({ title: 'Third' });

      const list = await bookingService.listBookings();
      expect(list.length).toBe(3);
      // Most recently updated first
      expect(list[0].updatedAt).toBeGreaterThanOrEqual(list[1].updatedAt);
      expect(list[1].updatedAt).toBeGreaterThanOrEqual(list[2].updatedAt);
    });

    it('should filter by status', async () => {
      const b1 = await bookingService.createBooking({ title: 'Draft' });
      const b2 = await bookingService.createBooking({ title: 'Pending' });
      await bookingService.transitionStatus(b2.id, 'pending');

      const drafts = await bookingService.listBookings({ status: 'draft' });
      expect(drafts.length).toBe(1);
      expect(drafts[0].title).toBe('Draft');

      const pendings = await bookingService.listBookings({ status: 'pending' });
      expect(pendings.length).toBe(1);
      expect(pendings[0].title).toBe('Pending');
    });

    it('should respect limit option', async () => {
      for (let i = 0; i < 5; i++) {
        await bookingService.createBooking({ title: `Booking ${i}` });
      }

      const list = await bookingService.listBookings({ limit: 2 });
      expect(list.length).toBe(2);
    });
  });

  // ── updateBooking ──────────────────────────────────────────────────

  describe('updateBooking', () => {
    it('should update a draft booking', async () => {
      const booking = await bookingService.createBooking({ title: 'Old Title' });
      const updated = await bookingService.updateBooking(booking.id, { title: 'New Title' });

      expect(updated.title).toBe('New Title');
    });

    it('should throw for non-draft booking', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');

      await expect(bookingService.updateBooking(booking.id, { title: 'Change' }))
        .rejects.toThrow('Booking can only be updated in draft status');
    });

    it('should protect immutable fields', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      const updated = await bookingService.updateBooking(booking.id, {
        id: 'hacked',
        profileId: 'hacked',
        status: 'completed',
        statusHistory: [],
        createdAt: 0
      });

      expect(updated.id).toBe(booking.id);
      expect(updated.profileId).toBe('u1');
      expect(updated.status).toBe('draft');
      expect(updated.statusHistory).toHaveLength(1);
      expect(updated.createdAt).toBe(booking.createdAt);
    });

    it('should throw for non-existent booking', async () => {
      await expect(bookingService.updateBooking('nonexistent', { title: 'X' }))
        .rejects.toThrow('Booking not found');
    });

    it('should emit booking:updated event', async () => {
      const handler = vi.fn();
      bus.on('booking:updated', handler);

      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.updateBooking(booking.id, { title: 'Updated' });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── deleteBooking ──────────────────────────────────────────────────

  describe('deleteBooking', () => {
    it('should delete a draft booking', async () => {
      const booking = await bookingService.createBooking({ title: 'To Delete' });
      await bookingService.deleteBooking(booking.id);

      const stored = await db.get('bookings', booking.id);
      expect(stored).toBeUndefined();
    });

    it('should throw for non-draft booking', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');

      await expect(bookingService.deleteBooking(booking.id))
        .rejects.toThrow('Booking can only be deleted in draft status');
    });

    it('should throw for non-existent booking', async () => {
      await expect(bookingService.deleteBooking('nonexistent'))
        .rejects.toThrow('Booking not found');
    });

    it('should emit booking:deleted event', async () => {
      const handler = vi.fn();
      bus.on('booking:deleted', handler);

      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.deleteBooking(booking.id);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].id).toBe(booking.id);
    });
  });

  // ── getStatusHistory ───────────────────────────────────────────────

  describe('getStatusHistory', () => {
    it('should return the statusHistory array', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');

      const history = await bookingService.getStatusHistory(booking.id);
      expect(history).toHaveLength(2);
      expect(history[0].status).toBe('draft');
      expect(history[1].status).toBe('pending');
    });

    it('should throw for non-existent booking', async () => {
      await expect(bookingService.getStatusHistory('nonexistent'))
        .rejects.toThrow('Booking not found');
    });
  });

  // ── Policies ───────────────────────────────────────────────────────

  describe('createPolicy', () => {
    it('should create a policy', async () => {
      const policy = await bookingService.createPolicy('cancellation', { fee: 10 });

      expect(policy.id).toBe('cancellation');
      expect(policy.type).toBe('cancellation');
      expect(policy.rules).toEqual({ fee: 10 });
      expect(policy.createdAt).toBeTypeOf('number');
    });

    it('should emit booking:policy-created event', async () => {
      const handler = vi.fn();
      bus.on('booking:policy-created', handler);

      await bookingService.createPolicy('cancellation', { fee: 5 });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPolicy', () => {
    it('should return a policy by type', async () => {
      await bookingService.createPolicy('cancellation', { fee: 10 });
      const policy = await bookingService.getPolicy('cancellation');

      expect(policy).toBeDefined();
      expect(policy.type).toBe('cancellation');
    });

    it('should return undefined for non-existent policy', async () => {
      const policy = await bookingService.getPolicy('nonexistent');
      expect(policy).toBeUndefined();
    });
  });

  describe('listPolicies', () => {
    it('should return all policies', async () => {
      await bookingService.createPolicy('cancellation', { fee: 10 });
      await bookingService.createPolicy('reschedule', { fee: 5 });

      const policies = await bookingService.listPolicies();
      expect(policies.length).toBe(2);
    });
  });

  // ── checkCancellationPolicy ────────────────────────────────────────

  describe('checkCancellationPolicy', () => {
    it('should return allowed when no policy exists', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');

      const result = await bookingService.checkCancellationPolicy(booking.id);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('No cancellation policy');
      expect(result.fee).toBe(0);
    });

    it('should return allowed with fee when policy exists', async () => {
      await bookingService.createPolicy('cancellation', { fee: 25 });
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');

      const result = await bookingService.checkCancellationPolicy(booking.id);
      expect(result.allowed).toBe(true);
      expect(result.fee).toBe(25);
    });

    it('should return not allowed for non-cancelable status', async () => {
      await bookingService.createPolicy('cancellation', { fee: 0 });
      const booking = await bookingService.createBooking({ title: 'Test' });
      // draft cannot be canceled (draft can only go to pending)

      const result = await bookingService.checkCancellationPolicy(booking.id);
      expect(result.allowed).toBe(false);
    });

    it('should throw for non-existent booking', async () => {
      await expect(bookingService.checkCancellationPolicy('nonexistent'))
        .rejects.toThrow('Booking not found');
    });
  });

  // ── checkReschedulePolicy ──────────────────────────────────────────

  describe('checkReschedulePolicy', () => {
    it('should return allowed when no policy exists', async () => {
      const booking = await bookingService.createBooking({ title: 'Test' });

      const result = await bookingService.checkReschedulePolicy(booking.id);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('No reschedule policy');
    });

    it('should return not allowed for completed status', async () => {
      await bookingService.createPolicy('reschedule', { fee: 5 });
      const booking = await bookingService.createBooking({ title: 'Test' });
      await bookingService.transitionStatus(booking.id, 'pending');
      await bookingService.transitionStatus(booking.id, 'approved');
      await bookingService.transitionStatus(booking.id, 'paid-marked');
      await bookingService.transitionStatus(booking.id, 'completed');

      const result = await bookingService.checkReschedulePolicy(booking.id);
      expect(result.allowed).toBe(false);
    });
  });

  // ── generateReceipt ────────────────────────────────────────────────

  describe('generateReceipt', () => {
    it('should return an HTML string with booking details', async () => {
      const booking = await bookingService.createBooking({
        title: 'Receipt Test',
        description: 'A test booking',
        totalAmount: 150.50,
        items: [
          { name: 'Widget', quantity: 2, unitPrice: 50.25 },
          { name: 'Gadget', quantity: 1, unitPrice: 50.00 }
        ]
      });

      const html = await bookingService.generateReceipt(booking.id);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Receipt Test');
      expect(html).toContain('Widget');
      expect(html).toContain('Gadget');
      expect(html).toContain('150.50');
      expect(html).toContain('draft');
    });

    it('should throw for non-existent booking', async () => {
      await expect(bookingService.generateReceipt('nonexistent'))
        .rejects.toThrow('Booking not found');
    });

    it('should include status history', async () => {
      const booking = await bookingService.createBooking({ title: 'History Test' });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submitted');

      const html = await bookingService.generateReceipt(booking.id);
      expect(html).toContain('pending');
      expect(html).toContain('Submitted');
    });
  });

  // ── exportBookingsCSV ──────────────────────────────────────────────

  describe('exportBookingsCSV', () => {
    it('should return a CSV string with header and booking rows', async () => {
      await bookingService.createBooking({ title: 'Export Test', totalAmount: 99 });

      const csv = await bookingService.exportBookingsCSV();

      expect(csv).toContain('ID,Title,Description,Status,Total Amount');
      expect(csv).toContain('Export Test');
    });

    it('should filter by status', async () => {
      await bookingService.createBooking({ title: 'Draft Booking' });
      const b2 = await bookingService.createBooking({ title: 'Pending Booking' });
      await bookingService.transitionStatus(b2.id, 'pending');

      const csv = await bookingService.exportBookingsCSV({ status: 'pending' });
      expect(csv).toContain('Pending Booking');
      expect(csv).not.toContain('Draft Booking');
    });

    it('should return header even with no bookings', async () => {
      const csv = await bookingService.exportBookingsCSV();
      expect(csv).toContain('ID,Title,Description,Status,Total Amount');
    });

    it('should sort bookings by createdAt descending', async () => {
      const b1 = await bookingService.createBooking({ title: 'First' });
      // Ensure distinct timestamps by updating createdAt
      const raw1 = await db.get('bookings', b1.id);
      raw1.createdAt = Date.now() - 5000;
      await db.put('bookings', raw1);

      await bookingService.createBooking({ title: 'Second' });

      const csv = await bookingService.exportBookingsCSV();
      const lines = csv.split('\n');
      // Header + 2 rows
      expect(lines.length).toBe(3);
      // Second created (newer) should be first in the output (desc order)
      expect(lines[1]).toContain('Second');
      expect(lines[2]).toContain('First');
    });
  });
});
