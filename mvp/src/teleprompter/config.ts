export const clientConfig = {
  realtimeSessionPath:
    import.meta.env.VITE_REALTIME_SESSION_PATH || '/api/realtime/session',
  configPath: import.meta.env.VITE_APP_CONFIG_PATH || '/api/config',
  visualRuntime: 'canvas-glyph-particles',
} as const
