'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const VenueProfile = require('../models/VenueProfile');
const User = require('../models/User');

function getPath(event) {
  return (event.rawPath || event.path || '').replace(/^\/api/, '') || '/';
}

function getMethod(event) {
  return (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
}

/**
 * Resolve venueId for the request: incharge restricted to their venueId; admin can use param or query.
 */
async function resolveVenueId(event, user) {
  const paramVenueId = event.pathParameters?.venueId;
  const queryVenueId = event.queryStringParameters?.venueId;

  if (user.role === auth.ROLES.ADMIN) {
    return paramVenueId || queryVenueId || null;
  }
  if (user.role === auth.ROLES.INCHARGE) {
    const u = await User.findById(user.sub).select('venueId').lean();
    const inchargeVenueId = u?.venueId?.toString();
    if (!inchargeVenueId) {
      const err = new Error('Incharge has no venue assigned');
      err.statusCode = 403;
      throw err;
    }
    if (paramVenueId && paramVenueId !== inchargeVenueId) {
      const err = new Error('Forbidden: cannot access another venue profile');
      err.statusCode = 403;
      throw err;
    }
    return inchargeVenueId;
  }
  return null;
}

/**
 * GET /api/profile/venue — get current user's venue profile (incharge: own venue; admin: ?venueId=).
 */
async function getProfileVenue(event) {
  const user = auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = await resolveVenueId(event, user);
  if (!venueId) return res.error('venueId is required for admin', 400);
  const doc = await VenueProfile.findOne({ venueId }).lean();
  if (!doc) return res.notFound('Venue profile not found');
  return res.success(doc);
}

/**
 * PUT /api/profile/venue — create or update venue profile (incharge: own venue; admin: body.venueId).
 */
async function putProfileVenue(event) {
  const user = auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  let venueId = await resolveVenueId(event, user);
  if (user.role === auth.ROLES.ADMIN && body.venueId) venueId = body.venueId;
  if (!venueId) return res.error('venueId is required', 400);

  const update = {
    logo: body.logo !== undefined ? body.logo : undefined,
    venueName: body.venueName !== undefined ? body.venueName : undefined,
    tagline: body.tagline !== undefined ? body.tagline : undefined,
    description: body.description !== undefined ? body.description : undefined,
    address: body.address !== undefined ? body.address : undefined,
    googleMapUrl: body.googleMapUrl !== undefined ? body.googleMapUrl : undefined,
    email: body.email !== undefined ? body.email : undefined,
    instagram: body.instagram !== undefined ? body.instagram : undefined,
    facebook: body.facebook !== undefined ? body.facebook : undefined,
    website: body.website !== undefined ? body.website : undefined,
    legal: body.legal !== undefined ? body.legal : undefined,
  };
  Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);
  if (update.legal && typeof update.legal === 'object') {
    const legal = update.legal;
    if (legal.businessName !== undefined) update['legal.businessName'] = legal.businessName;
    if (legal.gst !== undefined) update['legal.gst'] = legal.gst;
    delete update.legal;
  }

  const doc = await VenueProfile.findOneAndUpdate(
    { venueId },
    { $set: update },
    { new: true, upsert: true }
  ).lean();
  return res.success(doc);
}

/**
 * GET /api/venues/{venueId}/profile — get profile by venue (admin or incharge for that venue).
 */
async function getVenueProfile(event) {
  const user = auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  await resolveVenueId(event, user);
  const doc = await VenueProfile.findOne({ venueId }).lean();
  if (!doc) return res.notFound('Venue profile not found');
  return res.success(doc);
}

/**
 * PUT /api/venues/{venueId}/profile — upsert profile for venue (incharge only own venue).
 */
async function putVenueProfile(event) {
  const user = auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const venueId = event.pathParameters?.venueId;
  if (!venueId) return res.error('venueId required', 400);
  await resolveVenueId(event, user);

  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  const update = {
    logo: body.logo !== undefined ? body.logo : undefined,
    venueName: body.venueName !== undefined ? body.venueName : undefined,
    tagline: body.tagline !== undefined ? body.tagline : undefined,
    description: body.description !== undefined ? body.description : undefined,
    address: body.address !== undefined ? body.address : undefined,
    googleMapUrl: body.googleMapUrl !== undefined ? body.googleMapUrl : undefined,
    email: body.email !== undefined ? body.email : undefined,
    instagram: body.instagram !== undefined ? body.instagram : undefined,
    facebook: body.facebook !== undefined ? body.facebook : undefined,
    website: body.website !== undefined ? body.website : undefined,
    legal: body.legal !== undefined ? body.legal : undefined,
  };
  Object.keys(update).forEach((k) => update[k] === undefined && delete update[k]);
  if (update.legal && typeof update.legal === 'object') {
    const legal = update.legal;
    if (legal.businessName !== undefined) update['legal.businessName'] = legal.businessName;
    if (legal.gst !== undefined) update['legal.gst'] = legal.gst;
    delete update.legal;
  }

  const doc = await VenueProfile.findOneAndUpdate(
    { venueId },
    { $set: update },
    { new: true, upsert: true }
  ).lean();
  return res.success(doc);
}

const routes = [
  { method: 'GET', path: '/profile/venue', fn: getProfileVenue },
  { method: 'PUT', path: '/profile/venue', fn: putProfileVenue },
  { method: 'GET', path: '/venues/{venueId}/profile', fn: getVenueProfile },
  { method: 'PUT', path: '/venues/{venueId}/profile', fn: putVenueProfile },
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
