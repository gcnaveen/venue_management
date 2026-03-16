'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const Lead = require('../models/Lead');
const mongoose = require('mongoose');

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

function parsePathParams(event) {
  const p = event.pathParameters || {};
  return {
    venueId: p.venueId ?? p.venueid,
    leadId: p.leadId ?? p.leadid,
  };
}

function toObjectId(id) {
  if (id == null || id === '') return null;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch (_) {
    return null;
  }
}

async function resolveVenueAccess(event) {
  const decoded = auth.requireAuth(event);
  const User = require('../models/User');
  const u = await User.findById(decoded.sub).select('venueId role').lean();
  if (!u) {
    const err = new Error('User not found');
    err.statusCode = 401;
    throw err;
  }
  return { userId: u._id, role: u.role || decoded.role, venueId: u.venueId };
}

async function assertVenueAccess(event, venueId) {
  const decoded = auth.requireAuth(event);
  if (decoded.role === auth.ROLES.ADMIN) return decoded;
  if (decoded.role === auth.ROLES.INCHARGE) {
    const User = require('../models/User');
    const u = await User.findById(decoded.sub).select('venueId').lean();
    if (u?.venueId?.toString() !== String(venueId)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    return decoded;
  }
  const err = new Error('Forbidden');
  err.statusCode = 403;
  throw err;
}

function sanitizeContact(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.name != null ? String(raw.name).trim() : '';
  const phone = raw.phone != null ? String(raw.phone).trim() : '';
  if (!name || !phone) return null;
  return {
    name,
    phone,
    altPhone: raw.altPhone != null ? String(raw.altPhone).trim() : '',
  };
}

function sanitizeSpecialDay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startAt = raw.startAt ? new Date(raw.startAt) : null;
  const endAt = raw.endAt ? new Date(raw.endAt) : null;
  const durationHours = Number.isFinite(Number(raw.durationHours)) ? Number(raw.durationHours) : null;
  if (!startAt || isNaN(startAt.getTime()) || !endAt || isNaN(endAt.getTime()) || !durationHours) return null;
  return { startAt, endAt, durationHours };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

async function postLead(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  const decoded = await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const body = parseBody(event);

  const eventType = body.eventType != null ? String(body.eventType).trim().toLowerCase() : '';
  if (!eventType || !Lead.EVENT_TYPES.includes(eventType)) {
    return res.error(`eventType must be one of: ${Lead.EVENT_TYPES.join(', ')}`, 400);
  }

  const specialDay = sanitizeSpecialDay(body.specialDay);
  if (!specialDay) return res.error('specialDay with startAt, endAt, durationHours is required', 400);

  const contact = sanitizeContact(body.contact);
  if (!contact) return res.error('contact with name and phone is required', 400);

  const doc = await Lead.create({
    venueId: vid,
    createdBy: toObjectId(decoded.sub),
    eventType,
    eventTypeOther: eventType === 'other' && body.eventTypeOther ? String(body.eventTypeOther).trim() : '',
    specialDay,
    expectedGuests: Number.isFinite(Number(body.expectedGuests)) ? Number(body.expectedGuests) : null,
    contact,
    status: 'new',
    notes: body.notes != null ? String(body.notes).trim() : '',
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
  });

  return res.success(doc, 201);
}

async function getLeads(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const qs = event.queryStringParameters || {};
  const match = { venueId: vid };
  if (qs.status && Lead.LEAD_STATUSES.includes(qs.status)) match.status = qs.status;

  const list = await Lead.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'createdBy',
        foreignField: '_id',
        pipeline: [{ $project: { password: 0 } }],
        as: 'createdByUser',
      },
    },
    { $unwind: { path: '$createdByUser', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'venues',
        localField: 'venueId',
        foreignField: '_id',
        as: 'venue',
      },
    },
    { $unwind: { path: '$venue', preserveNullAndEmptyArrays: true } },
  ]);

  return res.success(list);
}

async function getConfirmedLeads(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  // "Confirmed leads" = leads for this venue that have at least one confirmed quote.
  const list = await Lead.aggregate([
    { $match: { venueId: vid } },
    {
      $lookup: {
        from: 'quotes',
        localField: '_id',
        foreignField: 'leadId',
        pipeline: [{ $match: { confirmed: true } }],
        as: 'confirmedQuotes',
      },
    },
    { $addFields: { confirmedQuoteCount: { $size: '$confirmedQuotes' } } },
    { $match: { confirmedQuoteCount: { $gt: 0 } } },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: 'createdBy',
        foreignField: '_id',
        pipeline: [{ $project: { password: 0 } }],
        as: 'createdByUser',
      },
    },
    { $unwind: { path: '$createdByUser', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'venues',
        localField: 'venueId',
        foreignField: '_id',
        as: 'venue',
      },
    },
    { $unwind: { path: '$venue', preserveNullAndEmptyArrays: true } },
    { $project: { confirmedQuotes: 0, confirmedQuoteCount: 0 } },
  ]);

  return res.success(list);
}

async function getLeadById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const list = await Lead.aggregate([
    { $match: { _id: lid, venueId: vid } },
    {
      $lookup: {
        from: 'users',
        localField: 'createdBy',
        foreignField: '_id',
        pipeline: [{ $project: { password: 0 } }],
        as: 'createdByUser',
      },
    },
    { $unwind: { path: '$createdByUser', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'venues',
        localField: 'venueId',
        foreignField: '_id',
        as: 'venue',
      },
    },
    { $unwind: { path: '$venue', preserveNullAndEmptyArrays: true } },
  ]);

  const doc = list[0];
  if (!doc) return res.notFound('Lead not found');
  return res.success(doc);
}

async function patchLead(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const body = parseBody(event);
  const update = {};

  if (body.eventType !== undefined) {
    const et = String(body.eventType).trim().toLowerCase();
    if (!Lead.EVENT_TYPES.includes(et)) return res.error(`eventType must be one of: ${Lead.EVENT_TYPES.join(', ')}`, 400);
    update.eventType = et;
  }
  if (body.eventTypeOther !== undefined) update.eventTypeOther = String(body.eventTypeOther).trim();
  if (body.specialDay !== undefined) {
    const sd = sanitizeSpecialDay(body.specialDay);
    if (!sd) return res.error('specialDay requires startAt, endAt, durationHours', 400);
    update.specialDay = sd;
  }
  if (body.expectedGuests !== undefined) {
    update.expectedGuests = Number.isFinite(Number(body.expectedGuests)) ? Number(body.expectedGuests) : null;
  }
  if (body.contact !== undefined) {
    const c = sanitizeContact(body.contact);
    if (!c) return res.error('contact requires name and phone', 400);
    update.contact = c;
  }
  if (body.status !== undefined) {
    const s = String(body.status).trim().toLowerCase();
    if (!Lead.LEAD_STATUSES.includes(s)) return res.error(`status must be one of: ${Lead.LEAD_STATUSES.join(', ')}`, 400);
    update.status = s;
  }
  if (body.notes !== undefined) update.notes = String(body.notes).trim();
  if (body.metadata !== undefined && typeof body.metadata === 'object') update.metadata = body.metadata;

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await Lead.findOneAndUpdate(
    { _id: lid, venueId: vid },
    { $set: update },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Lead not found');
  return res.success(doc);
}

async function deleteLead(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const deleted = await Lead.findOneAndDelete({ _id: lid, venueId: vid }).lean();
  if (!deleted) return res.notFound('Lead not found');
  return res.success({ deleted: true });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const routes = [
  { method: 'POST', path: '/venues/{venueId}/leads', fn: postLead },
  { method: 'GET', path: '/venues/{venueId}/leads', fn: getLeads },
  { method: 'GET', path: '/venues/{venueId}/leads/confirmed', fn: getConfirmedLeads },
  { method: 'GET', path: '/venues/{venueId}/leads/{leadId}', fn: getLeadById },
  { method: 'PATCH', path: '/venues/{venueId}/leads/{leadId}', fn: patchLead },
  { method: 'DELETE', path: '/venues/{venueId}/leads/{leadId}', fn: deleteLead },
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
