import { notFound } from "next/navigation";
import { BreedApp } from "@/app/_components/BreedApp";
import { hasLocale } from "@/i18n";
import { getDictionary } from "./dictionaries";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 sm:py-10">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-semibold tracking-wide text-violet-600">
          MeloBreed
        </p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {dict.hero.title}
        </h1>
        <p className="max-w-2xl text-base opacity-80">{dict.hero.lead}</p>
        <ul className="flex flex-wrap gap-2 text-xs font-medium">
          {Object.values(dict.hero.badges).map((badge) => (
            <li
              key={badge}
              className="rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1"
            >
              {badge}
            </li>
          ))}
        </ul>
        <p className="max-w-2xl text-xs opacity-60">
          {dict.hero.noTrainingNote}
        </p>
      </header>

      <BreedApp lang={lang} dict={dict} />
    </main>
  );
}
