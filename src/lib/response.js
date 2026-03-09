'use strict';

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Return a JSON API response.
 * @param {number} statusCode
 * @param {object} body - will be JSON.stringify'd
 * @param {object} [headers]
 */
function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...DEFAULT_HEADERS, ...headers },
    body: JSON.stringify(body),
  };
}

function success(data, statusCode = 200) {
  return json(statusCode, { success: true, data });
}

function error(message, statusCode = 400, code = 'ERROR') {
  return json(statusCode, { success: false, error: { message, code } });
}

function notFound(message = 'Resource not found') {
  return error(message, 404, 'NOT_FOUND');
}

function unauthorized(message = 'Unauthorized') {
  return error(message, 401, 'UNAUTHORIZED');
}

function forbidden(message = 'Forbidden') {
  return error(message, 403, 'FORBIDDEN');
}

/**
 * Wrap async handler to catch errors and return proper status.
 * @param {(event, context) => Promise<{ statusCode: number, body?: string, headers?: object }>} fn
 */
function withErrorHandler(fn) {
  return async (event, context) => {
    try {
      return await fn(event, context);
    } catch (err) {
      const statusCode = err.statusCode || 500;
      const message = err.message || 'Internal server error';
      return json(statusCode, { success: false, error: { message } });
    }
  };
}

module.exports = {
  json,
  success,
  error,
  notFound,
  unauthorized,
  forbidden,
  withErrorHandler,
};
