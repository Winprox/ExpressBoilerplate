import { inferAsyncReturnType, initTRPC, TRPCError } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import c from 'chalk';
import { parse } from 'cookie';
import { SHA256 } from 'crypto-js';
import { OpenApiMeta } from 'trpc-openapi';
import { prisma } from '../index';
import { generateAuthRouter } from './auth';
import { generateUsersRouter } from './users';
import {
  getRequestFingerprint,
  getUserById,
  isProd,
  jwtVerifyAndGetId,
  updateSessionAndIssueJWTs,
} from './_utils';

//? Context
export const createContext = async ({ req, res }: CreateExpressContextOptions) => {
  //? JWT Auth
  const auth = async () => {
    //? Get JWTs from Cookies
    const cookies = parse(req.headers.cookie ?? '');
    const refreshToken = cookies.token;
    const accessToken = cookies.aToken;
    if (!refreshToken || !accessToken) return undefined;

    const id = jwtVerifyAndGetId(refreshToken);
    if (!id) return undefined;

    //? Check Session
    const token = SHA256(refreshToken).toString();
    const fingerprint = getRequestFingerprint({ req, res });
    const session = await prisma.session.findFirst({ where: { id } });
    if (!session || session.token !== token || session.issuedTo !== fingerprint) {
      console.log(c.red('{REST/TRPC} SESSION_NOT_FOUND'));
      await prisma.session.deleteMany({ where: { id } }); //? Delete Session
      return undefined;
    }

    //? Get User from DB
    const user = await getUserById(id, prisma);
    if (!user) return undefined;

    let accessUpdated = false;
    const accessId = jwtVerifyAndGetId(accessToken); //? Id from Access Token
    if (!accessId) {
      accessUpdated = true;
      updateSessionAndIssueJWTs({ req, res }, id, prisma);
    }

    return { id: user.id, name: user.name, isAdmin: user.isAdmin, accessUpdated };
  };

  const user = await auth();
  if (!user) {
    //? Delete Cookies if Auth Failed
    res.clearCookie('token');
    res.clearCookie('aToken');
  }

  return { req, res, prisma, user };
};

//? Init
export type TRouter = typeof trpcRouter;
export const { router: trpcRouter, procedure } = initTRPC
  .context<inferAsyncReturnType<typeof createContext>>()
  .meta<OpenApiMeta>()
  .create({
    errorFormatter: ({ error, shape }) => {
      //? Hide Internal Server Errors in Production
      if (error.code === 'INTERNAL_SERVER_ERROR' && isProd)
        return { ...shape, message: 'Internal server error' };
      return shape;
    },
  });

//? Authed
export const authedProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Auth error' });
  return next();
});

//? Require ReAuth
export const reauthProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.user || ctx.user.accessUpdated)
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Auth error' });
  return next();
});

//? Authed Admin
export const adminProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.user.isAdmin)
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Auth error' });
  return next();
});

//? Router
export const router = trpcRouter({
  auth: generateAuthRouter(trpcRouter),
  users: generateUsersRouter(trpcRouter),
});
