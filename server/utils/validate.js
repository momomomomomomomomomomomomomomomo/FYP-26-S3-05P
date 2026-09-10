'use strict';
const { ApiError } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Children sign in with a short login id rather than an email address.
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,49}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(value, field, { min = 1, max = 255, required = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw ApiError.badRequest(`${field} is required.`);
    return null;
  }
  const s = String(value).trim();
  if (s.length < min) throw ApiError.badRequest(`${field} must be at least ${min} characters.`);
  if (s.length > max) throw ApiError.badRequest(`${field} must be ${max} characters or fewer.`);
  return s;
}

function int(value, field, { min = -Infinity, max = Infinity, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw ApiError.badRequest(`${field} is required.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw ApiError.badRequest(`${field} must be a whole number.`);
  if (n < min || n > max) throw ApiError.badRequest(`${field} must be between ${min} and ${max}.`);
  return n;
}

function email(value, field = 'Email', { required = true } = {}) {
  const s = str(value, field, { required, max: 255 });
  if (s === null) return null;
  if (!EMAIL_RE.test(s)) throw ApiError.badRequest(`${field} does not look like a valid email address.`);
  return s.toLowerCase();
}

function loginId(value, field = 'Login ID') {
  const s = str(value, field, { min: 3, max: 50 });
  if (!LOGIN_ID_RE.test(s)) {
    throw ApiError.badRequest(`${field} may only contain letters, numbers, dots, dashes and underscores.`);
  }
  return s.toLowerCase();
}

function password(value, field = 'Password') {
  const s = str(value, field, { min: 8, max: 100 });
  if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) {
    throw ApiError.badRequest(`${field} must contain at least one letter and one number.`);
  }
  return s;
}

/** Child passwords are deliberately gentler: 6+ characters, no composition rule. */
function childPassword(value, field = 'Password') {
  return str(value, field, { min: 6, max: 100 });
}

function dateOfBirth(value, field = 'Date of birth') {
  const s = str(value, field, { max: 10 });
  if (!DATE_RE.test(s)) throw ApiError.badRequest(`${field} must be in YYYY-MM-DD format.`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`${field} is not a real date.`);
  if (d.getTime() > Date.now()) throw ApiError.badRequest(`${field} cannot be in the future.`);
  if (d.getUTCFullYear() < 1900) throw ApiError.badRequest(`${field} is not a real date.`);
  return s;
}

function oneOf(value, field, allowed, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw ApiError.badRequest(`${field} is required.`);
    return null;
  }
  const s = String(value).trim().toUpperCase();
  if (!allowed.includes(s)) {
    throw ApiError.badRequest(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return s;
}

/**
 * Like `oneOf`, but compares exactly: no trimming to upper case. Used for
 * values where case folding makes no sense, such as an emoji reaction.
 */
function oneOfExact(value, field, allowed) {
  if (value === undefined || value === null || value === '') {
    throw ApiError.badRequest(`${field} is required.`);
  }
  const s = String(value);
  if (!allowed.includes(s)) throw ApiError.badRequest(`${field} is not one we recognise.`);
  return s;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** Clamp a value to a safe integer for use in a LIMIT clause. */
function limit(value, fallback = 24, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

function offset(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), 100000);
}

module.exports = {
  str, int, email, loginId, password, childPassword, dateOfBirth,
  oneOf, oneOfExact, bool, limit, offset, EMAIL_RE, LOGIN_ID_RE,
};
