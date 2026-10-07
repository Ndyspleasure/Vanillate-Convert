'use client';

/**
 * Conversion options, generated from the route's option definitions in the registry. Simple
 * options are shown; options marked advanced are collapsed.
 */
import type { OptionDef, OptionValue } from '@vanillate/core';

import { useI18n } from '@/i18n/client.tsx';

export type OptionState = Record<string, OptionValue | undefined>;

interface FieldProps {
  def: OptionDef;
  value: OptionValue | undefined;
  error: string | undefined;
  onChange: (id: string, value: OptionValue | undefined) => void;
}

function Field({ def, value, error, onChange }: FieldProps) {
  const { locale } = useI18n();
  const id = `option-${def.id}`;
  const helpId = def.help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const label = `${def.label[locale]}${def.unit ? ` (${def.unit})` : ''}`;
  const help = def.help ? (
    <span id={helpId} className="options-help">
      {def.help[locale]}
    </span>
  ) : null;
  const message = error ? (
    <span id={errorId} className="options-help" role="alert">
      {error}
    </span>
  ) : null;

  if (def.type === 'boolean') {
    return (
      <div className="field">
        <span className="field field--inline">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            aria-describedby={describedBy}
            onChange={(event) => onChange(def.id, event.target.checked)}
          />
          <label htmlFor={id}>{label}</label>
        </span>
        {help}
        {message}
      </div>
    );
  }

  let control;
  if (def.choices) {
    const choices = def.choices;
    control = (
      <select
        id={id}
        value={value === undefined ? '' : String(value)}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const choice = choices.find((c) => String(c.value) === event.target.value);
          onChange(def.id, choice?.value);
        }}
      >
        {def.default === null && <option value="">—</option>}
        {choices.map((choice) => (
          <option key={String(choice.value)} value={String(choice.value)}>
            {choice.label[locale]}
          </option>
        ))}
      </select>
    );
  } else if (def.type === 'integer' || def.type === 'number') {
    control = (
      <input
        id={id}
        type="number"
        inputMode={def.type === 'integer' ? 'numeric' : 'decimal'}
        value={typeof value === 'number' ? value : ''}
        min={def.min ?? undefined}
        max={def.max ?? undefined}
        step={def.step ?? (def.type === 'integer' ? 1 : 'any')}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(def.id, raw === '' ? undefined : Number(raw));
        }}
      />
    );
  } else if (def.type === 'color') {
    control = (
      <input
        id={id}
        type="color"
        value={typeof value === 'string' ? value : '#ffffff'}
        aria-describedby={describedBy}
        onChange={(event) => onChange(def.id, event.target.value)}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type="text"
        value={typeof value === 'string' ? value : ''}
        maxLength={def.maxLength ?? 200}
        pattern={def.pattern ?? undefined}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        onChange={(event) =>
          onChange(def.id, event.target.value === '' ? undefined : event.target.value)
        }
      />
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {help}
      {message}
    </div>
  );
}

export function OptionsForm({
  options,
  values,
  errors,
  onChange,
}: {
  options: readonly OptionDef[];
  values: OptionState;
  errors: Readonly<Record<string, string>>;
  onChange: (id: string, value: OptionValue | undefined) => void;
}) {
  const { t } = useI18n();
  if (options.length === 0) return null;
  const basic = options.filter((o) => !o.advanced);
  const advanced = options.filter((o) => o.advanced);
  const fields = (list: readonly OptionDef[]) =>
    list.map((def) => (
      <Field
        key={def.id}
        def={def}
        value={values[def.id]}
        error={errors[def.id]}
        onChange={onChange}
      />
    ));
  return (
    <>
      {basic.length > 0 && (
        <fieldset className="options" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="visually-hidden">{t.converter.options}</legend>
          {fields(basic)}
        </fieldset>
      )}
      {advanced.length > 0 && (
        <details className="advanced">
          <summary>{t.converter.advanced}</summary>
          <div className="options">{fields(advanced)}</div>
        </details>
      )}
    </>
  );
}
