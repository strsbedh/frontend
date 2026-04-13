// WebRTC configuration
export const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Add TURN server for NAT traversal if needed:
    // { urls: 'turn:your-turn-server.com:3478', username: 'user', credential: 'pass' }
  ],
};

export const API_URL = `${process.env.REACT_APP_BACKEND_URL}/api`;
