import test from 'node:test';
import assert from 'node:assert/strict';
import {COLORS,MAX_PLAYERS,CODE_ALPHABET,createRoom,addPlayer,setConnected,activePlayers,
  placementPoints,awardPlacements,standings,makeCode,pickRandomGame} from '../js/room.js';

const fill=(room,n)=>{for(let i=0;i<n;i++)addPlayer(room,{pid:'p'+i,name:'P'+i})};

test('placement points 5/3/1 then 0',()=>{
  assert.deepEqual(placementPoints([['a'],['b'],['c'],['d']]),{a:5,b:3,c:1,d:0});
});
test('tied players share the higher place and the next group skips',()=>{
  assert.deepEqual(placementPoints([['a','b'],['c']]),{a:5,b:5,c:1});
});
test('two players get 5 and 3',()=>{
  assert.deepEqual(placementPoints([['a'],['b']]),{a:5,b:3});
});
test('room is full at 10 players',()=>{
  const r=createRoom();fill(r,MAX_PLAYERS);
  assert.equal(r.players.length,10);
  assert.deepEqual(addPlayer(r,{pid:'x',name:'Extra'}),{ok:false,reason:'full'});
});
test('duplicate names are rejected case-insensitively and blank names are rejected',()=>{
  const r=createRoom();addPlayer(r,{pid:'a',name:'ann '});
  assert.equal(addPlayer(r,{pid:'b',name:'Ann'}).reason,'name');
  assert.equal(addPlayer(r,{pid:'c',name:'   '}).reason,'empty');
});
test('rejoin with same pid keeps score and slot',()=>{
  const r=createRoom();addPlayer(r,{pid:'p1',name:'Ann'});addPlayer(r,{pid:'p2',name:'Bob'});
  awardPlacements(r,[['p1'],['p2']]);
  setConnected(r,'p1',false);
  assert.equal(r.players.find(p=>p.pid==='p1').connected,false);
  const res=addPlayer(r,{pid:'p1',name:'Whatever'});
  assert.equal(res.ok,true);assert.equal(res.rejoined,true);
  assert.equal(res.player.connected,true);
  assert.equal(r.scores.p1,5);assert.equal(r.players.length,2);
});
test('late joiner waits until the current game ends',()=>{
  const r=createRoom();addPlayer(r,{pid:'a',name:'A'});addPlayer(r,{pid:'b',name:'B'});
  r.inGame=true;
  const res=addPlayer(r,{pid:'c',name:'C'});
  assert.equal(res.player.waiting,true);
  assert.deepEqual(activePlayers(r).map(p=>p.pid),['a','b']);
  awardPlacements(r,[['a'],['b']]);
  assert.equal(r.players.find(p=>p.pid==='c').waiting,false);
  assert.equal(r.scores.c||0,0);
});
test('ten players get ten distinct colors from COLORS',()=>{
  const r=createRoom();fill(r,10);
  const cs=r.players.map(p=>p.color);
  assert.equal(new Set(cs).size,10);
  cs.forEach(c=>assert.ok(COLORS.includes(c)));
});
test('standings sort by score with shared ranks',()=>{
  const r=createRoom();fill(r,3);
  awardPlacements(r,[['p0','p1'],['p2']]);
  const s=standings(r);
  assert.deepEqual(s.map(x=>x.rank),[1,1,3]);
  assert.equal(s[2].pid,'p2');
});
test('makeCode uses the safe alphabet',()=>{
  assert.equal(makeCode(()=>0),'AAAA');
  for(let i=0;i<100;i++){const c=makeCode(Math.random);assert.equal(c.length,4);
    for(const ch of c)assert.ok(CODE_ALPHABET.includes(ch))}
});
test('random game never repeats the last one',()=>{
  for(let i=0;i<50;i++)assert.equal(pickRandomGame(['a','b'],'a',Math.random),'b');
});
