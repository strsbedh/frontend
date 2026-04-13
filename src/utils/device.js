// Device identity management via localStorage
const KEYS = {
  id: 'rtd_device_id',
  name: 'rtd_device_name',
  token: 'rtd_auth_token',
};

export function getDeviceId() {
  let id = localStorage.getItem(KEYS.id);
  if (!id) {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    id = 'DEV-';
    for (let i = 0; i < 8; i++) id += c[Math.floor(Math.random() * c.length)];
    localStorage.setItem(KEYS.id, id);
  }
  return id;
}

export function getDeviceName() {
  return localStorage.getItem(KEYS.name) || '';
}

export function setDeviceName(name) {
  localStorage.setItem(KEYS.name, name);
}

export function getAuthToken() {
  return localStorage.getItem(KEYS.token) || '';
}

export function setAuthToken(token) {
  localStorage.setItem(KEYS.token, token);
}

export function isRegistered() {
  return !!(localStorage.getItem(KEYS.id) && localStorage.getItem(KEYS.token));
}

export function clearDevice() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
}
