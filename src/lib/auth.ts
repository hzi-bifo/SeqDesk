import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "./db";
import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";
import { authorizeDemoWorkspaceToken } from "@/lib/demo/server";
import { normalizeDemoExperience } from "@/lib/demo/types";

bootstrapRuntimeEnv();

function resolveSystemRole(user: {
  systemRole?: string | null;
  role?: string | null;
}): "MEMBER" | "ADMIN" {
  if (user.systemRole === "ADMIN" || user.systemRole === "MEMBER") {
    return user.systemRole;
  }
  return user.role === "FACILITY_ADMIN" ? "ADMIN" : "MEMBER";
}

function resolveFacilityWorkflowRole(user: {
  facilityWorkflowRole?: string | null;
  role?: string | null;
}): "REQUESTER" | "OPERATOR" {
  if (
    user.facilityWorkflowRole === "REQUESTER" ||
    user.facilityWorkflowRole === "OPERATOR"
  ) {
    return user.facilityWorkflowRole;
  }
  return user.role === "FACILITY_ADMIN" ? "OPERATOR" : "REQUESTER";
}

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

        const submittedEmail = credentials.email.trim();
        // New accounts are stored lowercase, but older installations may
        // contain mixed-case addresses. Prefer an exact match (which also
        // keeps case-colliding legacy rows distinguishable), then fall back to
        // PostgreSQL's case-insensitive comparison.
        const exactUser = await db.user.findUnique({
          where: { email: submittedEmail },
        });
        const caseInsensitiveMatches = exactUser
          ? []
          : await db.user.findMany({
            where: {
              email: { equals: submittedEmail, mode: "insensitive" },
            },
            take: 2,
          });
        // A legacy database can technically contain addresses that differ only
        // by case. Never guess between those accounts: their exact spellings
        // remain usable, while an ambiguous case-insensitive login is rejected.
        const user =
          exactUser ??
          (caseInsensitiveMatches.length === 1
            ? caseInsensitiveMatches[0]
            : null);

        if (!user || !user.password || user.isActive === false) {
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
          systemRole: resolveSystemRole(user),
          facilityWorkflowRole: resolveFacilityWorkflowRole(user),
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
        if (user.isActive === false) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          systemRole: resolveSystemRole(user),
          facilityWorkflowRole: resolveFacilityWorkflowRole(user),
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
        token.systemRole = resolveSystemRole(user);
        token.facilityWorkflowRole = resolveFacilityWorkflowRole(user);
        token.id = user.id;
        token.isDemo = Boolean(user.isDemo);
        token.demoExperience = user.demoExperience;
        token.authorizationValid = true;
      } else if (token.id) {
        // JWT sessions must not retain a stale administrator role until token
        // expiry. Refresh the stored role for every authenticated request; a
        // removed or deactivated account is converted to a disabled principal
        // immediately.
        const currentUser = await db.user.findUnique({
          where: { id: String(token.id) },
          select: {
            role: true,
            systemRole: true,
            facilityWorkflowRole: true,
            isActive: true,
            isDemo: true,
          },
        });
        if (currentUser?.isActive) {
          token.role = currentUser.role;
          token.systemRole = resolveSystemRole(currentUser);
          token.facilityWorkflowRole = resolveFacilityWorkflowRole(currentUser);
          token.isDemo = currentUser.isDemo;
          token.authorizationValid = true;
        } else {
          token.role = "DISABLED";
          token.systemRole = "DISABLED";
          token.facilityWorkflowRole = "DISABLED";
          token.authorizationValid = false;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as string;
        session.user.systemRole = token.systemRole as string;
        session.user.facilityWorkflowRole = token.facilityWorkflowRole as string;
        session.user.id = token.id as string;
        session.user.isDemo = Boolean(token.isDemo);
        session.user.authorizationValid = token.authorizationValid !== false;
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
