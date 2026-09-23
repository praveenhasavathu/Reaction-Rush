import "dotenv/config";
import path from "node:path";
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

type SocketSession = {
  roomId?: string;
  playerId?: string;
};

const app = express();
const httpServer = createServer(app);

const port = Number(process.env.PORT || 3001);
const clientOrigin = process.env.CLIENT_ORIGIN;

const allowedOrigins = clientOrigin
  ? clientOrigin
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  : true;

app.use(
  cors({
    origin: allowedOrigins,
  }),
);

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "reaction-rush",
    rooms: rooms.size,
  });
});

/*
 * Render starts the application from the project root.
 *
 * Production structure:
 *
 * reaction-rush/
 * ├── client/
 * │   └── dist/
 * └── server/
 *     └── dist/
 *
 * Therefore the frontend is located at:
 *
 * process.cwd()/client/dist
 */
const clientDistPath = path.resolve(
  __dirname,
  "../../client/dist",
);

/*
 * Serve the React frontend in production.
 *
 * We intentionally do not use import.meta.url here because
 * the server TypeScript configuration outputs CommonJS.
 */
if (process.env.NODE_ENV === "production") {
  app.use(
    express.static(clientDistPath),
  );

  /*
   * Express 5 SPA fallback.
   *
   * This allows the React application to handle
   * client-side routes.
   */
  app.get(
    "/{*splat}",
    (_req, res) => {
      res.sendFile(
        path.join(
          clientDistPath,
          "index.html",
        ),
      );
    },
  );
}

const io = new Server(
  httpServer,
  {
    cors: {
      origin: allowedOrigins,
    },
    transports: [
      "websocket",
      "polling",
    ],
  },
);

function emitRoom(roomId: string) {
  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  for (const player of room.players.values()) {
    if (
      !player.connected ||
      !player.socketId
    ) {
      continue;
    }

    io.to(player.socketId).emit(
      "state",
      publicState(
        room,
        player.id,
      ),
    );
  }
}

function errorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

io.on(
  "connection",
  (socket) => {
    const session: SocketSession = {};

    const replyError = (
      message: string,
    ) => {
      socket.emit(
        "errorMessage",
        { message },
      );
    };

    /*
     * CREATE ROOM
     */
    socket.on(
      "createRoom",
      (
        {
          nickname,
        }: {
          nickname: string;
        },
        ack?: (
          data: unknown,
        ) => void,
      ) => {
        try {
          const {
            room,
            player,
          } = createRoom(
            nickname,
          );

          session.roomId =
            room.id;

          session.playerId =
            player.id;

          attachPlayer(
            room,
            player,
            socket.id,
          );

          ack?.({
            ok: true,
            roomCode: room.code,
            sessionId:
              player.sessionId,
          });

          emitRoom(room.id);
        } catch (error) {
          ack?.({
            ok: false,
            message:
              errorMessage(error),
          });
        }
      },
    );

    /*
     * JOIN ROOM
     */
    socket.on(
      "joinRoom",
      (
        {
          roomCode,
          nickname,
        }: {
          roomCode: string;
          nickname: string;
        },
        ack?: (
          data: unknown,
        ) => void,
      ) => {
        try {
          const room =
            getRoom(roomCode);

          if (!room) {
            throw new Error(
              "Room not found. Check the code and try again.",
            );
          }

          const player =
            joinRoom(
              room,
              nickname,
            );

          session.roomId =
            room.id;

          session.playerId =
            player.id;

          attachPlayer(
            room,
            player,
            socket.id,
          );

          ack?.({
            ok: true,
            roomCode: room.code,
            sessionId:
              player.sessionId,
          });

          emitRoom(room.id);
        } catch (error) {
          ack?.({
            ok: false,
            message:
              errorMessage(error),
          });
        }
      },
    );

    /*
     * RECONNECT EXISTING PLAYER
     */
    socket.on(
      "reconnectRoom",
      (
        {
          roomCode,
          sessionId,
        }: {
          roomCode: string;
          sessionId: string;
        },
        ack?: (
          data: unknown,
        ) => void,
      ) => {
        try {
          const room =
            getRoom(roomCode);

          if (!room) {
            throw new Error(
              "That room no longer exists.",
            );
          }

          const player =
            findPlayerBySession(
              room,
              sessionId,
            );

          if (!player) {
            throw new Error(
              "Your session has expired. Rejoin the room.",
            );
          }

          if (
            player.socketId &&
            player.socketId !== socket.id
          ) {
            const oldSocket =
              io.sockets.sockets.get(
                player.socketId,
              );

            oldSocket?.disconnect(
              true,
            );
          }

          session.roomId =
            room.id;

          session.playerId =
            player.id;

          attachPlayer(
            room,
            player,
            socket.id,
          );

          ack?.({
            ok: true,
            roomCode: room.code,
            sessionId:
              player.sessionId,
          });

          emitRoom(room.id);
        } catch (error) {
          ack?.({
            ok: false,
            message:
              errorMessage(error),
          });
        }
      },
    );

    /*
     * START GAME
     */
    socket.on(
      "startGame",
      () => {
        try {
          const room =
            rooms.get(
              session.roomId ?? "",
            );

          const player =
            room?.players.get(
              session.playerId ?? "",
            );

          if (!room || !player) {
            throw new Error(
              "You are not in a room.",
            );
          }

          if (
            room.hostPlayerId !==
            player.id
          ) {
            throw new Error(
              "Only the host can start the game.",
            );
          }

          startGame(room);

          emitRoom(room.id);
        } catch (error) {
          replyError(
            errorMessage(error),
          );
        }
      },
    );

    /*
     * PLAYER CLICK
     *
     * The client only sends the current round.
     * The server determines the actual result,
     * reaction time, and score.
     */
    socket.on(
      "click",
      (
        {
          round,
        }: {
          round: number;
        },
      ) => {
        try {
          const room =
            rooms.get(
              session.roomId ?? "",
            );

          const player =
            room?.players.get(
              session.playerId ?? "",
            );

          if (!room || !player) {
            throw new Error(
              "You are not in a room.",
            );
          }

          if (
            !Number.isInteger(round)
          ) {
            throw new Error(
              "Invalid round.",
            );
          }

          playerClick(
            room,
            player,
            round,
          );

          emitRoom(room.id);
        } catch (error) {
          replyError(
            errorMessage(error),
          );
        }
      },
    );

    /*
     * PLAY AGAIN
     */
    socket.on(
      "playAgain",
      () => {
        try {
          const room =
            rooms.get(
              session.roomId ?? "",
            );

          const player =
            room?.players.get(
              session.playerId ?? "",
            );

          if (!room || !player) {
            throw new Error(
              "You are not in a room.",
            );
          }

          if (
            room.hostPlayerId !==
            player.id
          ) {
            throw new Error(
              "Only the host can start again.",
            );
          }

          playAgain(room);

          emitRoom(room.id);
        } catch (error) {
          replyError(
            errorMessage(error),
          );
        }
      },
    );

    /*
     * RETURN TO LOBBY
     */
    socket.on(
      "returnLobby",
      () => {
        try {
          const room =
            rooms.get(
              session.roomId ?? "",
            );

          const player =
            room?.players.get(
              session.playerId ?? "",
            );

          if (!room || !player) {
            throw new Error(
              "You are not in a room.",
            );
          }

          if (
            room.hostPlayerId !==
            player.id
          ) {
            throw new Error(
              "Only the host can return to the lobby.",
            );
          }

          returnLobby(room);

          emitRoom(room.id);
        } catch (error) {
          replyError(
            errorMessage(error),
          );
        }
      },
    );

    /*
     * LEAVE ROOM
     */
    socket.on(
      "leaveRoom",
      () => {
        const room =
          rooms.get(
            session.roomId ?? "",
          );

        const player =
          room?.players.get(
            session.playerId ?? "",
          );

        if (!room || !player) {
          return;
        }

        const roomId =
          room.id;

        leaveRoom(
          room,
          player,
        );

        session.roomId =
          undefined;

        session.playerId =
          undefined;

        if (rooms.has(roomId)) {
          emitRoom(roomId);
        }
      },
    );

    /*
     * DISCONNECT
     *
     * detachPlayer handles the reconnect
     * grace period and host transfer.
     */
    socket.on(
      "disconnect",
      () => {
        const room =
          rooms.get(
            session.roomId ?? "",
          );

        const player =
          room?.players.get(
            session.playerId ?? "",
          );

        if (
          !room ||
          !player ||
          player.socketId !==
            socket.id
        ) {
          return;
        }

        detachPlayer(
          room,
          player,
        );

        if (rooms.has(room.id)) {
          emitRoom(room.id);
        }
      },
    );
  },
);

/*
 * Remove inactive/expired rooms periodically.
 */
setInterval(
  cleanupRooms,
  60_000,
).unref();

/*
 * Render requires the server to listen on 0.0.0.0.
 */
httpServer.listen(
  port,
  "0.0.0.0",
  () => {
    console.log(
      `Reaction Rush server listening on port ${port}`,
    );

    console.log(
      `Serving client from: ${clientDistPath}`,
    );
  },
);