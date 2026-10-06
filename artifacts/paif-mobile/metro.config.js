const { getDefaultConfig } = require('expo/metro-config');

const { publicResearchProxy } = require('./server/research-proxy.cjs');
const config = getDefaultConfig(__dirname);
// Expo web has a separate preview host. Proxy only the three public research
// routes so browser requests remain same-origin, without exposing fund actions
// or weakening the original website's CORS/security policy.
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => publicResearchProxy(middleware),
};
module.exports = config;
