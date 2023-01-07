import c from 'chalk';
import { config } from 'dotenv';
import { SHA256 } from 'crypto-js';
import { CookieOptions } from 'express';
import { sign, verify } from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';

config(); //? Load .env
export const port = process.env.PORT ?? 8080;
export const isProd = process.env.NODE_ENV === 'production';
export const jwtSecret = process.env.JWT_SECRET ?? '';
export const cookieConfig: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' };

export const getRequestFingerprint = ({ req }: CreateExpressContextOptions) =>
  String(SHA256(`${req.socket.remoteAddress} ${req.headers['user-agent']}`));

export const getIdFromJWT = (token: string, jwtSecret: string) => {
  try {
    const decoded: any = verify(token, jwtSecret);
    if (!decoded.id) {
      console.log(c.red('{REST/TRPC} WRONG_TOKEN_FORMAT'));
      return undefined;
    }
    return String(decoded.id);
  } catch (error) {
    console.log(c.red(`{REST/TRPC} ${error}`));
    return undefined;
  }
};

export const updateSessionAndIssueJWTs = async (
  { req, res }: CreateExpressContextOptions,
  userId: string,
  prisma: PrismaClient
) => {
  //? Issue JWTs and set cookies
  const refreshToken = sign({ id: userId }, jwtSecret, { expiresIn: '10d' });
  const accessToken = sign({ id: userId }, jwtSecret, { expiresIn: '15m' });
  res.cookie('token', refreshToken, { ...cookieConfig, maxAge: 864000000 }); //? 10d equivalent
  res.cookie('aToken', accessToken, cookieConfig);

  //? Set Session
  const token = String(SHA256(refreshToken));
  const issuedTo = getRequestFingerprint({ req, res });
  await prisma.session
    .upsert({
      where: { id: userId },
      create: { id: userId, token, issuedTo },
      update: { token, issuedTo },
    })
    .catch(({ message }) => {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Internal server error`,
        cause: message,
      });
    });
  prisma.$disconnect();
};
