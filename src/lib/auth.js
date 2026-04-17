'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const ROLES = Object.freeze({
  ADMIN: 'admin',
  INCHARGE: 'incharge',
  OWNER: 'owner',
});

/**
 * Sign a JWT for a user payload.
 * @param {{ _id: string, email: string, role: string }} payload
 * @returns {string} token
 */
function signToken(payload) {
  return jwt.sign(
    {
      sub: payload._id.toString(),
      email: payload.email,
      role: payload.role,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verify JWT from Authorization header or token string.
 * @param {string} [authHeader] - "Bearer <token>"
 * @param {string} [token] - raw token
 * @returns {{ sub: string, email: string, role: string } | null}
 */
function verifyToken(authHeader, token) {
  const raw = token || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null);
  if (!raw) return null;
  try {
    return jwt.verify(raw, JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * Get auth headers from Lambda event (HTTP API / API Gateway).
 * @param {object} event - Lambda event
 * @returns {{ authorization?: string }}
 */
function getAuthHeaders(event) {
  const headers = event?.headers || {};
  const auth = headers.authorization || headers.Authorization;
  return { authorization: auth };
}

/**
 * Require valid JWT. Returns decoded payload or throws.
 * @param {object} event - Lambda event
 * @returns {{ sub: string, email: string, role: string }}
 */
function requireAuth(event) {
  const { authorization } = getAuthHeaders(event);
  const decoded = verifyToken(authorization);
  if (!decoded) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
  return decoded;
}

/**
 * Require one of the given roles.
 * @param {object} event - Lambda event
 * @param {string[]} allowedRoles - e.g. [ROLES.ADMIN, ROLES.INCHARGE]
 * @returns {{ sub: string, email: string, role: string }}
 */
function requireRole(event, allowedRoles) {
  const user = requireAuth(event);
  const expandedAllowed = new Set(allowedRoles);
  if (expandedAllowed.has(ROLES.INCHARGE)) expandedAllowed.add(ROLES.OWNER);
  if (!expandedAllowed.has(user.role)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
  return user;
}

module.exports = {
  ROLES,
  signToken,
  verifyToken,
  getAuthHeaders,
  requireAuth,
  requireRole,
};
