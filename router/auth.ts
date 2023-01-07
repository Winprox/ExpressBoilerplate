import { z } from 'zod';
import { SHA256 } from 'crypto-js';
import { sign } from 'jsonwebtoken';
import { TRPCError } from '@trpc/server';
import { cookieConfig, jwtSecret, prisma, io } from '../index';
import { procedure } from './_index';

export const generateAuthRouter = (router: any) =>
  router({
    login: procedure
      .meta({ openapi: { method: 'GET', path: '/login', tags: ['Auth'] } })
      .input(z.object({ name: z.string(), pass: z.string() }))
      .output(z.object({}))
      .query(async ({ input: { name, pass }, ctx: { req, res } }) => {
        const user = await prisma.user
          .findFirst({ where: { name, pass: SHA256(pass).toString() } })
          .catch(({ message }) => {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Internal server error',
              cause: message,
            });
          });
        prisma.$disconnect();
        if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });

        //? Issue JWTs
        const token = sign({ id: user.id }, jwtSecret, { expiresIn: '10d' });
        const accessToken = sign({ id: user.id }, jwtSecret, { expiresIn: '15m' });

        //? Set cookies
        res.cookie('token', token, { ...cookieConfig, maxAge: 864000000 });
        res.cookie('aToken', accessToken, cookieConfig);

        //? Set Session
        await prisma.session
          .upsert({
            where: { id: user.id },
            create: { id: user.id, token, issuedTo: req.ip },
            update: { token, issuedTo: req.socket.remoteAddress },
          })
          .catch(({ message }) => {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Internal server error`,
              cause: message,
            });
          });
        prisma.$disconnect();

        io.to('admins').emit(`login [${name}]`);
        return {};
      }),
  });
