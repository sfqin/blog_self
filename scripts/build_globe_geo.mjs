// Minimal, self-hosted D3 spherical clipping/projection bundle; no CDN at runtime.
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const here=fileURLToPath(new URL('.',import.meta.url));
const out=new URL('../web/static/js/globe-geo.js',import.meta.url);
await build({
 stdin:{contents:'export {geoArea, geoOrthographic, geoPath} from "d3-geo";',resolveDir:here},
 bundle:true,format:'iife',globalName:'GlobeGeo',minify:true,target:'es2018',
 outfile:fileURLToPath(out),
 banner:{js:'/*! D3 geographic projection; licenses: globe-geo.LICENSE.txt. Rebuild: npm run build:geo */'}
});
const licenses=await Promise.all(['d3-geo','d3-array','internmap'].map(async name=>name+'\n\n'+await readFile(new URL('node_modules/'+name+'/LICENSE',import.meta.url),'utf8')));
await writeFile(new URL('globe-geo.LICENSE.txt',out),licenses.join('\n\n'));
