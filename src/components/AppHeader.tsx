"use client";

import type { ReactNode } from "react";
import { useTheme } from "@/lib/theme/ThemeProvider";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { signOutAction } from "@/app/dashboard/actions";
import { ClientSwitcher } from "@/components/ClientSwitcher";
import type { Locale } from "@/lib/i18n/dictionaries";

export type ActiveNav = "dashboard" | "recommendations" | "ambientes";

export function AppHeader({
  activeNav,
  userLabel,
  operatorCustomerId,
  activeClientId,
  managedClients,
  search,
}: {
  activeNav: ActiveNav;
  userLabel: string;
  operatorCustomerId: string;
  activeClientId: string;
  managedClients: { id: string; name: string }[];
  search?: { value: string; onChange: (value: string) => void };
}) {
  const { theme, toggleTheme } = useTheme();
  const { locale, setLocale, t } = useLocale();

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 p-4 dark:border-gray-700">
      <div className="flex items-center gap-6">
        <span className="text-lg font-bold">Cloud Waste Hunter</span>
        <nav className="flex gap-4 text-sm">
          <NavLink href="/dashboard" active={activeNav === "dashboard"}>
            {t("nav.dashboard")}
          </NavLink>
          <NavLink href="/recommendations" active={activeNav === "recommendations"}>
            {t("nav.recommendations")}
          </NavLink>
          <span className="text-gray-400" title={t("nav.comingSoon")}>
            {t("nav.reports")}
          </span>
          <span className="text-gray-400" title={t("nav.comingSoon")}>
            {t("nav.automation")}
          </span>
          <NavLink href="/ambientes" active={activeNav === "ambientes"}>
            {t("nav.ambientes")}
          </NavLink>
        </nav>
      </div>
      {search && (
        <input
          type="search"
          placeholder={t("search.placeholder")}
          className="rounded border border-gray-300 px-3 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
        />
      )}
      <div className="flex items-center gap-3 text-sm">
        <ClientSwitcher
          myAccountId={operatorCustomerId}
          myAccountLabel={userLabel}
          activeClientId={activeClientId}
          managedClients={managedClients}
        />
        <span>{userLabel}</span>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
        >
          <option value="pt-BR">pt-BR</option>
          <option value="en">en</option>
          <option value="es">es</option>
        </select>
        <button
          type="button"
          onClick={toggleTheme}
          className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600"
        >
          {theme === "light" ? "🌙" : "☀️"}
        </button>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded border border-gray-300 px-2 py-1 dark:border-gray-600"
          >
            {t("account.signOut")}
          </button>
        </form>
      </div>
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={
        active ? "font-medium" : "font-medium text-gray-500 hover:underline dark:text-gray-400"
      }
    >
      {children}
    </a>
  );
}
