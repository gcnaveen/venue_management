'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const Quote = require('../models/Quote');
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
    quoteId: p.quoteId ?? p.quoteid,
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

// ─── Sanitizers ─────────────────────────────────────────────────────────────

function sanitizeEventWindow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const startAt = raw.startAt ? new Date(raw.startAt) : null;
  const endAt = raw.endAt ? new Date(raw.endAt) : null;
  const durationHours = Number.isFinite(Number(raw.durationHours)) ? Number(raw.durationHours) : null;
  if (!startAt || isNaN(startAt.getTime()) || !endAt || isNaN(endAt.getTime()) || !durationHours) return null;
  return { startAt, endAt, durationHours };
}

function sanitizeInclusions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(i => i && typeof i === 'object' && String(i.name || '').trim())
    .map(i => ({
      name: String(i.name).trim(),
      quantity: Number.isFinite(Number(i.quantity)) ? Number(i.quantity) : 1,
      maxQuantity: Number.isFinite(Number(i.maxQuantity)) ? Number(i.maxQuantity) : null,
    }));
}

function sanitizeAddons(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(i => i && typeof i === 'object' && String(i.name || '').trim())
    .map(i => ({
      name: String(i.name).trim(),
      quantity: Number.isFinite(Number(i.quantity)) ? Number(i.quantity) : 1,
      unitPrice: Number.isFinite(Number(i.unitPrice)) ? Number(i.unitPrice) : 0,
    }));
}

function sanitizeTotals(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const keys = ['venueBase', 'venueGst', 'addonTotal', 'addonGst', 'subtotal', 'discount', 'total'];
  const out = {};
  for (const k of keys) out[k] = Number.isFinite(Number(raw[k])) ? Number(raw[k]) : 0;
  return out;
}

function sanitizePricing(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const basePrice = Number.isFinite(Number(raw.basePrice)) ? Number(raw.basePrice) : null;
  if (basePrice == null) return null;
  return {
    basePrice,
    inclusions: sanitizeInclusions(raw.inclusions),
    addons: sanitizeAddons(raw.addons),
    gstRate: Number.isFinite(Number(raw.gstRate)) ? Number(raw.gstRate) : 0.18,
    discount: Number.isFinite(Number(raw.discount)) ? Number(raw.discount) : 0,
    totals: sanitizeTotals(raw.totals),
  };
}

/** Enforce draft/confirmed invariant and derive status. */
function resolveFlags(draft, confirmed, currentStatus) {
  let d = draft;
  let c = confirmed;
  if (c === true) d = false;
  if (d === true) c = false;
  let status = currentStatus || 'draft';
  if (d) status = 'draft';
  if (c && status === 'draft') status = 'shared';
  return { draft: d, confirmed: c, status };
}

// ─── Aggregation helper ─────────────────────────────────────────────────────

function quoteAggregationPipeline(match) {
  return [
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'leads',
        localField: 'leadId',
        foreignField: '_id',
        as: 'lead',
      },
    },
    { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'venues',
        localField: 'venueId',
        foreignField: '_id',
        as: 'venue',
      },
    },
    { $unwind: { path: '$venue', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'spaces',
        localField: 'spaceId',
        foreignField: '_id',
        as: 'space',
      },
    },
    { $unwind: { path: '$space', preserveNullAndEmptyArrays: true } },
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
  ];
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

async function postQuote(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  if (!leadId) return res.error('leadId required', 400);
  const decoded = await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const lead = await Lead.findOne({ _id: lid, venueId: vid }).lean();
  if (!lead) return res.notFound('Lead not found for this venue');

  const body = parseBody(event);

  const bookingType = body.bookingType != null ? String(body.bookingType).trim() : '';
  if (!Quote.BOOKING_TYPES.includes(bookingType)) {
    return res.error(`bookingType must be one of: ${Quote.BOOKING_TYPES.join(', ')}`, 400);
  }

  let spaceId = null;
  if (bookingType === 'space_buyout') {
    spaceId = toObjectId(body.spaceId);
    if (!spaceId) return res.error('spaceId is required for space_buyout', 400);
  }

  const eventWindow = sanitizeEventWindow(body.eventWindow);
  if (!eventWindow) return res.error('eventWindow with startAt, endAt, durationHours is required', 400);

  const pricing = sanitizePricing(body.pricing);
  if (!pricing) return res.error('pricing with basePrice is required', 400);

  const isDraft = body.draft !== false;
  const isConfirmed = body.confirmed === true;
  const { draft, confirmed, status } = resolveFlags(isDraft, isConfirmed, 'draft');

  const doc = await Quote.create({
    leadId: lid,
    venueId: vid,
    createdBy: toObjectId(decoded.sub),
    bookingType,
    spaceId,
    eventWindow,
    pricing,
    draft,
    confirmed,
    status,
  });

  return res.success(doc, 201);
}

async function getQuotes(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const match = { venueId: vid };

  if (leadId) {
    const lid = toObjectId(leadId);
    if (!lid) return res.error('Invalid leadId', 400);
    match.leadId = lid;
  }

  const qs = event.queryStringParameters || {};
  if (qs.status && Quote.QUOTE_STATUSES.includes(qs.status)) match.status = qs.status;
  if (qs.draft === 'true') match.draft = true;
  if (qs.draft === 'false') match.draft = false;
  if (qs.confirmed === 'true') match.confirmed = true;

  const list = await Quote.aggregate(quoteAggregationPipeline(match));
  return res.success(list);
}

async function getQuoteById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, quoteId } = parsePathParams(event);
  if (!venueId || !quoteId) return res.error('venueId and quoteId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const qid = toObjectId(quoteId);
  if (!vid || !qid) return res.error('Invalid venueId or quoteId', 400);

  const match = { _id: qid, venueId: vid };
  if (leadId) {
    const lid = toObjectId(leadId);
    if (lid) match.leadId = lid;
  }

  const list = await Quote.aggregate(quoteAggregationPipeline(match));
  const doc = list[0];
  if (!doc) return res.notFound('Quote not found');
  return res.success(doc);
}

async function patchQuote(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, quoteId } = parsePathParams(event);
  if (!venueId || !quoteId) return res.error('venueId and quoteId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const qid = toObjectId(quoteId);
  if (!vid || !qid) return res.error('Invalid venueId or quoteId', 400);

  const matchQ = { _id: qid, venueId: vid };
  if (leadId) {
    const lid = toObjectId(leadId);
    if (lid) matchQ.leadId = lid;
  }

  const existing = await Quote.findOne(matchQ).lean();
  if (!existing) return res.notFound('Quote not found');

  const body = parseBody(event);
  const update = {};

  if (body.bookingType !== undefined) {
    const bt = String(body.bookingType).trim();
    if (!Quote.BOOKING_TYPES.includes(bt)) return res.error(`bookingType must be one of: ${Quote.BOOKING_TYPES.join(', ')}`, 400);
    update.bookingType = bt;
  }
  if (body.spaceId !== undefined) {
    update.spaceId = body.spaceId ? toObjectId(body.spaceId) : null;
  }
  if (body.eventWindow !== undefined) {
    const ew = sanitizeEventWindow(body.eventWindow);
    if (!ew) return res.error('eventWindow requires startAt, endAt, durationHours', 400);
    update.eventWindow = ew;
  }
  if (body.pricing !== undefined) {
    const p = sanitizePricing(body.pricing);
    if (!p) return res.error('pricing requires basePrice', 400);
    update.pricing = p;
  }

  const draftVal = body.draft !== undefined ? Boolean(body.draft) : existing.draft;
  const confirmedVal = body.confirmed !== undefined ? Boolean(body.confirmed) : existing.confirmed;
  const statusVal = body.status && Quote.QUOTE_STATUSES.includes(body.status) ? body.status : existing.status;

  const flags = resolveFlags(draftVal, confirmedVal, statusVal);
  update.draft = flags.draft;
  update.confirmed = flags.confirmed;
  update.status = flags.status;

  const doc = await Quote.findOneAndUpdate(
    matchQ,
    { $set: update },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Quote not found');
  return res.success(doc);
}

async function deleteQuote(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, quoteId } = parsePathParams(event);
  if (!venueId || !quoteId) return res.error('venueId and quoteId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const qid = toObjectId(quoteId);
  if (!vid || !qid) return res.error('Invalid venueId or quoteId', 400);

  const matchQ = { _id: qid, venueId: vid };
  if (leadId) {
    const lid = toObjectId(leadId);
    if (lid) matchQ.leadId = lid;
  }

  const deleted = await Quote.findOneAndDelete(matchQ).lean();
  if (!deleted) return res.notFound('Quote not found');
  return res.success({ deleted: true });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

const routes = [
  // Nested under lead
  { method: 'POST', path: '/venues/{venueId}/leads/{leadId}/quotes', fn: postQuote },
  { method: 'GET', path: '/venues/{venueId}/leads/{leadId}/quotes', fn: getQuotes },
  { method: 'GET', path: '/venues/{venueId}/leads/{leadId}/quotes/{quoteId}', fn: getQuoteById },
  { method: 'PATCH', path: '/venues/{venueId}/leads/{leadId}/quotes/{quoteId}', fn: patchQuote },
  { method: 'DELETE', path: '/venues/{venueId}/leads/{leadId}/quotes/{quoteId}', fn: deleteQuote },
  // Venue-level (all quotes for a venue)
  { method: 'GET', path: '/venues/{venueId}/quotes', fn: getQuotes },
  { method: 'GET', path: '/venues/{venueId}/quotes/{quoteId}', fn: getQuoteById },
  { method: 'PATCH', path: '/venues/{venueId}/quotes/{quoteId}', fn: patchQuote },
  { method: 'DELETE', path: '/venues/{venueId}/quotes/{quoteId}', fn: deleteQuote },
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
