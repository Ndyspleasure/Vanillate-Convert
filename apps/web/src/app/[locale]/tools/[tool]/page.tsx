import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { paths, type Registry, type Tool } from '@vanillate/core';

import { ModeBadge, StatusBadge } from '@/components/Badges.tsx';
import { Breadcrumbs } from '@/components/Breadcrumbs.tsx';
import { Converter } from '@/components/converter/Converter.tsx';
import { format } from '@/i18n/messages.ts';
import { pageLocale } from '@/server/page.ts';
import { pageMetadata } from '@/server/seo.ts';
import { serverProcessingEnabled, siteRegistry } from '@/server/site.ts';

export function generateStaticParams(): { tool: string }[] {
  return siteRegistry()
    .offeredTools()
    .map((tool) => ({ tool: tool.id }));
}

export const dynamicParams = false;

function resolve(id: string): { registry: Registry; tool: Tool } {
  const registry = siteRegistry();
  const tool = registry.tool(id);
  if (!tool?.offered) notFound();
  return { registry, tool };
}

export async function generateMetadata({
  params,
}: PageProps<'/[locale]/tools/[tool]'>): Promise<Metadata> {
  const { locale, t } = await pageLocale(params);
  const { tool } = resolve((await params).tool);
  return pageMetadata({
    locale,
    path: (l) => paths.tool(l, tool.id),
    title: tool.name[locale],
    description: format(t.tools.metaDescription, {
      name: tool.name[locale],
      description: tool.description[locale],
    }),
    index: tool.indexable,
  });
}

export default async function ToolPage({ params }: PageProps<'/[locale]/tools/[tool]'>) {
  const { locale, t } = await pageLocale(params);
  const { registry, tool } = resolve((await params).tool);
  const modes = [...new Set(tool.routes.filter((r) => r.offered).map((r) => r.mode))];
  const inputs = tool.inputs.includes('*')
    ? t.tools.anyFile
    : tool.inputs.map((id) => registry.format(id)?.label ?? id).join(', ');
  return (
    <>
      <Breadcrumbs
        items={[
          { name: t.nav.home, href: paths.home(locale) },
          { name: t.tools.title, href: paths.tools(locale) },
          { name: tool.name[locale] },
        ]}
        label={t.nav.breadcrumbs}
      />
      <section className="hero">
        <h1>{tool.name[locale]}</h1>
        <p className="chips" style={{ margin: '0 0 0.75rem' }}>
          <StatusBadge status={tool.status} t={t} />
          {modes.map((mode) => (
            <ModeBadge key={mode} mode={mode} t={t} />
          ))}
        </p>
        <p className="lead">{tool.description[locale]}</p>
      </section>
      <Converter
        preset={{ kind: 'tool', toolId: tool.id }}
        serverProcessing={serverProcessingEnabled()}
      />
      <dl className="facts">
        <dt>{t.tools.inputs}</dt>
        <dd>{inputs}</dd>
      </dl>
      {tool.limitations.length > 0 && (
        <>
          <h2>{t.converter.limitations}</h2>
          <ul className="limitations">
            {tool.limitations
              .map((id) => registry.limitation(id))
              .filter((l) => l !== undefined)
              .map((limitation) => (
                <li key={limitation.id} className={`severity-${limitation.severity}`}>
                  {limitation.text[locale]}
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}
