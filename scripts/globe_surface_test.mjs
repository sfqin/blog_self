// Render the production land painter on a real Canvas, isolated from sunlight.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const executablePath = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean).find(existsSync);
const browser = await puppeteer.launch({executablePath, headless:'new', args:['--no-sandbox']});
try {
 const page = await browser.newPage();
 const errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await page.evaluateOnNewDocument(()=>{window.__GLOBE_TEST__=true;});
 await page.goto((process.env.BASE || 'http://127.0.0.1:8199')+'/', {waitUntil:'networkidle0'});
 await page.waitForFunction(()=>window.__globeDebug?.ready());
 const places = [
  ['eastern Europe',40,52,true],['Siberia',90,62,true],['India',78,23,true],
  ['central Africa',24,2,true],['Australia',135,-25,true],['North America',-105,45,true],
  ['South America',-60,-12,true],['Antarctica',0,-85,true],
  ['Indian Ocean',65,-10,false],['Atlantic',-35,0,false],['Pacific',-140,0,false]
 ];
 const centers = [[103.87,23.13],[103.97,23.13],[105,25],[0,20],[-100,25],[180,0],[0,-70]];
 for(let lon=-180;lon<180;lon+=30) for(const lat of [-70,-35,0,23.13,35,70]) centers.push([lon,lat]);
 for (const center of centers) {
  const samples=await page.evaluate(({center,places})=>window.__globeDebug.landSamples(center,places.map(p=>p.slice(1,3))),{center,places});
  samples.forEach((actual,i)=>{if(actual !== null) assert.equal(actual,places[i][3],`${places[i][0]} at rotation ${center} must keep its land/ocean fill`);});
 }
 assert.deepEqual(errors,[]);
 console.log('PASS real Canvas land masks across 79 globe rotations');
} finally { await browser.close(); }
