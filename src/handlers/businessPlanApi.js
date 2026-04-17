'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const mongoose = require('mongoose');
const BusinessPlan = require('../models/BusinessPlan');
const Venue = require('../models/Venue');
const Space = require('../models/Space');
const Quote = require('../models/Quote');
const Commission = require('../models/Commission');
const Labour = require('../models/Labour');
const DURATION_KEYS = BusinessPlan.DURATION_KEYS || ['12', '24', '36', '48'];

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

function parseMonthYear(qsOrBody) {
  const month = Number(qsOrBody.month);
  const year = Number(qsOrBody.year);
  if (!Number.isInteger(month) || month < 1 || month > 12) return { error: 'month must be an integer between 1 and 12' };
  if (!Number.isInteger(year) || year < 2020 || year > 2040) return { error: 'year must be an integer between 2020 and 2040' };
  return { month, year };
}

function monthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

function sanitizeNonNegative(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function emptyDurations() {
  return {
    '12': { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0 },
    '24': { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0 },
    '36': { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0 },
    '48': { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0 },
  };
}

function normalizeDurationKey(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '12';
  if (n <= 18) return '12';
  if (n <= 30) return '24';
  if (n <= 42) return '36';
  return '48';
}

function sanitizeDurations(raw, fallbackFlat) {
  const out = emptyDurations();
  if (raw && typeof raw === 'object') {
    for (const key of DURATION_KEYS) {
      const src = raw[key] || {};
      const expectedBookings = sanitizeNonNegative(src.expectedBookings !== undefined ? src.expectedBookings : 0);
      const expectedBusiness = sanitizeNonNegative(src.expectedBusiness !== undefined ? src.expectedBusiness : 0);
      const expectedExpenses = sanitizeNonNegative(src.expectedExpenses !== undefined ? src.expectedExpenses : 0);
      if (expectedBookings == null || expectedBusiness == null || expectedExpenses == null) return null;
      out[key] = { expectedBookings, expectedBusiness, expectedExpenses };
    }
    return out;
  }

  if (fallbackFlat) {
    const expectedBookings = sanitizeNonNegative(fallbackFlat.expectedBookings !== undefined ? fallbackFlat.expectedBookings : 0);
    const expectedBusiness = sanitizeNonNegative(fallbackFlat.expectedBusiness !== undefined ? fallbackFlat.expectedBusiness : 0);
    const expectedExpenses = sanitizeNonNegative(fallbackFlat.expectedExpenses !== undefined ? fallbackFlat.expectedExpenses : 0);
    if (expectedBookings == null || expectedBusiness == null || expectedExpenses == null) return null;
    out['24'] = { expectedBookings, expectedBusiness, expectedExpenses };
  }
  return out;
}

function sumDurations(durations) {
  const d = durations || emptyDurations();
  return DURATION_KEYS.reduce(
    (acc, key) => {
      acc.expectedBookings += Number(d[key]?.expectedBookings || 0);
      acc.expectedBusiness += Number(d[key]?.expectedBusiness || 0);
      acc.expectedExpenses += Number(d[key]?.expectedExpenses || 0);
      return acc;
    },
    { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0 }
  );
}

function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') return null;
    const rowType = String(r.rowType || '').trim();
    if (!BusinessPlan.ROW_TYPES.includes(rowType)) return null;
    const spaceName = String(r.spaceName || '').trim();
    if (!spaceName) return null;
    const durations = sanitizeDurations(r.durations, {
      expectedBookings: r.expectedBookings,
      expectedBusiness: r.expectedBusiness,
      expectedExpenses: r.expectedExpenses,
    });
    if (!durations) return null;
    const summed = sumDurations(durations);

    let spaceId = null;
    if (rowType === 'space') {
      spaceId = toObjectId(r.spaceId);
      if (!spaceId) return null;
    }

    out.push({
      rowType,
      spaceId,
      spaceName,
      durations,
      expectedBookings: summed.expectedBookings,
      expectedBusiness: summed.expectedBusiness,
      expectedExpenses: summed.expectedExpenses,
    });
  }
  return out;
}

async function computeMonthlyActualsBySpace(venueId, month, year) {
  const { start, end } = monthRange(year, month);

  const [quoteAgg, commissionAgg, labourAgg] = await Promise.all([
    Quote.aggregate([
      {
        $match: {
          venueId,
          confirmed: true,
          'eventWindow.startAt': { $gte: start, $lt: end },
        },
      },
      {
        $addFields: {
          durationKey: {
            $switch: {
              branches: [
                { case: { $lte: ['$eventWindow.durationHours', 18] }, then: '12' },
                { case: { $lte: ['$eventWindow.durationHours', 30] }, then: '24' },
                { case: { $lte: ['$eventWindow.durationHours', 42] }, then: '36' },
              ],
              default: '48',
            },
          },
        },
      },
      {
        $group: {
          _id: {
            rowType: {
              $cond: [{ $eq: ['$bookingType', 'space_buyout'] }, 'space', 'venue_buyout'],
            },
            spaceId: {
              $cond: [{ $eq: ['$bookingType', 'space_buyout'] }, '$spaceId', null],
            },
            durationKey: '$durationKey',
          },
          actualBookings: { $sum: 1 },
          quoteRevenue: { $sum: { $ifNull: ['$pricing.totals.total', 0] } },
        },
      },
    ]),
    Commission.aggregate([
      {
        $match: {
          venueId,
          status: { $ne: 'deleted' },
          givenDate: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: '$direction',
          amount: { $sum: '$amount' },
        },
      },
    ]),
    Labour.aggregate([
      {
        $match: {
          venueId,
          status: { $ne: 'deleted' },
          date: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          amount: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const byKey = new Map();
  for (const q of quoteAgg) {
    const key = `${q._id.rowType}:${q._id.spaceId ? String(q._id.spaceId) : 'null'}`;
    const durationKey = DURATION_KEYS.includes(String(q._id.durationKey)) ? String(q._id.durationKey) : normalizeDurationKey(q._id.durationKey);
    const curr = byKey.get(key) || {
      actualBookings: 0,
      quoteRevenue: 0,
      actualBusiness: 0,
      actualExpenses: 0,
      durations: {
        '12': { actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
        '24': { actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
        '36': { actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
        '48': { actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
      },
    };
    curr.actualBookings += q.actualBookings || 0;
    curr.quoteRevenue += q.quoteRevenue || 0;
    curr.actualBusiness += q.quoteRevenue || 0;
    curr.durations[durationKey].actualBookings += q.actualBookings || 0;
    curr.durations[durationKey].actualBusiness += q.quoteRevenue || 0;
    byKey.set(key, curr);
  }

  let inflow = 0;
  let outflow = 0;
  for (const c of commissionAgg) {
    if (c._id === 'inflow') inflow += c.amount || 0;
    if (c._id === 'outflow') outflow += c.amount || 0;
  }
  const labourOutflow = labourAgg?.[0]?.amount || 0;

  // Venue-buyout row carries venue-level inflow/outflow/labour costs.
  const venueKey = 'venue_buyout:null';
  const current = byKey.get(venueKey) || {
    actualBookings: 0,
    quoteRevenue: 0,
    actualBusiness: 0,
    actualExpenses: 0,
    durations: {
      '12': { actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
      '24': { actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
      '36': { actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
      '48': { actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
    },
  };
  current.actualBusiness = (current.quoteRevenue || 0) + inflow;
  current.actualExpenses = outflow + labourOutflow;
  byKey.set(venueKey, current);

  return byKey;
}

async function computeMonthlyActualVenueTotals(venueId, month, year) {
  const { start, end } = monthRange(year, month);

  const [quoteAgg, commissionAgg, labourAgg] = await Promise.all([
    Quote.aggregate([
      {
        $match: {
          venueId,
          confirmed: true,
          'eventWindow.startAt': { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          actualBookings: { $sum: 1 },
          quoteRevenue: { $sum: { $ifNull: ['$pricing.totals.total', 0] } },
        },
      },
    ]),
    Commission.aggregate([
      {
        $match: {
          venueId,
          status: { $ne: 'deleted' },
          givenDate: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: '$direction',
          amount: { $sum: '$amount' },
        },
      },
    ]),
    Labour.aggregate([
      {
        $match: {
          venueId,
          status: { $ne: 'deleted' },
          date: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          amount: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const actualBookings = quoteAgg?.[0]?.actualBookings || 0;
  const quoteRevenue = quoteAgg?.[0]?.quoteRevenue || 0;

  let commissionInflow = 0;
  let commissionOutflow = 0;
  for (const c of commissionAgg || []) {
    if (c._id === 'inflow') commissionInflow += c.amount || 0;
    if (c._id === 'outflow') commissionOutflow += c.amount || 0;
  }

  const labourAmount = labourAgg?.[0]?.amount || 0;

  const actualBusiness = quoteRevenue + commissionInflow;
  const actualExpenses = commissionOutflow + labourAmount;

  const profitLoss = actualBusiness - actualExpenses;

  return {
    actualBookings,
    actualBusiness,
    actualExpenses,
    profitLoss,
  };
}

async function getVenueAndSpaces(vid) {
  const [venueDoc, spaces] = await Promise.all([
    Venue.aggregate([
      { $match: { _id: vid } },
      { $project: { name: 1, isActive: 1 } },
    ]),
    Space.aggregate([
      { $match: { venueId: vid, isActive: true } },
      { $sort: { name: 1 } },
      {
        $project: {
          _id: 0,
          spaceId: { $toString: '$_id' },
          spaceName: '$name',
          capacity: { $ifNull: ['$capacity', null] },
          isActive: { $ifNull: ['$isActive', true] },
        },
      },
    ]),
  ]);

  return {
    venue: venueDoc?.[0]
      ? { venueId: String(vid), name: venueDoc[0].name, isActive: venueDoc[0].isActive }
      : { venueId: String(vid), name: null, isActive: null },
    spaces: spaces || [],
  };
}

async function getMonthlyBusinessPlan(event) {
  auth.requireRole(event, [auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const qs = event.queryStringParameters || {};
  const parsed = parseMonthYear(qs);
  if (parsed.error) return res.error(parsed.error, 400);
  const { month, year } = parsed;

  const plan = await BusinessPlan.findOne({ venueId: vid, month, year }).lean();
  const rows = Array.isArray(plan?.rows) ? plan.rows : [];
  const actualsMap = await computeMonthlyActualsBySpace(vid, month, year);
  const actualTotals = await computeMonthlyActualVenueTotals(vid, month, year);
  const { venue, spaces } = await getVenueAndSpaces(vid);

  const mappedRows = rows.map((r) => {
    const key = `${r.rowType}:${r.spaceId ? String(r.spaceId) : 'null'}`;
    const actual = actualsMap.get(key) || {};
    const durations = sanitizeDurations(r.durations, {
      expectedBookings: r.expectedBookings,
      expectedBusiness: r.expectedBusiness,
      expectedExpenses: r.expectedExpenses,
    }) || emptyDurations();
    const mappedDurations = {};
    for (const k of DURATION_KEYS) {
      mappedDurations[k] = {
        expectedBookings: Number(durations[k]?.expectedBookings || 0),
        expectedBusiness: Number(durations[k]?.expectedBusiness || 0),
        expectedExpenses: Number(durations[k]?.expectedExpenses || 0),
        actualBookings: Number(actual.durations?.[k]?.actualBookings || 0),
        actualBusiness: Number(actual.durations?.[k]?.actualBusiness || 0),
        actualExpenses: Number(actual.durations?.[k]?.actualExpenses || 0),
      };
    }
    const summed = sumDurations(durations);
    return {
      ...r,
      durations: mappedDurations,
      expectedBookings: summed.expectedBookings,
      expectedBusiness: summed.expectedBusiness,
      expectedExpenses: summed.expectedExpenses,
      actualBookings: Number(actual.actualBookings || 0),
      actualBusiness: Number(actual.actualBusiness || 0),
      actualExpenses: Number(actual.actualExpenses || 0),
    };
  });

  const expectedBookings = rows.reduce((s, r) => s + (Number(r.expectedBookings) || 0), 0);
  const expectedBusiness = rows.reduce((s, r) => s + (Number(r.expectedBusiness) || 0), 0);
  const expectedExpenses = rows.reduce((s, r) => s + (Number(r.expectedExpenses) || 0), 0);
  const durationTotals = {
    '12': { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0, actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
    '24': { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0, actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
    '36': { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0, actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
    '48': { expectedBookings: 0, expectedBusiness: 0, expectedExpenses: 0, actualBookings: 0, actualBusiness: 0, actualExpenses: 0 },
  };
  for (const row of mappedRows) {
    for (const k of DURATION_KEYS) {
      durationTotals[k].expectedBookings += Number(row.durations?.[k]?.expectedBookings || 0);
      durationTotals[k].expectedBusiness += Number(row.durations?.[k]?.expectedBusiness || 0);
      durationTotals[k].expectedExpenses += Number(row.durations?.[k]?.expectedExpenses || 0);
      durationTotals[k].actualBookings += Number(row.durations?.[k]?.actualBookings || 0);
      durationTotals[k].actualBusiness += Number(row.durations?.[k]?.actualBusiness || 0);
      durationTotals[k].actualExpenses += Number(row.durations?.[k]?.actualExpenses || 0);
    }
  }
  for (const k of DURATION_KEYS) {
    durationTotals[k].expectedProfit = durationTotals[k].expectedBusiness - durationTotals[k].expectedExpenses;
    durationTotals[k].actualProfit = durationTotals[k].actualBusiness - durationTotals[k].actualExpenses;
  }

  return res.success({
    venueId: String(vid),
    month,
    year,
    rows: mappedRows,
    totals: {
      expectedBookings,
      expectedBusiness,
      expectedExpenses,
      actualBookings: actualTotals.actualBookings,
      actualBusiness: actualTotals.actualBusiness,
      actualExpenses: actualTotals.actualExpenses,
      profitLoss: actualTotals.profitLoss,
      profitOrLossType: actualTotals.profitLoss >= 0 ? 'profit' : 'loss',
      durationTotals,
    },
    venue,
    spaces: spaces.map((s) => {
      const actual = actualsMap.get(`space:${s.spaceId}`) || {};
      return {
        ...s,
        actualBookings: actual.actualBookings || 0,
        actualBusiness: actual.actualBusiness || 0,
        actualExpenses: actual.actualExpenses || 0,
      };
    }),
  });
}

async function postMonthlyBusinessPlan(event) {
  auth.requireRole(event, [auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const body = parseBody(event);
  const parsed = parseMonthYear(body);
  if (parsed.error) return res.error(parsed.error, 400);
  const { month, year } = parsed;

  const rows = sanitizeRows(body.rows);
  if (!rows) return res.error('rows must be an array with valid business-plan rows', 400);

  await BusinessPlan.findOneAndUpdate(
    { venueId: vid, month, year },
    { $set: { rows } },
    { upsert: true, new: true }
  ).lean();

  // Reuse monthly GET response shape (with actuals).
  const fakeEvent = {
    ...event,
    queryStringParameters: { month: String(month), year: String(year) },
  };
  return getMonthlyBusinessPlan(fakeEvent);
}

async function getYearlyBusinessPlanSummary(event) {
  auth.requireRole(event, [auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);
  const { venue, spaces } = await getVenueAndSpaces(vid);

  const qs = event.queryStringParameters || {};
  const year = Number(qs.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2040) {
    return res.error('year must be an integer between 2020 and 2040', 400);
  }

  const plans = await BusinessPlan.find({ venueId: vid, year }).lean();

  const expectedByMonth = new Map();
  for (const p of plans) {
    const month = p.month;
    const rows = Array.isArray(p.rows) ? p.rows : [];
    const totalExpectedBookings = rows.reduce((s, r) => s + (Number(r.expectedBookings) || 0), 0);
    const totalExpectedBusiness = rows.reduce((s, r) => s + (Number(r.expectedBusiness) || 0), 0);
    const totalExpectedExpenses = rows.reduce((s, r) => s + (Number(r.expectedExpenses) || 0), 0);
    expectedByMonth.set(month, {
      month,
      totalExpectedBookings,
      totalExpectedBusiness,
      totalExpectedExpenses,
    });
  }

  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));

  const [quotesByMonth, commissionsByMonth, laboursByMonth] = await Promise.all([
    Quote.aggregate([
      {
        $match: {
          venueId: vid,
          confirmed: true,
          'eventWindow.startAt': { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: { $month: '$eventWindow.startAt' },
          totalActualBookings: { $sum: 1 },
          quoteRevenue: { $sum: { $ifNull: ['$pricing.totals.total', 0] } },
        },
      },
    ]),
    Commission.aggregate([
      {
        $match: {
          venueId: vid,
          status: { $ne: 'deleted' },
          givenDate: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: { month: { $month: '$givenDate' }, direction: '$direction' },
          amount: { $sum: '$amount' },
        },
      },
    ]),
    Labour.aggregate([
      {
        $match: {
          venueId: vid,
          status: { $ne: 'deleted' },
          date: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: { $month: '$date' },
          amount: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const actualByMonth = new Map();
  for (let m = 1; m <= 12; m++) {
    actualByMonth.set(m, {
      month: m,
      totalActualBookings: 0,
      totalActualBusiness: 0,
      totalActualExpenses: 0,
    });
  }

  for (const q of quotesByMonth) {
    const row = actualByMonth.get(q._id);
    if (!row) continue;
    row.totalActualBookings = q.totalActualBookings || 0;
    row.totalActualBusiness += q.quoteRevenue || 0;
  }
  for (const c of commissionsByMonth) {
    const row = actualByMonth.get(c._id.month);
    if (!row) continue;
    if (c._id.direction === 'inflow') row.totalActualBusiness += c.amount || 0;
    if (c._id.direction === 'outflow') row.totalActualExpenses += c.amount || 0;
  }
  for (const l of laboursByMonth) {
    const row = actualByMonth.get(l._id);
    if (!row) continue;
    row.totalActualExpenses += l.amount || 0;
  }

  const output = [];
  for (let m = 1; m <= 12; m++) {
    const expected = expectedByMonth.get(m) || {
      month: m,
      totalExpectedBookings: 0,
      totalExpectedBusiness: 0,
      totalExpectedExpenses: 0,
    };
    const actual = actualByMonth.get(m);
    const hasPlan = expectedByMonth.has(m);
    const hasActual =
      (actual?.totalActualBookings || 0) > 0 ||
      (actual?.totalActualBusiness || 0) > 0 ||
      (actual?.totalActualExpenses || 0) > 0;

    if (hasPlan || hasActual) {
      output.push({
        month: m,
        totalExpectedBookings: expected.totalExpectedBookings,
        totalExpectedBusiness: expected.totalExpectedBusiness,
        totalExpectedExpenses: expected.totalExpectedExpenses,
        totalActualBookings: actual.totalActualBookings,
        totalActualBusiness: actual.totalActualBusiness,
        totalActualExpenses: actual.totalActualExpenses,
      });
    }
  }

  return res.success({
    venue,
    spaces,
    months: output,
  });
}

const routes = [
  { method: 'GET', path: '/venues/{venueId}/business-plan/yearly', fn: getYearlyBusinessPlanSummary },
  { method: 'GET', path: '/venues/{venueId}/business-plan', fn: getMonthlyBusinessPlan },
  { method: 'POST', path: '/venues/{venueId}/business-plan', fn: postMonthlyBusinessPlan },
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
