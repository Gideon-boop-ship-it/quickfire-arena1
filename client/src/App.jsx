import React, { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || 'https://quickfire-arena1.onrender.com';
const AVATARS = ['⚡','🚀','🦊','🐉','👾','🦁','🦄','🔥'];

export default function App() {
  const [socket, setSocket] = useState(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('⚡');
  const [roomCode, setRoomCode] = useState('');
  const [room, setRoom] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [screen, setScreen] = useState('home');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [seconds, setSeconds] = useState(15);
  const [answered, setAnswered] = useState(false);
  const [muted, setMuted] = useState(false);
  const playerIdRef = useRef(null);
  playerIdRef.current = playerId;

  useEffect(() => {
    const s = io(SERVER, { transports: ['websocket','polling'] });
    setSocket(s);
    s.on('room:update', data => { setRoom(data); if (data.status === 'lobby') setScreen('lobby'); if (data.status === 'playing') setScreen('game'); if (data.status === 'finished') setScreen('results'); });
    s.on('question:start', () => { setResult(null); setAnswered(false); });
    s.on('question:result', data => { setResult(data); setAnswered(true); });
    s.on('answer:wrong', data => { if (data.playerId === playerIdRef.current) setError('Not quite — stay sharp for the next question.'); });
    s.on('match:finished', () => setScreen('results'));
    s.on('connect_error', () => setError('Cannot reach the game server. Start the server and refresh this page.'));
    return () => s.disconnect();
  }, []);

  useEffect(() => {
    if (!room?.currentQuestion || room.status !== 'playing') return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((room.currentQuestion.deadline - Date.now()) / 1000)));
    tick(); const id = setInterval(tick, 100); return () => clearInterval(id);
  }, [room?.currentQuestion?.deadline, room?.status]);

  const me = useMemo(() => room?.players?.find(p => p.id === playerId), [room, playerId]);
  const leaderboard = useMemo(() => [...(room?.players || [])].filter(p => !p.withdrawn).sort((a,b) => b.score-a.score), [room]);
  const call = (event, payload = {}) => new Promise(resolve => socket?.emit(event, payload, resolve));

  async function createRoom() {
    setError(''); if (!name.trim()) return setError('Choose a nickname first.');
    const response = await call('room:create', { name, avatar });
    if (!response?.ok) return setError(response?.error || 'Could not create room.');
    setPlayerId(response.playerId); setRoom(response.room); setScreen('lobby');
  }
  async function joinRoom() {
    setError(''); if (!name.trim()) return setError('Choose a nickname first.');
    const response = await call('room:join', { code: roomCode, name, avatar });
    if (!response?.ok) return setError(response?.error || 'Could not join room.');
    setPlayerId(response.playerId); setRoom(response.room); setScreen('lobby');
  }
  async function ready() { setError(''); await call('player:ready'); }
  async function start() { const response = await call('match:start'); if (!response?.ok) setError(response?.error || 'Could not start match.'); }
  async function answer(index) { if (answered || result || !room?.currentQuestion) return; setAnswered(true); setError(''); const response = await call('answer:submit', { answerIndex:index }); if (!response?.ok) { setAnswered(false); setError(response?.error || 'Answer could not be submitted.'); } else if (!response.correct) setTimeout(() => setAnswered(false), 650); }
  function leave() { socket?.emit('player:leave', {}, () => {}); setRoom(null); setPlayerId(null); setScreen('home'); setResult(null); setAnswered(false); }
  function fakeBeep() { if (muted) return; try { const Ctx=window.AudioContext||window.webkitAudioContext; const c=new Ctx(); const o=c.createOscillator(); const g=c.createGain(); o.connect(g); g.connect(c.destination); o.frequency.value=760; g.gain.value=.035; o.start(); o.stop(c.currentTime+.08); o.onended=()=>c.close(); } catch {} }

  return <div className="app-shell">
    <div className="ambient ambient-a"/><div className="ambient ambient-b"/>
    <header className="topbar"><a className="brand" href="#home" onClick={e=>{e.preventDefault();if(!room)setScreen('home')}}><span className="brand-mark">Q</span><span>QUICKFIRE<span className="brand-accent"> ARENA</span><small>THINK FAST. PLAY BOLD.</small></span></a><div className="top-actions"><span className="live-pill"><i/> LIVE ARENA</span><button className="icon-button" onClick={()=>setMuted(v=>!v)} aria-label="Toggle sound">{muted?'🔇':'🔊'}</button></div></header>
    <main className="main-wrap">
      {screen === 'home' && <section className="hero-grid"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> THE BATTLE OF BRAINS</div><h1>BE QUICK.<br/><span>BE BRILLIANT.</span><br/>BE THE LAST<br/>MIND STANDING.</h1><p className="hero-description">Fifteen questions. Three rounds. One arena. Race your rivals, trust your instincts, and climb the leaderboard.</p><div className="hero-stats"><div><b>15</b><span>QUESTIONS</span></div><div><b>03</b><span>ROUNDS</span></div><div><b>08</b><span>PLAYERS MAX</span></div></div></div>
        <div className="panel entry-panel"><div className="panel-head"><div><span className="mini-label">PLAYER SETUP</span><h2>Enter the arena</h2></div><span className="panel-icon">✦</span></div><label className="field-label" htmlFor="nickname">YOUR NICKNAME</label><input id="nickname" className="text-input" maxLength="18" placeholder="Choose your arena name" value={name} onChange={e=>setName(e.target.value)} />
          <span className="field-label avatar-label">CHOOSE YOUR AVATAR</span><div className="avatar-picker">{AVATARS.map(a=><button key={a} className={`avatar-option ${avatar===a?'selected':''}`} onClick={()=>setAvatar(a)} aria-label={`Choose ${a}`}>{a}</button>)}</div>
          <button className="primary-button" onClick={createRoom}>CREATE A ROOM <span>↗</span></button><div className="or-divider"><span/> OR JOIN WITH A CODE <span/></div><div className="join-row"><input className="text-input code-input" maxLength="6" placeholder="ROOM CODE" value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())}/><button className="secondary-button" onClick={joinRoom}>JOIN</button></div>
          <p className="small-note">No download. No fuss. Just friendly competition.</p>{error && <p className="error-message">{error}</p>}
        </div><div className="hero-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-core">⚡<span>QF</span></div><span className="orbit-tag tag-one">SPEED</span><span className="orbit-tag tag-two">ACCURACY</span><span className="orbit-tag tag-three">GLORY</span></div></section>}

      {screen === 'lobby' && room && <section className="lobby-layout"><div className="panel lobby-main"><div className="eyebrow"><span className="eyebrow-line"/> ARENA LOBBY</div><div className="room-title-row"><div><span className="mini-label">YOUR ROOM CODE</span><h1 className="room-code">{room.code}</h1></div><button className="secondary-button copy-button" onClick={()=>navigator.clipboard?.writeText(room.code)}>COPY CODE</button></div><p className="hero-description">Share this code with friends. At least two players must be ready to start.</p><div className="players-grid">{room.players.map((p,i)=><div className={`player-tile ${p.id===playerId?'you-tile':''}`} key={p.id}><span className="player-avatar">{p.avatar}</span><strong>{p.name}{p.id===playerId?' (YOU)':''}</strong><small>{p.ready?'READY':p.connected?'IN THE LOBBY':'RECONNECTING…'}</small><span className={`player-dot ${p.connected?'':'offline'}`}/></div>)}{Array.from({length:Math.max(0,8-room.players.length)},(_,i)=><div className="player-tile empty-tile" key={`empty-${i}`}><span className="player-avatar">＋</span><strong>OPEN SLOT</strong><small>WAITING FOR PLAYER</small></div>)}</div><div className="lobby-actions"><button className="primary-button" onClick={ready}>I'M READY <span>⚡</span></button>{room.hostId===playerId && <button className="secondary-button" onClick={start}>START MATCH</button>}<button className="quiet-button" onClick={leave}>LEAVE ROOM</button></div>{error&&<p className="error-message">{error}</p>}</div><aside className="panel rules-panel"><span className="mini-label">MATCH PROTOCOL</span><h2>Know the rules.</h2><div className="rule"><b>01</b><span><strong>Three rounds</strong><small>Five questions in every round.</small></span></div><div className="rule"><b>02</b><span><strong>15 seconds</strong><small>Choose before the countdown ends.</small></span></div><div className="rule"><b>03</b><span><strong>Speed pays</strong><small>100 base points + up to 100 speed bonus.</small></span></div><div className="rule"><b>04</b><span><strong>First correct wins</strong><small>One correct answer locks the question.</small></span></div></aside></section>}

      {screen === 'game' && room && <section className="game-layout"><div className="game-topline"><div className="eyebrow"><span className="eyebrow-line"/> ROUND {Math.min(3,Math.ceil((room.questionNumber||1)/5))} <span className="round-divider">/</span> 03</div><button className="quiet-button" onClick={leave}>LEAVE MATCH</button></div><div className="progress-track"><div style={{width:`${((room.questionNumber||1)/15)*100}%`}}/></div><div className="game-columns"><section className="panel question-panel"><div className="question-meta"><span className="category-pill">{room.currentQuestion?.category || 'GENERAL KNOWLEDGE'}</span><span className="question-count">QUESTION <b>{room.questionNumber}</b> <span>/ 15</span></span></div><div className={`timer-circle ${seconds<=5?'urgent':''}`}><svg viewBox="0 0 100 100"><circle className="timer-track" cx="50" cy="50" r="44"/><circle className="timer-progress" cx="50" cy="50" r="44" style={{strokeDashoffset:276.46*(1-seconds/15)}}/></svg><b>{seconds}</b><small>SECONDS</small></div><h2 className="question-text">{room.currentQuestion?.question || 'Get ready for the next question…'}</h2><div className="answers-grid">{(room.currentQuestion?.answers||[]).map((a,i)=><button key={`${room.questionNumber}-${i}`} disabled={!!result||answered} className={`answer-button ${result&&result.correctIndex===i?'answer-correct':''}`} onClick={()=>{answer(i);fakeBeep()}}><span className="answer-letter">{String.fromCharCode(65+i)}</span><span>{a}</span></button>)}</div>{result && <div className={`result-banner ${result.type==='timeout'?'timeout-banner':''}`}><strong>{result.type==='timeout'?'TIME’S UP!':result.winnerId===playerId?'⚡ YOU GOT IT FIRST!':`${result.winnerName} GOT IT FIRST!`}</strong><span>{result.type==='timeout'?'No points this time.':`+${result.points} POINTS`} {result.explanation?`— ${result.explanation}`:''}</span>{result.source&&<small>Source: {result.source}</small>}</div>}{error&&<p className="error-message">{error}</p>}</section><aside className="panel leaderboard-panel"><div className="panel-head"><div><span className="mini-label">LIVE STANDINGS</span><h2>Leaderboard</h2></div><span className="live-pill"><i/> LIVE</span></div>{leaderboard.map((p,i)=><div className={`leader-row ${p.id===playerId?'leader-me':''}`} key={p.id}><span className={`rank rank-${i+1}`}>{String(i+1).padStart(2,'0')}</span><span className="leader-avatar">{p.avatar}</span><span className="leader-name">{p.name}{p.id===playerId?' (YOU)':''}<small>{p.connected?'IN MATCH':'RECONNECTING'}</small></span><strong className="leader-score">{p.score}</strong></div>)}<div className="score-note"><span>⚡</span><p><b>Speed bonus active</b><br/>Answer sooner to earn up to 100 bonus points.</p></div></aside></div></section>}

      {screen === 'results' && room && <section className="panel final-panel"><div className="winner-burst">🏆</div><div className="eyebrow"><span className="eyebrow-line"/> MATCH COMPLETE</div><h1 className="final-title">ARENA <span>CHAMPION</span></h1><p className="hero-description">The final buzzer has sounded. Here are the results.</p><div className="final-leaderboard">{leaderboard.map((p,i)=><div className={`final-row ${i===0?'final-winner':''}`} key={p.id}><span className="final-rank">{i===0?'🏆':`#${i+1}`}</span><span className="leader-avatar">{p.avatar}</span><strong>{p.name}{p.id===playerId?' (YOU)':''}</strong><span className="final-points">{p.score} <small>PTS</small></span></div>)}</div><div className="final-actions"><button className="primary-button" onClick={leave}>BACK TO ARENA <span>↗</span></button><button className="secondary-button" onClick={async()=>{const response=await call('match:rematch');if(!response?.ok)setError(response?.error||'Rematch could not start.');}}>REMATCH</button></div><p className="small-note">A fresh match resets scores. Persistent accounts and competitive rankings are planned for a later phase.</p></section>}
    </main>
    <footer className="footer"><span>© QUICKFIRE ARENA</span><span>BUILT FOR THE BOLD <b>✦</b></span><span>PROTOTYPE · PHASE 1</span></footer>
  </div>;
}
