// Vercel entry point: the whole Express app (the web server in src/web/api-server.ts) runs as one serverless function.
// Vercel runs `npm run build` first (see vercel.json), which compiles src/ to dist/, and this file loads the compiled app.
// It exports the app instead of calling listen(): Vercel starts a function per request and has no long-running server.
// vercel.json sends /api/* and /docs to this function; everything else is served from public/.
import { createApp } from '../dist/web/api-server.js';

export default createApp();
