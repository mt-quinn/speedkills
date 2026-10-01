import test from 'node:test';
import assert from 'node:assert/strict';
import {filterFights,shipRecords,renderArchive,isUpset,archiveCsv} from '../js/live/archive.js';
const a={id:'a',name:'Iron & bark',style:'Knife',crew:[{name:'Judy Tayly',station:'pilot',skill:1,resistance:4}]},b={id:'b',name:'Corvid',style:'Reference',crew:[]};
const stats=[{railShots:10,railHits:7,torpedoes:8,intercepts:6,crewSurvived:4,hull:10},{railShots:8,railHits:4,torpedoes:9,intercepts:5,crewSurvived:3,hull:0}];
const rows=[{id:'1',sequence:3,ships:[a,b],odds:[.3,.7],winner:0,stats,betting:{total:20000}}, {id:'2',sequence:2,ships:[{...a,name:'Renamed'},b],odds:[.6,.4],winner:1,stats:[stats[1],stats[0]],betting:{total:30000}}, {id:'3',sequence:1,ships:[a,b],odds:[.5,.5],winner:null,stats,betting:{total:0}}];
test('archive search, outcome filters, ownership and meaningful sorting work independently',()=>{
 assert.deepEqual(filterFights(rows,{query:'judy'},'a').map(f=>f.id),['1','2','3']);
 assert.deepEqual(filterFights(rows,{filter:'draws'}).map(f=>f.id),['3']);
 assert.deepEqual(filterFights(rows,{filter:'upsets'}).map(f=>f.id),['1','2']);
 assert.equal(filterFights(rows,{filter:'mine'},'absent').length,0);
 assert.deepEqual(filterFights(rows,{sort:'pool'}).map(f=>f.id),['2','1','3']);
 assert.ok(!isUpset({...rows[0],odds:[.5,.5]}));
});
test('ship records follow stable identities through rename, preserve chronological form and count draws',()=>{
 const r=shipRecords(rows).find(r=>r.key==='a');
 assert.equal(r.fights,3);assert.equal(r.wins,1);assert.equal(r.draws,1);assert.equal(r.underdogWins,1);assert.equal(r.expected,1.4);assert.deepEqual(r.form,['W','L','D']);
 assert.equal(r.ship.name,'Iron & bark');
 assert.equal(shipRecords(rows).length,2);
});
test('archive escapes user names, suppresses zero pools, has no replay or wager controls, and explains sample scope',()=>{
 const html=renderArchive({rows,state:{},ownShipId:'a'});
 assert.ok(html.includes('Iron &amp; bark'));assert.ok(html.includes('LATEST 3 FIGHTS'));assert.ok(html.includes('My ship'));assert.ok(!html.includes('data-form="wager"'));assert.ok(!html.includes('iframe'));assert.ok(html.includes('CREW AT ENTRY'));
 const ships=renderArchive({rows,state:{view:'ships'}});assert.ok(ships.includes('Expected wins'));assert.ok(ships.includes('Records cover matching fights'));
 const empty=renderArchive({rows:[]});assert.ok(empty.includes('No fights match'));assert.ok(!empty.includes('<span>Total bet</span>'));
});

test('CSV preserves entry records, whole credits and safe quoted names',()=>{
 const csv=archiveCsv([{...rows[0],ships:[{...a,name:'=SUM(A1)'},b]}]);
 assert.ok(csv.startsWith('"Match","Ship"'));assert.ok(csv.includes('"\'=SUM(A1)"'));assert.ok(csv.includes('"200"'));assert.equal(csv.split('\r\n').length,3);assert.ok(csv.includes('"Judy Tayly"'));
});
