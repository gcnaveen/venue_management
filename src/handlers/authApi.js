'use strict';

const { connect } = require('../lib/db');
const auth = require('../lib/auth');
const res = require('../lib/response');
const User = require('../models/User');
const mongoose = require('mongoose');

function getPath(event) {
  return (event.rawPath || event.path || '').replace(/^\/api/, '') || '/';
}

function getMethod(event) {
  return (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
}

async function postRegister(event) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  const { email, password, name, role: roleRaw, venueId } = body;
  if (!email || !password || !name) {
    return res.error('email, password and name are required', 400);
  }
  const r = String(roleRaw ?? '').toLowerCase().trim();
  const role = (r === auth.ROLES.ADMIN || r === auth.ROLES.INCHARGE || r === auth.ROLES.OWNER) ? r : auth.ROLES.INCHARGE;
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.error('Email already registered', 409);
  const user = await User.create({
    email: email.toLowerCase(),
    password,
    name: (name || '').trim(),
    role,
    venueId: (role === auth.ROLES.INCHARGE || role === auth.ROLES.OWNER) ? (venueId || null) : null,
  });
  const token = auth.signToken({ _id: user._id, email: user.email, role: user.role });
  return res.success(
    { user: { _id: user._id, email: user.email, name: user.name, role: user.role, venueId: user.venueId }, token },
    201
  );
}

async function postLogin(event) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  const { email, password } = body;
  if (!email || !password) return res.error('email and password are required', 400);
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) return res.unauthorized('Invalid email or password');
  if (user.isBlocked) return res.forbidden('Account is blocked');
  const ok = await user.comparePassword(password);
  if (!ok) return res.unauthorized('Invalid email or password');
  const token = auth.signToken({ _id: user._id, email: user.email, role: user.role });
  return res.success({
    user: { _id: user._id, email: user.email, name: user.name, role: user.role, venueId: user.venueId },
    token,
  });
}

async function getMe(event) {
  const user = auth.requireAuth(event);
  const uid = new mongoose.Types.ObjectId(String(user.sub));
  const list = await User.aggregate([
    { $match: { _id: uid } },
    { $project: { password: 0 } },
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
        from: 'venueprofiles',
        localField: 'venueId',
        foreignField: 'venueId',
        as: 'venueProfile',
      },
    },
    { $unwind: { path: '$venueProfile', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'contactpersons',
        localField: 'venueProfile.contactPersons',
        foreignField: '_id',
        as: '_cpResolved',
      },
    },
    {
      $lookup: {
        from: 'contactpeople',
        localField: 'venueProfile.contactPersons',
        foreignField: '_id',
        as: '_cpLegacy',
      },
    },
    {
      $addFields: {
        _cpMerged: {
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
    {
      $addFields: {
        venueProfile: {
          $cond: [
            { $ifNull: ['$venueProfile', false] },
            { $mergeObjects: ['$venueProfile', { contactPersons: '$_cpMerged' }] },
            null,
          ],
        },
      },
    },
    { $project: { _cpResolved: 0, _cpLegacy: 0, _cpMerged: 0 } },
  ]);
  const doc = list[0] || null;
  if (!doc) return res.notFound('User not found');
  return res.success(doc);
}

/** Parse JSON body from Lambda event (string or object; optional base64). */
function parseBody(event) {
  let raw = event.body;
  if (raw == null) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  if (event.isBase64Encoded && typeof raw === 'string') {
    try {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    } catch (_) {}
  }
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw || '{}');
  } catch (_) {
    return {};
  }
}

/** Admin creates a user (if the user has not registered). Use POST /api/users with Admin Bearer token (not POST /api/auth/register). */
async function postCreateUser(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const body = parseBody(event);
  const email = body.email != null ? String(body.email).trim() : '';
  const password = body.password;
  const name = body.name != null ? String(body.name).trim() : '';
  const roleRaw = body.role ?? body.Role ?? '';
  const venueId = body.venueId;

  if (!email || !password || !name) {
    return res.error('email, password and name are required', 400);
  }
  const r = String(roleRaw).toLowerCase().trim();
  if (r !== auth.ROLES.ADMIN && r !== auth.ROLES.INCHARGE && r !== auth.ROLES.OWNER) {
    return res.error('role must be admin, owner, or incharge', 400);
  }
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) return res.error('Email already registered', 409);
  const user = await User.create({
    email: email.toLowerCase(),
    password,
    name,
    role: r,
    venueId: (r === auth.ROLES.INCHARGE || r === auth.ROLES.OWNER) ? (venueId || null) : null,
  });
  const created = await User.findById(user._id).select('-password').lean();
  return res.success(created, 201);
}

async function aggregateUsers(match) {
  return User.aggregate([
    { $match: match },
    { $project: { password: 0 } },
    { $sort: { createdAt: -1 } },
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
}

async function getUsers(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const list = await aggregateUsers({});
  return res.success(list);
}

async function getUserById(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const userId = event.pathParameters?.userId;
  if (!userId) return res.error('userId required', 400);

  let uid;
  try { uid = new mongoose.Types.ObjectId(String(userId)); } catch (_) {
    return res.error('Invalid userId', 400);
  }

  const list = await aggregateUsers({ _id: uid });
  const doc = list[0];
  if (!doc) return res.notFound('User not found');
  return res.success(doc);
}

async function patchUser(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const userId = event.pathParameters?.userId;
  if (!userId) return res.error('userId required', 400);
  const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body || {};
  const allowed = ['name', 'email', 'role', 'venueId'];
  const update = {};
  for (const k of allowed) if (body[k] !== undefined) update[k] = body[k];
  if (update.email) update.email = update.email.toLowerCase();
  const doc = await User.findByIdAndUpdate(userId, { $set: update }, { new: true }).select('-password');
  if (!doc) return res.notFound('User not found');
  return res.success(doc);
}

async function deleteUser(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const userId = event.pathParameters?.userId;
  if (!userId) return res.error('userId required', 400);
  const doc = await User.findByIdAndDelete(userId);
  if (!doc) return res.notFound('User not found');
  return res.success({ deleted: true });
}

async function postBlockUser(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const userId = event.pathParameters?.userId;
  if (!userId) return res.error('userId required', 400);
  const doc = await User.findByIdAndUpdate(userId, { isBlocked: true }, { new: true }).select('-password');
  if (!doc) return res.notFound('User not found');
  return res.success(doc);
}

async function postUnblockUser(event) {
  auth.requireRole(event, [auth.ROLES.ADMIN]);
  const userId = event.pathParameters?.userId;
  if (!userId) return res.error('userId required', 400);
  const doc = await User.findByIdAndUpdate(userId, { isBlocked: false }, { new: true }).select('-password');
  if (!doc) return res.notFound('User not found');
  return res.success(doc);
}

const routes = [
  { method: 'POST', path: '/auth/register', fn: postRegister },
  { method: 'POST', path: '/auth/login', fn: postLogin },
  { method: 'GET', path: '/auth/me', fn: getMe },
  { method: 'POST', path: '/users', fn: postCreateUser },
  { method: 'GET', path: '/users', fn: getUsers },
  { method: 'GET', path: '/users/{userId}', fn: getUserById },
  { method: 'PATCH', path: '/users/{userId}', fn: patchUser },
  { method: 'DELETE', path: '/users/{userId}', fn: deleteUser },
  { method: 'POST', path: '/users/{userId}/block', fn: postBlockUser },
  { method: 'POST', path: '/users/{userId}/unblock', fn: postUnblockUser },
];

function matchRoute(method, path) {
  const normalized = path.replace(/^\/api/, '') || '/';
  for (const r of routes) {
    if (r.method !== method) continue;
    const pattern = r.path.replace(/\{[\w]+\}/g, '[^/]+');
    const re = new RegExp('^' + pattern + '$');
    if (re.test(normalized)) return r.fn;
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
