import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { bookingService } from '../../js/services/booking-service.js';
import { autosave } from '../../js/core/autosave.js';

describe('Integration: Booking cancellation/reschedule policy enforcement', () => {
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    autosave.destroy();
    autosave.init(async () => {});
  });

  afterEach(() => { autosave.destroy(); });

  describe('Cancellation policy', () => {
    it('should allow cancellation when no policy exists', async () => {
      const booking = await bookingService.createBooking({ title: 'Test', totalAmount: 100 });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submit');
      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(true);
      expect(check.fee).toBe(0);
    });

    it('should apply late cancellation fee from policy', async () => {
      await bookingService.createPolicy('cancellation', {
        deadlineHours: 24,
        lateFee: 25.00,
        fee: 0
      });

      // Create booking scheduled for very soon (within deadline)
      const booking = await bookingService.createBooking({
        title: 'Urgent',
        totalAmount: 100,
        scheduledDate: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour from now
      });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submit');

      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(true);
      expect(check.fee).toBe(25.00);
      expect(check.reason).toContain('Late');
    });

    it('should block cancellation when blockLate is set and within deadline', async () => {
      await bookingService.createPolicy('cancellation', {
        deadlineHours: 48,
        blockLate: true
      });

      const booking = await bookingService.createBooking({
        title: 'Blocked',
        totalAmount: 50,
        scheduledDate: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() // 12h from now
      });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submit');

      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('not allowed');
    });

    it('should deny cancellation for already-canceled booking (with policy)', async () => {
      await bookingService.createPolicy('cancellation', { fee: 0 });
      const booking = await bookingService.createBooking({ title: 'Already canceled', totalAmount: 10 });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submit');
      await bookingService.transitionStatus(booking.id, 'canceled', 'Cancel');

      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('already canceled');
    });

    it('should deny cancellation for non-cancelable status (with policy)', async () => {
      await bookingService.createPolicy('cancellation', { fee: 0 });
      const booking = await bookingService.createBooking({ title: 'Done', totalAmount: 50 });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submit');
      await bookingService.transitionStatus(booking.id, 'approved', 'Approve');
      await bookingService.transitionStatus(booking.id, 'paid-marked', 'Pay');
      await bookingService.transitionStatus(booking.id, 'completed', 'Complete');

      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(false);
    });
  });

  describe('Reschedule policy', () => {
    it('should allow reschedule when no policy exists', async () => {
      const booking = await bookingService.createBooking({ title: 'Reschedulable', totalAmount: 100 });
      const check = await bookingService.checkReschedulePolicy(booking.id);
      expect(check.allowed).toBe(true);
      expect(check.fee).toBe(0);
    });

    it('should deny reschedule when max reschedules exceeded', async () => {
      await bookingService.createPolicy('reschedule', { maxReschedules: 0 });
      const booking = await bookingService.createBooking({ title: 'NoResched', totalAmount: 100 });
      const check = await bookingService.checkReschedulePolicy(booking.id);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Maximum');
    });

    it('should deny reschedule for completed booking (with policy)', async () => {
      await bookingService.createPolicy('reschedule', { maxReschedules: 10 });
      const booking = await bookingService.createBooking({ title: 'Done', totalAmount: 50 });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submit');
      await bookingService.transitionStatus(booking.id, 'approved', 'Approve');
      await bookingService.transitionStatus(booking.id, 'paid-marked', 'Pay');
      await bookingService.transitionStatus(booking.id, 'completed', 'Complete');

      const check = await bookingService.checkReschedulePolicy(booking.id);
      expect(check.allowed).toBe(false);
    });
  });

  describe('State machine transition enforcement', () => {
    it('should reject invalid transition draft → completed', async () => {
      const booking = await bookingService.createBooking({ title: 'Invalid', totalAmount: 100 });
      await expect(bookingService.transitionStatus(booking.id, 'completed', 'Skip'))
        .rejects.toThrow(/Cannot transition/);
    });

    it('should reject invalid transition pending → paid-marked', async () => {
      const booking = await bookingService.createBooking({ title: 'Invalid', totalAmount: 100 });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submit');
      await expect(bookingService.transitionStatus(booking.id, 'paid-marked', 'Pay'))
        .rejects.toThrow(/Cannot transition/);
    });

    it('should allow the full happy path', async () => {
      const booking = await bookingService.createBooking({ title: 'Happy', totalAmount: 100 });
      await bookingService.transitionStatus(booking.id, 'pending', 'Submit');
      await bookingService.transitionStatus(booking.id, 'approved', 'Approve');
      await bookingService.transitionStatus(booking.id, 'paid-marked', 'Mark paid');
      const final = await bookingService.transitionStatus(booking.id, 'completed', 'Complete');
      expect(final.status).toBe('completed');
      expect(final.statusHistory).toHaveLength(5);
    });
  });
});
