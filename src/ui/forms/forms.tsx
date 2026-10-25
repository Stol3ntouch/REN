import { RequestForm, type FieldDef } from './RequestForm';

/** Готовые формы сайта. Поля и тексты — единственное место, где описаны публичные формы. */

const CONTACT_METHODS = [
  { value: 'phone', label: 'Звонок по телефону' },
  { value: 'messenger', label: 'Мессенджер' },
  { value: 'email', label: 'Электронная почта' },
];

const NAME: FieldDef = { name: 'name', label: 'Ваше имя', type: 'text', required: true, autoComplete: 'name' };
const PHONE: FieldDef = { name: 'phone', label: 'Телефон', type: 'tel', required: true, autoComplete: 'tel', hint: 'Например, +7 900 000-00-00' };

export function CallbackForm() {
  return (
    <RequestForm
      kind="callback"
      fields={[NAME, PHONE]}
      submitLabel="Заказать звонок"
      successTitle="Заявка принята"
      successText="Мы перезвоним вам в рабочее время."
    />
  );
}

export function RepairForm() {
  return (
    <RequestForm
      kind="repair"
      fields={[
        NAME,
        PHONE,
        { name: 'email', label: 'Электронная почта', type: 'email', autoComplete: 'email', hint: 'Необязательно, если удобнее звонок' },
        { name: 'equipmentType', label: 'Тип техники', type: 'text', required: true, hint: 'Например: бензопила, триммер, культиватор' },
        { name: 'brand', label: 'Бренд', type: 'text', hint: 'Необязательно, например: Champion, Stihl' },
        { name: 'model', label: 'Модель', type: 'text', hint: 'Необязательно' },
        { name: 'description', label: 'Что случилось', type: 'textarea', required: true, rows: 5, hint: 'Опишите неисправность — чем подробнее, тем быстрее ответим' },
        { name: 'preferredContact', label: 'Как с вами связаться', type: 'select', options: CONTACT_METHODS, defaultValue: 'phone' },
      ]}
      photos
      submitLabel="Отправить заявку"
      successTitle="Заявка на ремонт принята"
      successText="Менеджер свяжется с вами выбранным способом."
    />
  );
}

export function ContactForm() {
  return (
    <RequestForm
      kind="contact"
      fields={[
        NAME,
        { name: 'email', label: 'Электронная почта', type: 'email', required: true, autoComplete: 'email' },
        { name: 'phone', label: 'Телефон', type: 'tel', autoComplete: 'tel', hint: 'Необязательно' },
        { name: 'message', label: 'Сообщение', type: 'textarea', required: true, rows: 5 },
      ]}
      submitLabel="Отправить"
      successTitle="Сообщение отправлено"
      successText="Спасибо! Ответим по указанной почте."
    />
  );
}

export function QuestionForm({ productId }: { productId: number }) {
  return (
    <RequestForm
      kind="question"
      hidden={{ productId }}
      fields={[
        NAME,
        { name: 'email', label: 'Электронная почта', type: 'email', required: true, autoComplete: 'email', hint: 'Ответ менеджера придёт сюда' },
        { name: 'message', label: 'Ваш вопрос о товаре', type: 'textarea', required: true, rows: 4 },
      ]}
      submitLabel="Задать вопрос"
      successTitle="Вопрос отправлен"
      successText="Мы передали его менеджеру и ответим по почте."
    />
  );
}

export function ReviewForm({ productId }: { productId: number }) {
  return (
    <RequestForm
      kind="review"
      hidden={{ productId }}
      fields={[
        { name: 'rating', label: 'Оценка (от 1 до 5)', type: 'rating', required: true },
        { ...NAME, name: 'authorName' },
        { name: 'body', label: 'Ваш отзыв', type: 'textarea', required: true, rows: 4 },
      ]}
      submitLabel="Отправить отзыв"
      successTitle="Спасибо за отзыв"
      successText="Он появится на странице товара после проверки модератором."
    />
  );
}
