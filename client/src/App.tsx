import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { GameState } from "@reaction-rush/shared";
import "./styles.css";

type Ack = { ok: boolean; roomCode?: string; sessionId?: string; message?: string };
type RRSocket = Socket;

type Screen = "home" | "create" | "join";

const STORAGE_ROOM = "reaction_rush_room";
const STORAGE_SESSION = "reaction_rush_session";
const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);

function saveSession(roomCode: string, sessionId: string) {
  localStorage.setItem(STORAGE_ROOM, roomCode);
  localStorage.setItem(STORAGE_SESSION, sessionId);
}

function clearSession() {
  localStorage.removeItem(STORAGE_ROOM);
  localStorage.removeItem(STORAGE_SESSION);
}

function initialRoomCode() {
  const query = new URLSearchParams(window.location.search).get("room");
  if (query) return query.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  const match = window.location.pathname.match(/\/join\/([A-Z0-9]{6})/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function App() {
  const [socket] = useState<RRSocket>(() => io(SERVER_URL, { autoConnect: true, transports: ["websocket", "polling"] }));
  const [connected, setConnected] = useState(socket.connected);
  const [state, setState] = useState<GameState | null>(null);
  const [screen, setScreen] = useState<Screen>(() => initialRoomCode() ? "join" : "home");
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState(initialRoomCode());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const savedRoom = localStorage.getItem(STORAGE_ROOM);
      const savedSession = localStorage.getItem(STORAGE_SESSION);
      if (savedRoom && savedSession) {
        socket.emit("reconnectRoom", { roomCode: savedRoom, sessionId: savedSession }, (ack: Ack) => {
          if (!ack.ok) {
            clearSession();
            setState(null);
            setScreen("home");
            setError(ack.message || "Your previous room session expired.");
          }
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onState = (next: GameState) => {
      setState(next);
      setRoomCode(next.roomCode);
      setScreen("home");
      setError("");
    };
    const onError = ({ message }: { message: string }) => setError(message);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("state", onState);
    socket.on("errorMessage", onError);
    if (socket.connected) onConnect();
    else socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("state", onState);
      socket.off("errorMessage", onError);
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.code !== "Space" && event.code !== "Enter") || !state) return;
      if (state.phase !== "WAITING" && state.phase !== "CLICK") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const me = state.players.find((player) => player.id === state.selfPlayerId);
      if (!me || me.status === "FALSE_START" || me.status === "CLICKED" || !me.connected) return;
      event.preventDefault();
      socket.emit("click", { round: state.round });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [socket, state]);

  const create = () => {
    setError("");
    socket.emit("createRoom", { nickname }, (ack: Ack) => {
      if (!ack.ok || !ack.roomCode || !ack.sessionId) return setError(ack.message || "Could not create the room.");
      saveSession(ack.roomCode, ack.sessionId);
      setRoomCode(ack.roomCode);
      setNotice("Room created.");
    });
  };

  const join = () => {
    setError("");
    socket.emit("joinRoom", { roomCode: roomCode.trim().toUpperCase(), nickname }, (ack: Ack) => {
      if (!ack.ok || !ack.roomCode || !ack.sessionId) return setError(ack.message || "Could not join the room.");
      saveSession(ack.roomCode, ack.sessionId);
      setRoomCode(ack.roomCode);
      setNotice("Joined the room.");
    });
  };

  const leaveHome = () => {
    socket.emit("leaveRoom");
    clearSession();
    setState(null);
    setNickname("");
    setRoomCode("");
    setError("");
    setNotice("");
    setScreen("home");
    window.history.replaceState({}, "", "/");
  };

  const copyLink = async () => {
    if (!state) return;
    const link = `${window.location.origin}/join/${state.roomCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy was blocked by the browser. Share the room code instead: " + state.roomCode);
    }
  };

  const active = Boolean(state);
  const statusLabel = connected ? "LIVE" : "RECONNECTING";

  return (
    <main className="app">
      <div className="glow glowOne" />
      <div className="glow glowTwo" />
      <header className="topbar">
        <button className="brand" onClick={() => !active && setScreen("home")} aria-label="Reaction Rush home">
          <span className="brandMark">⚡</span> REACTION RUSH
        </button>
        <span className={`connection ${connected ? "online" : "offline"}`}><i /> {statusLabel}</span>
      </header>

      <div className="shell">
        {state ? (
          <RoomView state={state} socket={socket} error={error} notice={notice} copied={copied} onCopy={copyLink} onLeave={leaveHome} />
        ) : (
          <>
            {screen === "home" && <Home onCreate={() => { setError(""); setScreen("create"); }} onJoin={() => { setError(""); setScreen("join"); }} />}
            {screen === "create" && <Form title="Create a game" label="Your nickname" value={nickname} setValue={setNickname} button="Create game" onSubmit={create} onBack={() => { setError(""); setScreen("home"); }} error={error} />}
            {screen === "join" && <JoinForm nickname={nickname} setNickname={setNickname} code={roomCode} setCode={setRoomCode} onSubmit={join} onBack={() => { setError(""); setScreen("home"); }} error={error} />}
          </>
        )}
      </div>
      <footer>NO LOGIN · UP TO 8 PLAYERS · 5 ROUNDS · SERVER-AUTHORITATIVE</footer>
    </main>
  );
}

function Home({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return <section className="hero">
    <div className="eyebrow"><span className="pulse" /> REAL-TIME MULTIPLAYER</div>
    <h1>REACTION<br /><em>RUSH</em></h1>
    <p className="tagline">Race your friends. Stay sharp.<br />Don't click too early.</p>
    <div className="homeButtons">
      <button className="primary" onClick={onCreate}>CREATE GAME <span>→</span></button>
      <button className="secondary" onClick={onJoin}>JOIN GAME</button>
    </div>
    <div className="rulesStrip"><div><strong>5</strong><span>ROUNDS</span></div><div><strong>2–8</strong><span>PLAYERS</span></div><div><strong>100</strong><span>MAX POINTS</span></div></div>
  </section>;
}

function Form({ title, label, value, setValue, button, onSubmit, onBack, error }: { title: string; label: string; value: string; setValue: (v: string) => void; button: string; onSubmit: () => void; onBack: () => void; error: string }) {
  return <section className="card formCard">
    <button className="back" onClick={onBack}>← Back</button>
    <h2>{title}</h2><p className="muted">Pick a nickname your friends will recognize.</p>
    <label>{label}<input autoFocus maxLength={18} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} placeholder="e.g. Praveen" /></label>
    {error && <div className="error">{error}</div>}
    <button className="primary full" onClick={onSubmit} disabled={!value.trim()}>Create room <span>→</span></button>
  </section>;
}

function JoinForm({ nickname, setNickname, code, setCode, onSubmit, onBack, error }: { nickname: string; setNickname: (v: string) => void; code: string; setCode: (v: string) => void; onSubmit: () => void; onBack: () => void; error: string }) {
  return <section className="card formCard">
    <button className="back" onClick={onBack}>← Back</button>
    <h2>Join a game</h2><p className="muted">Enter the six-character code from the host.</p>
    <label>Room code<input autoFocus className="codeInput" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))} placeholder="X7K4P2" /></label>
    <label>Nickname<input maxLength={18} value={nickname} onChange={(e) => setNickname(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} placeholder="e.g. Rahul" /></label>
    {error && <div className="error">{error}</div>}
    <button className="primary full" onClick={onSubmit} disabled={code.length !== 6 || !nickname.trim()}>Join game <span>→</span></button>
  </section>;
}

function RoomView({ state, socket, error, notice, copied, onCopy, onLeave }: { state: GameState; socket: RRSocket; error: string; notice: string; copied: boolean; onCopy: () => void; onLeave: () => void }) {
  if (state.phase === "LOBBY") return <Lobby state={state} socket={socket} error={error} notice={notice} copied={copied} onCopy={onCopy} onLeave={onLeave} />;
  return <GameView state={state} socket={socket} error={error} onLeave={onLeave} />;
}

function Lobby({ state, socket, error, notice, copied, onCopy, onLeave }: { state: GameState; socket: RRSocket; error: string; notice: string; copied: boolean; onCopy: () => void; onLeave: () => void }) {
  const connectedCount = state.players.filter((p) => p.connected).length;
  const me = state.players.find((p) => p.id === state.selfPlayerId);
  const isHost = me?.isHost;
  return <section className="room card">
    <div className="roomHeader"><div><span className="eyebrow">GAME ROOM</span><h2>{state.roomCode}</h2></div><button className="shareBtn" onClick={onCopy}>{copied ? "COPIED ✓" : "SHARE ↗"}</button></div>
    <div className="shareBox">Send the room link or code <strong>{state.roomCode}</strong> to your friends.</div>
    {notice && <div className="notice">{notice}</div>}
    <div className="playerCard">
      <div className="sectionTitle"><span>PLAYERS</span><b>{connectedCount}/8 connected</b></div>
      {state.players.map((p) => <div className="playerRow" key={p.id}><span className={`avatar ${p.connected ? "active" : ""}`}>{p.nickname.slice(0, 1).toUpperCase()}</span><span className="playerName">{p.nickname}{p.id === state.selfPlayerId ? " (you)" : ""}</span>{p.isHost && <span className="host">HOST</span>}<span className="statusDot">{p.connected ? "●" : "○"}</span></div>)}
    </div>
    <div className="ruleBox"><strong>HOW TO PLAY</strong><p>Wait for <b>CLICK!</b> before tapping. An early click is a <b>-30</b> false start. The server records the official reaction time and score.</p></div>
    {error && <div className="error">{error}</div>}
    {isHost && <button className="primary full" disabled={connectedCount < 2} onClick={() => socket.emit("startGame")}>{connectedCount < 2 ? "WAITING FOR 2 PLAYERS" : "START 5-ROUND GAME →"}</button>}
    {!isHost && <div className="waitingHost"><span className="pulse" /> Waiting for the host to start…</div>}
    <button className="textBtn" onClick={onLeave}>↪ Leave room</button>
  </section>;
}

function GameView({ state, socket, error, onLeave }: { state: GameState; socket: RRSocket; error: string; onLeave: () => void }) {
  const me = state.players.find((p) => p.id === state.selfPlayerId);
  const finished = state.phase === "FINISHED";
  const result = state.phase === "RESULT";
  const canClick = !finished && !result && me?.connected && me.status !== "CLICKED" && me.status !== "FALSE_START";
  const buttonText = me?.status === "FALSE_START" ? "FALSE START" : me?.status === "CLICKED" ? "LOCKED" : state.phase === "CLICK" ? "CLICK!" : "WAIT...";
  const hint = state.phase === "CLICK" ? "TAP / SPACEBAR" : me?.status === "FALSE_START" ? "You clicked before the signal." : "Clicking early costs 30 points";

  const sendClick = () => {
    if (canClick) socket.emit("click", { round: state.round });
  };

  return <section className="game card">
    <div className="gameTop"><div><span className="eyebrow">{finished ? "FINAL SCORE" : `ROUND ${state.round} / ${state.totalRounds}`}</span><div className="score">{me?.score ?? 0}<small>PTS</small></div></div><div className="miniStat">● {state.players.filter((p) => p.connected).length}</div></div>
    {finished ? <Final state={state} socket={socket} onLeave={onLeave} /> : result ? <RoundResult state={state} /> : <div className="arena">
      <p className="instruction">{state.phase === "WAITING" ? "DON'T CLICK YET" : "GO GO GO"}</p>
      <button className={`reaction ${state.phase.toLowerCase()} ${me?.status === "FALSE_START" ? "bad" : ""} ${me?.status === "CLICKED" ? "locked" : ""}`} onClick={sendClick} disabled={!canClick} aria-label={buttonText}>{buttonText}</button>
      <p className="hint">{hint}</p>
      {error && <div className="error gameError">{error}</div>}
      <div className="livePlayers">{state.players.map((p) => <span key={p.id} className={p.status === "CLICKED" ? "reacted" : p.status === "FALSE_START" ? "badText" : ""}>{p.nickname}{p.status === "CLICKED" ? " ✓" : p.status === "FALSE_START" ? " ×" : ""}</span>)}</div>
    </div>}
    {finished && <button className="textBtn" onClick={onLeave}>↪ Return home</button>}
  </section>;
}

function RoundResult({ state }: { state: GameState }) {
  const ordered = useMemo(() => state.roundResults, [state.roundResults]);
  return <div className="result"><div className="resultBadge">ROUND COMPLETE</div><h2>Fast hands win.</h2><div className="resultList">{ordered.map((r) => <div className="resultRow" key={r.playerId}><span className="rank">{r.position ? `#${r.position}` : "—"}</span><strong>{r.nickname}</strong><span>{r.falseStart ? "FALSE START" : r.timedOut ? "NO CLICK" : `${r.reactionTime} ms`}</span><b>{r.points > 0 ? `+${r.points}` : r.points}</b></div>)}</div><p className="muted">Next round starting automatically…</p></div>;
}

function Final({ state, socket, onLeave }: { state: GameState; socket: RRSocket; onLeave: () => void }) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));
  const me = state.players.find((p) => p.id === state.selfPlayerId);
  return <div className="final"><div className="winner"><div className="crown">🏆</div><span>FINAL LEADERBOARD</span><h1>{sorted[0]?.nickname || "—"}</h1><p>{sorted[0]?.score ?? 0} points</p></div><div className="finalList">{sorted.map((p, i) => <div className={`finalRow ${i === 0 ? "first" : ""}`} key={p.id}><span>#{i + 1}</span><strong>{p.nickname}{p.id === me?.id ? " (you)" : ""}</strong><b>{p.score}</b><small>PTS</small></div>)}</div><div className="finalActions">{me?.isHost && <><button className="primary full" onClick={() => socket.emit("playAgain")}>↻ PLAY AGAIN</button><button className="secondary full" onClick={() => socket.emit("returnLobby")}>RETURN TO LOBBY</button></>}{!me?.isHost && <p className="muted">The host can start another match or return to the lobby.</p>}</div></div>;
}

export default App;
