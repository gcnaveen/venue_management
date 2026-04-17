'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const VenuePricing = require('../models/VenuePricing');
const Venue = require('../models/Venue');
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
  if (decoded.role === auth.ROLES.ADMIN) return;
  if (decoded.role === auth.ROLES.INCHARGE || decoded.role === auth.ROLES.OWNER) {
    const User = require('../models/User');
    const u = await User.findById(decoded.sub).select('venueId').lean();
    if (u?.venueId?.toString() !== String(venueId)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
    return;
  }
  const err = new Error('Forbidden');
  err.statusCode = 403;
  throw err;
}

/**
 * Sanitize rackRates — ensure only valid duration keys, values are strings.
 */
function sanitizeRackRates(raw) {
  const rates = {};
  for (const k of VenuePricing.DURATION_KEYS) {
    rates[k] = raw && raw[k] != null ? String(raw[k]).trim() : '';
  }
  return rates;
}

/**
 * Sanitize inclusions array.
 */
function sanitizeInclusions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object' && String(item.name || '').trim())
    .map(item => ({
      name: String(item.name).trim(),
      maxQuantity: Number.isFinite(Number(item.maxQuantity)) ? Number(item.maxQuantity) : null,
    }));
}

/**
 * Sanitize addons array.
 */
function sanitizeAddons(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object' && String(item.name || '').trim())
    .map(item => ({
      name: String(item.name).trim(),
      maxQuantity: Number.isFinite(Number(item.maxQuantity)) ? Number(item.maxQuantity) : null,
      prices: sanitizeRackRates(item.prices),
    }));
}

/**
 * Sanitize spacePricings map.
 */
function sanitizeSpacePricings(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const result = {};
  for (const [spaceId, pricing] of Object.entries(raw)) {
    if (!spaceId || !pricing || typeof pricing !== 'object') continue;
    result[spaceId] = {
      rackRates: sanitizeRackRates(pricing.rackRates),
      inclusions: sanitizeInclusions(pricing.inclusions),
      addons: sanitizeAddons(pricing.addons),
    };
  }
  return result;
}

/**
 * GET /api/venues/{venueId}/pricing
 *
 * Returns the full pricing document with spaces populated.
 */
async function getPricing(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const list = await VenuePricing.aggregate([
    { $match: { venueId: vid } },
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
        let: { vid: '$venueId' },
        pipeline: [
          { $match: { $expr: { $eq: ['$venueId', '$$vid'] } } },
          { $project: { name: 1, capacity: 1, dimensions: 1, isActive: 1, images: 1 } },
        ],
        as: 'spaces',
      },
    },
  ]);

  const doc = list[0] || null;
  if (!doc) return res.success({ venueId, buyoutOnly: false, rackRates: {}, inclusions: [], addons: [], spaceOnly: false, spacePricings: {}, spaces: [] });
  return res.success(doc);
}

/**
 * PUT /api/venues/{venueId}/pricing
 *
 * Upserts the full pricing document. Accepts venue buyout fields, space buyout fields, or both.
 */
async function putPricing(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const venue = await Venue.findById(vid).lean();
  if (!venue) return res.notFound('Venue not found');

  const body = parseBody(event);
  const update = {};

  // Venue buyout fields
  if (body.buyoutOnly !== undefined) update.buyoutOnly = Boolean(body.buyoutOnly);
  if (body.rackRates !== undefined) update.rackRates = sanitizeRackRates(body.rackRates);
  if (body.inclusions !== undefined) update.inclusions = sanitizeInclusions(body.inclusions);
  if (body.addons !== undefined) update.addons = sanitizeAddons(body.addons);

  // Space buyout fields
  if (body.spaceOnly !== undefined) update.spaceOnly = Boolean(body.spaceOnly);
  if (body.spacePricings !== undefined) update.spacePricings = sanitizeSpacePricings(body.spacePricings);

  const doc = await VenuePricing.findOneAndUpdate(
    { venueId: vid },
    { $set: update },
    { new: true, upsert: true }
  ).lean();

  return res.success(doc);
}

/**
 * PATCH /api/venues/{venueId}/pricing/venue-buyout
 *
 * Partial update for venue buyout fields only.
 */
async function patchVenueBuyout(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const body = parseBody(event);
  const update = {};
  if (body.buyoutOnly !== undefined) update.buyoutOnly = Boolean(body.buyoutOnly);
  if (body.rackRates !== undefined) update.rackRates = sanitizeRackRates(body.rackRates);
  if (body.inclusions !== undefined) update.inclusions = sanitizeInclusions(body.inclusions);
  if (body.addons !== undefined) update.addons = sanitizeAddons(body.addons);

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await VenuePricing.findOneAndUpdate(
    { venueId: vid },
    { $set: update },
    { new: true, upsert: true }
  ).lean();

  return res.success(doc);
}

/**
 * PATCH /api/venues/{venueId}/pricing/space-buyout
 *
 * Partial update for space buyout fields only.
 */
async function patchSpaceBuyout(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  await assertVenueAccess(event, venueId);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const body = parseBody(event);
  const update = {};
  if (body.spaceOnly !== undefined) update.spaceOnly = Boolean(body.spaceOnly);
  if (body.spacePricings !== undefined) update.spacePricings = sanitizeSpacePricings(body.spacePricings);

  if (Object.keys(update).length === 0) return res.error('At least one field required', 400);

  const doc = await VenuePricing.findOneAndUpdate(
    { venueId: vid },
    { $set: update },
    { new: true, upsert: true }
  ).lean();

  return res.success(doc);
}

/**
 * DELETE /api/venues/{venueId}/pricing
 *
 * Remove all pricing for a venue.
 */
async function deletePricing(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);

  const vid = toObjectId(venueId);
  if (!vid) return res.error('Invalid venueId', 400);

  const deleted = await VenuePricing.findOneAndDelete({ venueId: vid }).lean();
  if (!deleted) return res.notFound('Pricing not found');
  return res.success({ deleted: true });
}

const routes = [
  { method: 'GET', path: '/venues/{venueId}/pricing', fn: getPricing },
  { method: 'PUT', path: '/venues/{venueId}/pricing', fn: putPricing },
  { method: 'PATCH', path: '/venues/{venueId}/pricing/venue-buyout', fn: patchVenueBuyout },
  { method: 'PATCH', path: '/venues/{venueId}/pricing/space-buyout', fn: patchSpaceBuyout },
  { method: 'DELETE', path: '/venues/{venueId}/pricing', fn: deletePricing },
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
