import Link from "next/link";
import { CheckCircle2, ArrowRight, PhoneCall, Package, Ticket } from "lucide-react";
import { OrderSuccessGoal } from "@/components/analytics/OrderSuccessGoal";
import { SuccessContactPhone } from "@/components/order/SuccessContactPhone";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Заказ оформлен — СибГофроТорг",
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const params = await searchParams;
  const code = firstParam(params.code).trim().toUpperCase();

  return (
    <div className="success-page">
      <OrderSuccessGoal />

      <div className="container-wide">
        <div className="success-card">
          <div className="success-card__icon-wrap">
            <CheckCircle2 size={52} className="success-card__icon" />
          </div>

          <h1 className="success-card__title">Заявка принята!</h1>
          <p className="success-card__desc">
            Менеджер проверяет складские остатки и свяжется с вами в течение{" "}
            <strong>10–15 минут</strong> для подтверждения времени получения.
          </p>

          {code && (
            <div className="success-code">
              <div className="success-code__icon"><Ticket size={20} /></div>
              <div className="success-code__body">
                <div className="success-code__label">Код выдачи заказа</div>
                <div className="success-code__value">{code}</div>
                <div className="success-code__hint">
                  Сохраните код — назовите его при получении товара на складе.
                </div>
              </div>
            </div>
          )}

          <div className="success-steps">
            <div className="success-step">
              <div className="success-step__num">1</div>
              <div className="success-step__text">
                <strong>Звонок менеджера</strong>
                <span>Уточним детали и подтвердим бронь</span>
              </div>
            </div>
            <div className="success-step__arrow">→</div>
            <div className="success-step">
              <div className="success-step__num">2</div>
              <div className="success-step__text">
                <strong>Резерв товара</strong>
                <span>Удерживаем 3 дня после подтверждения</span>
              </div>
            </div>
            <div className="success-step__arrow">→</div>
            <div className="success-step">
              <div className="success-step__num">3</div>
              <div className="success-step__text">
                <strong>Получение</strong>
                <span>Самовывоз по коду или доставка курьером</span>
              </div>
            </div>
          </div>

          <div className="success-phone-block">
            <div className="success-phone-label">Срочный вопрос? Позвоните нам:</div>
            <SuccessContactPhone />
          </div>

          <div className="success-actions">
            <Link href="/catalog" className="success-btn-primary">
              Продолжить покупки <ArrowRight size={15} />
            </Link>
            <Link href="/cabinet" className="success-btn-secondary">
              <Package size={15} /> Мои заказы
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
