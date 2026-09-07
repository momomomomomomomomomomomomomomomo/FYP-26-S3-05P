/* StoryNest - thin wrapper around fetch.
   Every call sends the session cookie and turns a non-2xx response into a
   thrown ApiError, so pages can use try/catch instead of checking res.ok. */
(function attachApi(global) {
  'use strict';

  class ApiError extends Error {
    constructor(status, message, details) {
      super(message);
      this.status = status;
      this.details = details || null;
    }
  }

  function buildUrl(path, params) {
    const url = new URL(path, global.location.origin);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
        else url.searchParams.set(key, value);
      });
    }
    return url.toString();
  }

  async function request(path, options) {
    const opts = options || {};
    const init = {
      method: opts.method || 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    let res;
    try {
      res = await fetch(buildUrl(path, opts.params), init);
    } catch (err) {
      throw new ApiError(0, 'Could not reach the server. Is it still running?');
    }

    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const payload = isJson ? await res.json().catch(() => ({})) : {};

    if (!res.ok) {
      throw new ApiError(res.status, payload.error || `Request failed (${res.status})`, payload.details);
    }
    return payload;
  }

  global.api = {
    ApiError,
    request,
    get: (path, params) => request(path, { params }),
    post: (path, body) => request(path, { method: 'POST', body }),
    put: (path, body) => request(path, { method: 'PUT', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    del: (path, params) => request(path, { method: 'DELETE', params }),
  };
}(window));
