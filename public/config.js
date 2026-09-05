// Runtime configuration for the hosted browser client.
//
// This placeholder ships in the bundle and defines nothing, so desktop builds
// and local dev behave exactly as before. The hosted-web container REPLACES the
// response for this path at runtime (see deploy/web/Caddyfile), filling in the
// instance's connect URL from the container's environment.
//
// That indirection is what lets one published letschat-web image serve any
// instance. Baking the URL in at build time made the image single-tenant, which
// meant it could not be published at all — so every operator had to compile the
// frontend on their own deployment target.
window.__LETSCHAT_CONFIG__ = window.__LETSCHAT_CONFIG__ || {}
