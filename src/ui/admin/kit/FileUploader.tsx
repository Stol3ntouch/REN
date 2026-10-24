'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ImagePreview } from './ImagePreview';
import { Icon } from './icons';
import { DEFAULT_IMAGE_TYPES, DEFAULT_MAX_BYTES, formatBytes, typeNames, validateFile, type UploadAction } from './upload-model';

/**
 * Загрузка изображения: выбор файла или перетаскивание, проверка типа и размера в браузере, превью.
 * Два режима:
 *  - `upload` (server action) — файл уходит сразу, результат (`path`) попадает в скрытое поле `${name}_path`;
 *  - без `upload` — файл остаётся в поле `name` и уходит вместе с формой (enctype multipart).
 * «Удалить» очищает выбор и ставит скрытое поле `${name}_clear=1`. Сервер всё равно проверяет содержимое файла.
 */
export function FileUploader({
  name,
  label,
  value = null,
  alt = '',
  accept = DEFAULT_IMAGE_TYPES,
  maxBytes = DEFAULT_MAX_BYTES,
  upload,
  hint,
  error: serverError,
}: {
  name: string;
  label: string;
  value?: string | null;
  alt?: string;
  accept?: readonly string[];
  maxBytes?: number;
  upload?: UploadAction;
  hint?: string;
  error?: string | null;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(value);
  const [path, setPath] = useState('');
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState<string | null>(serverError ?? null);
  const [busy, setBusy] = useState(false);
  const objectUrl = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  function setLocalPreview(file: File | null): void {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = file ? URL.createObjectURL(file) : null;
    setPreview(objectUrl.current);
  }

  async function onFile(file: File | null): Promise<void> {
    setError(null);
    if (!file) return;
    const problem = validateFile(file, { accept, maxBytes });
    if (problem) {
      setError(problem);
      if (input.current) input.current.value = '';
      return;
    }
    setCleared(false);
    setLocalPreview(file);
    if (!upload) return;
    setBusy(true);
    const body = new FormData();
    body.set('file', file);
    try {
      const result = await upload(body);
      if (result.ok) {
        setPath(result.path ?? result.url);
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
        setPreview(result.url);
      } else {
        setError(result.error);
        setLocalPreview(null);
        setPreview(value);
      }
    } catch {
      setError('Не удалось загрузить файл. Проверьте соединение и повторите.');
      setLocalPreview(null);
      setPreview(value);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  function remove(): void {
    setLocalPreview(null);
    setPreview(null);
    setPath('');
    setCleared(true);
    setError(null);
    if (input.current) input.current.value = '';
  }

  return (
    <div className="ak-uploader">
      <span className="ak-field__label" id={`${id}-label`}>
        {label}
      </span>
      <div className="ak-uploader__row">
        {preview ? <ImagePreview src={preview} alt={alt} width={120} height={120} fit="contain" /> : null}
        <label
          className="ak-uploader__drop"
          htmlFor={id}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0] ?? null;
            if (file && input.current && !upload) {
              const dt = new DataTransfer();
              dt.items.add(file);
              input.current.files = dt.files;
            }
            void onFile(file);
          }}
        >
          <Icon name="upload" size={22} />
          <span className="ak-uploader__title">{busy ? 'Загрузка…' : preview ? 'Заменить файл' : 'Выбрать файл'}</span>
          <span className="ak-uploader__hint">
            {typeNames(accept)} до {formatBytes(maxBytes)}
          </span>
        </label>
        {preview ? (
          <button type="button" className="ak-btn ak-btn--outline" onClick={remove} disabled={busy}>
            Удалить
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        id={id}
        className="visually-hidden"
        type="file"
        {...(upload ? {} : { name })}
        accept={accept.join(',')}
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        disabled={busy}
        onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
      />
      {upload ? <input type="hidden" name={`${name}_path`} value={path} /> : null}
      {cleared ? <input type="hidden" name={`${name}_clear`} value="1" /> : null}
      {hint ? (
        <p id={`${id}-hint`} className="ak-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="ak-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
