import express from 'express';
import cors from 'cors';
import c from 'chalk';
import ui from 'swagger-ui-express';
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

// import { EventEmitter } from 'events';
// import { observable } from '@trpc/server/observable';
// const addEE = new EventEmitter();

config();

const createContext = ({ req }: CreateExpressContextOptions) => {
  const getUser = () => {
    console.log(req.headers);
    if (req.headers.authorization) return {};
    else return null;
  };
  return { user: getUser() };
};

const { router: trpcRouter, procedure } = initTRPC
  .context<inferAsyncReturnType<typeof createContext>>()
  .meta<OpenApiMeta>()
  .create({
    errorFormatter: ({ error, shape }) => {
      if (error.code === 'INTERNAL_SERVER_ERROR' && process.env.NODE_ENV === 'production')
        return { ...shape, message: 'Internal server error' };
      return shape;
    },
  });

const protectedProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User not found' });
  return next();
});

const prisma = new PrismaClient();
const router = trpcRouter({
  users: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/get_users', tags: ['Users'] } })
    .input(z.object({}))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .query(async () => {
      const res = await prisma.user.findMany().catch(({ code, message }) => {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
          cause: { code, message },
        });
      });
      prisma.$disconnect();
      return res;
    }),
  addUser: protectedProcedure
    .meta({ openapi: { method: 'POST', path: '/add_user', tags: ['Users'] } })
    .input(z.object({ name: z.string() }))
    .output(z.string())
    .mutation(async ({ input }) => {
      const res = await prisma.user
        .create({ data: { name: input.name } })
        .catch(({ code, message }) => {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
            cause: { code, message },
          });
        });
      prisma.$disconnect();
      return res.id;
    }),
  updateUser: protectedProcedure
    .meta({ openapi: { method: 'PUT', path: '/update_user', tags: ['Users'] } })
    .input(z.object({ id: z.string(), name: z.string() }))
    .output(z.string())
    .mutation(async ({ input }) => {
      const res = await prisma.user
        .update({ where: { id: input.id }, data: { name: input.name } })
        .catch(({ code, message }) => {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
            cause: { code, message },
          });
        });
      prisma.$disconnect();
      return res.id;
    }),
  deleteUser: protectedProcedure
    .meta({ openapi: { method: 'DELETE', path: '/delete_user', tags: ['Users'] } })
    .input(z.object({ id: z.string() }))
    .output(z.string())
    .mutation(async ({ input }) => {
      const res = await prisma.user
        .delete({ where: { id: input.id } })
        .catch(({ code, message }) => {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
            cause: { code, message },
          });
        });
      prisma.$disconnect();
      return res.id;
    }),
  //? Will not work with OpenAPI
  // onAdd: procedure
  //   .meta({ openapi: { method: 'GET', path: '/on_add', tags: ['Ping'] } })
  //   .subscription(() =>
  //     observable<User>(() => {
  //       const listener = (user: User) => addEE.emit('data', user);
  //       addEE.on('add', listener);
  //       return () => addEE.off('add', listener);
  //     })
  //   ),
});

const port = process.env.PORT ?? 8080;

const oApi = generateOpenApiDocument(router, {
  title: 'Example API',
  description: 'Accepts any token as authorization',
  version: '1.0.0',
  baseUrl: `http://localhost:${port}`,
});
oApi.security = [{ bearerAuth: [] }];
oApi.components!.securitySchemes = { bearerAuth: { scheme: 'bearer', type: 'http' } };

const app = express();
app.use(cors());
app.get('/view', ui.setup(oApi));
app.use('/view', ui.serve);
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
app.listen(port, () => console.log(c.blue(`http://localhost:${port}/view`)));
