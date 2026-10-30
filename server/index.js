const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const { QUESTIONS } = require('./questions.cjs');

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true, service: 'quickfire-arena', time: new Date().toISOString() }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || '*', methods: ['GET', 'POST'] } });

const rooms = new Map();
const MAX_PLAYERS = 8;
const QUESTION_MS = 15000;
const QUESTIONS_PER_ROUND = 5;
const TOTAL_QUESTIONS = 15;
const RECONNECT_GRACE_MS = 60000;

function roomCode() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function cleanName(name) { return String(name || 'Player').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || 'Player'; }
function publicRoom(room) {
  return { code: room.code, status: room.status, hostId: room.hostId, questionNumber: room.questionIndex + 1, totalQuestions: TOTAL_QUESTIONS,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, avatar: p.avatar, score: p.score, ready: p.ready, connected: p.connected, withdrawn: p.withdrawn })),
    currentQuestion: room.status === 'playing' && room.current ? { number: room.questionIndex + 1, category: room.current.category, difficulty: room.current.difficulty, question: room.current.question, answers: room.current.answers, deadline: room.deadline, durationMs: QUESTION_MS } : null,
    lastResult: room.lastResult, round: Math.max(1, Math.floor(room.questionIndex / QUESTIONS_PER_ROUND) + 1) };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function chooseQuestions() {
  const pool = [...QUESTIONS];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return Array.from({ length: TOTAL_QUESTIONS }, (_, i) => pool[i % pool.length]);
}
function clearQuestionTimer(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; }
function finishMatch(room) {
  clearQuestionTimer(room); room.status = 'finished'; room.current = null;
  room.lastResult = { type: 'match-finished', leaderboard: [...room.players.values()].filter(p => !p.withdrawn).sort((a,b) => b.score-a.score).map((p,i) => ({ rank:i+1, id:p.id, name:p.name, avatar:p.avatar, score:p.score })) };
  emitRoom(room); io.to(room.code).emit('match:finished', room.lastResult);
}
function nextQuestion(room) {
  clearQuestionTimer(room); room.questionIndex++;
  if (room.questionIndex >= TOTAL_QUESTIONS) return finishMatch(room);
  room.current = room.questions[room.questionIndex]; room.questionStartedAt = Date.now(); room.deadline = room.questionStartedAt + QUESTION_MS; room.answered = new Set(); room.winnerId = null; room.lastResult = null; room.status = 'playing';
  emitRoom(room); io.to(room.code).emit('question:start', { number: room.questionIndex + 1, deadline: room.deadline, durationMs: QUESTION_MS });
  room.timer = setTimeout(() => { if (room.status !== 'playing' || room.winnerId) return; room.lastResult = { type:'timeout', correctIndex:room.current.correctIndex, explanation:room.current.explanation, source:room.current.source }; io.to(room.code).emit('question:result', room.lastResult); setTimeout(() => nextQuestion(room), 2400); }, QUESTION_MS);
}
function startMatch(room) {
  if (room.status === 'playing') return;
  const active = [...room.players.values()].filter(p => p.connected && !p.withdrawn);
  if (active.length < 2) return;
  room.questions = chooseQuestions(); room.questionIndex = -1; room.status = 'playing'; room.lastResult = null;
  for (const p of room.players.values()) { p.score = 0; p.ready = false; }
  io.to(room.code).emit('match:started', { totalQuestions: TOTAL_QUESTIONS, rounds: 3 });
  nextQuestion(room);
}

io.on('connection', socket => {
  socket.on('room:create', ({ name, avatar }, cb = () => {}) => {
    let code = roomCode(); while (rooms.has(code)) code = roomCode();
    const id = crypto.randomUUID(); const player = { id, socketId: socket.id, name: cleanName(name), avatar: avatar || '⚡', score:0, ready:false, connected:true, withdrawn:false, disconnectTimer:null, leaveTimes:[] };
    const room = { code, hostId:id, players:new Map([[id,player]]), status:'lobby', questionIndex:-1, questions:[], current:null, deadline:null, timer:null, answered:new Set(), winnerId:null, lastResult:null };
    rooms.set(code, room); socket.join(code); socket.data.playerId=id; socket.data.roomCode=code; cb({ ok:true, playerId:id, room:publicRoom(room) }); emitRoom(room);
  });
  socket.on('room:join', ({ code, name, avatar }, cb = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase()); if (!room) return cb({ ok:false, error:'Room not found. Check the code and try again.' });
    if (room.players.size >= MAX_PLAYERS) return cb({ ok:false, error:'This room is full (8 players maximum).' });
    if (room.status === 'playing' || room.status === 'finished') return cb({ ok:false, error:'This match has already started. You can join the next match.' });
    const id=crypto.randomUUID(); const player={ id, socketId:socket.id, name:cleanName(name), avatar:avatar || '🚀', score:0, ready:false, connected:true, withdrawn:false, disconnectTimer:null, leaveTimes:[] };
    room.players.set(id,player); socket.join(room.code); socket.data.playerId=id; socket.data.roomCode=room.code; cb({ ok:true, playerId:id, room:publicRoom(room) }); emitRoom(room);
  });
  socket.on('player:ready', (_data, cb=()=>{}) => {
    const room=rooms.get(socket.data.roomCode); const p=room?.players.get(socket.data.playerId); if (!room || !p || room.status!=='lobby') return cb({ok:false});
    p.ready=true; emitRoom(room); const ready=[...room.players.values()].filter(x=>x.ready&&x.connected&&!x.withdrawn);
    if (ready.length >= 2 && (p.id===room.hostId || ready.length===room.players.size)) startMatch(room);
    cb({ok:true});
  });
  socket.on('match:start', (_data, cb=()=>{}) => {
    const room=rooms.get(socket.data.roomCode); const p=room?.players.get(socket.data.playerId); if(!room||!p||p.id!==room.hostId) return cb({ok:false,error:'Only the host can start the match.'});
    if ([...room.players.values()].filter(x=>x.ready&&x.connected&&!x.withdrawn).length < 2) return cb({ok:false,error:'At least two players must be ready.'});
    startMatch(room); cb({ok:true});
  });
  socket.on('match:rematch', (_data, cb=()=>{}) => {
    const room=rooms.get(socket.data.roomCode); const p=room?.players.get(socket.data.playerId);
    if(!room||!p||p.id!==room.hostId) return cb({ok:false,error:'Only the host can start a rematch.'});
    if(room.status!=='finished') return cb({ok:false,error:'The current match must finish before a rematch.'});
    if([...room.players.values()].filter(x=>x.connected&&!x.withdrawn).length<2) return cb({ok:false,error:'At least two connected players are required.'});
    startMatch(room); cb({ok:true});
  });
  socket.on('answer:submit', ({ answerIndex }, cb=()=>{}) => {
    const room=rooms.get(socket.data.roomCode); const p=room?.players.get(socket.data.playerId);
    if(!room||!p||room.status!=='playing'||!room.current||room.winnerId||Date.now()>room.deadline) return cb({ok:false,error:'This question is no longer accepting answers.'});
    if(p.withdrawn||!p.connected||room.answered.has(p.id)) return cb({ok:false,error:'Your answer has already been recorded.'});
    room.answered.add(p.id);
    if(Number(answerIndex) !== room.current.correctIndex) { io.to(room.code).emit('answer:wrong', { playerId:p.id }); return cb({ok:true,correct:false}); }
    room.winnerId=p.id; clearQuestionTimer(room);
    const elapsed=Math.max(0,Math.min(QUESTION_MS,Date.now()-room.questionStartedAt)); const speedBonus=Math.round(100*(1-elapsed/QUESTION_MS)); const points=100+speedBonus; p.score+=points;
    room.lastResult={type:'correct',winnerId:p.id,winnerName:p.name,correctIndex:room.current.correctIndex,points,speedBonus,elapsedMs:elapsed,explanation:room.current.explanation,source:room.current.source};
    io.to(room.code).emit('question:result', room.lastResult); emitRoom(room); cb({ok:true,correct:true,points});
    setTimeout(()=>nextQuestion(room), 2600);
  });
  socket.on('player:leave', (_data, cb=()=>{}) => {
    const room=rooms.get(socket.data.roomCode); const p=room?.players.get(socket.data.playerId); if(!room||!p) return cb({ok:false});
    p.withdrawn=true; p.ready=false; p.connected=false; p.leaveTimes.push(Date.now()); p.leaveTimes=p.leaveTimes.filter(t=>Date.now()-t<24*60*60*1000);
    p.cooldownMs=Math.min(30*60*1000, Math.max(0,p.leaveTimes.length-1)*2*60*1000); socket.leave(room.code); emitRoom(room); cb({ok:true,cooldownMs:p.cooldownMs});
  });
  socket.on('disconnect', () => {
    const room=rooms.get(socket.data.roomCode); const p=room?.players.get(socket.data.playerId); if(!room||!p) return;
    p.connected=false; emitRoom(room);
    p.disconnectTimer=setTimeout(()=>{ if(!p.connected && room.status==='lobby') { room.players.delete(p.id); if(room.hostId===p.id) room.hostId=room.players.keys().next().value; emitRoom(room); } }, RECONNECT_GRACE_MS);
  });
});

const PORT=Number(process.env.PORT||3001);
server.listen(PORT,()=>console.log(`Quickfire Arena server listening on :${PORT}`));
