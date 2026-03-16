'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const mongoose = require('mongoose');
const Commission = require('../models/Commission');
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
    commissionId: p.commissionId ?? p.commissionid,
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

function sanitizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sanitizeGivenDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function sanitizeDirection(value) {
  const d = value != null ? String(value).trim().toLowerCase() : '';
  if (!Commission.COMMISSION_DIRECTIONS.includes(d)) return null;
  return d;
}

function sanitizeMethod(value) {
  const m = value != null ? String(value).trim().toLowerCase() : '';
  if (!Commission.COMMISSION_METHODS.includes(m)) return null;
  return m;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

async function postCommission(event) {
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

  const direction = sanitizeDirection(body.direction);
  const vendorName = body.vendorName != null ? String(body.vendorName).trim() : '';
  const amount = sanitizeAmount(body.amount);
  const method = sanitizeMethod(body.method);
  const givenDate = sanitizeGivenDate(body.givenDate);
  const notes = body.notes != null ? String(body.notes).trim() : '';

  if (!direction) return res.error(`direction must be one of: ${Commission.COMMISSION_DIRECTIONS.join(', ')}`, 400);
  if (!vendorName) return res.error('vendorName is required', 400);
  if (amount == null) return res.error('amount must be a non-negative number', 400);
  if (!method) return res.error(`method must be one of: ${Commission.COMMISSION_METHODS.join(', ')}`, 400);
  if (!givenDate) return res.error('givenDate must be a valid date (ISO)', 400);

  const doc = await Commission.create({
    venueId: vid,
    leadId: lid,
    direction,
    vendorName,
    amount,
    method,
    givenDate,
    notes,
    createdBy: toObjectId(decoded.sub),
  });

  return res.success(doc, 201);
}

async function getCommissions(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId } = parsePathParams(event);
  if (!venueId || !leadId) return res.error('venueId and leadId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  if (!vid || !lid) return res.error('Invalid venueId or leadId', 400);

  const qs = event.queryStringParameters || {};
  const match = { venueId: vid, leadId: lid, status: { $ne: 'deleted' } };

  if (qs.direction) {
    const d = sanitizeDirection(qs.direction);
    if (d) match.direction = d;
  }

  if (qs.method) {
    const m = sanitizeMethod(qs.method);
    if (m) match.method = m;
  }

  if (qs.from) {
    const from = new Date(qs.from);
    if (!isNaN(from.getTime())) {
      match.givenDate = match.givenDate || {};
      match.givenDate.$gte = from;
    }
  }
  if (qs.to) {
    const to = new Date(qs.to);
    if (!isNaN(to.getTime())) {
      match.givenDate = match.givenDate || {};
      match.givenDate.$lte = to;
    }
  }

  const list = await Commission.find(match).sort({ givenDate: -1, createdAt: -1 }).lean();
  return res.success(list);
}

async function patchCommission(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, commissionId } = parsePathParams(event);
  if (!venueId || !leadId || !commissionId) return res.error('venueId, leadId and commissionId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const cid = toObjectId(commissionId);
  if (!vid || !lid || !cid) return res.error('Invalid id(s)', 400);

  const body = parseBody(event);
  const update = {};

  if (body.direction !== undefined) {
    const d = sanitizeDirection(body.direction);
    if (!d) return res.error(`direction must be one of: ${Commission.COMMISSION_DIRECTIONS.join(', ')}`, 400);
    update.direction = d;
  }
  if (body.vendorName !== undefined) {
    const name = String(body.vendorName).trim();
    if (!name) return res.error('vendorName cannot be empty', 400);
    update.vendorName = name;
  }
  if (body.amount !== undefined) {
    const amount = sanitizeAmount(body.amount);
    if (amount == null) return res.error('amount must be a non-negative number', 400);
    update.amount = amount;
  }
  if (body.method !== undefined) {
    const m = sanitizeMethod(body.method);
    if (!m) return res.error(`method must be one of: ${Commission.COMMISSION_METHODS.join(', ')}`, 400);
    update.method = m;
  }
  if (body.givenDate !== undefined) {
    const d = sanitizeGivenDate(body.givenDate);
    if (!d) return res.error('givenDate must be a valid date (ISO)', 400);
    update.givenDate = d;
  }
  if (body.notes !== undefined) {
    update.notes = String(body.notes).trim();
  }

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await Commission.findOneAndUpdate(
    { _id: cid, venueId: vid, leadId: lid, status: { $ne: 'deleted' } },
    { $set: update },
    { new: true }
  ).lean();

  if (!doc) return res.notFound('Commission not found');
  return res.success(doc);
}

async function deleteCommission(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, leadId, commissionId } = parsePathParams(event);
  if (!venueId || !leadId || !commissionId) return res.error('venueId, leadId and commissionId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const lid = toObjectId(leadId);
  const cid = toObjectId(commissionId);
  if (!vid || !lid || !cid) return res.error('Invalid id(s)', 400);

  const doc = await Commission.findOneAndUpdate(
    { _id: cid, venueId: vid, leadId: lid, status: { $ne: 'deleted' } },
    { $set: { status: 'deleted' } },
    { new: true }
  ).lean();

  if (!doc) return res.notFound('Commission not found');
  return res.success({ deleted: true });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const routes = [
  { method: 'GET', path: '/venues/{venueId}/leads/{leadId}/commissions', fn: getCommissions },
  { method: 'POST', path: '/venues/{venueId}/leads/{leadId}/commissions', fn: postCommission },
  { method: 'PATCH', path: '/venues/{venueId}/leads/{leadId}/commissions/{commissionId}', fn: patchCommission },
  { method: 'DELETE', path: '/venues/{venueId}/leads/{leadId}/commissions/{commissionId}', fn: deleteCommission },
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

