import { inferAsyncReturnType, initTRPC, TRPCError } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { parse } from 'cookie';
import { SHA256 } from 'crypto-js';
import { OpenApiMeta } from 'trpc-openapi';
import { getRequestFingerprint, getUserById, isProd, jwtVerifyAndGetId, updateSessionAndIssueJWTs, } from './_utils.js'; // prettier-ignore
import { prisma } from './index.js';
import { generateAuthRouter } from './routes/auth.js';
import { generateUsersRouter } from './routes/users.js';

//? Context
export const createContext = async ({ req, res }: CreateExpressContextOptions) => {
  //? JWT Auth
  const auth = async () => {
    const cookies = parse(req.headers.cookie ?? '');
    const refreshToken = cookies.token;
    const accessToken = cookies.aToken;
    if (!refreshToken || !accessToken) return undefined;

    let accessUpdated = false;
    let id = jwtVerifyAndGetId(accessToken);
    if (!id) {
      accessUpdated = true;
      const refreshTokenId = jwtVerifyAndGetId(refreshToken);
      if (!refreshTokenId) return undefined;

      //? Check Session
      const tokenHash = SHA256(refreshToken).toString();
      const fingerprint = getRequestFingerprint(req);
      const session = await prisma.session.findFirst({ where: { id: refreshTokenId } });
      if (!session || session.token !== tokenHash || session.issuedTo !== fingerprint) {
        console.log('{REST/TRPC} SESSION_NOT_FOUND');
        await prisma.session.deleteMany({ where: { id: refreshTokenId } });
        return undefined;
      }

      updateSessionAndIssueJWTs({ req, res }, refreshTokenId, prisma);
      id = refreshTokenId;
    }

    //? Get User from DB
    const user = await getUserById(id, prisma);
    if (!user) return undefined;

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
    //? Hide Internal Server Errors in Production
    errorFormatter: ({ error, shape }) =>
      error.code === 'INTERNAL_SERVER_ERROR' && isProd
        ? { ...shape, message: 'Internal server error' }
        : shape,
  });

const authError = new TRPCError({ code: 'UNAUTHORIZED', message: 'Auth error' });

//? Authed
export const authedProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw authError;
  return next();
});

//? Require ReAuth
export const reauthProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.user.accessUpdated) throw authError;
  return next();
});

//? Authed Admin
export const adminProcedure = procedure.use(({ ctx, next }) => {
  if (!ctx.user || !ctx.user.isAdmin) throw authError;
  return next();
});

//? Router
export const router = trpcRouter({
  auth: generateAuthRouter(trpcRouter),
  users: generateUsersRouter(trpcRouter),
});
