import { describe, it, expect, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  generateRefreshToken,
  hashRefreshToken,
  newTokenFamily,
  refreshTokenExpiry,
  signAccessToken,
  ttlToMilliseconds,
  verifyAccessToken,
} from '../src/modules/auth/token.service.js';
import { UnauthenticatedError } from '../src/shared/errors.js';
import { env } from '../src/config/app-env.js';
import { closeDatabase } from './helpers.js';

afterAll(closeDatabase);

describe('ttlToMilliseconds', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('converts %s', (ttl, expected) => {
    expect(ttlToMilliseconds(ttl)).toBe(expected);
  });

  it('rejects a format it does not understand rather than defaulting to zero', () => {
    // A silent 0 would mean "expire immediately" and a very confusing outage.
    expect(() => ttlToMilliseconds('15 minutes')).toThrow(/Unsupported TTL/);
    expect(() => ttlToMilliseconds('')).toThrow(/Unsupported TTL/);
    expect(() => ttlToMilliseconds('m15')).toThrow(/Unsupported TTL/);
  });
});

describe('refreshTokenExpiry', () => {
  it('produces a future date', () => {
    expect(refreshTokenExpiry().getTime()).toBeGreaterThan(Date.now());
  });
});

describe('refresh tokens', () => {
  it('are long enough to be unguessable', () => {
    // 32 bytes of CSPRNG output encoded base64url. A shorter token would make
    // brute-forcing plausible, which is why the length is asserted rather than
    // assumed.
    expect(generateRefreshToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('are not predictable across calls', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(500);
  });

  it('hash to a stable 64-character hex digest', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).toBe(hash);
  });

  it('hash differently for different tokens', () => {
    expect(hashRefreshToken(generateRefreshToken())).not.toBe(hashRefreshToken(generateRefreshToken()));
  });

  it('do not contain the raw token, so a table dump cannot be replayed', () => {
    const token = generateRefreshToken();
    expect(hashRefreshToken(token)).not.toContain(token);
  });

  it('give each login a distinct family id', () => {
    expect(newTokenFamily()).not.toBe(newTokenFamily());
  });
});

describe('access tokens', () => {
  const userId = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  it('verify for the user they were issued to', () => {
    const claims = verifyAccessToken(signAccessToken(userId, 'member'));
    expect(claims.sub).toBe(userId);
    expect(claims.role).toBe('member');
    expect(claims.typ).toBe('access');
  });

  it('carry the issuer and audience the verifier demands', () => {
    const decoded = jwt.decode(signAccessToken(userId, 'member')) as jwt.JwtPayload;
    expect(decoded.iss).toBe('taskflow-api');
    expect(decoded.aud).toBe('taskflow-web');
  });

  it('are rejected after expiry', () => {
    const expired = jwt.sign({ role: 'member', typ: 'access' }, env.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: '-1s',
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(expired)).toThrow(UnauthenticatedError);
    expect(() => verifyAccessToken(expired)).toThrow(/expired/);
  });

  it('are rejected when signed with the refresh secret', () => {
    // The two secrets are separate, so a stolen refresh token is useless as a
    // bearer credential. This asserts the separation rather than trusting it.
    const wrongSecret = jwt.sign({ role: 'member', typ: 'access' }, env.JWT_REFRESH_SECRET, {
      subject: userId,
      expiresIn: '15m',
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(wrongSecret)).toThrow(UnauthenticatedError);
  });

  it('are rejected when tampered with', () => {
    const token = signAccessToken(userId, 'member');
    const [header, payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')), role: 'admin' }),
      'utf8',
    ).toString('base64url');
    expect(() => verifyAccessToken(`${header}.${forged}.${signature}`)).toThrow(UnauthenticatedError);
  });

  it('are rejected with a different issuer', () => {
    const token = jwt.sign({ role: 'member', typ: 'access' }, env.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: '15m',
      issuer: 'somebody-else',
      audience: 'taskflow-web',
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(token)).toThrow(UnauthenticatedError);
  });

  it('are rejected with a different audience', () => {
    const token = jwt.sign({ role: 'member', typ: 'access' }, env.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: '15m',
      issuer: 'taskflow-api',
      audience: 'some-other-client',
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(token)).toThrow(UnauthenticatedError);
  });

  it('are rejected with the alg:none downgrade', () => {
    // The classic JWT bypass: strip the signature and claim the algorithm is
    // "none". Pinned algorithms in verify() is what stops it.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8').toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: userId, role: 'admin', typ: 'access', iss: 'taskflow-api', aud: 'taskflow-web', exp: Math.floor(Date.now() / 1000) + 900 }),
      'utf8',
    ).toString('base64url');
    expect(() => verifyAccessToken(`${header}.${payload}.`)).toThrow(UnauthenticatedError);
  });

  it('are rejected when the typ claim says refresh', () => {
    // Defence in depth: even if a refresh token were somehow signed with the
    // access secret, it must not authenticate a request.
    const token = jwt.sign({ role: 'member', typ: 'refresh' }, env.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: '15m',
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(token)).toThrow(/malformed/);
  });

  it('are rejected when the role claim is not a known role', () => {
    const token = jwt.sign({ role: 'superuser', typ: 'access' }, env.JWT_ACCESS_SECRET, {
      subject: userId,
      expiresIn: '15m',
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(token)).toThrow(/malformed/);
  });

  it('are rejected when there is no subject', () => {
    const token = jwt.sign({ role: 'member', typ: 'access' }, env.JWT_ACCESS_SECRET, {
      expiresIn: '15m',
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(token)).toThrow(/malformed/);
  });

  it('are rejected when the subject is not a string', () => {
    const token = jwt.sign({ sub: { id: userId }, role: 'member', typ: 'access' }, env.JWT_ACCESS_SECRET, {
      expiresIn: '15m',
      issuer: 'taskflow-api',
      audience: 'taskflow-web',
      algorithm: 'HS256',
    });
    expect(() => verifyAccessToken(token)).toThrow(/malformed/);
  });

  it('are rejected for garbage input without throwing anything but UnauthenticatedError', () => {
    for (const value of ['', 'abc', 'a.b.c', '...']) {
      expect(() => verifyAccessToken(value)).toThrow(UnauthenticatedError);
    }
  });

  it('never echo the token or the secret back in the error', () => {
    const token = signAccessToken(userId, 'member');
    try {
      jwt.verify(token, 'wrong-secret', { algorithms: ['HS256'] });
    } catch {
      // Deliberately empty: this asserts the shape of our own error, not jsonwebtoken's.
    }
    expect(() => verifyAccessToken(`${token}tampered`)).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining(env.JWT_ACCESS_SECRET) }),
    );
  });
});
