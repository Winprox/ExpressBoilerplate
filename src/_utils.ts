import { PrismaClient } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { SHA256 } from 'crypto-js';
import { config } from 'dotenv';
import { CookieOptions } from 'express';
import { sign, verify } from 'jsonwebtoken';

config(); //? Load .env
export const port = process.env.PORT ?? 8080;
export const isProd = process.env.NODE_ENV === 'production';
export const jwtSecret = process.env.JWT_SECRET ?? '';
export const cookieConfig: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' };

export const getRequestFingerprint = (req: CreateExpressContextOptions['req']) =>
  SHA256(`${req.socket.remoteAddress} ${req.headers['user-agent']}`).toString();

type TToken = { id?: string };
export const jwtVerifyAndGetId = (token: string) => {
  try {
    const decoded = <TToken>verify(token, jwtSecret);
    if (!decoded.id) {
      console.log('{JWT} WRONG_TOKEN_FORMAT');
      return undefined;
    }
    return String(decoded.id);
  } catch (error) {
    console.log(`{JWT} ${error}`);
    return undefined;
  }
};

export const getUserById = async (id: string, prisma: PrismaClient) => {
  const user = await prisma.user.findFirst({ where: { id } });
  if (!user) {
    console.log('{USER} USER_NOT_FOUND');
    await prisma.session.deleteMany({ where: { id } }); //? Delete Session
    return undefined;
  }
  return user;
};

export const updateSessionAndIssueJWTs = async (
  { req, res }: CreateExpressContextOptions,
  id: string,
  prisma: PrismaClient
) => {
  //? Issue JWTs and set cookies
  const refreshToken = sign({ id: id }, jwtSecret, { expiresIn: '10d' });
  const accessToken = sign({ id: id }, jwtSecret, { expiresIn: '15m' });
  res.cookie('token', refreshToken, { ...cookieConfig, maxAge: 864e6 }); //? 10d equivalent
  res.cookie('aToken', accessToken, cookieConfig);

  //? Set Session
  const token = SHA256(refreshToken).toString();
  const issuedTo = getRequestFingerprint(req);
  await prisma.session
    .upsert({ where: { id }, create: { id, token, issuedTo }, update: { token, issuedTo } })
    .catch(({ message }) => {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
    });
  prisma.$disconnect();
};
