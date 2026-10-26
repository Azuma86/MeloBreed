import { notFound } from "next/navigation";
import { BreedApp } from "@/app/_components/BreedApp";
import { hasLocale } from "@/i18n";
import { getDictionary } from "./dictionaries";

export default async function Home({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-4 sm:gap-8 sm:py-6">
      <BreedApp
        lang={lang}
        dict={dict}
        hero={
          <div className="flex flex-col gap-2 sm:gap-3">
            <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">
              {dict.hero.title}
            </h1>
            <p className="max-w-2xl text-sm opacity-80 sm:text-base">
              {dict.hero.lead}
            </p>
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
          </div>
        }
      />
    </main>
  );
}
