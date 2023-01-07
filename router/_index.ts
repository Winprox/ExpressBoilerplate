import c from 'chalk';
import { parse } from 'cookie';
import { SHA256 } from 'crypto-js';
import { inferAsyncReturnType, initTRPC, TRPCError } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { OpenApiMeta } from 'trpc-openapi';
import {
  isProd,
  jwtSecret,
  getIdFromJWT,
  getRequestFingerprint,
  updateSessionAndIssueJWTs,
} from '../utils';
import { prisma } from '../index';
import { generateAuthRouter } from './auth';
import { generateUsersRouter } from './users';

//? Context
export const createContext = async ({ req, res }: CreateExpressContextOptions) => {
  //? JWT Auth
  const auth = async () => {
    //? Get JWTs from Cookies
    const cookies = parse(req.headers.cookie ?? '');
    const refreshToken = cookies.token;
    const accessToken = cookies.aToken;
    if (!refreshToken || !accessToken) return undefined;

    const id = getIdFromJWT(refreshToken, jwtSecret);
    if (!id) return undefined;

    //? Check Session
    const token = String(SHA256(refreshToken));
    const fingerprint = getRequestFingerprint({ req, res });
    const session = await prisma.session.findFirst({ where: { id } });
    if (!session || session.token !== token || session.issuedTo !== fingerprint) {
      console.log(c.red('{REST/TRPC} SESSION_NOT_FOUND'));
      await prisma.session.deleteMany({ where: { id } }); //? Delete Session
      return undefined;
    }

    //? Check User in DB
    const user = await prisma.user.findFirst({ where: { id } });
    if (!user) {
      console.log(c.red('{REST/TRPC} USER_NOT_FOUND'));
      await prisma.session.deleteMany({ where: { id } }); //? Delete Session
      return undefined;
    }

    const accessId = getIdFromJWT(accessToken, jwtSecret); //? Id from Access Token
    if (!accessId) updateSessionAndIssueJWTs({ req, res }, id, prisma);

    return { id: user.id, name: user.name, ifAdmin: user.ifAdmin };
  };

  const user = await auth();
  if (!user) {
    //? Delete Cookies if Auth Failed
    res.clearCookie('token');
    res.clearCookie('aToken');
  }

  return { req, res, user };
};

//? Init
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

//? Authed Admin
export const adminProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.user?.ifAdmin) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Auth error' });
  return next();
});

//? Router
export const router = trpcRouter({
  auth: generateAuthRouter(trpcRouter),
  users: generateUsersRouter(trpcRouter),
});
