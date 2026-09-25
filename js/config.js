// Same origin in hosting; support the previous local preview and file access.
(() => {
  const loc = window.location;
  const localPreview = !loc.protocol || loc.protocol === 'file:' || (loc.protocol === 'http:' && loc.port === '8322');
  const apiOrigin = localPreview ? 'http://' + (loc.hostname || '127.0.0.1') + ':3001' : loc.origin;
  window.ChargeGridConfig = { apiOrigin, wsUrl: apiOrigin.replace(/^http/, 'ws') + '/ws' };
})();
