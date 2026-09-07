'use strict';
require('dotenv').config();

const config = {
  port: Number(process.env.PORT || 3000),
  env: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'storynest',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'storynest-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  cookieName: 'storynest_token',
};

if (config.env === 'production' && config.jwt.secret.includes('change-me')) {
  throw new Error('JWT_SECRET must be set to a real secret before running in production.');
}

module.exports = config;
