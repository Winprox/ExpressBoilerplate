import express from 'express';
import cors from 'cors';
import c from 'chalk';
import { writeFileSync } from 'fs';
import { setup, serve } from 'swagger-ui-express';
import { verify, JwtPayload } from 'jsonwebtoken';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { z } from 'zod';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { inferAsyncReturnType, initTRPC, TRPCError } from '@trpc/server';
import {
  createExpressMiddleware,
  CreateExpressContextOptions,
} from '@trpc/server/adapters/express';
import {
  OpenApiMeta,
  generateOpenApiDocument,
  createOpenApiExpressMiddleware,
} from 'trpc-openapi';

config(); //? Load .env
const port = process.env.PORT ?? 8080;
const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET ?? '';

const app = express();
const server = createServer(app);
const io = new Server(server);
const prisma = new PrismaClient();

//? TRPC Context
const createContext = ({ req }: CreateExpressContextOptions) => {
  //? JWT Auth
  const getUser = () => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return null;

    try {
      const decoded = verify(String(token), jwtSecret);
      if (!decoded) {
        console.log(c.red('{REST/TRPC} TOKEN_DECODING_ERROR'));
        return null;
      }
      //? Check Decoded JWT and Return User With Permissions
      return {};
    } catch (error: any) {
      //? Accept Malformed JWTs in Development
      if (!isProd && error.message === 'jwt malformed') return {};
      console.log(c.red(`{REST/TRPC} ${error}`));
      return null;
    }
  };

  return { req, user: getUser() };
};

//? Init TRPC
const { router: trpcRouter, procedure } = initTRPC
  .context<inferAsyncReturnType<typeof createContext>>()
  .meta<OpenApiMeta>()
  .create({
    errorFormatter: ({ error, shape }) => {
      if (error.code === 'INTERNAL_SERVER_ERROR' && isProd)
        return { ...shape, message: 'Internal server error' };
      return shape;
    },
  });

//? TRPC Protected Middleware
const protectedProcedure = procedure.use(({ ctx, next }) => {
  //? Check User Permissions
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Auth error' });
  return next();
});

//? TRPC Routes
const router = trpcRouter({
  getUsers: procedure
    .meta({ openapi: { method: 'GET', path: '/get_users', tags: ['General'] } })
    .input(z.object({}))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .query(async ({ ctx }) => {
      const res = await prisma.user.findMany().catch(({ code, message }) => {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
          cause: { code, message },
        });
      });
      io.to('admins').emit('users', { res, user: ctx.user });
      prisma.$disconnect();
      return res;
    }),
  addUser: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/add_user', tags: ['Auth Required'] } })
    .input(z.object({ name: z.string() }))
    .output(z.string())
    .mutation(async ({ input, ctx }) => {
      const res = await prisma.user
        .create({ data: { name: input.name } })
        .catch(({ code, message }) => {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
            cause: { code, message },
          });
        });
      io.to('admins').emit('addUser', { res, user: ctx.user });
      prisma.$disconnect();
      return res.id;
    }),
  updateUser: protectedProcedure
    .meta({ openapi: { method: 'PUT', path: '/update_user', tags: ['Auth Required'] } })
    .input(z.object({ id: z.string(), name: z.string() }))
    .output(z.object({}))
    .mutation(async ({ input, ctx }) => {
      const res = await prisma.user
        .update({ where: { id: input.id }, data: { name: input.name } })
        .catch(({ code, message }) => {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
            cause: { code, message },
          });
        });
      io.to('admins').emit('updateUser', { res, user: ctx.user });
      prisma.$disconnect();
      return {};
    }),
  deleteUser: protectedProcedure
    .meta({ openapi: { method: 'DELETE', path: '/delete_user', tags: ['Auth Required'] } })
    .input(z.object({ id: z.string() }))
    .output(z.object({}))
    .mutation(async ({ input, ctx }) => {
      const res = await prisma.user
        .delete({ where: { id: input.id } })
        .catch(({ code, message }) => {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
            cause: { code, message },
          });
        });
      io.to('admins').emit('deleteUser', { res, user: ctx.user });
      prisma.$disconnect();
      return {};
    }),
});

//? Generate OpenAPI
const oApi = generateOpenApiDocument(router, {
  title: 'Example API',
  description: 'Accepts any token as authorization',
  version: '1.0.0',
  baseUrl: `http://localhost:${port}`,
});
oApi.security = [{ bearerAuth: [] }];
oApi.components!.securitySchemes = { bearerAuth: { scheme: 'bearer', type: 'http' } };

//? Write OpenAPI to File
writeFileSync('./openapi.json', JSON.stringify(oApi, null, 2));

//? Setup CORS
app.use(cors());

//? Setup Swagger UI
app.get('/view', setup(oApi));
app.use('/view', serve);

//? Setup REST and TRPC Middleware
app.use(
  '/',
  createOpenApiExpressMiddleware({
    router,
    createContext,
    onError: ({ path, error }: any) =>
      console.log(c.red(`{REST} [${path}] ${error.code}: ${error.message}`)),
    maxBodySize: undefined,
    responseMeta: undefined,
  })
);
app.use(
  '/trpc',
  createExpressMiddleware({
    router,
    createContext,
    onError: ({ path, error }) =>
      console.log(c.red(`{TRPC} [${path}] ${error.code}: ${error.message}`)),
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

    //? Check Decoded JWT and Join Different Rooms
    //? Emit Signals to Rooms or All Users
    socket.join('admins');
  };

  try {
    const decoded = verify(String(token), jwtSecret);
    if (!decoded) {
      console.log(c.red('{WS} TOKEN_DECODING_ERROR'));
      return next(new Error('Auth error'));
    }
    roomJoin(decoded);
  } catch (error: any) {
    //? Accept Malformed JWTs in Development
    if (!isProd && error.message === 'jwt malformed') roomJoin('');
    console.log(c.red(`{WS} ${error}}`));
    return next(new Error('Auth error'));
  }

  next();
});

server.listen(port, () => console.log(c.blue(`http://localhost:${port}/view`)));
