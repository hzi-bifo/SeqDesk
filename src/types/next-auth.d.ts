import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      systemRole: string;
      facilityWorkflowRole: string;
      isDemo: boolean;
      authorizationValid: boolean;
      demoExperience?: "researcher" | "facility";
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    systemRole: string;
    facilityWorkflowRole: string;
    isDemo: boolean;
    authorizationValid?: boolean;
    demoExperience?: "researcher" | "facility";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    systemRole: string;
    facilityWorkflowRole: string;
    isDemo: boolean;
    authorizationValid?: boolean;
    demoExperience?: "researcher" | "facility";
  }
}
