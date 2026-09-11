import { getArmAccessToken } from "@/lib/azure/credential";

export async function armFetch<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getArmAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Azure ARM request to ${url} failed with ${response.status}: ${body}`,
    );
  }
  return (await response.json()) as T;
}
