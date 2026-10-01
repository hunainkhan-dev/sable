// Vercel serverless entry — re-exports the request handler from the shared server.
// All /api/* requests are routed here by vercel.json; static files are served from /public.
export { default } from '../server/server.js';
