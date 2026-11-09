export async function apiRequest(endpoint, options = {}) {
  const config = {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    }
  };

  if (options.body) {
    if (typeof options.body === 'object') {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(options.body);
    } else {
      config.body = options.body;
    }
  }

  const response = await fetch(endpoint, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data.error || (data.errors ? data.errors.join(', ') : `Request failed (HTTP ${response.status})`);
    const err = new Error(errorMsg);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function getCurrentUser() {
  try {
    const res = await apiRequest('/api/auth/me');
    return res.user || null;
  } catch {
    return null;
  }
}
