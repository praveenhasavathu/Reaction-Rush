import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  attachPlayer,
  cleanupRooms,
  createRoom,
  detachPlayer,
  findPlayerBySession,
  getRoom,
  joinRoom,
  leaveRoom,
  playAgain,
  publicState,
  rooms,
  startGame,
  playerClick,
  returnLobby,
} from "./game.js";

type SocketSession = { roomId?: string; playerId?: string };

const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT || 3001);
const clientOrigin = process.env.CLIENT_ORIGIN;

app.use(express.static(clientDistPath));

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

const __filename = fileURLToPath(import path from "node:path";);
const __dirname = process.cwd();
const clientDistPath = path.resolve(process.cwd(), "client", "dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDist));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

const io = new Server(httpServer, {
  cors: { origin: clientOrigin ? clientOrigin.split(",").map((v) => v.trim()) : true },
  transports: ["websocket", "polling"],
});

function emitRoom(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const player of room.players.values()) {
    if (!player.connected || !player.socketId) continue;
    io.to(player.socketId).emit("state", publicState(room, player.id));
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

io.on("connection", (socket) => {
  const session: SocketSession = {};

  const replyError = (message: string) => socket.emit("errorMessage", { message });

  socket.on("createRoom", ({ nickname }: { nickname: string }, ack?: (data: unknown) => void) => {
    try {
      const { room, player } = createRoom(nickname);
      session.roomId = room.id;
      session.playerId = player.id;
      attachPlayer(room, player, socket.id);
      ack?.({ ok: true, roomCode: room.code, sessionId: player.sessionId });
      emitRoom(room.id);
    } catch (error) {
      ack?.({ ok: false, message: errorMessage(error) });
    }
  });

  socket.on("joinRoom", ({ roomCode, nickname }: { roomCode: string; nickname: string }, ack?: (data: unknown) => void) => {
    try {
      const room = getRoom(roomCode);
      if (!room) throw new Error("Room not found. Check the code and try again.");
      const player = joinRoom(room, nickname);
      session.roomId = room.id;
      session.playerId = player.id;
      attachPlayer(room, player, socket.id);
      ack?.({ ok: true, roomCode: room.code, sessionId: player.sessionId });
      emitRoom(room.id);
    } catch (error) {
      ack?.({ ok: false, message: errorMessage(error) });
    }
  });

  socket.on("reconnectRoom", ({ roomCode, sessionId }: { roomCode: string; sessionId: string }, ack?: (data: unknown) => void) => {
    try {
      const room = getRoom(roomCode);
      if (!room) throw new Error("That room no longer exists.");
      const player = findPlayerBySession(room, sessionId);
      if (!player) throw new Error("Your session has expired. Rejoin the room.");
      if (player.socketId && player.socketId !== socket.id) io.sockets.sockets.get(player.socketId)?.disconnect(true);
      session.roomId = room.id;
      session.playerId = player.id;
      attachPlayer(room, player, socket.id);
      ack?.({ ok: true, roomCode: room.code, sessionId: player.sessionId });
      emitRoom(room.id);
    } catch (error) {
      ack?.({ ok: false, message: errorMessage(error) });
    }
  });

  socket.on("startGame", () => {
    try {
      const room = rooms.get(session.roomId ?? "");
      const player = room?.players.get(session.playerId ?? "");
      if (!room || !player) throw new Error("You are not in a room.");
      if (room.hostPlayerId !== player.id) throw new Error("Only the host can start the game.");
      startGame(room);
      emitRoom(room.id);
    } catch (error) { replyError(errorMessage(error)); }
  });

  socket.on("click", ({ round }: { round: number }) => {
    try {
      const room = rooms.get(session.roomId ?? "");
      const player = room?.players.get(session.playerId ?? "");
      if (!room || !player) throw new Error("You are not in a room.");
      if (!Number.isInteger(round)) throw new Error("Invalid round.");
      playerClick(room, player, round);
      emitRoom(room.id);
    } catch (error) { replyError(errorMessage(error)); }
  });

  socket.on("playAgain", () => {
    try {
      const room = rooms.get(session.roomId ?? "");
      const player = room?.players.get(session.playerId ?? "");
      if (!room || !player) throw new Error("You are not in a room.");
      if (room.hostPlayerId !== player.id) throw new Error("Only the host can start again.");
      playAgain(room);
      emitRoom(room.id);
    } catch (error) { replyError(errorMessage(error)); }
  });

  socket.on("returnLobby", () => {
    try {
      const room = rooms.get(session.roomId ?? "");
      const player = room?.players.get(session.playerId ?? "");
      if (!room || !player) throw new Error("You are not in a room.");
      if (room.hostPlayerId !== player.id) throw new Error("Only the host can return to the lobby.");
      returnLobby(room);
      emitRoom(room.id);
    } catch (error) { replyError(errorMessage(error)); }
  });

  socket.on("leaveRoom", () => {
    const room = rooms.get(session.roomId ?? "");
    const player = room?.players.get(session.playerId ?? "");
    if (!room || !player) return;
    const roomId = room.id;
    leaveRoom(room, player);
    session.roomId = undefined;
    session.playerId = undefined;
    if (rooms.has(roomId)) emitRoom(roomId);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(session.roomId ?? "");
    const player = room?.players.get(session.playerId ?? "");
    if (!room || !player || player.socketId !== socket.id) return;
    detachPlayer(room, player);
    if (rooms.has(room.id)) emitRoom(room.id);
  });
});

setInterval(cleanupRooms, 60_000).unref();

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Reaction Rush server listening on http://localhost:${port}`);
});

