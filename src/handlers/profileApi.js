'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const VenueProfile = require('../models/VenueProfile');
const User = require('../models/User');
const ContactPerson = require('../models/ContactPerson');
const mongoose = require('mongoose');

function getPath(event) {
  return (event.rawPath || event.path || '').replace(/^\/api/, '') || '/';
}

function getMethod(event) {
  return (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
}

async function upsertContactPersons(venueId, contactPersons) {
  if (!Array.isArray(contactPersons)) return null;
  const ids = [];
  for (const raw of contactPersons) {
    if (!raw || typeof raw !== 'object') continue;
    const name = raw.name != null ? String(raw.name).trim() : '';
    const designation = raw.designation != null ? String(raw.designation).trim() : '';
    const contactNumber = raw.contactNumber != null ? String(raw.contactNumber).trim() : '';
    const isActive = raw.isActive !== false;
    const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
    if (!name || !contactNumber) continue;

    if (raw._id) {
      const updated = await ContactPerson.findOneAndUpdate(
        { _id: raw._id, venueId },
        { $set: { name, designation, contactNumber, isActive, metadata } },
        { new: true }
      ).lean();
      if (updated?._id) ids.push(updated._id);
      continue;
    }

    const created = await ContactPerson.create({ venueId, name, designation, contactNumber, isActive, metadata });
    ids.push(created._id);
  }
  return ids;
}

async function getVenueProfileAggregated(venueId) {
  const vid = new mongoose.Types.ObjectId(String(venueId));
  const list = await VenueProfile.aggregate([
    { $match: { venueId: vid } },
    { $addFields: { _cpIds: { $ifNull: ['$contactPersons', []] } } },
    {
      $lookup: {
        from: 'contactpersons',
        localField: '_cpIds',
        foreignField: '_id',
        as: '_cpResolved',
      },
    },
    {
      $lookup: {
        from: 'contactpeople',
        localField: '_cpIds',
        foreignField: '_id',
        as: '_cpLegacy',
      },
    },
    {
      $addFields: {
        contactPersons: {
          $reduce: {
            input: { $concatArrays: ['$_cpResolved', '$_cpLegacy'] },
            initialValue: [],
            in: {
              $cond: [
                {
                  $in: [
                    '$$this._id',
                    { $map: { input: '$$value', as: 'v', in: '$$v._id' } },
                  ],
                },
                '$$value',
                { $concatArrays: ['$$value', ['$$this']] },
              ],
            },
          },
        },
      },
    },
    { $project: { _cpIds: 0, _cpResolved: 0, _cpLegacy: 0 } },
  ]);
  return list[0] || null;
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
  const doc = await getVenueProfileAggregated(venueId);
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

  const contactPersonIds = await upsertContactPersons(venueId, body.contactPersons);

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
    contactPersons: contactPersonIds ? contactPersonIds : undefined,
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
  const doc = await getVenueProfileAggregated(venueId);
  if (!doc) return res.notFound('Venue profile not found');
  return res.success(doc);
}

async function deleteContactPerson(event) {
  const user = auth.requireRole(event, [auth.ROLES.ADMIN, auth.ROLES.INCHARGE]);
  const contactPersonId =
    event.pathParameters?.contactPersonId || event.pathParameters?.contactId || event.pathParameters?.id;
  if (!contactPersonId) return res.error('contactPersonId required', 400);

  const venueId = await resolveVenueId(event, user);
  if (!venueId) return res.error('venueId is required for admin', 400);

  let vid;
  let cid;
  try {
    vid = new mongoose.Types.ObjectId(String(venueId));
    cid = new mongoose.Types.ObjectId(String(contactPersonId));
  } catch (_) {
    return res.error('Invalid venueId or contactPersonId', 400);
  }

  const deleted = await ContactPerson.findOneAndDelete({ _id: cid, venueId: vid }).lean();
  if (!deleted) return res.notFound('Contact person not found');

  await VenueProfile.findOneAndUpdate(
    { venueId: vid },
    { $pull: { contactPersons: deleted._id } },
    { new: true }
  );

  return res.success({ deleted: true });
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
  const contactPersonIds = await upsertContactPersons(venueId, body.contactPersons);
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
    contactPersons: contactPersonIds ? contactPersonIds : undefined,
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
  { method: 'DELETE', path: '/profile/venue/contact-persons/{contactPersonId}', fn: deleteContactPerson },
  { method: 'GET', path: '/venues/{venueId}/profile', fn: getVenueProfile },
  { method: 'PUT', path: '/venues/{venueId}/profile', fn: putVenueProfile },
  { method: 'DELETE', path: '/venues/{venueId}/profile/contact-persons/{contactPersonId}', fn: deleteContactPerson },
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
