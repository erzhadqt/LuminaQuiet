const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

const isBrowser = typeof window !== 'undefined';

const defaultBackendHttpBase = () => {
  if (!isBrowser) {
    return 'http://localhost:8000';
  }

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//${window.location.hostname}:8000`;
};

const backendHttpBase = trimTrailingSlash(
  import.meta.env.VITE_BACKEND_URL || defaultBackendHttpBase()
);

const wsBaseFromHttp = () => {
  const parsed = new URL(backendHttpBase);
  const wsProtocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${parsed.host}`;
};

const backendWsBase = trimTrailingSlash(
  import.meta.env.VITE_BACKEND_WS_URL || wsBaseFromHttp()
);

export const ENDPOINTS = {
  currentNoise: `${backendHttpBase}/api/current-noise/`,
  currentNoiseHistory: `${backendHttpBase}/api/current-noise/?history=1&limit=100`,
  deviceConfig: `${backendHttpBase}/api/device-config/`,
  currentSession: `${backendHttpBase}/api/sessions/current/`,
  startSession: `${backendHttpBase}/api/sessions/start/`,
  stopSession: `${backendHttpBase}/api/sessions/stop/`,
  createLog: `${backendHttpBase}/api/logs/`,
  noiseSocket: `${backendWsBase}/ws/noise/`,
};
