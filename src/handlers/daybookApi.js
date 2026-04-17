'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const mongoose = require('mongoose');
const Payment = require('../models/Payment');
const Commission = require('../models/Commission');
const Labour = require('../models/Labour');

function getPath(event) {
  return (event.rawPath || event.path || '').replace(/^\/api/, '') || '/';
}

function getMethod(event) {
  return (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
}

function parsePathParams(event) {
  const p = event.pathParameters || {};
  return {
    venueId: p.venueId ?? p.venueid,
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

function sanitizeDateOnly(value) {
  if (value == null) return null;
  const s = String(value).trim();
  // Expect YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (isNaN(start.getTime())) return null;
  const end = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  return { start, end, dayLabel: s };
}

function sanitizeIsoDate(value) {
  if (value == null) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function normalizePeriodFromQuery(qs) {
  const dateOnly = qs.date ? sanitizeDateOnly(qs.date) : null;
  if (dateOnly) {
    return {
      start: dateOnly.start,
      end: dateOnly.end,
      mode: 'day',
      date: dateOnly.dayLabel,
    };
  }

  const from = qs.from ? sanitizeIsoDate(qs.from) : null;
  const to = qs.to ? sanitizeIsoDate(qs.to) : null;
  if (!from) return null;

  // If `to` omitted, default to 1 day range from `from`.
  const end = to || new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return {
    start: from,
    end,
    mode: 'range',
    from: qs.from || null,
    to: qs.to || null,
  };
}

function daybookAggregationPipeline({ vid, startDate, endDate }) {
  // Inflow:
  // - Payment.amount (receivedAt) always treated as inflow
  // Outflow:
  // - Labour.amount (date) always treated as outflow
  // - Commission.amount (givenDate) treated as:
  //   direction=inflow  -> inflow
  //   direction=outflow -> outflow
  return [
    {
      $match: {
        venueId: vid,
        status: { $ne: 'deleted' },
        receivedAt: { $gte: startDate, $lt: endDate },
      },
    },
    {
      $project: {
        _id: 1,
        venueId: 1,
        source: { $literal: 'payment' },
        date: '$receivedAt',
        type: { $literal: 'inflow' },
        amount: '$amount',
        method: '$method',
        receivedByName: '$receivedByName',
        givenByName: '$givenByName',
        notes: '$notes',
        leadId: '$leadId',
        quoteId: '$quoteId',
        reminderId: '$reminderId',
        createdBy: '$createdBy',
        confirmedBy: '$confirmedBy',
        confirmedReceived: '$confirmedReceived',
        confirmedReceivedAt: '$confirmedReceivedAt',
        confirmedNotes: '$confirmedNotes',
      },
    },
    {
      $unionWith: {
        coll: 'commissions',
        pipeline: [
          {
            $match: {
              venueId: vid,
              status: { $ne: 'deleted' },
              givenDate: { $gte: startDate, $lt: endDate },
            },
          },
          {
            $project: {
              _id: 1,
              venueId: 1,
              source: { $literal: 'commission' },
              date: '$givenDate',
              type: {
                $cond: [{ $eq: ['$direction', 'inflow'] }, 'inflow', 'outflow'],
              },
              amount: '$amount',
              direction: '$direction',
              vendorName: '$vendorName',
              method: '$method',
              notes: '$notes',
              leadId: '$leadId',
              taxableAmount: '$taxableAmount',
              gstIncluded: '$gstIncluded',
              gstRate: '$gstRate',
              gstAmount: '$gstAmount',
              quoteId: { $literal: null },
              reminderId: { $literal: null },
              receivedByName: { $literal: '' },
              givenByName: { $literal: '' },
              createdBy: '$createdBy',
              confirmedBy: { $literal: null },
              confirmedReceived: { $literal: false },
              confirmedReceivedAt: { $literal: null },
              confirmedNotes: { $literal: '' },
            },
          },
        ],
      },
    },
    {
      $unionWith: {
        coll: 'labours',
        pipeline: [
          {
            $match: {
              venueId: vid,
              status: { $ne: 'deleted' },
              date: { $gte: startDate, $lt: endDate },
            },
          },
          {
            $project: {
              _id: 1,
              venueId: 1,
              source: { $literal: 'labour' },
              date: '$date',
              type: { $literal: 'outflow' },
              amount: '$amount',
              shiftType: '$shiftType',
              labourCount: '$labourCount',
              dayRate: '$dayRate',
              nightRate: '$nightRate',
              notes: '$notes',
              leadId: '$leadId',
              taxableAmount: '$taxableAmount',
              gstIncluded: '$gstIncluded',
              gstRate: '$gstRate',
              gstAmount: '$gstAmount',
              quoteId: { $literal: null },
              reminderId: { $literal: null },
              vendorName: { $literal: '' },
              method: { $literal: '' },
              direction: { $literal: 'outflow' },
              receivedByName: { $literal: '' },
              givenByName: { $literal: '' },
              createdBy: '$createdBy',
              confirmedBy: { $literal: null },
              confirmedReceived: { $literal: false },
              confirmedReceivedAt: { $literal: null },
              confirmedNotes: { $literal: '' },
            },
          },
        ],
      },
    },
    // ---- Enrich / map ids to objects ----
    {
      $lookup: {
        from: 'leads',
        localField: 'leadId',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              referenceCode: 1,
              eventType: 1,
              eventTypeOther: 1,
              contact: 1,
              specialDay: 1,
              status: 1,
            },
          },
        ],
        as: 'lead',
      },
    },
    { $unwind: { path: '$lead', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'quotes',
        localField: 'quoteId',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              bookingType: 1,
              confirmed: 1,
              status: 1,
              draft: 1,
              spaceId: 1,
              eventWindow: 1,
              'pricing.totals': 1,
            },
          },
        ],
        as: 'quote',
      },
    },
    { $unwind: { path: '$quote', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'paymentreminders',
        localField: 'reminderId',
        foreignField: '_id',
        pipeline: [{ $project: { expectedAmount: 1, expectedDate: 1, status: 1, paymentId: 1, quoteId: 1 } }],
        as: 'reminder',
      },
    },
    { $unwind: { path: '$reminder', preserveNullAndEmptyArrays: true } },
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
    {
      $lookup: {
        from: 'users',
        localField: 'confirmedBy',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, email: 1, role: 1 } }],
        as: 'confirmedByUser',
      },
    },
    { $unwind: { path: '$confirmedByUser', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'venues',
        localField: 'venueId',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, isActive: 1 } }],
        as: 'venue',
      },
    },
    { $unwind: { path: '$venue', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        day: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$date',
            timezone: 'UTC',
          },
        },
      },
    },
    {
      $facet: {
        inflowItems: [
          { $match: { type: 'inflow' } },
          { $sort: { date: 1 } },
        ],
        outflowItems: [
          { $match: { type: 'outflow' } },
          { $sort: { date: 1 } },
        ],
        daybook: [
          {
            $group: {
              _id: '$day',
              inflowTotal: { $sum: { $cond: [{ $eq: ['$type', 'inflow'] }, '$amount', 0] } },
              outflowTotal: { $sum: { $cond: [{ $eq: ['$type', 'outflow'] }, '$amount', 0] } },
            },
          },
          { $sort: { _id: 1 } },
          {
            $project: {
              _id: 0,
              date: '$_id',
              inflowTotal: 1,
              outflowTotal: 1,
              net: { $subtract: ['$inflowTotal', '$outflowTotal'] },
            },
          },
        ],
        totals: [
          {
            $group: {
              _id: null,
              inflowTotal: { $sum: { $cond: [{ $eq: ['$type', 'inflow'] }, '$amount', 0] } },
              outflowTotal: { $sum: { $cond: [{ $eq: ['$type', 'outflow'] }, '$amount', 0] } },
            },
          },
          {
            $project: {
              _id: 0,
              inflowTotal: 1,
              outflowTotal: 1,
              profitLoss: { $subtract: ['$inflowTotal', '$outflowTotal'] },
            },
          },
        ],
      },
    },
  ];
}

async function getDaybook(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const qs = event.queryStringParameters || {};
  const period = normalizePeriodFromQuery(qs);
  if (!period) return res.error('Provide `date` (YYYY-MM-DD) or `from` (ISO). Optionally `to` (ISO).', 400);

  const startDate = period.start;
  const endDate = period.end;

  const agg = await Payment.aggregate(
    daybookAggregationPipeline({
      vid,
      startDate,
      endDate,
    })
  );

  const row = agg?.[0] || { daybook: [], totals: [] };
  const totals = row.totals?.[0] || { inflowTotal: 0, outflowTotal: 0, profitLoss: 0 };

  return res.success({
    period,
    totals: {
      ...totals,
      profitOrLossType: totals.profitLoss >= 0 ? 'profit' : 'loss',
    },
    inflowItems: row.inflowItems || [],
    outflowItems: row.outflowItems || [],
    daybook: row.daybook || [],
  });
}

const routes = [{ method: 'GET', path: '/venues/{venueId}/daybook', fn: getDaybook }];

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

