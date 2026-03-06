import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      isDemo: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    isDemo: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    isDemo: boolean;
  }
}
