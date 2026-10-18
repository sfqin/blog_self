import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const executablePath=[process.env.CHROME_BIN,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean).find(existsSync);
const browser=await puppeteer.launch({executablePath,headless:'new',args:['--no-sandbox']});
const BASE=process.env.BASE || 'http://127.0.0.1:8199';
const errors=[];
async function open({mobile=false,reduced=false,hash=''}={}) {
 const p=await browser.newPage();
 p.on('pageerror',e=>errors.push(e.message));
 await p.setViewport(mobile?{width:390,height:844,isMobile:true,hasTouch:true}:{width:1440,height:900});
 if(reduced) await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await p.goto(BASE+'/'+hash,{waitUntil:'networkidle0'});
 assert.equal(await p.$('.hero-hint'),null);
 return p;
}
try {
 const desktop=await open();
 await desktop.waitForSelector('.star-guide');
 const box=await desktop.$eval('.star-guide svg',el=>({width:el.getBoundingClientRect().width,hidden:el.parentNode.getAttribute('aria-hidden'),off:el.closest('.star').hasAttribute('data-off')}));
 assert.deepEqual(box,{width:28,hidden:'true',off:false});
 await desktop.waitForSelector('.star-guide',{hidden:true,timeout:10000});
 await desktop.close();
 const mobile=await open({mobile:true});
 await mobile.waitForSelector('.star-guide');
 const key=await mobile.$eval('.star-guide',el=>el.closest('a').dataset.key);
 await mobile.tap('a.star:has(.star-guide)');
 await mobile.waitForFunction(key=>location.hash==='#'+key,{},key);
 assert.equal(await mobile.$('.star-guide'),null);
 await mobile.close();
 const keyboard=await open();
 await keyboard.waitForSelector('.star-guide');
 await keyboard.keyboard.press('Tab');
 assert.equal(await keyboard.$('.star-guide'),null);
 await keyboard.close();
 const scroll=await open();
 await scroll.waitForSelector('.star-guide');
 await scroll.evaluate(()=>window.scrollTo(0,100));
 await scroll.waitForSelector('.star-guide',{hidden:true});
 await scroll.close();
 for(const opts of [{reduced:true},{hash:'#footprint'}]) {
  const p=await open(opts);
  await new Promise(r=>setTimeout(r,3000));
  assert.equal(await p.$('.star-guide'),null);
  await p.close();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS star cue: desktop expiry, mobile tap, keyboard, scroll, reduced motion, deep link');
} finally {await browser.close();}
