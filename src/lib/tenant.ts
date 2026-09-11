import { auth } from "@/auth";

export class UnauthenticatedError extends Error {
  constructor() {
    super("No authenticated customer in session");
  }
}

export async function requireCustomerId(): Promise<string> {
  const session = await auth();
  if (!session?.customerId) {
    throw new UnauthenticatedError();
  }
  return session.customerId;
}
