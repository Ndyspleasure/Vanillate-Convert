import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { paths, type Format, type Registry } from '@vanillate/core';

import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { format } from '@/i18n/messages.ts';
import { pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { siteRegistry } from '@/server/site.ts';

/** Formats that take part in at least one offered conversion or tool. */
function offered(registry: Registry): Format[] {
  return registry.formats.filter((f) => f.readable || f.writable);
}

export function generateStaticParams(): { format: string }[] {
  return offered(siteRegistry()).map((f) => ({ format: f.id }));
}

export const dynamicParams = false;

function resolve(id: string): { registry: Registry; target: Format } {
  const registry = siteRegistry();
  const target = registry.format(id);
  if (!target || !(target.readable || target.writable)) notFound();
  return { registry, target };
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/formats/[format]'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  const { registry, target } = resolve((await params).format);
  const count =
    registry.conversionsFrom(target.id).length + registry.conversionsTo(target.id).length;
  return pageMetadata({
    locale,
    path: (l) => paths.format(l, target.id),
    title: format(t.format.title, { label: target.label, name: target.name[locale] }),
    description: format(t.format.metaDescription, {
      label: target.label,
      name: target.name[locale],
      count,
    }),
    index: count > 0,
  });
}

export default async function FormatPage({ params }: PageProps<'/[locale]/formats/[format]'>) {
  const { locale, t } = await pageLocale(params);
  const { registry, target } = resolve((await params).format);
  const from = registry.conversionsFrom(target.id);
  const to = registry.conversionsTo(target.id);
  const tools = registry.toolsFor(target.id).filter((tool) => !tool.inputs.includes('*'));
  const category = registry.category(target.category);
  const vars = { label: target.label, name: target.name[locale] };
  return (
    <>
      <Breadcrumbs
        items={[
          { name: t.nav.home, href: paths.home(locale) },
          { name: t.format.allTitle, href: paths.formats(locale) },
          { name: target.label },
        ]}
        label={t.nav.breadcrumbs}
      />
      <h1>{format(t.format.title, vars)}</h1>
      <p className="lead">{target.description[locale]}</p>
      {target.notes && <p className="notice">{target.notes[locale]}</p>}
      <dl className="facts">
        <dt>{t.format.extensions}</dt>
        <dd>
          {target.extensions.map((ext) => (
            <code key={ext}>.{ext} </code>
          ))}
        </dd>
        {target.mimeTypes.length > 0 && (
          <>
            <dt>{t.format.mimeTypes}</dt>
            <dd>
              {target.mimeTypes.map((mime) => (
                <code key={mime}>{mime} </code>
              ))}
            </dd>
          </>
        )}
        {category && (
          <>
            <dt>{t.format.category}</dt>
            <dd>
              <Link href={paths.category(locale, category.id)}>{category.name[locale]}</Link>
            </dd>
          </>
        )}
      </dl>

      {from.length > 0 && (
        <>
          <h2>{format(t.format.convertFrom, vars)}</h2>
          <ul className="chips">
            {from.map((c) => (
              <li key={c.key}>
                <Link className="chip" href={paths.conversion(locale, c.from, c.to)}>
                  {registry.requireFormat(c.to).label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {to.length > 0 && (
        <>
          <h2>{format(t.format.convertTo, vars)}</h2>
          <ul className="chips">
            {to.map((c) => (
              <li key={c.key}>
                <Link className="chip" href={paths.conversion(locale, c.from, c.to)}>
                  {registry.requireFormat(c.from).label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {from.length === 0 && to.length === 0 && <p className="muted">{t.format.noConversions}</p>}
      {tools.length > 0 && (
        <>
          <h2>{format(t.format.tools, vars)}</h2>
          <ul className="chips">
            {tools.map((tool) => (
              <li key={tool.id}>
                <Link className="chip" href={paths.tool(locale, tool.id)}>
                  {tool.name[locale]}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
