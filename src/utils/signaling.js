// WebSocket signaling helpers for device-based routing
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

export function getWsUrl(path) {
  return BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://') + path;
}
