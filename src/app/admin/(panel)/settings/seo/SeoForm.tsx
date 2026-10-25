'use client';

import { useState } from 'react';
import { CHANGE_FREQUENCIES, SEO_SECTIONS, SEO_SECTION_LABELS, TEMPLATE_VARIABLE_HINT } from '@/domain/content/seo-constants';
import type { SeoSettingsView, SeoTemplates } from '@/domain/content/seo-settings';
import { FileUploader, FormField, SelectField, TextAreaField, Toggle, UnsavedChangesGuard } from '@/ui/admin/kit';
import { previewSeoTemplateAction, saveSeoSettingsAction } from './actions';

const TEMPLATE_FIELDS: { key: keyof SeoTemplates; label: string; area?: boolean }[] = [
  { key: 'productTitle', label: 'Товар: шаблон title' },
  { key: 'productDescription', label: 'Товар: шаблон description', area: true },
  { key: 'categoryTitle', label: 'Категория: шаблон title' },
  { key: 'categoryDescription', label: 'Категория: шаблон description', area: true },
];

function TemplateField({ k, label, area, initial }: { k: keyof SeoTemplates; label: string; area?: boolean; initial: string }) {
  const [value, setValue] = useState(initial);
  const [result, setResult] = useState<string | null>(null);
  async function check(): Promise<void> {
    const r = await previewSeoTemplateAction(k, value);
    setResult(r.ok ? `Предпросмотр («${r.sample}»): ${r.text || '— пусто —'}` : r.error);
  }
  const common = { name: `tpl_${k}`, label, value, hint: `Переменные: ${TEMPLATE_VARIABLE_HINT}. Индивидуальные SEO-поля товара и категории важнее шаблона.` };
  return (
    <div>
      {area ? (
        <TextAreaField {...common} rows={3} maxLength={400} onChange={(e) => setValue(e.target.value)} />
      ) : (
        <FormField {...common} maxLength={200} onChange={(e) => setValue(e.target.value)} />
      )}
      <button type="button" className="ak-btn ak-btn--outline" onClick={() => void check()}>
        Проверить на реальном {k.startsWith('product') ? 'товаре' : 'категории'}
      </button>
      {result ? (
        <p className="ak-field__hint" role="status">
          {result}
        </p>
      ) : null}
    </div>
  );
}

export function SeoForm({ seo }: { seo: SeoSettingsView }) {
  return (
    <form id="seo-form" action={saveSeoSettingsAction} encType="multipart/form-data" className="ak-form-grid">
      <UnsavedChangesGuard formId="seo-form" />
      <input type="hidden" name="version" value={seo.version} />
      <fieldset disabled={seo.readOnly} className="ak-form-grid" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <section className="ak-card" aria-labelledby="seo-main">
          <h2 id="seo-main">Основное</h2>
          <FormField name="siteName" label="Название сайта" maxLength={120} defaultValue={seo.siteName} hint="Пусто — название магазина" />
          <TextAreaField name="description" label="Meta Description по умолчанию" rows={3} maxLength={300} defaultValue={seo.description} />
          <SelectField name="ogType" label="Open Graph: тип" defaultValue={seo.ogType} options={[{ value: 'website', label: 'website' }, { value: 'article', label: 'article' }]} />
          <FileUploader name="ogImage" label="Open Graph: изображение по умолчанию" value={seo.ogImageUrl} alt="Изображение Open Graph" maxBytes={5 * 1024 * 1024} hint="JPG, PNG или WebP до 5 МБ" />
        </section>

        <section className="ak-card" aria-labelledby="seo-canonical">
          <h2 id="seo-canonical">Canonical</h2>
          <Toggle name="canonicalHttps" checked={seo.canonicalHttps} label="Всегда https в canonical и sitemap" />
          <SelectField
            name="canonicalHost"
            label="Правило для www"
            defaultValue={seo.canonicalHost}
            options={[
              { value: 'any', label: 'Как в SITE_URL' },
              { value: 'www', label: 'Всегда с www' },
              { value: 'bare', label: 'Всегда без www' },
            ]}
          />
        </section>

        <section className="ak-card" aria-labelledby="seo-robots">
          <h2 id="seo-robots">Robots и sitemap</h2>
          <Toggle name="robotsIndex" checked={seo.robotsIndex} label="Индексировать сайт" description="Выключен — robots.txt закрывает весь сайт, на страницах noindex, sitemap пуст" />
          <TextAreaField name="robotsDisallow" label="Дополнительные Disallow-пути" rows={4} defaultValue={seo.robotsDisallow.join('\n')} hint="По одному пути на строку, начиная с «/». Служебные разделы закрыты всегда" />
          {SEO_SECTIONS.map((s) => (
            <Toggle key={s} name={`sitemap_${s}`} checked={seo.sitemapSections[s]} label={`Sitemap: ${SEO_SECTION_LABELS[s].toLowerCase()}`} />
          ))}
          <SelectField
            name="changeFrequency"
            label="Частота обновления по умолчанию"
            defaultValue={seo.changeFrequency ?? ''}
            options={[{ value: '', label: 'Не указывать' }, ...CHANGE_FREQUENCIES.map((f) => ({ value: f, label: f }))]}
          />
          <FormField name="priority" label="Приоритет по умолчанию (0–1)" defaultValue={seo.priority === null ? '' : String(seo.priority)} placeholder="0.5" />
        </section>

        <section className="ak-card" aria-labelledby="seo-tpl">
          <h2 id="seo-tpl">Шаблоны для товаров и категорий</h2>
          {TEMPLATE_FIELDS.map((f) => (
            <TemplateField key={f.key} k={f.key} label={f.label} area={f.area} initial={seo.templates[f.key]} />
          ))}
        </section>

        <section className="ak-card" aria-labelledby="seo-index">
          <h2 id="seo-index">Правила индексации</h2>
          <Toggle name="noindexFilters" checked={seo.noindexFilters} label="Фильтры и сортировки — noindex" description="Страницы категории с фильтрами, сортировкой и поиском не попадают в индекс" />
          <Toggle name="noindexEmptyCategories" checked={seo.noindexEmptyCategories} label="Пустые категории — noindex" />
        </section>
      </fieldset>
    </form>
  );
}
