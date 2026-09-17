import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

const featureCards = [
  {
    title: "Visão em tempo real",
    description:
      "Monitore gastos, brilho de uso e recursos ociosos do Azure em um painel atualizado em segundos.",
  },
  {
    title: "Detecção inteligente",
    description:
      "Identifique desperdícios com regras de FinOps e avaliações focadas em custos, desempenho e risco.",
  },
  {
    title: "Ações priorizadas",
    description:
      "Receba sugestões práticas para reduzir custos sem comprometer segurança, disponibilidade e SLA.",
  },
];

export default async function HomePage() {
  const session = await auth();
  if (session?.customerId) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.35),_transparent_55%)]" />

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 font-bold text-white">
            C
          </div>
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-200">
              Cloud Waste Hunter
            </p>
          </div>
        </div>

        <nav className="hidden items-center gap-6 text-sm text-slate-300 md:flex">
          <Link href="#beneficios" className="transition hover:text-white">
            Benefícios
          </Link>
          <Link href="#funcionalidades" className="transition hover:text-white">
            Funcionalidades
          </Link>
          <Link href="#contato" className="transition hover:text-white">
            Contato
          </Link>
        </nav>

        <Link
          href="/api/auth/signin?callbackUrl=%2Fdashboard"
          className="rounded-lg border border-blue-400/60 bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
        >
          Entrar
        </Link>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 pb-16 pt-10 md:grid-cols-2 md:items-center md:pt-16">
        <div>
          <span className="inline-flex rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">
            FinOps para Azure
          </span>
          <h1 className="mt-6 text-4xl font-black tracking-tight text-white md:text-6xl">
            Elimine desperdício e <span className="text-blue-400">otimize custos</span>
            na nuvem.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-slate-300">
            O Cloud Waste Hunter identifica recursos subutilizados, sobredimensionados e
            pouco eficientes para ajudar sua equipe a reduzir gastos com clareza e rapidez.
          </p>

          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/api/auth/signin?callbackUrl=%2Fdashboard"
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Acessar painel
            </Link>
            <Link
              href="/ambientes"
              className="rounded-xl border border-slate-700 bg-slate-900/70 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
            >
              Ver ambientes
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap gap-8 text-sm text-slate-300">
            <div>
              <p className="text-2xl font-bold text-white">3x</p>
              <p>mais visibilidade</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">24/7</p>
              <p>monitoramento</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">100%</p>
              <p>foco em redução</p>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-blue-950/30 backdrop-blur">
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Resumo do mês</p>
                <p className="mt-2 text-3xl font-bold text-white">$183.420</p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
                -12.4%
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {[
                { label: "Recursos ociosos", value: "42", tone: "text-blue-300" },
                { label: "VMs sobredimensionadas", value: "18", tone: "text-amber-300" },
                { label: "Discos sem uso", value: "11", tone: "text-rose-300" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-xl bg-slate-900 p-3">
                  <span className="text-sm text-slate-300">{item.label}</span>
                  <span className={`text-sm font-semibold ${item.tone}`}>{item.value}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl bg-blue-500/10 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-blue-200">Potencial de economia</p>
              <p className="mt-2 text-2xl font-bold text-white">$24.860/mês</p>
            </div>
          </div>
        </div>
      </section>

      <section id="funcionalidades" className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">Funcionalidades</p>
          <h2 className="mt-3 text-3xl font-bold text-white">Tudo que sua equipe precisa para reduzir desperdício</h2>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {featureCards.map((feature) => (
            <article
              key={feature.title}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-lg shadow-slate-950/30"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600/15 text-lg text-blue-300">
                ✓
              </div>
              <h3 className="text-xl font-semibold text-white">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="beneficios" className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <div className="grid gap-6 md:grid-cols-3">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Controle</p>
              <h3 className="mt-3 text-2xl font-bold text-white">Visão clara do uso real</h3>
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Economia</p>
              <h3 className="mt-3 text-2xl font-bold text-white">Priorize os ganhos mais rápidos</h3>
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Confiança</p>
              <h3 className="mt-3 text-2xl font-bold text-white">Ações baseadas em evidências</h3>
            </div>
          </div>
        </div>
      </section>

      <footer id="contato" className="mx-auto max-w-6xl px-6 pb-16 pt-4">
        <div className="flex flex-col items-center justify-between gap-4 border-t border-slate-800 py-8 text-sm text-slate-400 md:flex-row">
          <p>© 2026 Cloud Waste Hunter</p>
          <Link href="/api/auth/signin?callbackUrl=%2Fdashboard" className="text-blue-300 hover:text-blue-200">
            Acessar plataforma
          </Link>
        </div>
      </footer>
    </main>
  );
}
