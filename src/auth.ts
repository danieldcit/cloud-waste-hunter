import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { getOrCreateCustomerForTenant } from "@/lib/customer-bootstrap";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      issuer: "https://login.microsoftonline.com/common/v2.0",
      authorization: {
        params: {
          scope: "openid profile email User.Read",
          prompt: "select_account",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, profile }) {
      if (profile?.tid && typeof profile.tid === "string") {
        const customer = await getOrCreateCustomerForTenant(
          profile.tid,
          (profile.name as string | undefined) ?? profile.tid,
        );
        token.customerId = customer.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.customerId === "string") {
        session.customerId = token.customerId;
      }
      return session;
    },
  },
});
