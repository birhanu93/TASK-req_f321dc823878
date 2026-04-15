import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAll, setCurrentUser } from '../helpers.js';
import { bookingService } from '../../js/services/booking-service.js';
import { db } from '../../js/core/db.js';
import { autosave } from '../../js/core/autosave.js';

describe('Integration: Policy configuration round-trip (Ops → Service → Booking)', () => {
  beforeEach(async () => {
    await resetAll();
    setCurrentUser();
    autosave.destroy();
    autosave.init(async () => {});
  });

  afterEach(() => { autosave.destroy(); });

  // ── Cancellation Policy Config ─────────────────────────────────────

  describe('Cancellation policy configuration', () => {
    it('should persist cancellation policy via createPolicy and retrieve it', async () => {
      await bookingService.createPolicy('cancellation', {
        fee: 15,
        deadlineHours: 24,
        lateFee: 50,
        blockLate: false
      });

      const policy = await bookingService.getPolicy('cancellation');
      expect(policy).toBeDefined();
      expect(policy.type).toBe('cancellation');
      expect(policy.rules.fee).toBe(15);
      expect(policy.rules.deadlineHours).toBe(24);
      expect(policy.rules.lateFee).toBe(50);
      expect(policy.rules.blockLate).toBe(false);
    });

    it('should overwrite existing cancellation policy when saved again', async () => {
      await bookingService.createPolicy('cancellation', { fee: 10 });
      await bookingService.createPolicy('cancellation', { fee: 25, deadlineHours: 12 });

      const policy = await bookingService.getPolicy('cancellation');
      expect(policy.rules.fee).toBe(25);
      expect(policy.rules.deadlineHours).toBe(12);
    });

    it('should apply standard fee from configured policy', async () => {
      await bookingService.createPolicy('cancellation', { fee: 20 });

      const booking = await bookingService.createBooking({
        title: 'Standard Fee Test',
        totalAmount: 100,
        scheduledDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      });
      await bookingService.transitionStatus(booking.id, 'pending');

      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(true);
      expect(check.fee).toBe(20);
    });

    it('should apply late fee when within deadline and lateFee configured', async () => {
      await bookingService.createPolicy('cancellation', {
        fee: 5,
        deadlineHours: 48,
        lateFee: 75
      });

      const booking = await bookingService.createBooking({
        title: 'Late Fee Test',
        totalAmount: 200,
        scheduledDate: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString() // 6h from now
      });
      await bookingService.transitionStatus(booking.id, 'pending');

      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(true);
      expect(check.fee).toBe(75);
      expect(check.reason).toContain('Late');
    });

    it('should block cancellation when blockLate is enabled and within deadline', async () => {
      await bookingService.createPolicy('cancellation', {
        deadlineHours: 24,
        blockLate: true
      });

      const booking = await bookingService.createBooking({
        title: 'Block Late Test',
        totalAmount: 100,
        scheduledDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      });
      await bookingService.transitionStatus(booking.id, 'pending');

      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('not allowed');
    });

    it('should allow cancellation outside the deadline window even with blockLate', async () => {
      await bookingService.createPolicy('cancellation', {
        deadlineHours: 2,
        blockLate: true,
        fee: 10
      });

      const booking = await bookingService.createBooking({
        title: 'Outside Deadline',
        totalAmount: 100,
        scheduledDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() // 72h out
      });
      await bookingService.transitionStatus(booking.id, 'pending');

      const check = await bookingService.checkCancellationPolicy(booking.id);
      expect(check.allowed).toBe(true);
      expect(check.fee).toBe(10);
    });
  });

  // ── Reschedule Policy Config ───────────────────────────────────────

  describe('Reschedule policy configuration', () => {
    it('should persist reschedule policy with all rules', async () => {
      await bookingService.createPolicy('reschedule', {
        fee: 10,
        deadlineHours: 12,
        lateFee: 30,
        blockLate: false,
        maxReschedules: 3
      });

      const policy = await bookingService.getPolicy('reschedule');
      expect(policy.rules.fee).toBe(10);
      expect(policy.rules.maxReschedules).toBe(3);
      expect(policy.rules.deadlineHours).toBe(12);
    });

    it('should enforce maxReschedules limit', async () => {
      await bookingService.createPolicy('reschedule', { maxReschedules: 1 });

      const booking = await bookingService.createBooking({ title: 'Max Test', totalAmount: 50 });
      // Manually set rescheduleCount to 1
      const raw = await db.get('bookings', booking.id);
      raw.rescheduleCount = 1;
      await db.put('bookings', raw);

      const check = await bookingService.checkReschedulePolicy(booking.id);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('Maximum');
    });

    it('should allow reschedule when under maxReschedules', async () => {
      await bookingService.createPolicy('reschedule', { maxReschedules: 3, fee: 5 });

      const booking = await bookingService.createBooking({ title: 'Under Max', totalAmount: 50 });
      const raw = await db.get('bookings', booking.id);
      raw.rescheduleCount = 2;
      await db.put('bookings', raw);

      const check = await bookingService.checkReschedulePolicy(booking.id);
      expect(check.allowed).toBe(true);
      expect(check.fee).toBe(5);
    });

    it('should apply late fee for reschedule within deadline', async () => {
      await bookingService.createPolicy('reschedule', {
        deadlineHours: 24,
        lateFee: 40,
        fee: 0
      });

      const booking = await bookingService.createBooking({
        title: 'Late Resched',
        totalAmount: 100,
        scheduledDate: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      });

      const check = await bookingService.checkReschedulePolicy(booking.id);
      expect(check.allowed).toBe(true);
      expect(check.fee).toBe(40);
      expect(check.reason).toContain('Late');
    });

    it('should block reschedule when blockLate and within deadline', async () => {
      await bookingService.createPolicy('reschedule', {
        deadlineHours: 24,
        blockLate: true
      });

      const booking = await bookingService.createBooking({
        title: 'Block Resched',
        totalAmount: 100,
        scheduledDate: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      });

      const check = await bookingService.checkReschedulePolicy(booking.id);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('not allowed');
    });
  });

  // ── Both Policies Together ─────────────────────────────────────────

  describe('Both policies coexist', () => {
    it('should list both policies independently', async () => {
      await bookingService.createPolicy('cancellation', { fee: 10 });
      await bookingService.createPolicy('reschedule', { fee: 5, maxReschedules: 2 });

      const policies = await bookingService.listPolicies();
      expect(policies).toHaveLength(2);
      const types = policies.map(p => p.type);
      expect(types).toContain('cancellation');
      expect(types).toContain('reschedule');
    });

    it('should enforce different rules per policy type on same booking', async () => {
      await bookingService.createPolicy('cancellation', { fee: 25 });
      await bookingService.createPolicy('reschedule', { fee: 10, maxReschedules: 0 });

      const booking = await bookingService.createBooking({
        title: 'Dual Policy',
        totalAmount: 100,
        scheduledDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()
      });
      await bookingService.transitionStatus(booking.id, 'pending');

      const cancel = await bookingService.checkCancellationPolicy(booking.id);
      expect(cancel.allowed).toBe(true);
      expect(cancel.fee).toBe(25);

      const resched = await bookingService.checkReschedulePolicy(booking.id);
      expect(resched.allowed).toBe(false); // maxReschedules=0
    });
  });
});
