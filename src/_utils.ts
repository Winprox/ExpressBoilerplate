import { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import c from 'chalk';
import { SHA256 } from 'crypto-js';
import { config } from 'dotenv';
import { CookieOptions } from 'express';
import { sign, verify } from 'jsonwebtoken';

config(); //? Load .env
export const port = process.env.PORT ?? 8080;
export const isProd = process.env.NODE_ENV === 'production';
export const jwtSecret = process.env.JWT_SECRET ?? '';
export const cookieConfig: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' };

export const getRequestFingerprint = ({ req }: CreateExpressContextOptions) =>
  SHA256(`${req.socket.remoteAddress} ${req.headers['user-agent']}`).toString();

export const jwtVerifyAndGetId = (token: string) => {
  try {
    const decoded: any = verify(token, jwtSecret);
    if (!decoded.id) {
      console.log(c.red('{JWT} WRONG_TOKEN_FORMAT'));
      return undefined;
    }
    return String(decoded.id);
  } catch (error) {
    console.log(c.red(`{JWT} ${error}`));
    return undefined;
  }
};

export const getUserById = async (id: string, prisma: PrismaClient) => {
  const user = await prisma.user.findFirst({ where: { id } });
  if (!user) {
    console.log(c.red('{USER} USER_NOT_FOUND'));
    await prisma.session.deleteMany({ where: { id } }); //? Delete Session
    return undefined;
  }
  return user;
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
  const tokenHash = SHA256(refreshToken).toString();
  const issuedTo = getRequestFingerprint({ req, res });
  await prisma.session
    .upsert({
      where: { id: userId },
      create: { id: userId, token: tokenHash, issuedTo },
      update: { token: tokenHash, issuedTo },
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
