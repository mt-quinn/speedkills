import { build } from 'esbuild';
import { writeFile, mkdir, cp, rm } from 'node:fs/promises';
// Public deployment URLs. Explicit configuration always overrides these defaults.
const defaults = {
  production: 'https://glad-dogfish-932.convex.cloud',
  preview: 'https://resolute-crocodile-221.convex.cloud',
};
const url=process.env.VITE_CONVEX_URL||process.env.CONVEX_URL||defaults[process.env.VERCEL_ENV];
if(!url)throw new Error('Set VITE_CONVEX_URL to the target Convex deployment before building.');
await mkdir('viewer2/js/live', { recursive: true });
await build({ entryPoints: ['viewer2/js/live/client.js'], bundle: true, format: 'esm', outfile: 'viewer2/js/live/client.bundle.js', minify: true, target: 'es2022' });
await writeFile('viewer2/live-config.json',JSON.stringify({convexUrl:url}));
await rm('dist',{recursive:true,force:true});
await cp('viewer2','dist',{recursive:true,filter:path=>!/(?:^|\/)(matches|cards|tools)(?:\/|$)/.test(path)});
await cp('public/background music.opus','dist/sfx/bgm.opus');
console.log(`Built live client${url?' with configured Convex deployment':'; Convex URL is not configured'}. Legacy recordings are excluded from the deployment.`);
