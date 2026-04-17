'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const mongoose = require('mongoose');
const Bill = require('../models/Bill');

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
    billId: p.billId ?? p.billid,
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

function normalizePaymentMode(value) {
  const v = value != null ? String(value).trim().toLowerCase() : '';
  if (!v) return null;
  if (v === 'cash') return 'cash';
  if (v === 'account') return 'account';
  // Accept "Cash"/"Account" too
  return null;
}

function computeTotals(bill) {
  const emiStatus = Array.isArray(bill.emiStatus) ? bill.emiStatus : [];
  const totalEmiAmount = emiStatus.reduce((sum, s) => sum + (Number(s.emiAmount) || 0), 0);
  const totalPaid = emiStatus.reduce((sum, s) => sum + (Number(s.amountPaid) || 0), 0);
  const remainingAmount = totalEmiAmount - totalPaid;
  return { totalEmiAmount, totalPaid, remainingAmount };
}

function withTotals(doc) {
  if (!doc) return doc;
  return { ...doc, ...computeTotals(doc) };
}

function sanitizeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

function sanitizeNonNegative(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function sanitizeEmiStatusItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const month = Number(raw.month);
  const year = Number(raw.year);
  const emiAmount = sanitizeNonNegative(raw.emiAmount);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(year) || year < 1970 || year > 3000) return null;
  if (emiAmount == null) return null;

  const paid = raw.paid === true;
  const amountPaid = sanitizeNonNegative(raw.amountPaid !== undefined ? raw.amountPaid : 0);
  if (amountPaid == null) return null;

  const paymentMode = raw.paymentMode !== undefined ? normalizePaymentMode(raw.paymentMode) : null;
  if (raw.paymentMode !== undefined && !paymentMode) return null;

  const paymentDate = raw.paymentDate ? sanitizeDate(raw.paymentDate) : null;
  if (raw.paymentDate && !paymentDate) return null;

  return {
    month,
    year,
    emiAmount,
    paid,
    amountPaid,
    remarks: raw.remarks != null ? String(raw.remarks).trim() : '',
    paymentMode: paymentMode || 'cash',
    paymentDate,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

async function postBill(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  const decoded = await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const body = parseBody(event);

  const name = body.name != null ? String(body.name).trim() : '';
  const emi_end_date = sanitizeDate(body.emi_end_date);
  const emiType = body.emiType != null ? String(body.emiType).trim() : '';
  const emiDate = sanitizeDate(body.emiDate);
  const defaultAmount = sanitizeNonNegative(body.defaultAmount);

  if (!name) return res.error('name is required', 400);
  if (!emi_end_date) return res.error('emi_end_date must be a valid date', 400);
  if (!emiType) return res.error('emiType is required', 400);
  if (!emiDate) return res.error('emiDate must be a valid date', 400);
  if (defaultAmount == null) return res.error('defaultAmount must be a non-negative number', 400);

  let emiStatus = [];
  if (body.emiStatus !== undefined) {
    if (!Array.isArray(body.emiStatus)) return res.error('emiStatus must be an array', 400);
    const items = body.emiStatus.map(sanitizeEmiStatusItem);
    if (items.some(i => !i)) return res.error('Invalid emiStatus item(s)', 400);
    emiStatus = items;
  }

  const doc = await Bill.create({
    venueId: vid,
    name,
    emi_end_date,
    emiType,
    emiDate,
    defaultAmount,
    emiStatus,
    createdBy: toObjectId(decoded.sub),
  });

  return res.success(withTotals(doc.toObject ? doc.toObject() : doc), 201);
}

async function getBills(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId } = parsePathParams(event);
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const qs = event.queryStringParameters || {};
  const match = { venueId: vid, status: { $ne: 'deleted' } };
  if (qs.q) match.name = { $regex: String(qs.q).trim(), $options: 'i' };

  const list = await Bill.find(match).sort({ createdAt: -1 }).lean();
  return res.success(list.map(withTotals));
}

async function getBillById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, billId } = parsePathParams(event);
  if (!venueId || !billId) return res.error('venueId and billId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const bid = toObjectId(billId);
  if (!vid || !bid) return res.error('Invalid venueId or billId', 400);

  const doc = await Bill.findOne({ _id: bid, venueId: vid, status: { $ne: 'deleted' } }).lean();
  if (!doc) return res.notFound('Bill not found');
  return res.success(withTotals(doc));
}

async function patchBill(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, billId } = parsePathParams(event);
  if (!venueId || !billId) return res.error('venueId and billId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const bid = toObjectId(billId);
  if (!vid || !bid) return res.error('Invalid venueId or billId', 400);

  const existing = await Bill.findOne({ _id: bid, venueId: vid, status: { $ne: 'deleted' } }).lean();
  if (!existing) return res.notFound('Bill not found');

  const body = parseBody(event);
  const update = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return res.error('name cannot be empty', 400);
    update.name = name;
  }
  if (body.emi_end_date !== undefined) {
    const d = sanitizeDate(body.emi_end_date);
    if (!d) return res.error('emi_end_date must be a valid date', 400);
    update.emi_end_date = d;
  }
  if (body.emiType !== undefined) {
    const t = String(body.emiType).trim();
    if (!t) return res.error('emiType cannot be empty', 400);
    update.emiType = t;
  }
  if (body.emiDate !== undefined) {
    const d = sanitizeDate(body.emiDate);
    if (!d) return res.error('emiDate must be a valid date', 400);
    update.emiDate = d;
  }
  if (body.defaultAmount !== undefined) {
    const n = sanitizeNonNegative(body.defaultAmount);
    if (n == null) return res.error('defaultAmount must be a non-negative number', 400);
    update.defaultAmount = n;
  }
  if (body.emiStatus !== undefined) {
    if (!Array.isArray(body.emiStatus)) return res.error('emiStatus must be an array', 400);
    const items = body.emiStatus.map(sanitizeEmiStatusItem);
    if (items.some(i => !i)) return res.error('Invalid emiStatus item(s)', 400);
    update.emiStatus = items;
  }

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await Bill.findOneAndUpdate(
    { _id: bid, venueId: vid, status: { $ne: 'deleted' } },
    { $set: update },
    { new: true }
  ).lean();

  if (!doc) return res.notFound('Bill not found');
  return res.success(withTotals(doc));
}

async function patchBillEmiStatus(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, billId } = parsePathParams(event);
  if (!venueId || !billId) return res.error('venueId and billId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const bid = toObjectId(billId);
  if (!vid || !bid) return res.error('Invalid venueId or billId', 400);

  const existing = await Bill.findOne({ _id: bid, venueId: vid, status: { $ne: 'deleted' } }).lean();
  if (!existing) return res.notFound('Bill not found');

  const body = parseBody(event);
  const item = sanitizeEmiStatusItem(body);
  if (!item) return res.error('Invalid EMI status payload', 400);

  // Upsert the specific month/year entry
  const updated = (Array.isArray(existing.emiStatus) ? existing.emiStatus : []).filter(
    s => !(Number(s.month) === item.month && Number(s.year) === item.year)
  );
  updated.push(item);
  updated.sort((a, b) => (a.year - b.year) || (a.month - b.month));

  const doc = await Bill.findOneAndUpdate(
    { _id: bid, venueId: vid, status: { $ne: 'deleted' } },
    { $set: { emiStatus: updated } },
    { new: true }
  ).lean();

  return res.success(withTotals(doc));
}

async function deleteBill(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const { venueId, billId } = parsePathParams(event);
  if (!venueId || !billId) return res.error('venueId and billId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  const bid = toObjectId(billId);
  if (!vid || !bid) return res.error('Invalid venueId or billId', 400);

  const doc = await Bill.findOneAndUpdate(
    { _id: bid, venueId: vid, status: { $ne: 'deleted' } },
    { $set: { status: 'deleted' } },
    { new: true }
  ).lean();

  if (!doc) return res.notFound('Bill not found');
  return res.success({ deleted: true });
}

const routes = [
  { method: 'GET', path: '/venues/{venueId}/bills', fn: getBills },
  { method: 'POST', path: '/venues/{venueId}/bills', fn: postBill },
  { method: 'GET', path: '/venues/{venueId}/bills/{billId}', fn: getBillById },
  { method: 'PATCH', path: '/venues/{venueId}/bills/{billId}', fn: patchBill },
  { method: 'PATCH', path: '/venues/{venueId}/bills/{billId}/emi-status', fn: patchBillEmiStatus },
  { method: 'DELETE', path: '/venues/{venueId}/bills/{billId}', fn: deleteBill },
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

