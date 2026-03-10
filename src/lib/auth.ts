import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "./db";
import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";
import { authorizeDemoWorkspaceToken } from "@/lib/demo/server";
import { normalizeDemoExperience } from "@/lib/demo/types";

bootstrapRuntimeEnv();

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.password) {
          throw new Error("Invalid email or password");
        }

        const isPasswordValid = await compare(credentials.password, user.password);

        if (!isPasswordValid) {
          throw new Error("Invalid email or password");
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          isDemo: user.isDemo,
          demoExperience: undefined,
        };
      },
    }),
    CredentialsProvider({
      id: "demo-workspace",
      name: "demo workspace",
      credentials: {
        token: { label: "Demo token", type: "text" },
        demoExperience: { label: "Demo experience", type: "text" },
      },
      async authorize(credentials) {
        const user = await authorizeDemoWorkspaceToken(
          credentials?.token,
          normalizeDemoExperience(credentials?.demoExperience)
        );
        if (!user) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          isDemo: user.isDemo,
          demoExperience: user.demoExperience,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
        token.isDemo = Boolean(user.isDemo);
        token.demoExperience = user.demoExperience;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string;
        session.user.id = token.id as string;
        session.user.isDemo = Boolean(token.isDemo);
        session.user.demoExperience =
          token.demoExperience === "facility" ? "facility" : token.isDemo ? "researcher" : undefined;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
};
