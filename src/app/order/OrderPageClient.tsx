"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/context/CartContext";
import {
  Trash2,
  ArrowRight,
  ArrowLeft,
  Plus,
  Minus,
  Truck,
  MapPin,
  Building2,
  CreditCard,
  Banknote,
  FileText,
  Phone,
  Loader2,
  Check,
  Shield,
  UserPlus,
} from "lucide-react";
import { GlyphIcon } from "@/components/ui/Glyph";
import { ModalPortal } from "@/components/admin/ModalPortal";

type DeliveryMethod = "courier" | "pickup" | "transport";
type PaymentMethod = "card" | "cash" | "invoice";
type CustomerType = "individual" | "legal";
type CommChannel = "call" | "whatsapp" | "telegram" | "max";

const STEPS = [
  { n: 1, label: "Корзина" },
  { n: 2, label: "Доставка" },
  { n: 3, label: "Данные" },
  { n: 4, label: "Оплата" },
];

export function OrderPageClient({
  deliveryPrice,
  freeDeliveryThreshold,
}: {
  deliveryPrice: number;
  freeDeliveryThreshold: number;
}) {
  const router = useRouter();
  const { cart, updateQty, removeFromCart, totalSum, clearCart } = useCart();

  const [step, setStep] = useState(1);
  const [delivery, setDelivery] = useState<DeliveryMethod>("courier");
  const [payment, setPayment] = useState<PaymentMethod>("card");
  const [customerType, setCustomerType] = useState<CustomerType>("individual");
  const [commChannel, setCommChannel] = useState<CommChannel>("call");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [sessionUser, setSessionUser] = useState<{
    id?: string;
    name?: string | null;
    phone?: string;
    email?: string | null;
  } | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [comment, setComment] = useState("");

  // юрлицо
  const [companyName, setCompanyName] = useState("");
  const [shortName, setShortName] = useState("");
  const [inn, setInn] = useState("");
  const [kpp, setKpp] = useState("");
  const [ogrn, setOgrn] = useState("");
  const [legalAddress, setLegalAddress] = useState("");
  const [actualAddress, setActualAddress] = useState("");
  const [taxSystem, setTaxSystem] = useState("ОСНО");
  const [bankAccount, setBankAccount] = useState("");
  const [bankName, setBankName] = useState("");
  const [bik, setBik] = useState("");
  const [correspondentAccount, setCorrespondentAccount] = useState("");

  // Модалка создания личного кабинета (регистрация без потери корзины)
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accName, setAccName] = useState("");
  const [accPhone, setAccPhone] = useState("");
  const [accPassword, setAccPassword] = useState("");
  const [accPassword2, setAccPassword2] = useState("");
  const [accSaving, setAccSaving] = useState(false);
  const [accError, setAccError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.user) {
          setSessionUser(null);
          return;
        }
        const u = data.user;
        setSessionUser(u);
        // автозаполнение из профиля — только пустые поля не затираем уже введённое
        if (u.name) setName(u.name);
        if (u.phone) setPhone(u.phone);
        if (u.email) setEmail(u.email);
        if (u.customerType === "legal" || u.customerType === "individual") {
          setCustomerType(u.customerType);
        }
        if (u.companyName) setCompanyName(u.companyName);
        if (u.shortName) setShortName(u.shortName);
        if (u.inn) setInn(u.inn);
        if (u.kpp) setKpp(u.kpp);
        if (u.ogrn) setOgrn(u.ogrn);
        if (u.legalAddress) setLegalAddress(u.legalAddress);
        if (u.actualAddress) setActualAddress(u.actualAddress);
        if (u.deliveryAddress) setAddress(u.deliveryAddress);
      })
      .catch(() => {});
  }, []);

  const deliveryCost =
    delivery === "pickup"
      ? 0
      : totalSum >= freeDeliveryThreshold
        ? 0
        : deliveryPrice;
  const grandTotal = totalSum + deliveryCost;

  function openAccountModal() {
    setAccName(name);
    setAccPhone(phone);
    setAccPassword("");
    setAccPassword2("");
    setAccError("");
    setAccountModalOpen(true);
  }

  /** Регистрация/вход из модалки — корзина не сбрасывается */
  async function handleAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAccError("");
    if (accPassword.length < 8) {
      setAccError("Пароль минимум 8 символов");
      return;
    }
    if (accPassword !== accPassword2) {
      setAccError("Пароли не совпадают");
      return;
    }
    setAccSaving(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: accPhone.trim(),
          password: accPassword,
          name: accName.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // уже есть аккаунт — пробуем войти тем же паролем
        if (
          typeof data.error === "string" &&
          data.error.toLowerCase().includes("уже")
        ) {
          const loginRes = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: accPhone.trim(),
              password: accPassword,
            }),
          });
          const loginData = await loginRes.json().catch(() => ({}));
          if (!loginRes.ok) {
            setAccError(
              loginData.error ||
                "Аккаунт с этим телефоном уже есть. Введите верный пароль."
            );
            setAccSaving(false);
            return;
          }
          setSessionUser(loginData.user || { phone: accPhone.trim(), name: accName });
          if (!phone) setPhone(accPhone.trim());
          if (!name && accName) setName(accName.trim());
          setAccountModalOpen(false);
          setAccSaving(false);
          return;
        }
        setAccError(data.error || "Не удалось создать аккаунт");
        setAccSaving(false);
        return;
      }
      setSessionUser(data.user || { phone: accPhone.trim(), name: accName });
      if (!phone) setPhone(accPhone.trim());
      if (!name && accName) setName(accName.trim());
      setAccountModalOpen(false);
    } catch {
      setAccError("Ошибка сети");
    }
    setAccSaving(false);
  }

  function nextStep() {
    setError("");
    if (step === 1 && cart.length === 0) {
      setError("Корзина пуста");
      return;
    }
    if (step === 3) {
      if (!name.trim()) {
        setError(
          customerType === "legal"
            ? "Укажите контактное лицо"
            : "Укажите имя"
        );
        return;
      }
      if (!phone.trim()) {
        setError("Укажите телефон");
        return;
      }
      if (customerType === "legal") {
        if (!companyName.trim()) {
          setError("Укажите полное наименование организации");
          return;
        }
        if (!inn.trim()) {
          setError("Укажите ИНН");
          return;
        }
        if (!email.trim()) {
          setError("Укажите рабочую почту для счёта");
          return;
        }
        if (!legalAddress.trim()) {
          setError("Укажите юридический адрес");
          return;
        }
      }
      if (delivery === "courier" && !address.trim()) {
        setError("Укажите адрес доставки");
        return;
      }
    }
    setStep((s) => Math.min(4, s + 1));
  }

  function prevStep() {
    setError("");
    setStep((s) => Math.max(1, s - 1));
  }

  async function handleSubmit() {
    if (cart.length === 0) return;
    const finalPayment = customerType === "legal" ? "invoice" : payment;
    // Для оплаты по счёту (в т.ч. ИП/физлицо) нужна почта, куда придёт счёт
    if (finalPayment === "invoice" && !email.trim()) {
      setError("Укажите почту для счёта — на неё придёт счёт на оплату");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      // Гость оформляет без регистрации — придёт заявка с номером.
      // Если пользователь вошёл (через модалку «Создать ЛК»), заказ
      // автоматически привяжется к аккаунту по cookie сессии.
      const payload = {
        type: "order",
        customerType,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        customerEmail: email.trim() || null,
        communicationChannel: commChannel,
        paymentMethod: finalPayment,
        companyName: customerType === "legal" ? companyName.trim() : null,
        shortName: customerType === "legal" ? shortName.trim() || null : null,
        inn: customerType === "legal" ? inn.trim() : null,
        kpp: customerType === "legal" ? kpp.trim() || null : null,
        ogrn: customerType === "legal" ? ogrn.trim() || null : null,
        legalAddress: customerType === "legal" ? legalAddress.trim() : null,
        actualAddress:
          customerType === "legal" ? actualAddress.trim() || null : null,
        taxSystem: customerType === "legal" ? taxSystem.trim() || null : null,
        bankAccount: customerType === "legal" ? bankAccount.trim() || null : null,
        bankName: customerType === "legal" ? bankName.trim() || null : null,
        bik: customerType === "legal" ? bik.trim() || null : null,
        correspondentAccount:
          customerType === "legal" ? correspondentAccount.trim() || null : null,
        deliveryAddress: address.trim() || null,
        comment: [
          address ? `Адрес доставки: ${address}` : "",
          delivery === "courier"
            ? "Доставка: курьер"
            : delivery === "pickup"
              ? "Доставка: самовывоз"
              : "Доставка: ТК",
          comment,
        ]
          .filter(Boolean)
          .join(". "),
        channel: "website",
        items: cart.map((item) => ({
          productId: item.productId,
          name: item.name,
          sku: item.sku || "—",
          quantity: item.quantity,
          price: item.price,
        })),
        totalSum: grandTotal,
      };

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as Record<string, string>).error || "Ошибка оформления"
        );
      }

      const result = await res.json();
      try {
        const existing = JSON.parse(
          localStorage.getItem("sib_my_orders") || "[]"
        );
        localStorage.setItem(
          "sib_my_orders",
          JSON.stringify([...existing, result.orderId])
        );
      } catch {
        /* ignore */
      }

      // очищаем корзину ТОЛЬКО после успешного заказа
      clearCart();
      router.push("/order/success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сервера");
      setSubmitting(false);
    }
  }

  if (cart.length === 0) {
    return (
      <div className="checkout-empty">
        <div className="checkout-empty__inner">
          <div className="checkout-empty__icon"><GlyphIcon value="cart" size={44} /></div>
          <h1 className="checkout-empty__title">Корзина пуста</h1>
          <p className="checkout-empty__desc">
            Добавьте коробки или упаковочные материалы из каталога
          </p>
          <Link href="/catalog" className="checkout-empty__btn">
            Открыть каталог <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-page">
      <div className="container-wide">
        <div className="checkout-breadcrumbs">
          <Link href="/">Главная</Link>
          <span>/</span>
          <span>Оформление заказа</span>
        </div>

        <h1 className="checkout-h1">Оформление бронирования</h1>

        {/* шаги */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 28,
            flexWrap: "wrap",
          }}
        >
          {STEPS.map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => s.n < step && setStep(s.n)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 999,
                border:
                  step === s.n
                    ? "2px solid var(--kraft, #d97706)"
                    : step > s.n
                      ? "1px solid var(--green, #16a34a)"
                      : "1px solid var(--border, #e5e5e5)",
                background:
                  step === s.n
                    ? "var(--kraft-light, #fef3c7)"
                    : step > s.n
                      ? "var(--green-light, #dcfce7)"
                      : "#fff",
                fontWeight: step === s.n ? 700 : 500,
                fontSize: 13,
                cursor: s.n < step ? "pointer" : "default",
                opacity: s.n > step ? 0.55 : 1,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 800,
                  background:
                    step > s.n
                      ? "var(--green, #16a34a)"
                      : step === s.n
                        ? "var(--kraft, #d97706)"
                        : "#e5e5e5",
                  color: step >= s.n ? "#fff" : "#666",
                }}
              >
                {step > s.n ? <GlyphIcon value="check" size={13} /> : s.n}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        <div className="checkout-layout">
          <div className="checkout-main">
            {/* ШАГ 1 — корзина (как раньше) */}
            {step === 1 && (
              <div className="checkout-block">
                <div className="checkout-block__header">
                  <span className="checkout-block__step">1</span>
                  <span className="checkout-block__title">
                    Товары в заказе
                    <span className="checkout-block__count">
                      {cart.length} поз.
                    </span>
                  </span>
                </div>
                <div className="checkout-block__body">
                  <div className="cart-items">
                    {cart.map((item) => (
                      <div key={item.productId} className="cart-item">
                        <div className="cart-item__img">
                          {item.imageUrl ? (
                            <Image
                              src={item.imageUrl}
                              alt={item.name}
                              fill
                              style={{ objectFit: "cover" }}
                              sizes="56px"
                            />
                          ) : (
                            <span><GlyphIcon value="box" size={22} /></span>
                          )}
                        </div>
                        <div className="cart-item__info">
                          <div className="cart-item__name">{item.name}</div>
                          {item.sku && (
                            <div className="cart-item__sku">
                              Арт: {item.sku}
                            </div>
                          )}
                          <div className="cart-item__price-unit">
                            {item.price.toLocaleString("ru-RU")} ₽/шт.
                          </div>
                        </div>
                        <div className="cart-item__right">
                          <div className="cart-item__stepper">
                            <button
                              type="button"
                              onClick={() =>
                                updateQty(item.productId, item.quantity - 1)
                              }
                              className="cart-item__step-btn"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="cart-item__qty">
                              {item.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateQty(item.productId, item.quantity + 1)
                              }
                              className="cart-item__step-btn"
                            >
                              <Plus size={12} />
                            </button>
                          </div>
                          <div className="cart-item__sum">
                            {(item.price * item.quantity).toLocaleString(
                              "ru-RU"
                            )}{" "}
                            ₽
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.productId)}
                            className="cart-item__del"
                            aria-label="Удалить"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!sessionUser ? (
                    <div
                      className="checkout-tip"
                      style={{
                        marginTop: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <UserPlus size={16} />
                        С регистрацией можно отслеживать статус заказа (готов к
                        получению или нет) в личном кабинете.
                      </span>
                      <button
                        type="button"
                        onClick={openAccountModal}
                        className="btn-back"
                        style={{ borderColor: "var(--green)", color: "var(--green)", fontWeight: 700 }}
                      >
                        Создать личный кабинет
                      </button>
                    </div>
                  ) : (
                    <div className="checkout-tip" style={{ marginTop: 16 }}>
                      Заказ будет привязан к вашему кабинету (
                      <strong>{sessionUser.phone}</strong>) — статус можно
                      отслеживать в ЛК.
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: 20,
                    }}
                  >
                    <button
                      type="button"
                      onClick={nextStep}
                      className="checkout-submit"
                      style={{ width: "auto", minWidth: 220 }}
                    >
                      Далее: доставка <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ШАГ 2 — доставка (как раньше, address в state) */}
            {step === 2 && (
              <div className="checkout-block">
                <div className="checkout-block__header">
                  <span className="checkout-block__step">2</span>
                  <span className="checkout-block__title">Способ доставки</span>
                </div>
                <div className="checkout-block__body">
                  <div className="delivery-options">
                    {(
                      [
                        {
                          id: "courier" as const,
                          icon: <Truck size={20} />,
                          title: "Курьером по Новосибирску",
                          desc: `2–3 рабочих дня · бесплатно от ${freeDeliveryThreshold.toLocaleString("ru-RU")} ₽`,
                          price:
                            totalSum >= freeDeliveryThreshold
                              ? "Бесплатно"
                              : `${deliveryPrice.toLocaleString("ru-RU")} ₽`,
                          free: totalSum >= freeDeliveryThreshold,
                        },
                        {
                          id: "pickup" as const,
                          icon: <MapPin size={20} />,
                          title: "Самовывоз со склада",
                          desc: "ул. Ватутина, 42а к1 · Пн–Пт 8:30–17:00",
                          price: "Бесплатно",
                          free: true,
                        },
                        {
                          id: "transport" as const,
                          icon: <Building2 size={20} />,
                          title: "Транспортная компания",
                          desc: "Сдадим в ТК по вашему выбору",
                          price: "По тарифу ТК",
                          free: false,
                        },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.id}
                        className={`delivery-option${
                          delivery === opt.id ? " delivery-option--active" : ""
                        }`}
                      >
                        <input
                          type="radio"
                          name="delivery"
                          value={opt.id}
                          checked={delivery === opt.id}
                          onChange={() => setDelivery(opt.id)}
                          className="delivery-option__radio"
                        />
                        <span className="delivery-option__icon">
                          {opt.icon}
                        </span>
                        <span className="delivery-option__info">
                          <span className="delivery-option__title">
                            {opt.title}
                          </span>
                          <span className="delivery-option__desc">
                            {opt.desc}
                          </span>
                        </span>
                        <span
                          className={`delivery-option__price${
                            opt.free ? " delivery-option__price--free" : ""
                          }`}
                        >
                          {opt.price}
                        </span>
                      </label>
                    ))}
                  </div>

                  {delivery !== "pickup" && (
                    <div style={{ marginTop: 14 }}>
                      <label className="checkout-label">
                        Адрес доставки {delivery === "courier" && "*"}
                      </label>
                      <input
                        type="text"
                        className="form-input"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={
                          delivery === "transport"
                            ? "Адрес терминала ТК"
                            : "Улица, дом, квартира/офис"
                        }
                      />
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      marginTop: 20,
                      flexWrap: "wrap",
                    }}
                  >
                    <button type="button" onClick={prevStep} className="btn-back">
                      <ArrowLeft size={16} /> Назад
                    </button>
                    <button
                      type="button"
                      onClick={nextStep}
                      className="checkout-submit"
                      style={{ width: "auto", minWidth: 220 }}
                    >
                      Далее: ваши данные <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ШАГ 3 — данные + юрлицо */}
            {step === 3 && (
              <div className="checkout-block">
                <div className="checkout-block__header">
                  <span className="checkout-block__step">3</span>
                  <span className="checkout-block__title">Ваши данные</span>
                </div>
                <div className="checkout-block__body">
                  {sessionUser && (
                    <div className="checkout-tip" style={{ marginBottom: 16 }}>
                      Данные автоматически заполнены из ЛК
                    </div>
                  )}

                  <div className="customer-type-switch">
                    <button
                      type="button"
                      onClick={() => setCustomerType("individual")}
                      className={`customer-type-btn${
                        customerType === "individual"
                          ? " customer-type-btn--active"
                          : ""
                      }`}
                    >
                      <GlyphIcon value="user" size={14} /> Физическое лицо
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomerType("legal")}
                      className={`customer-type-btn${
                        customerType === "legal"
                          ? " customer-type-btn--active"
                          : ""
                      }`}
                    >
                      <GlyphIcon value="building" size={14} /> Юр. лицо / ИП
                    </button>
                  </div>

                  <div className="checkout-fields">
                    {customerType === "legal" && (
                      <>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label className="checkout-label">
                            Полное наименование *
                          </label>
                          <input
                            className="form-input"
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            placeholder='ООО «...»'
                          />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label className="checkout-label">
                            Сокращённое наименование
                          </label>
                          <input
                            className="form-input"
                            value={shortName}
                            onChange={(e) => setShortName(e.target.value)}
                            placeholder='ООО «КОРУНА» / ИП Иванов И.И.'
                          />
                        </div>
                        <div>
                          <label className="checkout-label">ИНН *</label>
                          <input
                            className="form-input"
                            value={inn}
                            onChange={(e) => setInn(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="checkout-label">КПП</label>
                          <input
                            className="form-input"
                            value={kpp}
                            onChange={(e) => setKpp(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="checkout-label">ОГРН</label>
                          <input
                            className="form-input"
                            value={ogrn}
                            onChange={(e) => setOgrn(e.target.value)}
                          />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label className="checkout-label">
                            Юридический адрес *
                          </label>
                          <input
                            className="form-input"
                            value={legalAddress}
                            onChange={(e) => setLegalAddress(e.target.value)}
                          />
                        </div>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <label className="checkout-label">
                            Фактический адрес
                          </label>
                          <input
                            className="form-input"
                            value={actualAddress}
                            onChange={(e) => setActualAddress(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="checkout-label">Налогообложение</label>
                          <select className="form-input" value={taxSystem} onChange={(e) => setTaxSystem(e.target.value)}>
                            <option value="ОСНО">ОСНО</option>
                            <option value="УСН">УСН</option>
                            <option value="ПСН">ПСН</option>
                            <option value="ЕСХН">ЕСХН</option>
                          </select>
                        </div>
                        <div>
                          <label className="checkout-label">Расчётный счёт</label>
                          <input className="form-input" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
                        </div>
                        <div>
                          <label className="checkout-label">Банк</label>
                          <input className="form-input" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder='ООО "Банк Точка"' />
                        </div>
                        <div>
                          <label className="checkout-label">БИК</label>
                          <input className="form-input" value={bik} onChange={(e) => setBik(e.target.value)} />
                        </div>
                        <div>
                          <label className="checkout-label">Корр. счёт</label>
                          <input className="form-input" value={correspondentAccount} onChange={(e) => setCorrespondentAccount(e.target.value)} />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="checkout-label">
                        {customerType === "legal"
                          ? "Контактное лицо *"
                          : "Ваше имя *"}
                      </label>
                      <input
                        className="form-input"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="checkout-label">Телефон *</label>
                      <input
                        className="form-input"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        readOnly={!!sessionUser}
                        style={
                          sessionUser
                            ? { background: "var(--bg-main)" }
                            : undefined
                        }
                      />
                    </div>
                    <div>
                      <label className="checkout-label">
                        {customerType === "legal"
                          ? "Рабочая почта для счёта *"
                          : "Email"}
                      </label>
                      <input
                        className="form-input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <label className="checkout-label">Способ связи</label>
                    <div className="comm-options">
                      {(["call", "whatsapp", "telegram", "max"] as CommChannel[]).map(
                        (ch) => (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => setCommChannel(ch)}
                            className={`comm-option${
                              commChannel === ch ? " comm-option--active" : ""
                            }`}
                          >
                            {ch === "call" && (
                              <>
                                <Phone size={13} /> Звонок
                              </>
                            )}
                            {ch === "whatsapp" && (
                              <>
                                <GlyphIcon value="chat" size={13} /> WhatsApp
                              </>
                            )}
                            {ch === "telegram" && (
                              <>
                                <GlyphIcon value="send" size={13} /> Telegram
                              </>
                            )}
                            {ch === "max" && (
                              <>
                                <GlyphIcon value="chats" size={13} /> Макс
                              </>
                            )}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <label className="checkout-label">Комментарий</label>
                    <textarea
                      className="form-input"
                      rows={3}
                      style={{ resize: "none" }}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </div>

                  {error && (
                    <div className="checkout-error" style={{ marginTop: 12 }}>
                      {error}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      marginTop: 20,
                      flexWrap: "wrap",
                    }}
                  >
                    <button type="button" onClick={prevStep} className="btn-back">
                      <ArrowLeft size={16} /> Назад
                    </button>
                    <button
                      type="button"
                      onClick={nextStep}
                      className="checkout-submit"
                      style={{ width: "auto", minWidth: 220 }}
                    >
                      Далее: оплата <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ШАГ 4 — оплата + быстрая регистрация гостя */}
            {step === 4 && (
              <div className="checkout-block">
                <div className="checkout-block__header">
                  <span className="checkout-block__step">4</span>
                  <span className="checkout-block__title">
                    Оплата и подтверждение
                  </span>
                </div>
                <div className="checkout-block__body">
                  {customerType === "legal" ? (
                    <div className="payment-legal">
                      <FileText
                        size={18}
                        style={{ color: "var(--kraft)", flexShrink: 0 }}
                      />
                      <div>
                        <div className="payment-legal__title">
                          Безналичный расчёт по счёту
                        </div>
                        <div className="payment-legal__desc">
                          Счёт отправим на {email || "указанную почту"}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="payment-options">
                      {(
                        [
                          {
                            id: "card" as const,
                            icon: <CreditCard size={18} />,
                            title: "Перевод на карту",
                            desc: "Сбербанк / СБП",
                          },
                          {
                            id: "cash" as const,
                            icon: <Banknote size={18} />,
                            title: "Наличными",
                            desc: "На складе или курьеру",
                          },
                          {
                            id: "invoice" as const,
                            icon: <FileText size={18} />,
                            title: "Оплата по счёту",
                            desc: "Для ИП и физлиц — счёт придёт на почту",
                          },
                        ] as const
                      ).map((opt) => (
                        <label
                          key={opt.id}
                          className={`payment-option${
                            payment === opt.id ? " payment-option--active" : ""
                          }`}
                        >
                          <input
                            type="radio"
                            name="payment"
                            checked={payment === opt.id}
                            onChange={() => setPayment(opt.id)}
                            className="payment-option__radio"
                          />
                          <span className="payment-option__icon">
                            {opt.icon}
                          </span>
                          <span className="payment-option__info">
                            <span className="payment-option__title">
                              {opt.title}
                            </span>
                            <span className="payment-option__desc">
                              {opt.desc}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* ИП / физлицо: счёт пришлём на почту */}
                  {customerType === "individual" && payment === "invoice" && (
                    <div className="payment-legal" style={{ marginTop: 16 }}>
                      <FileText
                        size={18}
                        style={{ color: "var(--kraft)", flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <div className="payment-legal__title">Счёт на оплату</div>
                        <div className="payment-legal__desc">
                          Счёт придёт на указанную почту
                        </div>
                        <input
                          type="email"
                          className="form-input"
                          style={{ marginTop: 8 }}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Email для счёта *"
                        />
                      </div>
                    </div>
                  )}

                  {sessionUser ? (
                    <div className="checkout-tip" style={{ marginTop: 16 }}>
                      Заказ будет в кабинете: <strong>{sessionUser.phone}</strong>
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontSize: 13, color: "var(--ink-muted)" }}>
                      Хотите отслеживать статус заказа?{" "}
                      <button
                        type="button"
                        onClick={openAccountModal}
                        style={{
                          color: "var(--green)",
                          fontWeight: 700,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          textDecoration: "underline",
                          padding: 0,
                          font: "inherit",
                        }}
                      >
                        Создать личный кабинет
                      </button>
                    </div>
                  )}

                  {error && (
                    <div className="checkout-error" style={{ marginTop: 12 }}>
                      {error}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      marginTop: 20,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      type="button"
                      onClick={prevStep}
                      disabled={submitting}
                      className="btn-back"
                    >
                      <ArrowLeft size={16} /> Назад
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="checkout-submit"
                      style={{ width: "auto", minWidth: 260 }}
                    >
                      {submitting ? (
                        <>
                          <Loader2 size={18} className="animate-spin" />{" "}
                          Оформляем...
                        </>
                      ) : (
                        <>
                          <Check size={18} /> Подтвердить бронирование
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* sidebar итог — как раньше */}
          <aside className="checkout-sidebar">
            <div className="checkout-summary">
              <div className="checkout-summary__title">Итог заказа</div>
              <div className="checkout-summary__items">
                {cart.map((item) => (
                  <div key={item.productId} className="checkout-summary__item">
                    <span className="checkout-summary__item-name">
                      {item.name}
                      <span className="checkout-summary__item-qty">
                        {" "}
                        × {item.quantity}
                      </span>
                    </span>
                    <span className="checkout-summary__item-sum">
                      {(item.price * item.quantity).toLocaleString("ru-RU")} ₽
                    </span>
                  </div>
                ))}
              </div>
              <div className="checkout-summary__divider" />
              <div className="checkout-summary__rows">
                <div className="checkout-summary__row">
                  <span>Товары</span>
                  <span>{totalSum.toLocaleString("ru-RU")} ₽</span>
                </div>
                <div className="checkout-summary__row">
                  <span>Доставка</span>
                  <span>
                    {deliveryCost === 0
                      ? "Бесплатно"
                      : `${deliveryCost.toLocaleString("ru-RU")} ₽`}
                  </span>
                </div>
              </div>
              <div className="checkout-summary__total">
                <span>К оплате</span>
                <span className="checkout-summary__total-sum">
                  {grandTotal.toLocaleString("ru-RU")} ₽
                </span>
              </div>
              <div className="checkout-summary__reserve">
                <Shield size={13} /> Товар бронируется на 3 дня
              </div>
            </div>
          </aside>
        </div>
      </div>

      {accountModalOpen && (
        <ModalPortal>
          <div
            className="popup-root-overlay"
            onClick={() => setAccountModalOpen(false)}
          >
            <div
              className="banner-v2"
              style={{ width: "min(460px, 100%)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="banner-v2__close"
                onClick={() => setAccountModalOpen(false)}
                aria-label="Закрыть"
              >
                ✕
              </button>
              <form onSubmit={handleAccountSubmit} className="banner-v2__body">
                <div className="banner-v2__kicker">
                  <UserPlus size={14} /> Личный кабинет
                </div>
                <h2 className="banner-v2__title" style={{ fontSize: 24 }}>
                  Создать личный кабинет
                </h2>
                <p className="banner-v2__desc">
                  Сможете отслеживать статус заказа (готов к получению или нет).
                  Корзина не пропадёт.
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
                  <div>
                    <label className="checkout-label">Телефон (логин) *</label>
                    <input
                      type="tel"
                      className="form-input"
                      value={accPhone}
                      onChange={(e) => setAccPhone(e.target.value)}
                      placeholder="+7 ..."
                    />
                  </div>
                  <div>
                    <label className="checkout-label">Имя</label>
                    <input
                      type="text"
                      className="form-input"
                      value={accName}
                      onChange={(e) => setAccName(e.target.value)}
                      placeholder="Как к вам обращаться"
                    />
                  </div>
                  <div>
                    <label className="checkout-label">Пароль *</label>
                    <input
                      type="password"
                      className="form-input"
                      value={accPassword}
                      onChange={(e) => setAccPassword(e.target.value)}
                      placeholder="минимум 8 символов"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label className="checkout-label">Повторите пароль *</label>
                    <input
                      type="password"
                      className="form-input"
                      value={accPassword2}
                      onChange={(e) => setAccPassword2(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {accError && (
                  <div className="checkout-error" style={{ width: "100%" }}>
                    {accError}
                  </div>
                )}

                <div className="banner-v2__actions">
                  <button type="submit" className="banner-v2__cta" disabled={accSaving}>
                    {accSaving ? (
                      <>
                        <Loader2 size={18} className="animate-spin" /> Создаём...
                      </>
                    ) : (
                      <>Создать кабинет</>
                    )}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--ink-muted)", margin: 0, width: "100%" }}>
                  Можно оформить заказ и без регистрации — нам просто придёт
                  заявка с вашим номером.
                </p>
              </form>
            </div>
          </div>
        </ModalPortal>
      )}

      <style jsx global>{`
        .btn-back {
          height: 48px;
          padding: 0 18px;
          border: 1px solid var(--border, #e5e5e5);
          border-radius: 8px;
          background: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}