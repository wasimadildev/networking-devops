import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/async-handler.js';
import { caller } from '../../shared/request.js';
import { sendCreated, sendData, sendNoContent } from '../../shared/response.js';
import type { ChangePasswordBody, LoginBody, RefreshBody, RegisterBody } from './auth.schemas.js';
import {
  changePassword,
  login,
  logout,
  logoutEverywhere,
  refresh,
  register,
  type RequestContextMeta,
} from './auth.service.js';

/**
 * The client IP is only trustworthy when Express is told how many proxies to
 * believe. Reading `req.ip` behind a misconfigured `trust proxy` lets a client
 * spoof its own rate-limit bucket by sending `X-Forwarded-For`.
 */
const requestMeta = (req: Request): RequestContextMeta => ({
  userAgent: req.header('user-agent')?.slice(0, 256) ?? null,
  ipAddress: req.ip ?? null,
});

export const registerHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await register(req.body as RegisterBody, requestMeta(req));
  sendCreated(res, result);
});

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await login(req.body as LoginBody, requestMeta(req));
  sendData(res, result);
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as RefreshBody;
  const result = await refresh(refreshToken, requestMeta(req));
  sendData(res, result);
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body as RefreshBody;
  await logout(refreshToken);
  sendNoContent(res);
});

export const logoutAllHandler = asyncHandler(async (req: Request, res: Response) => {
  await logoutEverywhere(caller(req).userId);
  sendNoContent(res);
});

export const changePasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await changePassword(caller(req).userId, req.body as ChangePasswordBody);
  sendData(res, result);
});
