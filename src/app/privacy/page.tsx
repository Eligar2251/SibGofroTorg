// =========================================================
// FILE: src/app/privacy/page.tsx — Политика конфиденциальности
// Обработка персональных данных (152-ФЗ)
// =========================================================

import type { Metadata } from "next";
import {
  COMPANY_FULL_NAME,
  COMPANY_LEGAL_NAME,
  COMPANY_INN,
  COMPANY_KPP,
  COMPANY_OGRN,
  COMPANY_LEGAL_ADDRESS,
  COMPANY_DIRECTOR,
  SITE_EMAIL,
  SITE_PHONE,
  SITE_ADDRESS,
} from "@/lib/site-config";
import { SITE_URL, SITE_NAME } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Политика конфиденциальности",
  description:
    "Политика обработки персональных данных компании СибГофроТорг (ООО «СибГофроТорг»): какие данные собираются, как используются и защищаются.",
  alternates: { canonical: `${SITE_URL}/privacy` },
  robots: { index: true, follow: true },
};

const EFFECTIVE_DATE = "01 января 2024 года";

function Section({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="privacy__section">
      <h2 className="privacy__h2">
        <span className="privacy__num">{num}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="privacy-page">
      <div className="container-wide privacy-page__inner">
        {/* Шапка */}
        <header className="privacy-hero">
          <h1 className="privacy-hero__title">Политика конфиденциальности</h1>
          <p className="privacy-hero__sub">
            Политика обработки персональных данных · {COMPANY_LEGAL_NAME}
          </p>
        </header>

        <div className="privacy-card">
          <p className="privacy__lead">
            Настоящая Политика обработки персональных данных (далее —
            «Политика») разработана в соответствии с Федеральным законом от
            27.07.2006 № 152-ФЗ «О персональных данных» и определяет порядок
            обработки персональных данных и меры по обеспечению их
            безопасности, предпринимаемые {COMPANY_LEGAL_NAME} (далее —
            «Оператор»).
          </p>

          <Section num="1" title="Оператор персональных данных">
            <p>
              Оператором персональных данных является{" "}
              <strong>{COMPANY_FULL_NAME}</strong> (сокращённое наименование —{" "}
              {COMPANY_LEGAL_NAME}).
            </p>
            <div className="privacy-table">
              <div className="privacy-table__row">
                <span className="privacy-table__key">ИНН</span>
                <span className="privacy-table__val">{COMPANY_INN}</span>
              </div>
              <div className="privacy-table__row">
                <span className="privacy-table__key">КПП</span>
                <span className="privacy-table__val">{COMPANY_KPP}</span>
              </div>
              <div className="privacy-table__row">
                <span className="privacy-table__key">ОГРН</span>
                <span className="privacy-table__val">{COMPANY_OGRN}</span>
              </div>
              <div className="privacy-table__row">
                <span className="privacy-table__key">Юридический адрес</span>
                <span className="privacy-table__val">{COMPANY_LEGAL_ADDRESS}</span>
              </div>
              <div className="privacy-table__row">
                <span className="privacy-table__key">Руководитель</span>
                <span className="privacy-table__val">{COMPANY_DIRECTOR}</span>
              </div>
              <div className="privacy-table__row">
                <span className="privacy-table__key">Телефон</span>
                <span className="privacy-table__val">{SITE_PHONE}</span>
              </div>
              <div className="privacy-table__row">
                <span className="privacy-table__key">Электронная почта</span>
                <span className="privacy-table__val">{SITE_EMAIL}</span>
              </div>
              <div className="privacy-table__row">
                <span className="privacy-table__key">Сайт</span>
                <span className="privacy-table__val">{SITE_URL}</span>
              </div>
            </div>
          </Section>

          <Section num="2" title="Основные понятия">
            <ul className="privacy__list">
              <li>
                <strong>Персональные данные</strong> — любая информация,
                относящаяся прямо или косвенно к определённому или
                определяемому физическому лицу (субъекту персональных данных).
              </li>
              <li>
                <strong>Обработка персональных данных</strong> — любое действие
                или совокупность действий с персональными данными: сбор,
                запись, систематизация, накопление, хранение, уточнение,
                извлечение, использование, передача, обезличивание,
                блокирование, удаление, уничтожение.
              </li>
              <li>
                <strong>Субъект персональных данных</strong> — физическое лицо,
                к которому относятся персональные данные.
              </li>
            </ul>
          </Section>

          <Section num="3" title="Какие данные мы обрабатываем">
            <p>
              Мы обрабатываем только те персональные данные, которые вы
              добровольно сообщаете через формы на сайте ({SITE_URL}), а
              именно:
            </p>
            <ul className="privacy__list">
              <li>имя (фамилия, имя, отчество);</li>
              <li>номер контактного телефона;</li>
              <li>адрес электронной почты;</li>
              <li>логин (имя учётной записи);</li>
              <li>
                для юридических лиц и ИП — реквизиты организации:
                наименование, ИНН, КПП, ОГРН, юридический и фактический адреса,
                банковские реквизиты, контактное лицо, корпоративная
                электронная почта;
              </li>
              <li>
                сведения, содержащиеся в заявках и сообщениях (состав заказа,
                комментарии, предпочтительный способ связи).
              </li>
            </ul>
            <p>
              Мы не осуществляем обработку специальных категорий персональных
              данных, касающихся расовой, национальной принадлежности,
              политических взглядов, религиозных или философских убеждений,
              состояния здоровья, а также биометрических персональных данных.
            </p>
          </Section>

          <Section num="4" title="Цели обработки персональных данных">
            <ul className="privacy__list">
              <li>приём и обработка заявок и заказов на сайте;</li>
              <li>связь с клиентом: звонки, сообщения в мессенджерах, письма;</li>
              <li>заключение и исполнение договоров купли-продажи и поставки;</li>
              <li>выставление счетов и бухгалтерский учёт;</li>
              <li>регистрация и ведение личного кабинета пользователя;</li>
              <li>улучшение качества обслуживания и работы сайта.</li>
            </ul>
          </Section>

          <Section num="5" title="Правовые основания обработки">
            <ul className="privacy__list">
              <li>согласие субъекта персональных данных на обработку;</li>
              <li>
                исполнение договора, стороной которого является субъект
                персональных данных;
              </li>
              <li>требования законодательства Российской Федерации.</li>
            </ul>
          </Section>

          <Section num="6" title="Порядок и условия обработки">
            <ul className="privacy__list">
              <li>
                Обработка персональных данных осуществляется с согласия
                субъекта, выраженного путём проставления отметки в
                соответствующем чекбоксе на формах сайта.
              </li>
              <li>
                Персональные данные обрабатываются без передачи третьим лицам,
                за исключением случаев, предусмотренных законодательством РФ,
                либо когда передача необходима для исполнения договора
                (например, транспортным компаниям для доставки).
              </li>
              <li>
                Хранение осуществляется в защищённых информационных системах с
                применением необходимых организационных и технических мер.
              </li>
              <li>
                Персональные данные хранятся не дольше, чем этого требуют цели
                обработки, если иное не предусмотрено законодательством РФ.
              </li>
            </ul>
          </Section>

          <Section num="7" title="Права субъекта персональных данных">
            <p>Субъект персональных данных вправе:</p>
            <ul className="privacy__list">
              <li>
                получать информацию, касающуюся обработки его персональных
                данных;
              </li>
              <li>
                требовать уточнения, блокирования или уничтожения персональных
                данных, если они являются неполными, устаревшими, неточными,
                незаконно полученными или не являются необходимыми для
                заявленной цели обработки;
              </li>
              <li>
                отозвать согласие на обработку персональных данных, направив
                запрос по адресу {SITE_EMAIL} или по телефону {SITE_PHONE};
              </li>
              <li>
                обжаловать действия или бездействие оператора в уполномоченный
                орган по защите прав субъектов персональных данных
                (Роскомнадзор) или в судебном порядке.
              </li>
            </ul>
          </Section>

          <Section num="8" title="Файлы cookie и метрические сервисы">
            <p>
              Сайт {SITE_NAME} может использовать файлы cookie и сервисы
              веб-аналитики (например, Яндекс.Метрика) для анализа посещаемости
              и улучшения работы сайта. Такие файлы и сервисы активируются
              только после вашего согласия, которое вы даёте, нажимая кнопку
              «Принять» в баннере согласия на использование cookie. Вы можете
              отказаться от использования cookie или отозвать согласие в любое
              время.
            </p>
          </Section>

          <Section num="9" title="Заключительные положения">
            <p>
              Настоящая Политика действует в отношении всей информации, которую
              оператор может получить о посетителях сайта {SITE_URL}. Политика
              вступает в силу с момента её размещения на сайте и действует
              бессрочно до замены её новой версией. Оператор вправе вносить
              изменения в настоящую Политику; актуальная редакция всегда
              доступна по адресу {SITE_URL}/privacy.
            </p>
            <p className="privacy__date">
              Дата публикации действующей редакции: {EFFECTIVE_DATE}.
            </p>
          </Section>
        </div>

        <footer className="privacy__footer">
          <p>
            {COMPANY_LEGAL_NAME} · {SITE_ADDRESS} · {SITE_PHONE} · {SITE_EMAIL}
          </p>
        </footer>
      </div>
    </div>
  );
}
