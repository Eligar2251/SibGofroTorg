"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowUpLeft,
  Banknote,
  CreditCard,
  FilePlus2,
  Landmark,
  PackagePlus,
  Recycle,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { useEscapeClose } from "@/hooks/use-escape-close";

type Department = "sgt" | "wastepaper";

type QuickAction = {
  id: string;
  title: string;
  description: string;
  icon: typeof FilePlus2;
  href: (adminPath: string) => string;
  tone: "blue" | "green" | "amber" | "violet";
};

const SGT_ACTIONS: QuickAction[] = [
  {
    id: "order",
    title: "Заказ покупателя",
    description: "Новый заказ во внутреннем учёте СГТ",
    icon: FilePlus2,
    tone: "blue",
    href: (path) => `/${path}/warehouse?tab=deals&action=quick-order`,
  },
  {
    id: "supply",
    title: "Поставка товара",
    description: "Приходный ордер, приёмка и расчёты с поставщиком",
    icon: PackagePlus,
    tone: "amber",
    href: (path) => `/${path}/warehouse?tab=receipts&action=quick-receipt`,
  },
  {
    id: "salary",
    title: "Зарплата / план выплаты",
    description: "Сотрудник, дата, сумма и счёт СибГофроТорга",
    icon: Banknote,
    tone: "green",
    href: (path) => `/${path}/warehouse?tab=salaries&salary=regular&action=quick-salary`,
  },
  {
    id: "payment",
    title: "Платёж",
    description: "Укажите назначение, направление и счёт оплаты",
    icon: CreditCard,
    tone: "violet",
    href: (path) => `/${path}/warehouse?tab=bank&action=quick-payment`,
  },
];

const WASTEPAPER_ACTIONS: QuickAction[] = [
  {
    id: "intake",
    title: "Приём макулатуры",
    description: "Забор у контрагента, веса, сумма и счёт выплаты",
    icon: ArrowDownLeft,
    tone: "green",
    href: (path) => `/${path}/wastepaper-account?tab=intakes&action=quick-intake`,
  },
  {
    id: "shipment",
    title: "Сдача макулатуры",
    description: "Продажа предприятию, приёмка, оплата и перевозка",
    icon: ArrowUpLeft,
    tone: "blue",
    href: (path) => `/${path}/wastepaper-account?tab=shipments&action=quick-shipment`,
  },
  {
    id: "salary",
    title: "Зарплата / план выплаты",
    description: "Выплата попадёт только в таблицу макулатуры",
    icon: Banknote,
    tone: "amber",
    href: (path) => `/${path}/wastepaper-account?tab=salaries&action=quick-salary`,
  },
  {
    id: "payment",
    title: "Платёж макулатуры",
    description: "Отдельный платёж и назначение из счетов макулатуры",
    icon: Wallet,
    tone: "violet",
    href: (path) => `/${path}/wastepaper-account?tab=payments&action=quick-payment`,
  },
];

export function DashboardQuickActions({ adminPath }: { adminPath: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState<Department>("sgt");
  useEscapeClose(() => setOpen(false), open);

  const actions = department === "sgt" ? SGT_ACTIONS : WASTEPAPER_ACTIONS;

  function openAction(action: QuickAction) {
    setOpen(false);
    router.push(action.href(adminPath));
  }

  return (
    <>
      <button type="button" className="dash-action-trigger" onClick={() => setOpen(true)}>
        <span className="dash-action-trigger__icon"><FilePlus2 size={17} /></span>
        <span>Добавить операцию</span>
      </button>

      {open && (
        <ModalPortal>
          <div
            className="admin-modal-overlay dash-quick-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section className="admin-modal dash-quick-modal" role="dialog" aria-modal="true" aria-labelledby="dash-quick-title">
              <header className="dash-quick-modal__head">
                <div>
                  <span className="dash-quick-modal__eyebrow">Быстрое добавление</span>
                  <h2 id="dash-quick-title">Что создаём?</h2>
                  <p>Выберите подразделение, затем нужную операцию. Откроется привычная форма учёта.</p>
                </div>
                <button type="button" className="admin-modal__close" onClick={() => setOpen(false)} aria-label="Закрыть">
                  <X size={17} />
                </button>
              </header>

              <div className="dash-quick-modal__body">
                <div className="dash-quick-departments" role="tablist" aria-label="Подразделение">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={department === "sgt"}
                    className={`dash-quick-department${department === "sgt" ? " is-active" : ""}`}
                    onClick={() => setDepartment("sgt")}
                  >
                    <span className="dash-quick-department__icon"><Landmark size={17} /></span>
                    <span><strong>СибГофроТорг</strong><small>Заказы · поставки · свой банк</small></span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={department === "wastepaper"}
                    className={`dash-quick-department${department === "wastepaper" ? " is-active" : ""}`}
                    onClick={() => setDepartment("wastepaper")}
                  >
                    <span className="dash-quick-department__icon"><Recycle size={17} /></span>
                    <span><strong>Макулатура</strong><small>Приём · сдача · отдельные счета</small></span>
                  </button>
                </div>

                <div className="dash-quick-actions" aria-live="polite">
                  {actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={`${department}-${action.id}`}
                        type="button"
                        className={`dash-quick-action dash-quick-action--${action.tone}`}
                        onClick={() => openAction(action)}
                      >
                        <span className="dash-quick-action__icon"><Icon size={18} /></span>
                        <span className="dash-quick-action__copy">
                          <strong>{action.title}</strong>
                          <small>{action.description}</small>
                        </span>
                        <span className="dash-quick-action__arrow" aria-hidden="true">→</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <footer className="dash-quick-modal__foot">
                <Truck size={14} aria-hidden="true" />
                <span>Денежные счета подразделений не связаны. Общий для них только раздел перевозок.</span>
              </footer>
            </section>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
