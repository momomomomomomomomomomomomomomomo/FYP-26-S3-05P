'use strict';
const config = require('../config');
const { ApiError } = require('../utils/errors');

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'That endpoint does not exist.' });
  }
  return next();
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err instanceof ApiError ? err.status : 500;
  let message = err instanceof ApiError ? err.message : 'Something went wrong on our side.';

  // Turn the MySQL errors we can predict into readable messages.
  if (err.code === 'ER_DUP_ENTRY') {
    status = 409;
    message = 'That record already exists.';
  } else if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    status = 400;
    message = 'That referenced record does not exist.';
  } else if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    status = 503;
    message = 'The database is not reachable. Check that MySQL is running and your .env is correct.';
  }

  if (status >= 500) console.error('[error]', err);

  const body = { error: message };
  if (err.details) body.details = err.details;
  if (config.env !== 'production' && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
