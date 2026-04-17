'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const Lead = require('../models/Lead');
const Quote = require('../models/Quote');
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
  if (decoded.role === auth.ROLES.INCHARGE || decoded.role === auth.ROLES.OWNER) {
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
    namePrefix: raw.namePrefix != null ? String(raw.namePrefix).trim().toLowerCase() : '',
    name,
    clientName: raw.clientName != null ? String(raw.clientName).trim() : '',
    brideName: raw.brideName != null ? String(raw.brideName).trim() : '',
    groomName: raw.groomName != null ? String(raw.groomName).trim() : '',
    email: raw.email != null ? String(raw.email).trim() : '',
    stateCityAddress: raw.stateCityAddress != null ? String(raw.stateCityAddress).trim() : '',
    pan: raw.pan != null ? String(raw.pan).trim().toUpperCase() : '',
    gst: raw.gst != null ? String(raw.gst).trim().toUpperCase() : '',
    companyName: raw.companyName != null ? String(raw.companyName).trim() : '',
    referredBy: raw.referredBy != null ? String(raw.referredBy).trim() : '',
    referredByPhone: raw.referredByPhone != null ? String(raw.referredByPhone).trim() : '',
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

function getReferencePeriodStart(specialDay) {
  const source = specialDay?.startAt instanceof Date ? specialDay.startAt : new Date();
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + 1;
  return { year, month };
}

async function generateLeadReferenceCode(venueId, specialDay) {
  const { year, month } = getReferencePeriodStart(specialDay);
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, '0');
  const venueSuffix = String(venueId).slice(-4).toUpperCase();
  const prefix = `LD-${yy}${mm}-${venueSuffix}-`;

  const last = await Lead.findOne({
    venueId,
    referenceCode: { $regex: `^${prefix}` },
  })
    .sort({ referenceCode: -1 })
    .select('referenceCode')
    .lean();

  let next = 1;
  if (last?.referenceCode) {
    const parts = String(last.referenceCode).split('-');
    const maybeSeq = Number(parts[parts.length - 1]);
    if (Number.isInteger(maybeSeq) && maybeSeq > 0) next = maybeSeq + 1;
  }

  return `${prefix}${String(next).padStart(4, '0')}`;
}

function sanitizeMeetings(raw) {
  if (!Array.isArray(raw)) return null;
  const meetings = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const meetingAt = item.meetingAt ? new Date(item.meetingAt) : null;
    if (!meetingAt || isNaN(meetingAt.getTime())) return null;
    meetings.push({
      meetingAt,
      notes: item.notes != null ? String(item.notes).trim() : '',
    });
  }
  return meetings;
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

  let doc = null;
  let attempts = 0;
  while (!doc && attempts < 5) {
    attempts += 1;
    const referenceCode = await generateLeadReferenceCode(vid, specialDay);
    try {
      doc = await Lead.create({
        venueId: vid,
        createdBy: toObjectId(decoded.sub),
        referenceCode,
        eventType,
        eventTypeOther: eventType === 'other' && body.eventTypeOther ? String(body.eventTypeOther).trim() : '',
        specialDay,
        expectedGuests: Number.isFinite(Number(body.expectedGuests)) ? Number(body.expectedGuests) : null,
        eventStatus:
          body.eventStatus && Lead.EVENT_STATUSES.includes(String(body.eventStatus).trim().toLowerCase())
            ? String(body.eventStatus).trim().toLowerCase()
            : 'not_started',
        meetings: body.meetings !== undefined ? (sanitizeMeetings(body.meetings) || []) : [],
        contact,
        status: 'new',
        notes: body.notes != null ? String(body.notes).trim() : '',
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }
  if (!doc) return res.error('Could not generate unique lead reference code', 500);

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

  const qs = event.queryStringParameters || {};
  const bookingType = qs.bookingType ? String(qs.bookingType).trim() : '';
  if (bookingType && !Quote.BOOKING_TYPES.includes(bookingType)) {
    return res.error(`bookingType must be one of: ${Quote.BOOKING_TYPES.join(', ')}`, 400);
  }

  const confirmedQuoteMatch = { confirmed: true };
  if (bookingType) confirmedQuoteMatch.bookingType = bookingType;

  // "Confirmed leads" = leads for this venue that have at least one confirmed quote.
  const list = await Lead.aggregate([
    { $match: { venueId: vid } },
    {
      $lookup: {
        from: 'quotes',
        localField: '_id',
        foreignField: 'leadId',
        pipeline: [{ $match: confirmedQuoteMatch }],
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

async function getConfirmedStats(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const qs = event.queryStringParameters || {};
  const year = qs.year ? Number(qs.year) : null;
  const month = qs.month ? Number(qs.month) : null; // 1-12

  if (year && (!Number.isInteger(year) || year < 1970 || year > 3000)) {
    return res.error('year must be a valid integer (e.g. 2026)', 400);
  }
  if (month && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return res.error('month must be an integer between 1 and 12', 400);
  }

  let startDate = null;
  let endDate = null;
  if (year) {
    if (month) {
      startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    } else {
      startDate = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      endDate = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    }
  }

  const dateMatch = {};
  if (startDate) dateMatch.$gte = startDate;
  if (endDate) dateMatch.$lt = endDate;

  const pipeline = [
    { $match: { venueId: vid } },
    {
      $lookup: {
        from: 'quotes',
        localField: '_id',
        foreignField: 'leadId',
        pipeline: [
          { $match: { confirmed: true } },
          ...(startDate || endDate
            ? [
                {
                  $match: {
                    'eventWindow.startAt': dateMatch,
                  },
                },
              ]
            : []),
        ],
        as: 'confirmedQuotes',
      },
    },
    {
      $addFields: {
        confirmedQuotesCount: { $size: '$confirmedQuotes' },
      },
    },
    { $match: { confirmedQuotesCount: { $gt: 0 } } },
    {
      $project: {
        confirmedQuotesCount: 1,
        confirmedQuotes: 1,
        specialDay: 1,
      },
    },
    {
      $unwind: '$confirmedQuotes',
    },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        totalRevenue: { $sum: '$confirmedQuotes.pricing.totals.total' },
        totalHoursBooked: { $sum: '$confirmedQuotes.eventWindow.durationHours' },
        totalEventDays: {
          $sum: {
            $ceil: {
              $divide: [
                {
                  $subtract: ['$confirmedQuotes.eventWindow.endAt', '$confirmedQuotes.eventWindow.startAt'],
                },
                1000 * 60 * 60 * 24,
              ],
            },
          },
        },
      },
    },
  ];

  const agg = await Lead.aggregate(pipeline);
  const stats = agg[0] || {
    totalBookings: 0,
    totalRevenue: 0,
    totalHoursBooked: 0,
    totalEventDays: 0,
  };

  const periodDays = (() => {
    if (!year) return null;
    if (month) {
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 1));
      return Math.round((end - start) / (1000 * 60 * 60 * 24));
    }
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    return Math.round((end - start) / (1000 * 60 * 60 * 24));
  })();

  let occupancyPercent = null;
  if (periodDays && stats.totalEventDays > 0) {
    occupancyPercent = Math.min(100, (stats.totalEventDays / periodDays) * 100);
  }

  return res.success({
    totalBookings: stats.totalBookings,
    totalRevenue: stats.totalRevenue,
    totalHoursBooked: stats.totalHoursBooked,
    totalEventDays: stats.totalEventDays,
    occupancyPercent,
    period: {
      year: year || null,
      month: month || null,
    },
  });
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
  if (body.eventStatus !== undefined) {
    const es = String(body.eventStatus).trim().toLowerCase();
    if (!Lead.EVENT_STATUSES.includes(es)) {
      return res.error(`eventStatus must be one of: ${Lead.EVENT_STATUSES.join(', ')}`, 400);
    }
    update.eventStatus = es;
  }
  if (body.meetings !== undefined) {
    const meetings = sanitizeMeetings(body.meetings);
    if (!meetings) return res.error('meetings must be an array of { meetingAt, notes? }', 400);
    update.meetings = meetings;
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
   { method: 'GET', path: '/venues/{venueId}/leads/confirmed/stats', fn: getConfirmedStats },
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
