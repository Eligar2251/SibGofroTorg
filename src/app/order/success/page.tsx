// src/app/order/success/page.tsx
import Link from "next/link";
import { CheckCircle2, ArrowRight, PhoneCall, Package } from "lucide-react";
import { OrderSuccessGoal } from "@/components/analytics/OrderSuccessGoal";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Заказ оформлен — СибГофроТорг",
};

export default function OrderSuccessPage() {
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
                <span>Самовывоз или доставка курьером</span>
              </div>
            </div>
          </div>

          <div className="success-phone-block">
            <div className="success-phone-label">Срочный вопрос? Позвоните нам:</div>
            <a href="tel:+73832918146" className="success-phone">
              <PhoneCall size={18} /> +7 (383) 291-81-46
            </a>
            <div className="success-phone-hours">Пн–Пт 8:30–17:00 · Сб, Вс — выходные</div>
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