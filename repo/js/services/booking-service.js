import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { sync } from '../core/sync.js';
import { uuid, now, escapeHTML, formatDateTime } from '../core/utils.js';

const ALLOWED_TRANSITIONS = {
  'draft': ['pending'],
  'pending': ['approved', 'canceled'],
  'approved': ['paid-marked', 'canceled'],
  'paid-marked': ['completed', 'refunding-marked'],
  'canceled': ['refunding-marked'],
  'refunding-marked': ['completed']
};

export const bookingService = {
  // ── Booking CRUD ──────────────────────────────────────────────────

  async createBooking(data) {
    const currentUser = store.get('currentUser');
    const booking = {
      id: uuid(),
      profileId: currentUser?.id || null,
      title: data.title,
      description: data.description || '',
      items: data.items || [],
      totalAmount: data.totalAmount || 0,
      scheduledDate: data.scheduledDate || null,
      status: 'draft',
      statusHistory: [
        { status: 'draft', timestamp: now(), note: 'Created' }
      ],
      createdAt: now(),
      updatedAt: now()
    };
    await db.put('bookings', booking);
    bus.emit('booking:created', booking);
    sync.broadcast({ type: 'db-change', store: 'bookings', key: booking.id, data: booking });
    return booking;
  },

  async transitionStatus(bookingId, toStatus, note = '') {
    const booking = await db.get('bookings', bookingId);
    if (!booking) throw new Error('Booking not found');

    const allowed = ALLOWED_TRANSITIONS[booking.status];
    if (!allowed || !allowed.includes(toStatus)) {
      throw new Error(
        `Cannot transition from "${booking.status}" to "${toStatus}". ` +
        `Allowed: ${(allowed || []).join(', ') || 'none'}`
      );
    }

    booking.status = toStatus;
    booking.statusHistory.push({ status: toStatus, timestamp: now(), note });
    booking.updatedAt = now();
    await db.put('bookings', booking);
    bus.emit('booking:status-changed', { bookingId, from: booking.statusHistory[booking.statusHistory.length - 2].status, to: toStatus });
    sync.broadcast({ type: 'db-change', store: 'bookings', key: booking.id, data: booking });
    return booking;
  },

  async getBooking(id) {
    return db.get('bookings', id);
  },

  async listBookings(options = {}) {
    const currentUser = store.get('currentUser');
    const profileId = options.profileId || currentUser?.id || null;
    let bookings;

    if (options.status) {
      bookings = await db.getAllByIndex('bookings', 'profileId_status', [profileId, options.status]);
    } else {
      bookings = await db.getAllByIndex('bookings', 'profileId', profileId);
    }

    bookings.sort((a, b) => b.updatedAt - a.updatedAt);

    if (options.limit) {
      bookings = bookings.slice(0, options.limit);
    }

    return bookings;
  },

  async updateBooking(id, data) {
    const booking = await db.get('bookings', id);
    if (!booking) throw new Error('Booking not found');
    if (booking.status !== 'draft') {
      throw new Error('Booking can only be updated in draft status');
    }

    const { id: _id, profileId: _pid, status: _s, statusHistory: _sh, createdAt: _ca, ...allowed } = data;
    Object.assign(booking, allowed, { updatedAt: now() });
    await db.put('bookings', booking);
    bus.emit('booking:updated', booking);
    sync.broadcast({ type: 'db-change', store: 'bookings', key: booking.id, data: booking });
    return booking;
  },

  async deleteBooking(id) {
    const booking = await db.get('bookings', id);
    if (!booking) throw new Error('Booking not found');
    if (booking.status !== 'draft') {
      throw new Error('Booking can only be deleted in draft status');
    }

    await db.delete('bookings', id);
    bus.emit('booking:deleted', { id });
    sync.broadcast({ type: 'db-change', store: 'bookings', key: id, action: 'delete' });
  },

  async getStatusHistory(id) {
    const booking = await db.get('bookings', id);
    if (!booking) throw new Error('Booking not found');
    return booking.statusHistory;
  },

  // ── Policies ──────────────────────────────────────────────────────

  async createPolicy(type, rules) {
    const policy = {
      id: type,
      type,
      rules,
      createdAt: now(),
      updatedAt: now()
    };
    await db.put('bookingPolicies', policy);
    bus.emit('booking:policy-created', policy);
    return policy;
  },

  async getPolicy(type) {
    return db.get('bookingPolicies', type);
  },

  async listPolicies() {
    return db.getAll('bookingPolicies');
  },

  async checkCancellationPolicy(bookingId) {
    const booking = await db.get('bookings', bookingId);
    if (!booking) throw new Error('Booking not found');

    const policy = await db.get('bookingPolicies', 'cancellation');
    if (!policy) {
      return { allowed: true, reason: 'No cancellation policy configured', fee: 0 };
    }

    const rules = policy.rules;
    const scheduled = booking.scheduledDate ? new Date(booking.scheduledDate).getTime() : null;
    const currentTime = now();

    // Check if cancellation is allowed based on status
    const allowed = ALLOWED_TRANSITIONS[booking.status];
    if (!allowed || !allowed.includes('canceled')) {
      // Special case: canceled can transition to refunding-marked if was paid
      if (booking.status === 'canceled') {
        return { allowed: false, reason: 'Booking is already canceled', fee: 0 };
      }
      return { allowed: false, reason: `Cannot cancel a booking in "${booking.status}" status`, fee: 0 };
    }

    // Check deadline rule (hours before scheduled date)
    if (rules.deadlineHours && scheduled) {
      const deadlineMs = rules.deadlineHours * 60 * 60 * 1000;
      const timeUntil = scheduled - currentTime;
      if (timeUntil < deadlineMs) {
        if (rules.lateFee) {
          return { allowed: true, reason: `Late cancellation — within ${rules.deadlineHours}h of scheduled date`, fee: rules.lateFee };
        }
        if (rules.blockLate) {
          return { allowed: false, reason: `Cancellation not allowed within ${rules.deadlineHours}h of scheduled date`, fee: 0 };
        }
      }
    }

    const fee = rules.fee || 0;
    return { allowed: true, reason: 'Cancellation allowed per policy', fee };
  },

  async checkReschedulePolicy(bookingId) {
    const booking = await db.get('bookings', bookingId);
    if (!booking) throw new Error('Booking not found');

    const policy = await db.get('bookingPolicies', 'reschedule');
    if (!policy) {
      return { allowed: true, reason: 'No reschedule policy configured', fee: 0 };
    }

    const rules = policy.rules;
    const scheduled = booking.scheduledDate ? new Date(booking.scheduledDate).getTime() : null;
    const currentTime = now();

    // Only draft and pending bookings can be rescheduled
    if (booking.status !== 'draft' && booking.status !== 'pending' && booking.status !== 'approved') {
      return { allowed: false, reason: `Cannot reschedule a booking in "${booking.status}" status`, fee: 0 };
    }

    // Check max reschedule count
    if (rules.maxReschedules != null) {
      const rescheduleCount = (booking.rescheduleCount || 0);
      if (rescheduleCount >= rules.maxReschedules) {
        return { allowed: false, reason: `Maximum reschedules (${rules.maxReschedules}) exceeded`, fee: 0 };
      }
    }

    // Check deadline rule
    if (rules.deadlineHours && scheduled) {
      const deadlineMs = rules.deadlineHours * 60 * 60 * 1000;
      const timeUntil = scheduled - currentTime;
      if (timeUntil < deadlineMs) {
        if (rules.lateFee) {
          return { allowed: true, reason: `Late reschedule — within ${rules.deadlineHours}h of scheduled date`, fee: rules.lateFee };
        }
        if (rules.blockLate) {
          return { allowed: false, reason: `Reschedule not allowed within ${rules.deadlineHours}h of scheduled date`, fee: 0 };
        }
      }
    }

    const fee = rules.fee || 0;
    return { allowed: true, reason: 'Reschedule allowed per policy', fee };
  },

  // ── Receipt & Export ──────────────────────────────────────────────

  async generateReceipt(bookingId) {
    const booking = await db.get('bookings', bookingId);
    if (!booking) throw new Error('Booking not found');

    const itemRows = booking.items.map(item => `
      <tr>
        <td>${escapeHTML(item.name || item.description || '')}</td>
        <td>${item.quantity || 1}</td>
        <td>${(item.unitPrice || 0).toFixed(2)}</td>
        <td>${((item.quantity || 1) * (item.unitPrice || 0)).toFixed(2)}</td>
      </tr>
    `).join('');

    const historyRows = booking.statusHistory.map(entry => `
      <tr>
        <td>${escapeHTML(entry.status)}</td>
        <td>${formatDateTime(entry.timestamp)}</td>
        <td>${escapeHTML(entry.note || '')}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Receipt — ${escapeHTML(booking.title)}</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { font-size: 1.4rem; margin-bottom: 0.25rem; }
    .meta { color: #555; font-size: 0.9rem; margin-bottom: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
    th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .total { font-weight: bold; font-size: 1.1rem; text-align: right; margin-bottom: 1.5rem; }
    .status { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; background: #e0e0e0; font-size: 0.85rem; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <h1>Receipt</h1>
  <div class="meta">
    <div><strong>Booking:</strong> ${escapeHTML(booking.title)}</div>
    <div><strong>ID:</strong> ${escapeHTML(booking.id)}</div>
    <div><strong>Status:</strong> <span class="status">${escapeHTML(booking.status)}</span></div>
    <div><strong>Created:</strong> ${formatDateTime(booking.createdAt)}</div>
    ${booking.scheduledDate ? `<div><strong>Scheduled:</strong> ${escapeHTML(booking.scheduledDate)}</div>` : ''}
    ${booking.description ? `<div><strong>Description:</strong> ${escapeHTML(booking.description)}</div>` : ''}
  </div>

  <h2>Items</h2>
  <table>
    <thead>
      <tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="4">No items</td></tr>'}
    </tbody>
  </table>

  <div class="total">Total: ${booking.totalAmount.toFixed(2)}</div>

  <h2>Status History</h2>
  <table>
    <thead>
      <tr><th>Status</th><th>Date</th><th>Note</th></tr>
    </thead>
    <tbody>
      ${historyRows}
    </tbody>
  </table>
</body>
</html>`;
  },

  async exportBookingsCSV(options = {}) {
    const currentUser = store.get('currentUser');
    const profileId = currentUser?.id || null;
    let bookings;

    if (options.status) {
      bookings = await db.getAllByIndex('bookings', 'profileId_status', [profileId, options.status]);
    } else {
      bookings = await db.getAllByIndex('bookings', 'profileId', profileId);
    }

    if (options.since) {
      bookings = bookings.filter(b => b.createdAt >= options.since);
    }
    if (options.until) {
      bookings = bookings.filter(b => b.createdAt <= options.until);
    }

    bookings.sort((a, b) => b.createdAt - a.createdAt);

    const csvEscape = (val) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const header = ['ID', 'Title', 'Description', 'Status', 'Total Amount', 'Scheduled Date', 'Items Count', 'Created At', 'Updated At'];
    const rows = bookings.map(b => [
      csvEscape(b.id),
      csvEscape(b.title),
      csvEscape(b.description),
      csvEscape(b.status),
      csvEscape(b.totalAmount),
      csvEscape(b.scheduledDate || ''),
      csvEscape((b.items || []).length),
      csvEscape(formatDateTime(b.createdAt)),
      csvEscape(formatDateTime(b.updatedAt))
    ]);

    return [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
};
