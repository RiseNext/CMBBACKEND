import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";
import { unauthorized } from "./errors.js";

export interface AccessTokenClaims {
  sub: string;
  email: string;
  roleId: string;
  roleKey: string;
  roleLevel: number;
  tokenType: "access";
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  tokenType: "refresh";
}

export function signAccessToken(claims: Omit<AccessTokenClaims, "tokenType">): string {
  const config = env();
  const options: SignOptions = {
    expiresIn: config.ACCESS_TOKEN_TTL as SignOptions["expiresIn"],
    issuer: "risenext-crm",
    audience: "risenext-crm-api",
  };
  return jwt.sign({ ...claims, tokenType: "access" }, config.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(claims: Omit<RefreshTokenClaims, "tokenType">): string {
  const config = env();
  const options: SignOptions = {
    expiresIn: `${config.REFRESH_TOKEN_TTL_DAYS}d`,
    issuer: "risenext-crm",
    audience: "risenext-crm-api",
  };
  return jwt.sign({ ...claims, tokenType: "refresh" }, config.JWT_REFRESH_SECRET, options);
}

/*
 * THE ALGORITHM IS PINNED — SEC-022, Task 13.11.
 *
 * `jwt.verify` without `algorithms` accepts whatever the *token's own header*
 * declares, and both secrets are symmetric. The attack that closes is the
 * classic one: a token whose header says `alg: "none"` is rejected by
 * jsonwebtoken 9 out of the box, but the `HS*` family is not constrained, so a
 * token forged with a different HMAC width still reaches signature
 * verification. More importantly, if either secret is ever migrated to an
 * asymmetric key, an unpinned verifier will happily treat the PUBLIC key as an
 * HMAC secret — the algorithm-confusion attack — and a value anyone can read
 * becomes a signing key.
 *
 * `signAccessToken` and `signRefreshToken` do not pass `algorithm`, so they use
 * jsonwebtoken's default, HS256. Pinning the verifier to exactly that is
 * therefore behaviour-preserving for every token this service issues, and
 * closes the door for every token it did not.
 */
const JWT_ALGORITHMS = ["HS256"] as const;

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env().JWT_ACCESS_SECRET, {
      algorithms: [...JWT_ALGORITHMS],
      issuer: "risenext-crm",
      audience: "risenext-crm-api",
    }) as AccessTokenClaims;
    if (decoded.tokenType !== "access") throw unauthorized("Wrong token type");
    return decoded;
  } catch {
    throw unauthorized("Session expired or invalid");
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    const decoded = jwt.verify(token, env().JWT_REFRESH_SECRET, {
      algorithms: [...JWT_ALGORITHMS],
      issuer: "risenext-crm",
      audience: "risenext-crm-api",
    }) as RefreshTokenClaims;
    if (decoded.tokenType !== "refresh") throw unauthorized("Wrong token type");
    return decoded;
  } catch {
    throw unauthorized("Session expired or invalid");
  }
}

export function refreshCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "none" | "lax";
  path: string;
  maxAge: number;
  domain?: string;
} {
  const config = env();
  const isProd = config.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    // Frontend on Vercel and API on Railway are different sites, so the
    // refresh cookie has to be SameSite=None in production. That in turn
    // requires Secure, and CORS must send credentials with an explicit origin.
    sameSite: isProd ? "none" : "lax",
    path: "/api/auth",
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

export const REFRESH_COOKIE_NAME = "rn_refresh";
