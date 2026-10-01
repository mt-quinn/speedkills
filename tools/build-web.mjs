import { build } from 'esbuild';
import { writeFile, mkdir, cp, rm } from 'node:fs/promises';
// Public deployment URLs. Explicit configuration always overrides these defaults.
const defaults = {
  production: 'https://glad-dogfish-932.convex.cloud',
  preview: 'https://resolute-crocodile-221.convex.cloud',
};
const url=process.env.VITE_CONVEX_URL||process.env.CONVEX_URL||defaults[process.env.VERCEL_ENV];
const cloudflareUrl=process.env.VITE_CLOUDFLARE_URL;
if(!url&&!cloudflareUrl)throw new Error('Set VITE_CONVEX_URL or VITE_CLOUDFLARE_URL before building.');
if(cloudflareUrl&&new URL(cloudflareUrl).protocol!=='https:')throw new Error('The Cloudflare deployment URL must use HTTPS.');
await mkdir('viewer2/js/live', { recursive: true });
await build({ entryPoints: ['viewer2/js/live/client.js'], bundle: true, format: 'esm', outfile: 'viewer2/js/live/client.bundle.js', minify: true, target: 'es2022' });
await writeFile('viewer2/live-config.json',JSON.stringify(cloudflareUrl?{cloudflareUrl}:{convexUrl:url}));
await rm('dist',{recursive:true,force:true});
await cp('viewer2','dist',{recursive:true,filter:path=>!/(?:^|\/)(matches|cards|tools)(?:\/|$)/.test(path)});
await cp('public/background music.opus','dist/sfx/bgm.opus');
console.log(`Built live client with configured ${cloudflareUrl?'Cloudflare':'Convex'} deployment. Legacy recordings are excluded from the deployment.`);
