import { timingSafeEqual } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function verifyPassword(password: string): boolean {
  const actualPassword = Buffer.from(password, "utf8");
  const expectedPassword = Buffer.from(
    requireEnv("EMSD_ADMIN_PASSWORD"),
    "utf8",
  );

  if (actualPassword.length !== expectedPassword.length) {
    return false;
  }

  return timingSafeEqual(actualPassword, expectedPassword);
}

export const authOptions: NextAuthOptions = {
  secret: requireEnv("NEXTAUTH_SECRET"),
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Admin Password",
      credentials: {
        password: {
          label: "Password",
          type: "password",
        },
      },
      authorize(credentials) {
        const password = credentials?.password?.trim();

        if (!password || !verifyPassword(password)) {
          return null;
        }

        return {
          id: "admin",
          name: "admin",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.name = "admin";
        token.sub = "admin";
      }

      return token;
    },
    async session({ session }) {
      session.user = {
        name: "admin",
      };

      return session;
    },
  },
};
