/**
 * Видимая метка вместо факта, которого у нас нет (адрес, телефон, логотип, тексты).
 * Никогда не подставляйте выдуманное значение: placeholder('АДРЕС') → «[АДРЕС — впиши]».
 */
export function placeholder(label: string, verb: 'впиши' | 'загрузи' = 'впиши'): string {
  return `[${label} — ${verb}]`;
}

/** Та же метка для разметки страницы: заметная плашка (стиль .placeholder в theme.css). */
export function Placeholder({ label, verb }: { label: string; verb?: 'впиши' | 'загрузи' }) {
  return (
    <span className="placeholder" data-placeholder={label}>
      {placeholder(label, verb)}
    </span>
  );
}
