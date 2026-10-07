import Link from 'next/link';

export interface Crumb {
  name: string;
  href?: string;
}

export function Breadcrumbs({ items, label }: { items: readonly Crumb[]; label: string }) {
  return (
    <nav className="breadcrumbs" aria-label={label}>
      <ol>
        {items.map((item, index) => (
          <li key={`${item.name}-${index}`}>
            {item.href && index < items.length - 1 ? (
              <Link href={item.href}>{item.name}</Link>
            ) : (
              <span aria-current={index === items.length - 1 ? 'page' : undefined}>
                {item.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
