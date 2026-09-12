"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";
import { addManagedClient } from "@/app/ambientes/actions";
import { ClientSwitcher } from "@/components/ClientSwitcher";

interface AmbienteRow {
  id: string;
  azureSubscriptionId: string;
  displayName: string;
  status: "PENDING" | "CONNECTED" | "ERROR";
  lastScanAt: string | null;
}

interface ConnectLinkInfo {
  deployUrl: string;
}

interface ManagedClient {
  id: string;
  name: string;
}

export function AmbientesClient({
  operatorCustomerId,
  operatorLabel,
  activeClientId,
  initialManagedClients,
  initialSubscriptions,
}: {
  operatorCustomerId: string;
  operatorLabel: string;
  activeClientId: string;
  initialManagedClients: ManagedClient[];
  initialSubscriptions: AmbienteRow[];
}) {
  const { t } = useLocale();
  const [managedClients, setManagedClients] = useState(initialManagedClients);
  const [newClientName, setNewClientName] = useState("");
  const [clientFormError, setClientFormError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [azureSubscriptionId, setAzureSubscriptionId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [connectLinkBySubscription, setConnectLinkBySubscription] = useState<
    Record<string, ConnectLinkInfo>
  >({});
  const [verifyMessageBySubscription, setVerifyMessageBySubscription] = useState<
    Record<string, string>
  >({});

  async function handleAddEnvironment(event: React.FormEvent) {
    event.preventDefault();
    if (!isValidSubscriptionId(azureSubscriptionId)) {
      setFormError("ID de subscription inválido");
      return;
    }
    if (!displayName.trim()) {
      setFormError("Nome é obrigatório");
      return;
    }
    setFormError(null);

    const response = await fetch("/api/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        azureSubscriptionId: azureSubscriptionId.trim(),
        displayName: displayName.trim(),
      }),
    });

    if (!response.ok) {
      setFormError("Não foi possível adicionar este ambiente");
      return;
    }

    const created = await response.json();
    setSubscriptions((current) => [
      {
        id: created.id,
        azureSubscriptionId: created.azureSubscriptionId,
        displayName: created.displayName,
        status: created.status,
        lastScanAt: null,
      },
      ...current,
    ]);
    setAzureSubscriptionId("");
    setDisplayName("");
  }

  async function handleShowDeployLink(subscriptionRowId: string) {
    const response = await fetch("/api/subscriptions/connect-link");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    setConnectLinkBySubscription((current) => ({
      ...current,
      [subscriptionRowId]: { deployUrl: data.deployUrl },
    }));
  }

  async function handleVerify(subscriptionRowId: string) {
    const response = await fetch(`/api/subscriptions/${subscriptionRowId}/verify`, {
      method: "POST",
    });

    if (response.status === 409) {
      setVerifyMessageBySubscription((current) => ({
        ...current,
        [subscriptionRowId]: "Delegação ainda não encontrada — tente novamente em alguns minutos.",
      }));
      return;
    }
    if (!response.ok) {
      setVerifyMessageBySubscription((current) => ({
        ...current,
        [subscriptionRowId]: "Não foi possível verificar a conexão.",
      }));
      return;
    }

    setSubscriptions((current) =>
      current.map((s) =>
        s.id === subscriptionRowId ? { ...s, status: "CONNECTED" } : s,
      ),
    );
    setVerifyMessageBySubscription((current) => {
      const next = { ...current };
      delete next[subscriptionRowId];
      return next;
    });
  }

  async function handleAddClient(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = newClientName.trim();
    if (!trimmed) {
      setClientFormError(t("ambientes.clientNameRequired"));
      return;
    }
    setClientFormError(null);
    try {
      const created = await addManagedClient(trimmed);
      setManagedClients((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewClientName("");
    } catch {
      setClientFormError(t("ambientes.addClientFailed"));
    }
  }

  return (
    <main className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <span className="text-lg font-bold">Cloud Waste Hunter</span>
        <ClientSwitcher
          myAccountId={operatorCustomerId}
          myAccountLabel={operatorLabel}
          activeClientId={activeClientId}
          managedClients={managedClients}
        />
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">{t("ambientes.clientsHeading")}</h2>
        <form onSubmit={handleAddClient} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm mb-1" htmlFor="clientName">
              {t("ambientes.clientName")}
            </label>
            <input
              id="clientName"
              className="border rounded px-3 py-2"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700"
          >
            {t("ambientes.addClient")}
          </button>
          {clientFormError && <p className="text-red-600 text-sm">{clientFormError}</p>}
        </form>
      </section>

      <h1 className="text-2xl font-bold mb-4">{t("ambientes.title")}</h1>

      <form onSubmit={handleAddEnvironment} className="mb-8 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-sm mb-1" htmlFor="azureSubscriptionId">
            {t("ambientes.subscriptionId")}
          </label>
          <input
            id="azureSubscriptionId"
            className="border rounded px-3 py-2"
            value={azureSubscriptionId}
            onChange={(e) => setAzureSubscriptionId(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm mb-1" htmlFor="displayName">
            {t("ambientes.displayName")}
          </label>
          <input
            id="displayName"
            className="border rounded px-3 py-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700"
        >
          {t("ambientes.submit")}
        </button>
        {formError && <p className="text-red-600 text-sm">{formError}</p>}
      </form>

      <ul className="space-y-4">
        {subscriptions.map((s) => (
          <li key={s.id} className="border rounded p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {s.displayName} ({s.azureSubscriptionId})
                </p>
                <p className="text-sm text-gray-500">
                  {s.status === "CONNECTED" ? t("ambientes.connected") : t("ambientes.pending")}
                  {" · "}
                  {t("ambientes.lastScan")}: {s.lastScanAt ?? t("ambientes.neverScanned")}
                </p>
              </div>
              {s.status === "PENDING" && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="border rounded px-3 py-1"
                    onClick={() => handleShowDeployLink(s.id)}
                  >
                    Lighthouse
                  </button>
                  <button
                    type="button"
                    className="bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700"
                    onClick={() => handleVerify(s.id)}
                  >
                    {t("ambientes.verify")}
                  </button>
                </div>
              )}
            </div>
            {connectLinkBySubscription[s.id] && (
              <p className="mt-2 text-sm">
                {t("ambientes.deployInstructions")}{" "}
                <a
                  className="text-blue-600 underline"
                  href={connectLinkBySubscription[s.id].deployUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {connectLinkBySubscription[s.id].deployUrl}
                </a>
              </p>
            )}
            {verifyMessageBySubscription[s.id] && (
              <p className="mt-2 text-sm text-amber-600">
                {verifyMessageBySubscription[s.id]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
