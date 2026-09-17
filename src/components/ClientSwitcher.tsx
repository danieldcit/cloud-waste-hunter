"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setActiveClient } from "@/app/ambientes/actions";

interface ManagedClient {
  id: string;
  name: string;
}

export function ClientSwitcher({
  myAccountId,
  myAccountLabel,
  activeClientId,
  managedClients,
}: {
  myAccountId: string;
  myAccountLabel: string;
  activeClientId: string;
  managedClients: ManagedClient[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = event.target.value;
    startTransition(async () => {
      await setActiveClient(nextId);
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <select
      value={activeClientId}
      onChange={handleChange}
      disabled={isPending}
      className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
    >
      <option value={myAccountId}>{myAccountLabel}</option>
      {managedClients.map((client) => (
        <option key={client.id} value={client.id}>
          {client.name}
        </option>
      ))}
    </select>
  );
}
