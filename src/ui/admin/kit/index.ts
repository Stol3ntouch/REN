/**
 * Kit админки: все общие компоненты в одном месте. Страницы импортируют отсюда:
 *   import { PageHeader, DataTable, Pagination } from '@/ui/admin/kit';
 * Клиентские компоненты помечены 'use client' в своих файлах; на сервер-страницах их можно использовать как обычно.
 * Стили — `@/ui/admin/admin.css` (подключён в app/admin/layout.tsx, классы с префиксом `ak-`).
 */
export { AdminLayout } from './AdminLayout';
export { Sidebar } from './Sidebar';
export { Topbar, type TopbarFeatures } from './Topbar';
export { UserMenu } from './UserMenu';
export { SearchBox } from './SearchBox';
export { NotificationBell } from './NotificationBell';
export { Breadcrumbs, type BreadcrumbItem } from './Breadcrumbs';
export { AutoBreadcrumbs } from './AutoBreadcrumbs';
export { PageHeader } from './PageHeader';
export { DataTable, type DataTableColumn, type DataTableProps } from './DataTable';
export { SelectionScope } from './SelectionScope';
export { Pagination } from './Pagination';
export { PageSizeSelect } from './PageSizeSelect';
export { pageWindow, pageCountOf, shownRange, clampPageSize, type PageItem } from './pagination-model';
export { SearchInput } from './SearchInput';
export { FilterPanel } from './FilterPanel';
export { StatusBadge, type StatusTone } from './StatusBadge';
export { Toggle } from './Toggle';
export { runOptimistic, type ToggleAction, type ToggleResult } from './toggle-model';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { ConfirmButton } from './ConfirmButton';
export { FormField } from './FormField';
export { SelectField, type SelectOption } from './SelectField';
export { TextAreaField } from './TextAreaField';
export { FieldShell, describedBy, fieldIds, type FieldError } from './field-shell';
export { FileUploader } from './FileUploader';
export { ImagePreview } from './ImagePreview';
export { validateFile, formatBytes, DEFAULT_IMAGE_TYPES, DEFAULT_MAX_BYTES, type UploadAction, type UploadResult } from './upload-model';
export { Tabs, resolveTab, type TabItem } from './Tabs';
export { TabPanel } from './TabPanel';
export { EmptyState } from './EmptyState';
export { LoadingState } from './LoadingState';
export { ErrorState } from './ErrorState';
export { Toaster, useToast, FlashToast, toastReducer, type ToastItem } from './Toaster';
export { PermissionGate, can } from './PermissionGate';
export { SaveBar } from './SaveBar';
export { UnsavedChangesGuard } from './UnsavedChangesGuard';
export { attachUnsavedGuard, UNSAVED_MESSAGE } from './unsaved-guard';
export { Icon, ADMIN_ICON_NAMES, type AdminIconName } from './icons';
export { useFocusTrap } from './use-focus-trap';
export { cycleIndex } from './focus';
export { buildHref, parseListParams, nextSearchHref, firstParam, PAGE_SIZES, DEFAULT_PAGE_SIZE, type SearchParams, type ListParams, type SortDir } from './url';
export { roleLabel, initialOf, ROLE_LABELS } from './labels';
