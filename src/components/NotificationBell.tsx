"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setActiveClient } from "@/app/ambientes/actions";
import { useLocale } from "@/lib/i18n/LocaleProvider";

interface NotificationItem {
  id: string;
  findingId: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  customerId: string;
}

export function NotificationBell() {
  const router = useRouter();
  const { locale, t } = useLocale();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function loadNotifications() {
    const response = await fetch("/api/notifications");
    if (response.ok) setNotifications(await response.json());
  }

  useEffect(() => {
    void loadNotifications();
    const interval = window.setInterval(() => void loadNotifications(), 30000);
    return () => window.clearInterval(interval);
  }, []);

  async function openNotification(notification: NotificationItem) {
    if (!notification.readAt) {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notification.id }),
      });
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
    }
    setOpen(false);
    await setActiveClient(notification.customerId);
    router.push(`/dashboard?findingId=${notification.findingId}`);
  }

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label={t("notifications.title")}
        className="relative rounded border border-gray-300 px-2 py-1 dark:border-gray-600"
        onClick={() => setOpen((current) => !current)}
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute -right-2 -top-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded border border-gray-300 bg-white p-2 shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <p className="px-2 py-1 text-sm font-semibold">{t("notifications.title")}</p>
          {notifications.length === 0 ? (
            <p className="px-2 py-3 text-xs text-gray-500">{t("notifications.placeholder")}</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  className={`block w-full rounded p-2 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    notification.readAt ? "opacity-60" : "bg-blue-50 dark:bg-blue-950/40"
                  }`}
                  onClick={() => void openNotification(notification)}
                >
                  <span className="font-medium">
                    {notification.title === "NEW_WASTE_FINDING"
                      ? t("notifications.newWaste")
                      : notification.title}
                  </span>
                  <span className="mt-1 block">{notification.message}</span>
                  <span className="mt-1 block text-[10px] text-gray-500">
                    {new Date(notification.createdAt).toLocaleString(locale)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
