export function debugLog(...args: any[]) {
  if (process.env.DEBUG === 'true') {
    // eslint-disable-next-line no-console
    console.log('[DEBUG]', ...args);
  }
} 