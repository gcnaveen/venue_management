'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const mongoose = require('mongoose');
const Labour = require('../models/Labour');
const Lead = require('../models/Lead');

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
    labourId: p.labourId ?? p.labourid,
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

function sanitizeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function sanitizeShiftType(value) {
  const s = value != null ? String(value).trim().toLowerCase() : '';
  if (!Labour.SHIFT_TYPES.includes(s)) return null;
  return s;
}

function sanitizePositiveInt(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function sanitizeNonNegative(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function computeAmount(shiftType, labourCount, dayRate, nightRate) {
  if (shiftType === 'day') return labourCount * dayRate;
  if (shiftType === 'night') return labourCount * nightRate;
  return labourCount * (dayRate + nightRate);
}

function validateRatesForShift(shiftType, dayRate, nightRate) {
  if (shiftType === 'day') return dayRate > 0 && nightRate === 0;
  if (shiftType === 'night') return nightRate > 0 && dayRate === 0;
  return dayRate > 0 && nightRate > 0;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function postLabour(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  const decoded = await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const lead = await Lead.findOne({ _id: lid, venueId: vid }).lean();
  if (!lead) return res.notFound('Lead not found for this venue');

  const body = parseBody(event);
  const date = sanitizeDate(body.date);
  const shiftType = sanitizeShiftType(body.shiftType);
  const labourCount = sanitizePositiveInt(body.labourCount);
  const dayRate = sanitizeNonNegative(body.dayRate);
  const nightRate = sanitizeNonNegative(body.nightRate);
  const gstIncluded = body.gstIncluded === true;
  const gstRate = sanitizeNonNegative(body.gstRate !== undefined ? body.gstRate : 0);
  const notes = body.notes != null ? String(body.notes).trim() : '';

  if (!date) return res.error('date must be a valid date (ISO)', 400);
  if (!shiftType) return res.error(`shiftType must be one of: ${Labour.SHIFT_TYPES.join(', ')}`, 400);
  if (labourCount == null) return res.error('labourCount must be an integer >= 1', 400);
  if (dayRate == null) return res.error('dayRate must be a non-negative number', 400);
  if (nightRate == null) return res.error('nightRate must be a non-negative number', 400);
  if (gstRate == null) return res.error('gstRate must be a non-negative number', 400);
  if (!validateRatesForShift(shiftType, dayRate, nightRate)) {
    return res.error('Invalid rates for shiftType: day=>dayRate>0 & nightRate=0, night=>nightRate>0 & dayRate=0, both=>dayRate>0 & nightRate>0', 400);
  }

  const taxableAmount = computeAmount(shiftType, labourCount, dayRate, nightRate);
  const gstAmount = gstIncluded ? round2((taxableAmount * gstRate) / 100) : 0;
  const amount = round2(gstIncluded ? taxableAmount + gstAmount : taxableAmount);

  const doc = await Labour.create({
    venueId: vid,
    leadId: lid,
    date,
    shiftType,
    labourCount,
    dayRate,
    nightRate,
    taxableAmount,
    gstIncluded,
    gstRate,
    gstAmount,
    amount,
    notes,
    createdBy: toObjectId(decoded.sub),
  });

  return res.success(doc, 201);
}

async function getLabours(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const qs = event.queryStringParameters || {};
  const match = { venueId: vid, leadId: lid, status: { $ne: 'deleted' } };

  if (qs.shiftType) {
    const s = sanitizeShiftType(qs.shiftType);
    if (s) match.shiftType = s;
  }
  if (qs.from) {
    const from = new Date(qs.from);
    if (!isNaN(from.getTime())) {
      match.date = match.date || {};
      match.date.$gte = from;
    }
  }
  if (qs.to) {
    const to = new Date(qs.to);
    if (!isNaN(to.getTime())) {
      match.date = match.date || {};
      match.date.$lte = to;
    }
  }

  const list = await Labour.find(match).sort({ date: -1, createdAt: -1 }).lean();
  return res.success(list);
}

async function patchLabour(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, labourId } = parsePathParams(event);
  if (!venueId || !leadId || !labourId) return res.error('venueId, leadId and labourId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const xid = toObjectId(labourId);
  if (!vid || !lid || !xid) return res.error('Invalid id(s)', 400);

  const existing = await Labour.findOne({ _id: xid, venueId: vid, leadId: lid, status: { $ne: 'deleted' } }).lean();
  if (!existing) return res.notFound('Labour not found');

  const body = parseBody(event);
  const update = {};

  if (body.date !== undefined) {
    const date = sanitizeDate(body.date);
    if (!date) return res.error('date must be a valid date (ISO)', 400);
    update.date = date;
  }
  if (body.shiftType !== undefined) {
    const shiftType = sanitizeShiftType(body.shiftType);
    if (!shiftType) return res.error(`shiftType must be one of: ${Labour.SHIFT_TYPES.join(', ')}`, 400);
    update.shiftType = shiftType;
  }
  if (body.labourCount !== undefined) {
    const labourCount = sanitizePositiveInt(body.labourCount);
    if (labourCount == null) return res.error('labourCount must be an integer >= 1', 400);
    update.labourCount = labourCount;
  }
  if (body.dayRate !== undefined) {
    const dayRate = sanitizeNonNegative(body.dayRate);
    if (dayRate == null) return res.error('dayRate must be a non-negative number', 400);
    update.dayRate = dayRate;
  }
  if (body.nightRate !== undefined) {
    const nightRate = sanitizeNonNegative(body.nightRate);
    if (nightRate == null) return res.error('nightRate must be a non-negative number', 400);
    update.nightRate = nightRate;
  }
  if (body.gstIncluded !== undefined) update.gstIncluded = body.gstIncluded === true;
  if (body.gstRate !== undefined) {
    const gstRate = sanitizeNonNegative(body.gstRate);
    if (gstRate == null) return res.error('gstRate must be a non-negative number', 400);
    update.gstRate = gstRate;
  }
  if (body.notes !== undefined) {
    update.notes = String(body.notes).trim();
  }

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const finalShiftType = update.shiftType !== undefined ? update.shiftType : existing.shiftType;
  const finalLabourCount = update.labourCount !== undefined ? update.labourCount : existing.labourCount;
  const finalDayRate = update.dayRate !== undefined ? update.dayRate : existing.dayRate;
  const finalNightRate = update.nightRate !== undefined ? update.nightRate : existing.nightRate;
  const finalGstIncluded = update.gstIncluded !== undefined ? update.gstIncluded : (existing.gstIncluded === true);
  const finalGstRate = update.gstRate !== undefined ? update.gstRate : (existing.gstRate || 0);

  if (!validateRatesForShift(finalShiftType, finalDayRate, finalNightRate)) {
    return res.error('Invalid rates for shiftType: day=>dayRate>0 & nightRate=0, night=>nightRate>0 & dayRate=0, both=>dayRate>0 & nightRate>0', 400);
  }
  const finalTaxableAmount = computeAmount(finalShiftType, finalLabourCount, finalDayRate, finalNightRate);
  const finalGstAmount = finalGstIncluded ? round2((finalTaxableAmount * finalGstRate) / 100) : 0;
  const finalAmount = round2(finalGstIncluded ? finalTaxableAmount + finalGstAmount : finalTaxableAmount);

  update.taxableAmount = finalTaxableAmount;
  update.gstIncluded = finalGstIncluded;
  update.gstRate = finalGstRate;
  update.gstAmount = finalGstAmount;
  update.amount = finalAmount;

  const doc = await Labour.findOneAndUpdate(
    { _id: xid, venueId: vid, leadId: lid, status: { $ne: 'deleted' } },
    { $set: update },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Labour not found');
  return res.success(doc);
}

async function deleteLabour(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, labourId } = parsePathParams(event);
  if (!venueId || !leadId || !labourId) return res.error('venueId, leadId and labourId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const xid = toObjectId(labourId);
  if (!vid || !lid || !xid) return res.error('Invalid id(s)', 400);

  const doc = await Labour.findOneAndUpdate(
    { _id: xid, venueId: vid, leadId: lid, status: { $ne: 'deleted' } },
    { $set: { status: 'deleted' } },
    { new: true }
  ).lean();
  if (!doc) return res.notFound('Labour not found');
  return res.success({ deleted: true });
}

const routes = [
  { method: 'GET', path: '/venues/{venueId}/leads/{leadId}/labours', fn: getLabours },
  { method: 'POST', path: '/venues/{venueId}/leads/{leadId}/labours', fn: postLabour },
  { method: 'PATCH', path: '/venues/{venueId}/leads/{leadId}/labours/{labourId}', fn: patchLabour },
  { method: 'DELETE', path: '/venues/{venueId}/leads/{leadId}/labours/{labourId}', fn: deleteLabour },
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
