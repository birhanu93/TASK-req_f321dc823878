import { db } from '../core/db.js';
import { bus } from '../core/event-bus.js';
import { store } from '../core/store.js';
import { uuid, now } from '../core/utils.js';

export const opsService = {
  // ── Announcements ──────────────────────────────────────────────────

  async createAnnouncement(title, body, bgColor = '#1e40af', textColor = '#ffffff') {
    const announcement = {
      id: uuid(),
      title,
      body,
      bgColor,
      textColor,
      active: true,
      createdAt: now(),
      updatedAt: now()
    };
    await db.put('opsAnnouncements', announcement);
    bus.emit('ops:announcement-created', announcement);
    return announcement;
  },

  async updateAnnouncement(id, data) {
    const announcement = await db.get('opsAnnouncements', id);
    if (!announcement) throw new Error('Announcement not found');
    const { id: _id, createdAt: _ca, ...allowed } = data;
    Object.assign(announcement, allowed, { updatedAt: now() });
    await db.put('opsAnnouncements', announcement);
    bus.emit('ops:announcement-updated', announcement);
    return announcement;
  },

  async deleteAnnouncement(id) {
    await db.delete('opsAnnouncements', id);
  },

  async getActiveAnnouncement() {
    let active;
    try {
      active = await db.getAllByIndex('opsAnnouncements', 'active', true);
    } catch {
      // Fallback: boolean index keys not supported in all environments
      const all = await db.getAll('opsAnnouncements');
      active = all.filter(a => a.active);
    }
    if (active.length === 0) return null;
    active.sort((a, b) => b.createdAt - a.createdAt);
    return active[0];
  },

  async listAnnouncements() {
    const all = await db.getAll('opsAnnouncements');
    return all.sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Templates ──────────────────────────────────────────────────────

  async createTemplate(name, category, data, thumbnail = null) {
    const all = await db.getAll('opsTemplates');
    const maxOrder = all.reduce((max, t) => Math.max(max, t.sortOrder || 0), 0);

    const template = {
      id: uuid(),
      name,
      category,
      data,
      thumbnail,
      sortOrder: maxOrder + 1,
      createdAt: now(),
      updatedAt: now()
    };
    await db.put('opsTemplates', template);
    return template;
  },

  async updateTemplate(id, data) {
    const template = await db.get('opsTemplates', id);
    if (!template) throw new Error('Template not found');
    const { id: _id, createdAt: _ca, ...allowed } = data;
    Object.assign(template, allowed, { updatedAt: now() });
    await db.put('opsTemplates', template);
    return template;
  },

  async deleteTemplate(id) {
    await db.delete('opsTemplates', id);
  },

  async listTemplates(category) {
    const all = await db.getAll('opsTemplates');
    let filtered = category
      ? all.filter(t => t.category === category)
      : all;
    return filtered.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  },

  async reorderTemplates(orderedIds) {
    const updates = orderedIds.map((id, index) =>
      db.get('opsTemplates', id).then(template => {
        if (!template) return null;
        template.sortOrder = index;
        template.updatedAt = now();
        return template;
      })
    );
    const templates = (await Promise.all(updates)).filter(Boolean);
    if (templates.length > 0) {
      await db.putBatch('opsTemplates', templates);
    }
  },

  // ── Rules ──────────────────────────────────────────────────────────

  async createRule(title, body, category) {
    const rule = {
      id: uuid(),
      title,
      body,
      category,
      active: true,
      createdAt: now(),
      updatedAt: now()
    };
    await db.put('opsRules', rule);
    return rule;
  },

  async updateRule(id, data) {
    const rule = await db.get('opsRules', id);
    if (!rule) throw new Error('Rule not found');
    const { id: _id, createdAt: _ca, ...allowed } = data;
    Object.assign(rule, allowed, { updatedAt: now() });
    await db.put('opsRules', rule);
    return rule;
  },

  async deleteRule(id) {
    await db.delete('opsRules', id);
  },

  async listRules(category, includeInactive = false) {
    const all = await db.getAll('opsRules');
    let filtered = all;
    if (!includeInactive) {
      filtered = filtered.filter(r => r.active);
    }
    if (category) {
      filtered = filtered.filter(r => r.category === category);
    }
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  },

  // ── Canary Flags ───────────────────────────────────────────────────

  async setFlag(key, enabled, description = '') {
    const existing = await db.get('canaryFlags', key);
    const flag = {
      key,
      enabled,
      description: description || existing?.description || '',
      updatedAt: now(),
      createdAt: existing?.createdAt || now()
    };
    await db.put('canaryFlags', flag);
    return flag;
  },

  async getFlag(key) {
    return db.get('canaryFlags', key);
  },

  async listFlags() {
    return db.getAll('canaryFlags');
  },

  async isEnabled(key) {
    const flag = await db.get('canaryFlags', key);
    return flag ? !!flag.enabled : false;
  },

  // ── Analytics ──────────────────────────────────────────────────────

  async trackEvent(event, properties = {}) {
    const sessionId = store.get('sessionId') || store.get('currentUser')?.sessionId || null;
    const entry = {
      id: uuid(),
      event,
      properties,
      sessionId,
      timestamp: now()
    };
    await db.put('analyticsEvents', entry);
    return entry;
  },

  async getEvents(options = {}) {
    const { event, since, until, limit } = options;
    let events;

    if (event) {
      events = await db.getAllByIndex('analyticsEvents', 'event', event);
    } else {
      events = await db.getAll('analyticsEvents');
    }

    if (since) {
      events = events.filter(e => e.timestamp >= since);
    }
    if (until) {
      events = events.filter(e => e.timestamp <= until);
    }

    events.sort((a, b) => b.timestamp - a.timestamp);

    if (limit && limit > 0) {
      events = events.slice(0, limit);
    }

    return events;
  },

  async getFunnelData(steps) {
    const allEvents = await db.getAll('analyticsEvents');

    return steps.map((stepName, index) => {
      const matching = allEvents.filter(e => e.event === stepName);
      const uniqueSessions = new Set(matching.map(e => e.sessionId).filter(Boolean));
      const count = uniqueSessions.size;
      const firstStepCount = index === 0 ? count : null;

      return {
        step: stepName,
        count,
        rate: index === 0
          ? 1
          : (steps._firstCount > 0 ? count / steps._firstCount : 0)
      };
    }).map((item, index, arr) => {
      // Recalculate rate based on actual first step count
      const firstCount = arr[0].count;
      return {
        step: item.step,
        count: item.count,
        rate: firstCount > 0 ? item.count / firstCount : 0
      };
    });
  },

  async clearEvents(before) {
    const allEvents = await db.getAll('analyticsEvents');
    const toDelete = allEvents
      .filter(e => e.timestamp < before)
      .map(e => e.id);
    if (toDelete.length > 0) {
      await db.deleteBatch('analyticsEvents', toDelete);
    }
    return toDelete.length;
  }
};
