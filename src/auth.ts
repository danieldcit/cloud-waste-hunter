import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { getOrCreateCustomerForTenant } from "@/lib/customer-bootstrap";

/**
 * Fixed placeholder tenant id Microsoft puts in the `tid` claim for every
 * personal Microsoft account (outlook.com/hotmail.com/live.com). It is the
 * same value for all personal accounts, so it can't be used on its own to
 * key a Customer record — every personal-account user would collapse into
 * the same one. See docs/azure-real-validation-findings.md #2.
 */
const PERSONAL_ACCOUNT_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

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
        const isPersonalAccount = profile.tid === PERSONAL_ACCOUNT_TENANT_ID;
        const tenantKey =
          isPersonalAccount && typeof profile.sub === "string"
            ? `personal:${profile.sub}`
            : profile.tid;
        const customer = await getOrCreateCustomerForTenant(
          tenantKey,
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
