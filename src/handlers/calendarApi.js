'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const CalendarDay = require('../models/CalendarDay');
const mongoose = require('mongoose');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function getPath(event) {
  return (event.rawPath || event.path || '').replace(/^\/api/, '') || '/';
}

function getMethod(event) {
  return (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
}

function parseBody(event) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  return body && typeof body === 'object' ? body : {};
}

function toObjectId(id) {
  if (id == null || id === '') return null;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch (_) {
    return null;
  }
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const religion = raw.religion != null ? String(raw.religion).trim().toLowerCase() : '';
  const type = raw.type != null ? String(raw.type).trim().toLowerCase() : '';
  const date = raw.date != null ? String(raw.date).trim() : '';
  if (!CalendarDay.RELIGIONS.includes(religion)) return null;
  if (!CalendarDay.DAY_TYPES.includes(type)) return null;
  if (!DATE_RE.test(date)) return null;
  return { religion, type, date };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

async function postCalendarDay(event) {
  const decoded = auth.requireRole(event, [auth.ROLES.ADMIN]);
  const body = parseBody(event);
  const item = sanitizeItem(body);
  if (!item) return res.error('religion (hindu|muslim|christian), type (most_auspicious|auspicious|less_auspicious), and date (YYYY-MM-DD) are required', 400);

  const existing = await CalendarDay.findOne({ religion: item.religion, date: item.date }).lean();
  if (existing) return res.error(`Entry already exists for ${item.religion} on ${item.date}`, 409);

  const doc = await CalendarDay.create({ ...item, createdBy: toObjectId(decoded.sub) });
  return res.success(doc, 201);
}

async function postBulkCalendarDays(event) {
  const decoded = auth.requireRole(event, [auth.ROLES.ADMIN]);
  const body = parseBody(event);
  const rawItems = Array.isArray(body.items) ? body.items : (Array.isArray(body) ? body : []);

  if (rawItems.length === 0) return res.error('items array is required and must not be empty', 400);
  if (rawItems.length > 500) return res.error('Maximum 500 items per bulk request', 400);

  const items = [];
  const errors = [];
  for (let i = 0; i < rawItems.length; i++) {
    const sanitized = sanitizeItem(rawItems[i]);
    if (!sanitized) {
      errors.push({ index: i, message: 'Invalid religion, type, or date format' });
      continue;
    }
    items.push({ ...sanitized, createdBy: toObjectId(decoded.sub) });
  }

  if (items.length === 0) return res.error('No valid items to create', 400);

  const docs = [];
  const skipped = [];
  for (const item of items) {
    try {
      const doc = await CalendarDay.findOneAndUpdate(
        { religion: item.religion, date: item.date },
        { $setOnInsert: item },
        { upsert: true, new: true, rawResult: true }
      );
      const isNew = doc.lastErrorObject?.updatedExisting === false;
      if (isNew) {
        docs.push(doc.value);
      } else {
        skipped.push({ religion: item.religion, date: item.date, reason: 'already exists' });
      }
    } catch (e) {
      if (e.code === 11000) {
        skipped.push({ religion: item.religion, date: item.date, reason: 'duplicate' });
      } else {
        throw e;
      }
    }
  }

  return res.success({ created: docs, skipped, errors }, docs.length > 0 ? 201 : 200);
}

async function getCalendarDays(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const qs = event.queryStringParameters || {};
  const match = {};

  if (qs.religion && CalendarDay.RELIGIONS.includes(qs.religion.toLowerCase())) {
    match.religion = qs.religion.toLowerCase();
  }
  if (qs.type && CalendarDay.DAY_TYPES.includes(qs.type.toLowerCase())) {
    match.type = qs.type.toLowerCase();
  }
  if (qs.year) {
    const y = String(qs.year);
    let datePattern = `^${y}`;
    if (qs.month) {
      const m = String(qs.month).padStart(2, '0');
      datePattern = `^${y}-${m}`;
    }
    match.date = { $regex: datePattern };
  }

  const list = await CalendarDay.aggregate([
    { $match: match },
    { $sort: { date: 1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'createdBy',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, email: 1, role: 1 } }],
        as: 'createdByUser',
      },
    },
    { $unwind: { path: '$createdByUser', preserveNullAndEmptyArrays: true } },
  ]);

  return res.success(list);
}

async function patchCalendarDay(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const id = event.pathParameters?.id ?? event.pathParameters?.Id;
  if (!id) return res.error('id required', 400);

  const oid = toObjectId(id);
  if (!oid) return res.error('Invalid id', 400);

  const body = parseBody(event);
  const update = {};

  if (body.religion !== undefined) {
    const r = String(body.religion).trim().toLowerCase();
    if (!CalendarDay.RELIGIONS.includes(r)) return res.error(`religion must be one of: ${CalendarDay.RELIGIONS.join(', ')}`, 400);
    update.religion = r;
  }
  if (body.type !== undefined) {
    const t = String(body.type).trim().toLowerCase();
    if (!CalendarDay.DAY_TYPES.includes(t)) return res.error(`type must be one of: ${CalendarDay.DAY_TYPES.join(', ')}`, 400);
    update.type = t;
  }
  if (body.date !== undefined) {
    const d = String(body.date).trim();
    if (!DATE_RE.test(d)) return res.error('date must be YYYY-MM-DD', 400);
    update.date = d;
  }

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await CalendarDay.findByIdAndUpdate(oid, { $set: update }, { new: true }).lean();
  if (!doc) return res.notFound('Calendar day not found');
  return res.success(doc);
}

async function deleteCalendarDay(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const id = event.pathParameters?.id ?? event.pathParameters?.Id;
  if (!id) return res.error('id required', 400);

  const oid = toObjectId(id);
  if (!oid) return res.error('Invalid id', 400);

  const deleted = await CalendarDay.findByIdAndDelete(oid).lean();
  if (!deleted) return res.notFound('Calendar day not found');
  return res.success({ deleted: true });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const routes = [
  { method: 'POST', path: '/calendar-days/bulk', fn: postBulkCalendarDays },
  { method: 'POST', path: '/calendar-days', fn: postCalendarDay },
  { method: 'GET', path: '/calendar-days', fn: getCalendarDays },
  { method: 'PATCH', path: '/calendar-days/{id}', fn: patchCalendarDay },
  { method: 'DELETE', path: '/calendar-days/{id}', fn: deleteCalendarDay },
];

function matchRoute(method, path) {
  const normalized = path.replace(/^\/api/, '') || '/';
  for (const r of routes) {
    if (r.method !== method) continue;
    const pattern = r.path.replace(/\{[\w]+\}/g, '[^/]+');
    if (new RegExp('^' + pattern + '$').test(normalized)) return r.fn;
  }
  return null;
}

async function handler(event, context) {
  const wrapped = res.withErrorHandler(async (evt) => {
    await connect();
    const method = getMethod(evt);
    const path = getPath(evt);
    const fn = matchRoute(method, path);
    if (!fn) return res.error('Not found', 404);
    return fn(evt);
  });
  return wrapped(event, context);
}

module.exports = { handler };
