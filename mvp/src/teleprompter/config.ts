export const clientConfig = {
  realtimeSessionPath: '/session',
  configPath: import.meta.env.VITE_APP_CONFIG_PATH || '/api/config',
  visualRuntime: 'canvas-glyph-particles',
} as const
