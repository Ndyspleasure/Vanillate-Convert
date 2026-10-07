'use client';

import { useI18n } from '@/i18n/client.tsx';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="hero" role="alert">
      <h1>{t.error.title}</h1>
      <p className="lead">{t.error.text}</p>
      <button type="button" className="button button--primary" onClick={reset}>
        {t.error.retry}
      </button>
    </section>
  );
}
