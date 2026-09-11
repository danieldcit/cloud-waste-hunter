import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    customerId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    customerId?: string;
  }
}
