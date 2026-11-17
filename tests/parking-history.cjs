'use strict';
/* Parking: fake-browser regression tests. No GPS, external APIs, or user data. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Main Parking inline script exists');
new vm.Script(script,{filename:'index.html/inline-script'});

const ACTIVE='parking.saved.v1', HISTORY='parking.history.v1';
function position(i){
  return {lat:39.600+i*0.001,lon:20.800+i*0.001,accuracy:15,
    timestamp:1700000000000+i,address:i===0?'Old Street':'',addressLookedUp:i===0};
}
class FakeStorage{
  constructor(initial={}){this.map=new Map(Object.entries(initial));this.failKey=null;}
  getItem(key){return this.map.has(key)?this.map.get(key):null;}
  setItem(key,value){if(key===this.failKey)throw Error('Simulated quota error');this.map.set(key,String(value));}
  removeItem(key){this.map.delete(key);}
}
class FakeElement{
  constructor(tag='div',id=''){
    this.tagName=tag.toUpperCase();this.id=id;
    this.textContent='';this.className='';this.children=[];
    this.style={};this.disabled=false;this.hidden=false;
    this.type='';this.listeners={};
    const classes=new Set();
    this.classList={
      add(...names){names.forEach(x=>classes.add(x));},
      remove(...names){names.forEach(x=>classes.delete(x));},
      contains(name){return classes.has(name);},
      toggle(name,forced){const next=forced===undefined?!classes.has(name):!!forced;
        next?classes.add(name):classes.delete(name);return next;}
    };
  }
  addEventListener(event,listener){(this.listeners[event]??=[]).push(listener);}
  appendChild(child){this.children.push(child);return child;}
  append(...children){children.forEach(x=>this.appendChild(x));}
  replaceChildren(...children){this.children=[...children];}
  click(){for(const listener of(this.listeners.click||[]))listener({target:this});}
}
function createEnvironment(storage,coordinates=[]){
  const elements=new Map(),links=[];
  let idCounter=0,clock=1800000000000,locationIndex=0;
  const get=id=>{
    if(!elements.has(id))elements.set(id,new FakeElement('div',id));
    return elements.get(id);
  };
  const statusChip=new FakeElement('div','status-chip');
  const check=new FakeElement('span','status-chip-check');
  const document={
    getElementById:get,
    createElement:tag=>new FakeElement(tag),
    querySelector(selector){
      if(selector==='.status-chip')return statusChip;
      if(selector==='.status-chip .check')return check;
      throw Error('Unexpected selector: '+selector);
    }
  };
  const navigator={
    onLine:false, // No reverse geocoding or external web access in any test.
    geolocation:{
      watchPosition(success){
        const coords=coordinates[locationIndex++];
        if(!coords)throw Error('GPS fixture exhausted');
        success({coords:{latitude:coords.lat,longitude:coords.lon,accuracy:15}});
        return ++idCounter;
      },
      clearWatch(){}
    }
  };
  class SimulatedDate extends Date{static now(){return ++clock;}}
  const ctx={document,navigator,window:{open:(url,target,features)=>links.push({url,target,features})},
    localStorage:storage,Date:SimulatedDate,Intl,Number,Array,JSON,Math,Error,Set,String,
    encodeURIComponent,isSecureContext:true,performance:{now:()=>0},
    requestAnimationFrame:()=>42,cancelAnimationFrame:()=>{},
    setTimeout:()=>42,clearTimeout:()=>{},
    AbortController,console};
  vm.runInNewContext(script,ctx);
  return{get,storage,links,statusChip,check,save(){get('save').click();}};
}
const existing=position(0);
{
  const app=createEnvironment(new FakeStorage());
  assert.equal(app.get('history-panel').hidden,true,'No history before first save');
  assert.equal(app.get('map').disabled,true);
  assert.equal(app.get('navigate').disabled,true);
}
{
  const store=new FakeStorage({[ACTIVE]:JSON.stringify(existing)});
  const app=createEnvironment(store);
  assert.equal(app.get('history-panel').hidden,false,'Old saved location migrated into history view');
  assert.equal(app.get('history-count').textContent,'1/5');
  assert.equal(app.get('history-list').children.length,1);
  assert.equal(app.get('history-list').children[0].className.includes('is-current'),true);
  assert.equal(store.getItem(HISTORY),null,'Do not change storage merely by viewing a legacy pin');
  assert.equal(store.getItem(ACTIVE),JSON.stringify(existing),'Legacy current pin must remain identical');
}
{
  const store=new FakeStorage({[ACTIVE]:JSON.stringify(existing)});
  const coordinates=Array.from({length:6},(_,i)=>position(i+1));
  const app=createEnvironment(store,coordinates);
  for(let i=0;i<6;i++)app.save();
  const history=JSON.parse(store.getItem(HISTORY));
  assert.equal(history.length,5,'History must never exceed five saved positions');
  assert.equal(history[0].lat,coordinates[5].lat,'Newest saved position must be first');
  assert.equal(history[4].lat,coordinates[1].lat,'Fifth-most-recent position must remain');
  assert.equal(history.some(x=>x.lat===existing.lat),false,'Oldest positions roll off');
  assert.equal(app.get('history-count').textContent,'5/5');
  assert.equal(app.get('history-list').children.length,5,'Five visible history entries');
  assert.equal(JSON.parse(store.getItem(ACTIVE)).lat,coordinates[5].lat,'Active pin matches the latest save');
  assert.equal(app.get('history-list').children[0].className.includes('is-current'),true);
  app.get('history-list').children[4].children[3].children[0].click();
  assert.ok(app.links.at(-1).url.includes('mlat='+coordinates[1].lat),'Old map opens selected historical pin');
  app.get('history-list').children[4].children[3].children[1].click();
  assert.ok(app.links.at(-1).url.includes('destination='+encodeURIComponent(coordinates[1].lat+','+coordinates[1].lon)),
    'Old navigation uses the historic location');
  app.get('map').click();
  assert.ok(app.links.at(-1).url.includes('mlat='+coordinates[5].lat),'Primary map still opens the active pin');
  const reopened=createEnvironment(store);
  assert.equal(reopened.get('history-count').textContent,'5/5','History survives a reload');
  assert.equal(reopened.get('history-list').children.length,5);
}
for(const failKey of [HISTORY,ACTIVE]){
  const store=new FakeStorage({[ACTIVE]:JSON.stringify(existing)});
  const app=createEnvironment(store,[position(7)]);
  store.failKey=failKey;
  app.save();
  assert.equal(store.getItem(ACTIVE),JSON.stringify(existing),'Failed save must retain original active pin');
  assert.equal(store.getItem(HISTORY),null,'Failed save must not leave a half-written history');
  assert.match(app.get('capture-status').textContent,/αποθήκευση απέτυχε/);
  assert.equal(app.get('history-count').textContent,'1/5','Displayed history remains intact');
}
{
  const malicious={...existing,address:'<img src=x onerror=alert(1)>'};
  const app=createEnvironment(new FakeStorage({[ACTIVE]:JSON.stringify(malicious)}));
  const item=app.get('history-list').children[0];
  assert.equal(item.children[1].textContent,malicious.address,'Address displayed as text, never HTML');
}
const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
new vm.Script(sw,{filename:'sw.js'});
assert.ok(sw.includes('parking-shell-')&&sw.includes('key.startsWith(PREFIX)'),
  'Cache cleanup must not touch other Applications projects');
assert.ok(sw.includes('v15'),'New history app-shell version must be cached');
console.log('PASS Parking: empty state, legacy migration, 5-pin rotation, map/navigation, reload, failure rollback, XSS-safe text, isolated cache');
