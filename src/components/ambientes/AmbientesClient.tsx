"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { isValidSubscriptionId } from "@/lib/ambientes/validateSubscriptionId";
import {
  addManagedClientWithSubscriptions,
  addSubscriptionToManagedClient,
  archiveManagedClient,
  permanentlyDeleteManagedClient,
  removeSubscriptionFromManagedClient,
  restoreManagedClient,
  updateManagedClientName,
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
  const [clientFormError, setClientFormError] = useState<string | null>(null);
  const [clientAddedMessage, setClientAddedMessage] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
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
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingClientName, setEditingClientName] = useState("");
  const [editingSubscription, setEditingSubscription] = useState({
    azureSubscriptionId: "",
    azureTenantId: "",
    displayName: "",
  });
  const [editError, setEditError] = useState<string | null>(null);
  const editPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editingClientId) return;
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("[data-client-edit-toggle]")) return;
      if (!editPanelRef.current?.contains(target)) {
        setEditingClientId(null);
        setEditError(null);
      }
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [editingClientId]);

  function startEditingClient(client: ManagedClient) {
    setEditingClientId(client.id);
    setEditingClientName(client.name);
    setEditError(null);
  }

  async function saveClientName(clientId: string) {
    try {
      await updateManagedClientName(clientId, editingClientName);
      setManagedClients((current) =>
        current.map((client) =>
          client.id === clientId ? { ...client, name: editingClientName.trim() } : client,
        ),
      );
      setAllClients((current) =>
        current.map((client) =>
          client.id === clientId ? { ...client, name: editingClientName.trim() } : client,
        ),
      );
      setEditingClientId(null);
    } catch {
      setEditError(t("ambientes.editFailed"));
    }
  }

  async function addSubscriptionWhileEditing(clientId: string) {
    const draft = editingSubscription;
    if (
      !isValidSubscriptionId(draft.azureSubscriptionId) ||
      !isValidSubscriptionId(draft.azureTenantId) ||
      !draft.displayName.trim()
    ) {
      setEditError(t("ambientes.subscriptionDataInvalid"));
      return;
    }
    try {
      const created = await addSubscriptionToManagedClient(
        clientId,
        draft.azureSubscriptionId,
        draft.azureTenantId,
        draft.displayName,
      );
      setSubscriptions((current) => [
        {
          id: created.id,
          customerId: clientId,
          azureSubscriptionId: draft.azureSubscriptionId.trim(),
          azureTenantId: draft.azureTenantId.trim(),
          displayName: created.displayName,
          tenantId: draft.azureTenantId.trim(),
          status: "PENDING",
          lastScanAt: null,
          needsPermissionUpgrade: false,
        },
        ...current,
      ]);
      setEditingSubscription({ azureSubscriptionId: "", azureTenantId: "", displayName: "" });
      setEditError(null);
    } catch {
      setEditError(t("ambientes.editFailed"));
    }
  }

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
    const poll = window.setInterval(async () => {
      try {
        const statusResponse = await fetch(`/api/subscriptions/${subscriptionRowId}/scan-status`);
        if (statusResponse.ok) {
          const status = await statusResponse.json();
          setScanProgressBySubscription((current) => ({
            ...current,
            [subscriptionRowId]: Math.max(0, Math.min(100, status.progress ?? 0)),
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
    if (!trimmedName) {
      setClientFormError(t("ambientes.clientNameRequired"));
      return;
    }

    const drafts = subscriptionDrafts;
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
      setNewClientName("");
      setSubscriptionDrafts([{ azureSubscriptionId: "", azureTenantId: "", displayName: "" }]);
    } catch {
      setClientFormError(t("ambientes.addClientFailed"));
    }
  }

  function renderSubscription(s: AmbienteRow) {
    return (
      <li key={s.id} className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{s.displayName}</p>
            <p className="mt-1 text-xs text-slate-400">
              {s.azureSubscriptionId} ·{" "}
              {s.status === "CONNECTED" ? t("ambientes.connected") : t("ambientes.pending")}
              {" · "}
              {t("ambientes.lastScan")}:{" "}
              {formatLastScan(s.lastScanAt, t("ambientes.neverScanned"), locale)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <a
              href={getAzureLoginUrl(s)}
              target="_blank"
              rel="noreferrer"
              className="border rounded px-2.5 py-1 text-sm"
            >
              {t("ambientes.openAzure")}
            </a>
            <button
              type="button"
              disabled={verifyingSubscriptionId === s.id}
              className="bg-blue-600 text-white rounded px-2.5 py-1 text-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
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

      <main className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">{t("ambientes.title")}</h1>
        {subscriptions.length > 0 && (
          <button
            type="button"
            onClick={handleVerifyAll}
            disabled={verifyingSubscriptionId !== null}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
          >
            {verifyingSubscriptionId !== null
              ? t("ambientes.verifyInProgress")
              : t("ambientes.verifyAll")}
          </button>
        )}
      </div>

      <form
        onSubmit={handleAddClientWithSubscription}
        className="mb-6 flex flex-col items-start gap-2"
      >
        <div>
          <label className="mb-1 block text-xs" htmlFor="clientName">
            Cliente
          </label>
          <input
            id="clientName"
            className="border rounded px-2.5 py-1.5 text-sm"
            placeholder={t("ambientes.clientName")}
            value={newClientName}
            onChange={(e) => setNewClientName(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs" htmlFor="azureSubscriptionId">
              {t("ambientes.subscriptionId")}
            </label>
            <input
              id="azureSubscriptionId"
              className="border rounded px-2.5 py-1.5 text-sm"
              value={subscriptionDrafts[0].azureSubscriptionId}
              onChange={(e) =>
                setSubscriptionDrafts((current) =>
                  current.map((draft, index) =>
                    index === 0 ? { ...draft, azureSubscriptionId: e.target.value } : draft,
                  ),
                )
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-xs" htmlFor="azureTenantId">
              {t("ambientes.tenantId")}
            </label>
            <input
              id="azureTenantId"
              className="border rounded px-2.5 py-1.5 text-sm"
              value={subscriptionDrafts[0].azureTenantId}
              onChange={(e) =>
                setSubscriptionDrafts((current) =>
                  current.map((draft, index) =>
                    index === 0 ? { ...draft, azureTenantId: e.target.value } : draft,
                  ),
                )
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-xs" htmlFor="displayName">
              {t("ambientes.displayName")}
            </label>
            <input
              id="displayName"
              className="border rounded px-2.5 py-1.5 text-sm"
              value={subscriptionDrafts[0].displayName}
              onChange={(e) =>
                setSubscriptionDrafts((current) =>
                  current.map((draft, index) =>
                    index === 0 ? { ...draft, displayName: e.target.value } : draft,
                  ),
                )
              }
            />
          </div>
        </div>
        {subscriptionDrafts.length > 1 && (
          <div className="flex flex-col gap-2">
            {subscriptionDrafts.slice(1).map((draft, index) => (
              <div key={index + 1} className="flex flex-wrap items-end gap-3">
                <input
                  className="border rounded px-2.5 py-1.5 text-sm"
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
                  className="border rounded px-2.5 py-1.5 text-sm"
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
                  className="border rounded px-2.5 py-1.5 text-sm"
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
        <button
          type="button"
          className="border rounded px-2.5 py-1.5 text-sm"
          onClick={() =>
            setSubscriptionDrafts((current) => [
              ...current,
              { azureSubscriptionId: "", azureTenantId: "", displayName: "" },
            ])
          }
        >
          {t("ambientes.addSubscription")}
        </button>
        <button
          type="submit"
          className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm hover:bg-blue-700"
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
        {allClients.map((client, clientIndex) => {
          const clientSubscriptions = subscriptions.filter((s) => s.customerId === client.id);
          const scannedSubscriptions = clientSubscriptions.filter(
            (subscription) => subscription.lastScanAt !== null,
          );
          const pendingSubscriptions = clientSubscriptions.filter(
            (subscription) => subscription.lastScanAt === null,
          );
          const expanded = expandedClients[client.id] ?? clientSubscriptions.length <= 1;
          return (
            <section
              key={client.id}
              className={`overflow-hidden rounded-lg border shadow-sm ${
                clientIndex % 2 === 0
                  ? "border-slate-500 bg-slate-900"
                  : "border-slate-700 bg-slate-950"
              }`}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-700 bg-slate-900/70 px-4 py-3">
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 text-left text-base font-semibold"
                  onClick={() =>
                    setExpandedClients((current) => ({
                      ...current,
                      [client.id]: !expanded,
                    }))
                  }
                >
                  {clientSubscriptions.length > 1 && <span>{expanded ? "▾" : "▸"}</span>}
                  <span className="truncate">{client.name}</span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    data-client-edit-toggle
                    className="rounded border px-2 py-1 text-sm"
                    onClick={() => {
                      if (editingClientId === client.id) {
                        setEditingClientId(null);
                        setEditError(null);
                      } else {
                        startEditingClient(client);
                      }
                    }}
                  >
                    {t("ambientes.editClient")}
                  </button>
                  {client.id !== operatorCustomerId && (
                    <button
                      type="button"
                      className="rounded border border-red-500 px-2 py-1 text-sm text-red-500"
                      onClick={async () => {
                        await archiveManagedClient(client.id);
                        window.location.reload();
                      }}
                    >
                      {t("ambientes.deleteClient")}
                    </button>
                  )}
                </div>
              </div>
              {editingClientId === client.id && (
                <div ref={editPanelRef} className="border-b border-blue-300 bg-blue-950/20 p-4 text-sm">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1">
                      {t("ambientes.clientName")}
                      <input
                        className="rounded border px-2 py-1"
                        value={editingClientName}
                        onChange={(event) => setEditingClientName(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded bg-blue-600 px-2 py-1 text-white"
                      onClick={() => saveClientName(client.id)}
                    >
                      {t("ambientes.saveChanges")}
                    </button>
                    <button
                      type="button"
                      className="rounded border px-2 py-1"
                      onClick={() => setEditingClientId(null)}
                    >
                      {t("ambientes.cancel")}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <input
                      className="rounded border px-2 py-1"
                      placeholder={t("ambientes.subscriptionId")}
                      value={editingSubscription.azureSubscriptionId}
                      onChange={(event) =>
                        setEditingSubscription((current) => ({
                          ...current,
                          azureSubscriptionId: event.target.value,
                        }))
                      }
                    />
                    <input
                      className="rounded border px-2 py-1"
                      placeholder={t("ambientes.tenantId")}
                      value={editingSubscription.azureTenantId}
                      onChange={(event) =>
                        setEditingSubscription((current) => ({
                          ...current,
                          azureTenantId: event.target.value,
                        }))
                      }
                    />
                    <input
                      className="rounded border px-2 py-1"
                      placeholder={t("ambientes.displayName")}
                      value={editingSubscription.displayName}
                      onChange={(event) =>
                        setEditingSubscription((current) => ({
                          ...current,
                          displayName: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="rounded bg-blue-600 px-2 py-1 text-white"
                      onClick={() => addSubscriptionWhileEditing(client.id)}
                    >
                      {t("ambientes.addSubscription")}
                    </button>
                  </div>
                  {clientSubscriptions.map((subscription) => (
                    <div key={subscription.id} className="mt-2 flex items-center justify-between">
                      <span>{subscription.displayName}</span>
                      <button
                        type="button"
                        className="text-red-600"
                        onClick={async () => {
                          if (!window.confirm(t("ambientes.removeSubscriptionConfirm"))) return;
                          await removeSubscriptionFromManagedClient(subscription.id);
                          setSubscriptions((current) =>
                            current.filter((item) => item.id !== subscription.id),
                          );
                        }}
                      >
                        {t("ambientes.removeSubscription")}
                      </button>
                    </div>
                  ))}
                  {editError && <p className="mt-2 text-red-600">{editError}</p>}
                </div>
              )}
              {expanded && (
                <div className="space-y-4 p-4">
                  {scannedSubscriptions.length > 0 && (
                    <div className="rounded-md border border-emerald-900/70 bg-emerald-950/10 p-3">
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-green-400">
                        <span className="h-2 w-2 rounded-full bg-green-400" />
                        {t("ambientes.scanned")}
                      </h3>
                      <ul className="space-y-2">
                        {scannedSubscriptions.map(renderSubscription)}
                      </ul>
                    </div>
                  )}
                  {pendingSubscriptions.length > 0 && (
                    <div className="rounded-md border border-amber-900/70 bg-amber-950/10 p-3">
                      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-400">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        {t("ambientes.pendingSection")}
                      </h3>
                      <ul className="space-y-2">
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
        <section className="mt-6 rounded border border-gray-300 p-3">
          <h2 className="mb-2 text-base font-semibold">{t("ambientes.trash")}</h2>
          <ul className="space-y-2">
            {archivedClients.map((client) => (
              <li key={client.id} className="flex items-center justify-between rounded border p-3">
                <span>{client.name}</span>
                <div className="flex items-center gap-2">
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
                  <button
                    type="button"
                    className="rounded bg-red-600 px-3 py-1 text-white"
                    onClick={async () => {
                      if (!window.confirm(t("ambientes.permanentDeleteConfirm"))) return;
                      await permanentlyDeleteManagedClient(client.id);
                      window.location.reload();
                    }}
                  >
                    {t("ambientes.permanentDelete")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      </main>
    </div>
  );
}
