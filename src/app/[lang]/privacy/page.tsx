import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasLocale } from "@/i18n";
import { getDictionary } from "../dictionaries";

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/privacy">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const dict = await getDictionary(lang);
  return { title: `${dict.privacy.title} — MeloBreed` };
}

export default async function Privacy({
  params,
}: PageProps<"/[lang]/privacy">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const { privacy: p } = await getDictionary(lang);

  const sections: [string, string][] = [
    [p.browserTitle, p.browser],
    [p.analyticsTitle, p.analytics],
    [p.emailTitle, p.email],
    [p.hostingTitle, p.hosting],
    [p.rightsTitle, p.rights],
    [p.contactTitle, p.contact],
  ];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold">{p.title}</h1>
        <p className="mt-1 text-sm opacity-60">{p.updated}</p>
      </div>
      <p>{p.intro}</p>
      {sections.map(([title, body]) => (
        <section key={title} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="leading-relaxed">{body}</p>
        </section>
      ))}
      <Link
        href={`/${lang}`}
        className="inline-flex min-h-11 items-center underline"
      >
        ← {p.back}
      </Link>
    </main>
  );
}
