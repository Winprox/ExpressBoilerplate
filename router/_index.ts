import c from 'chalk';
import { parse } from 'cookie';
import { inferAsyncReturnType, initTRPC, TRPCError } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { OpenApiMeta } from 'trpc-openapi';
import { getIdFromJWT, issueJWTsAndUpdateSession, isProd, jwtSecret } from '../utils';
import { prisma } from '../index';
import { generateAuthRouter } from './auth';
import { generateUsersRouter } from './users';

//? Context
export const createContext = async ({ req, res }: CreateExpressContextOptions) => {
  //? JWT Auth
  const auth = async () => {
    //? Check User in DB
    const checkUser = async (id: string) => {
      const user = await prisma.user.findFirst({ where: { id } });
      if (!user) {
        console.log(c.red('{REST/TRPC} USER_NOT_FOUND'));
        await prisma.session.delete({ where: { id } }); //? Delete Session
        return undefined;
      }
      return { id: user.id, name: user.name, ifAdmin: user.ifAdmin };
    };

    //? Get JWTs from Cookies
    const cookies = parse(req.headers.cookie ?? '');
    const token = cookies.token;
    const aToken = cookies.aToken;

    //? If Authed, check Access Token
    if (token && aToken) {
      const id = getIdFromJWT(aToken, jwtSecret);
      if (!id) return undefined;
      return checkUser(id);
    }

    //? If not Authed, check Refresh Token
    if (!token) return undefined;
    const id = getIdFromJWT(token, jwtSecret);
    if (!id) return undefined;

    //? Check Session
    const ip = req.socket.remoteAddress;
    const session = await prisma.session.findFirst({ where: { id } });
    if (!session || session.token !== token || session.issuedTo !== ip) {
      console.log(c.red('{REST/TRPC} SESSION_NOT_FOUND'));
      await prisma.session.delete({ where: { id } }); //? Delete Session
      return undefined;
    }

    issueJWTsAndUpdateSession({ req, res }, id, prisma);
    return checkUser(id);
  };

  const user = await auth();
  if (!user) {
    //? Delete Cookies
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
