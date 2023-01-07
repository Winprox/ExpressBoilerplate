import c from 'chalk';
import cors from 'cors';
import express from 'express';
import { writeFileSync } from 'fs';
import { setup, serve } from 'swagger-ui-express';
import { verify, JwtPayload } from 'jsonwebtoken';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { generateOpenApiDocument, createOpenApiExpressMiddleware } from 'trpc-openapi';
import { port, jwtSecret } from './utils';
import { router, createContext } from './router/_index';

const app = express();
const server = createServer(app);
export const prisma = new PrismaClient();
export const io = new Server(server);

//? Generate OpenAPI
const oApi = generateOpenApiDocument(router, {
  title: 'Example API',
  version: '1.0.0',
  baseUrl: `http://localhost:${port}`,
});

//? Write OpenAPI to File
writeFileSync('./openapi.json', JSON.stringify(oApi, null, 2));

//? CORS
app.use(cors());

//? Swagger UI
app.get('/view', setup(oApi));
app.use('/view', serve);

//? REST and TRPC
const errorHandler = (type: string, path: any, error: TRPCError) =>
  console.log(
    c.red(
      `{${type}} [${path}] ${error.code}: ` +
        `${error.message}${error.cause ? `\n${error.cause}` : ''}`
    )
  );

app.use(
  '/',
  createOpenApiExpressMiddleware({
    router,
    createContext,
    onError: ({ path, error }: any) => errorHandler('REST', path, error),
    maxBodySize: undefined,
    responseMeta: undefined,
  })
);

app.use(
  '/trpc',
  createExpressMiddleware({
    router,
    createContext,
    onError: ({ path, error }) => errorHandler('TRPC', path, error),
    maxBodySize: undefined,
    responseMeta: undefined,
  })
);

//? SocketIO JWT Auth and Room Join Middleware
const numClients: Record<string, number> = {};
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    console.log(c.red('{WS} NO_TOKEN'));
    return next(new Error('Auth error'));
  }

  const roomJoin = (decoded: string | JwtPayload) => {
    socket.on('join', (room: string) => {
      if (numClients[room] == undefined) numClients[room] = 1;
      else numClients[room]++;
      console.log(c.blue(`{WS} ++ ${decoded} [${room}] (Total: ${numClients[room]})`));
    });

    socket.on('disconnect', () => {
      socket.rooms.forEach((room) => {
        if (numClients[room] !== undefined) numClients[room]--;
        console.log(c.blue(`{WS} -- ${decoded} [${room}] (Total: ${numClients[room]})`));
      });
    });

    //TODO Check Decoded JWT and Join Different Rooms
    //? Emit Signals to Rooms or All Users
    // socket.handshake.auth.token;
    // socket.request.connection.remoteAddress
    socket.join('admins');
  };

  try {
    const decoded = verify(String(token), jwtSecret);
    if (!decoded) {
      console.log(c.red('{WS} TOKEN_DECODING_ERROR'));
      return next(new Error('Auth error'));
    }
    roomJoin(decoded);
  } catch (error) {
    console.log(c.red(`{WS} ${error}}`));
    return next(new Error('Auth error'));
  }

  next();
});

server.listen(port, () => console.log(c.blue(`http://localhost:${port}/view`)));
