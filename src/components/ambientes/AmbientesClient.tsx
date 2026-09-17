"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";
import {
  addManagedClientWithSubscriptions,
  addSubscriptionToManagedClient,
  archiveManagedClient,
  restoreManagedClient,
} from "@/app/ambientes/actions";
import { AppHeader } from "@/components/AppHeader";

interface AmbienteRow {
  id: string;
  customerId: string;
  azureSubscriptionId: string;
  azureTenantId: string | null;
  displayName: string;
  tenantId: string | null;
  status: "PENDING" | "CONNECTED" | "ERROR";
  lastScanAt: string | null;
  needsPermissionUpgrade: boolean;
}

interface ManagedClient {
  id: string;
  name: string;
}

interface ArchivedClient {
  id: string;
  name: string;
  archivedAt: string;
}

function formatLastScan(
  lastScanAt: string | null,
  neverScannedLabel: string,
  locale: string,
): string {
  if (!lastScanAt) {
    return neverScannedLabel;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(lastScanAt));
}

function getAzureLoginUrl(subscription: AmbienteRow): string {
  const tenant = subscription.tenantId
    ? `@${encodeURIComponent(subscription.tenantId)}`
    : "";
  return `https://portal.azure.com/#${tenant}/resource/subscriptions/${encodeURIComponent(
    subscription.azureSubscriptionId,
  )}/overview`;
}

export function AmbientesClient({
  operatorCustomerId,
  operatorLabel,
  activeClientId,
  initialManagedClients,
  initialAllClients,
  initialArchivedClients,
  initialSubscriptions,
}: {
  operatorCustomerId: string;
  operatorLabel: string;
  activeClientId: string;
  initialManagedClients: ManagedClient[];
  initialAllClients: ManagedClient[];
  initialArchivedClients: ArchivedClient[];
  initialSubscriptions: AmbienteRow[];
}) {
  const { locale, t } = useLocale();
  const [managedClients, setManagedClients] = useState(initialManagedClients);
  const [allClients, setAllClients] = useState(initialAllClients);
  const archivedClients = initialArchivedClients;
  const [newClientName, setNewClientName] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [clientFormError, setClientFormError] = useState<string | null>(null);
  const [clientAddedMessage, setClientAddedMessage] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [azureSubscriptionId, setAzureSubscriptionId] = useState("");
  const [azureTenantId, setAzureTenantId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [subscriptionDrafts, setSubscriptionDrafts] = useState([
    { azureSubscriptionId: "", azureTenantId: "", displayName: "" },
  ]);
  const [verifyMessageBySubscription, setVerifyMessageBySubscription] = useState<
    Record<string, string>
  >({});
  const [verifyingSubscriptionId, setVerifyingSubscriptionId] = useState<string | null>(null);
  const [scanProgressBySubscription, setScanProgressBySubscription] = useState<
    Record<string, number>
  >({});
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});

  async function handleVerify(subscriptionRowId: string) {
    setVerifyingSubscriptionId(subscriptionRowId);
    setVerifyMessageBySubscription((current) => {
      const next = { ...current };
      delete next[subscriptionRowId];
      return next;
    });
    setScanProgressBySubscription((current) => ({ ...current, [subscriptionRowId]: 0 }));
    setVerifyMessageBySubscription((current) => ({
      ...current,
      [subscriptionRowId]: t("ambientes.verifyInProgress"),
    }));
    const startedAt = Date.now();
    const poll = window.setInterval(async () => {
      try {
        const statusResponse = await fetch(`/api/subscriptions/${subscriptionRowId}/scan-status`);
        if (statusResponse.ok) {
          const status = await statusResponse.json();
          const elapsedProgress = Math.min(
            90,
            5 + Math.floor((Date.now() - startedAt) / 2000) * 5,
          );
          setScanProgressBySubscription((current) => ({
            ...current,
            [subscriptionRowId]: Math.max(status.progress ?? 0, elapsedProgress),
          }));
        }

      } catch {
        // The verification response remains the source of truth if polling is interrupted.
      }
    }, 1000);
    try {
      const response = await fetch(`/api/subscriptions/${subscriptionRowId}/verify`, {
        method: "POST",
      });

      if (response.status === 409) {
        setVerifyMessageBySubscription((current) => ({
          ...current,
          [subscriptionRowId]:
            t("ambientes.delegationPending"),
        }));
        return;
      }
      if (!response.ok) {
        const errorData = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setVerifyMessageBySubscription((current) => ({
          ...current,
          [subscriptionRowId]:
            errorData?.error ?? t("ambientes.verifyFailed"),
        }));
        return;
      }

      const data = await response.json();
      setSubscriptions((current) =>
        current.map((s) =>
          s.id === subscriptionRowId
            ? {
                ...s,
                status: data.status,
                lastScanAt: data.lastScanAt ?? s.lastScanAt,
                needsPermissionUpgrade: data.needsPermissionUpgrade,
              }
            : s,
        ),
      );
      setVerifyMessageBySubscription((current) => ({
        ...current,
        [subscriptionRowId]:
          data.accessMode === "DIRECT_READ_ONLY"
            ? t("ambientes.scanDirectSuccess")
            : t("ambientes.scanSuccess"),
      }));
    } catch {
      setVerifyMessageBySubscription((current) => ({
        ...current,
        [subscriptionRowId]:
          t("ambientes.connectionFailed"),
      }));
    } finally {
      window.clearInterval(poll);
      setScanProgressBySubscription((current) => {
        const next = { ...current };
        delete next[subscriptionRowId];
        return next;
      });
      setVerifyingSubscriptionId(null);
    }
  }

  async function handleVerifyAll() {
    for (const subscription of subscriptions) {
      await handleVerify(subscription.id);
    }
  }

  async function handleAddClientWithSubscription(event: React.FormEvent) {
    event.preventDefault();
    setClientAddedMessage(null);
    const trimmedName = newClientName.trim();
    if (!selectedClientId && !trimmedName) {
      setClientFormError(t("ambientes.clientNameRequired"));
      return;
    }

    const drafts = selectedClientId
      ? [{ azureSubscriptionId, azureTenantId, displayName }]
      : subscriptionDrafts;
    if (drafts.some((draft) => !isValidSubscriptionId(draft.azureSubscriptionId))) {
      setClientFormError(t("ambientes.subscriptionIdInvalid"));
      return;
    }
    if (drafts.some((draft) => !isValidSubscriptionId(draft.azureTenantId))) {
      setClientFormError(t("ambientes.tenantIdInvalid"));
      return;
    }
    if (drafts.some((draft) => !draft.displayName.trim())) {
      setClientFormError(t("ambientes.displayNameRequired"));
      return;
    }
    setClientFormError(null);
    try {
      if (selectedClientId) {
        const createdSubscriptions = await Promise.all(
          drafts.map((draft) =>
            addSubscriptionToManagedClient(
              selectedClientId,
              draft.azureSubscriptionId,
              draft.azureTenantId,
              draft.displayName,
            ),
          ),
        );
        setSubscriptions((current) => [
          ...createdSubscriptions.map((created, index) => ({
            id: created.id,
            customerId: selectedClientId,
            azureSubscriptionId: drafts[index].azureSubscriptionId.trim(),
            azureTenantId: drafts[index].azureTenantId.trim(),
            displayName: created.displayName,
            tenantId: null,
            status: "PENDING" as const,
            lastScanAt: null,
            needsPermissionUpgrade: false,
          })),
          ...current,
        ]);
        setClientAddedMessage(
          `${managedClients.find((client) => client.id === selectedClientId)?.name ?? ""} — ${createdSubscriptions.length} subscription(s)`,
        );
        setTimeout(() => {
          void createdSubscriptions.reduce(
            (chain, subscription) => chain.then(() => handleVerify(subscription.id)),
            Promise.resolve(),
          );
        }, 0);
      } else {
        const created = await addManagedClientWithSubscriptions(trimmedName, drafts);
        setManagedClients((current) =>
          [...current, created.client].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setAllClients((current) =>
          [...current, created.client].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setSubscriptions((current) => [
          ...created.subscriptions.map((subscription) => ({
            id: subscription.id,
            customerId: created.client.id,
            azureSubscriptionId: subscription.azureSubscriptionId,
            azureTenantId: subscription.azureTenantId,
            displayName: subscription.displayName,
            tenantId: subscription.azureTenantId,
            status: "PENDING" as const,
            lastScanAt: null,
            needsPermissionUpgrade: false,
          })),
          ...current,
        ]);
        setClientAddedMessage(created.client.name);
        setTimeout(() => {
          void created.subscriptionIds.reduce(
            (chain, subscriptionId) => chain.then(() => handleVerify(subscriptionId)),
            Promise.resolve(),
          );
        }, 0);
      }
      setNewClientName("");
      setSelectedClientId("");
      setAzureSubscriptionId("");
      setAzureTenantId("");
      setDisplayName("");
      setSubscriptionDrafts([{ azureSubscriptionId: "", azureTenantId: "", displayName: "" }]);
    } catch {
      setClientFormError(t("ambientes.addClientFailed"));
    }
  }

  function renderSubscription(s: AmbienteRow) {
    return (
      <li key={s.id} className="border rounded p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{s.displayName}</p>
            <p className="text-sm text-gray-500">
              {s.azureSubscriptionId} ·{" "}
              {s.status === "CONNECTED" ? t("ambientes.connected") : t("ambientes.pending")}
              {" · "}
              {t("ambientes.lastScan")}:{" "}
              {formatLastScan(s.lastScanAt, t("ambientes.neverScanned"), locale)}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href={getAzureLoginUrl(s)}
              target="_blank"
              rel="noreferrer"
              className="border rounded px-3 py-1"
            >
              {t("ambientes.openAzure")}
            </a>
            <button
              type="button"
              disabled={verifyingSubscriptionId === s.id}
              className="bg-blue-600 text-white rounded px-3 py-1 hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
              onClick={() => handleVerify(s.id)}
            >
              {verifyingSubscriptionId === s.id
                ? `${t("ambientes.verifyInProgress")} ${scanProgressBySubscription[s.id] ?? 0}%`
                : t("ambientes.verify")}
            </button>
          </div>
        </div>
        {verifyMessageBySubscription[s.id] && (
          <p className={`mt-2 text-sm ${
            verifyMessageBySubscription[s.id] === t("ambientes.scanDirectSuccess") ||
            verifyMessageBySubscription[s.id] === t("ambientes.scanSuccess")
              ? "text-green-600"
              : verifyMessageBySubscription[s.id].startsWith("Verificando")
                ? "text-amber-600"
                : "text-red-600"
          }`}>
            {verifyMessageBySubscription[s.id]}
          </p>
        )}
      </li>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <AppHeader
        activeNav="ambientes"
        userLabel={operatorLabel}
        operatorCustomerId={operatorCustomerId}
        activeClientId={activeClientId}
        managedClients={managedClients}
      />

      <main className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("ambientes.title")}</h1>
        {subscriptions.length > 0 && (
          <button
            type="button"
            onClick={handleVerifyAll}
            disabled={verifyingSubscriptionId !== null}
            className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
          >
            {verifyingSubscriptionId !== null
              ? t("ambientes.verifyInProgress")
              : t("ambientes.verifyAll")}
          </button>
        )}
      </div>

      <form
        onSubmit={handleAddClientWithSubscription}
        className="mb-8 flex flex-col items-start gap-3"
      >
        <div>
          <label className="block text-sm mb-1" htmlFor="clientName">
            Cliente
          </label>
          <select
            id="clientName"
            className="border rounded px-3 py-2"
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
          >
            <option value="">{t("ambientes.newClient")}</option>
            {managedClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          {!selectedClientId && (
            <input
              className="mt-2 border rounded px-3 py-2"
              placeholder={t("ambientes.clientName")}
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
            />
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm mb-1" htmlFor="azureSubscriptionId">
              {t("ambientes.subscriptionId")}
            </label>
            <input
              id="azureSubscriptionId"
              className="border rounded px-3 py-2"
              value={selectedClientId ? azureSubscriptionId : subscriptionDrafts[0].azureSubscriptionId}
              onChange={(e) =>
                selectedClientId
                  ? setAzureSubscriptionId(e.target.value)
                  : setSubscriptionDrafts((current) =>
                      current.map((draft, index) =>
                        index === 0 ? { ...draft, azureSubscriptionId: e.target.value } : draft,
                      ),
                    )
              }
            />
          </div>
          <div>
            <label className="block text-sm mb-1" htmlFor="azureTenantId">
              {t("ambientes.tenantId")}
            </label>
            <input
              id="azureTenantId"
              className="border rounded px-3 py-2"
              value={selectedClientId ? azureTenantId : subscriptionDrafts[0].azureTenantId}
              onChange={(e) =>
                selectedClientId
                  ? setAzureTenantId(e.target.value)
                  : setSubscriptionDrafts((current) =>
                      current.map((draft, index) =>
                        index === 0 ? { ...draft, azureTenantId: e.target.value } : draft,
                      ),
                    )
              }
            />
          </div>
          <div>
            <label className="block text-sm mb-1" htmlFor="displayName">
              {t("ambientes.displayName")}
            </label>
            <input
              id="displayName"
              className="border rounded px-3 py-2"
              value={selectedClientId ? displayName : subscriptionDrafts[0].displayName}
              onChange={(e) =>
                selectedClientId
                  ? setDisplayName(e.target.value)
                  : setSubscriptionDrafts((current) =>
                      current.map((draft, index) =>
                        index === 0 ? { ...draft, displayName: e.target.value } : draft,
                      ),
                    )
              }
            />
          </div>
        </div>
        {!selectedClientId && subscriptionDrafts.length > 1 && (
          <div className="flex flex-col gap-2">
            {subscriptionDrafts.slice(1).map((draft, index) => (
              <div key={index + 1} className="flex flex-wrap items-end gap-3">
                <input
                  className="border rounded px-3 py-2"
                  placeholder={t("ambientes.subscriptionId")}
                  value={draft.azureSubscriptionId}
                  onChange={(e) =>
                    setSubscriptionDrafts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index + 1
                          ? { ...item, azureSubscriptionId: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <input
                  className="border rounded px-3 py-2"
                  placeholder={t("ambientes.tenantId")}
                  value={draft.azureTenantId}
                  onChange={(e) =>
                    setSubscriptionDrafts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index + 1
                          ? { ...item, azureTenantId: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <input
                  className="border rounded px-3 py-2"
                  placeholder={t("ambientes.displayName")}
                  value={draft.displayName}
                  onChange={(e) =>
                    setSubscriptionDrafts((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index + 1
                          ? { ...item, displayName: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        )}
        {!selectedClientId && (
          <button
            type="button"
            className="border rounded px-3 py-2"
            onClick={() =>
              setSubscriptionDrafts((current) => [
                ...current,
                { azureSubscriptionId: "", azureTenantId: "", displayName: "" },
              ])
            }
          >
            {t("ambientes.addSubscription")}
          </button>
        )}
        <button
          type="submit"
          className="bg-blue-600 text-white rounded px-4 py-2 hover:bg-blue-700"
        >
          {t("ambientes.addClient")}
        </button>
        {clientFormError && <p className="text-red-600 text-sm">{clientFormError}</p>}
        {clientAddedMessage && (
          <p className="text-green-600 text-sm">
            {t("ambientes.clientAdded")}: {clientAddedMessage}
          </p>
        )}
      </form>

      <div className="space-y-4">
        {allClients.map((client) => {
          const clientSubscriptions = subscriptions.filter((s) => s.customerId === client.id);
          const scannedSubscriptions = clientSubscriptions.filter(
            (subscription) => subscription.lastScanAt !== null,
          );
          const pendingSubscriptions = clientSubscriptions.filter(
            (subscription) => subscription.lastScanAt === null,
          );
          const expanded = expandedClients[client.id] ?? clientSubscriptions.length <= 1;
          return (
            <section key={client.id} className="rounded border border-gray-300 p-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="flex items-center gap-2 text-left text-lg font-semibold"
                  onClick={() =>
                    setExpandedClients((current) => ({
                      ...current,
                      [client.id]: !expanded,
                    }))
                  }
                >
                  {clientSubscriptions.length > 1 && <span>{expanded ? "▾" : "▸"}</span>}
                  {client.name}
                </button>
                {client.id !== operatorCustomerId && (
                  <button
                    type="button"
                    className="rounded border border-red-500 px-3 py-1 text-red-500"
                    onClick={async () => {
                      await archiveManagedClient(client.id);
                      window.location.reload();
                    }}
                  >
                    {t("ambientes.deleteClient")}
                  </button>
                )}
              </div>
              {expanded && (
                <div className="mt-3 space-y-5">
                  {scannedSubscriptions.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-green-700 dark:text-green-400">
                        {t("ambientes.scanned")}
                      </h3>
                      <ul className="space-y-3">
                        {scannedSubscriptions.map(renderSubscription)}
                      </ul>
                    </div>
                  )}
                  {pendingSubscriptions.length > 0 && (
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
                        {t("ambientes.pendingSection")}
                      </h3>
                      <ul className="space-y-3">
                        {pendingSubscriptions.map(renderSubscription)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {archivedClients.length > 0 && (
        <section className="mt-8 rounded border border-gray-300 p-4">
          <h2 className="mb-3 text-lg font-semibold">{t("ambientes.trash")}</h2>
          <ul className="space-y-2">
            {archivedClients.map((client) => (
              <li key={client.id} className="flex items-center justify-between rounded border p-3">
                <span>{client.name}</span>
                <button
                  type="button"
                  className="rounded bg-green-600 px-3 py-1 text-white"
                  onClick={async () => {
                    await restoreManagedClient(client.id);
                    window.location.reload();
                  }}
                >
                  {t("ambientes.restore")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      </main>
    </div>
  );
}
