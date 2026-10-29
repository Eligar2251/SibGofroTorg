export interface FirestoreCategory {
  id: string;
  name: string;
  slug: string;
  icon?: string | null | undefined;
  description?: string | null | undefined;
  sortOrder?: number | null | undefined;
  isVisible?: boolean | null | undefined;
  imageUrl?: string | null | undefined;
  /** Тип размеров товаров категории (product_dimension_profiles.id). */
  dimensionProfileId?: string | null | undefined;
  createdAt?: any;
}

export interface FirestoreProduct {
  id: string;
  name: string;
  slug: string;
  categoryId?: string | null | undefined;
  sku?: string | null | undefined;
  description?: string | null | undefined;
  price: number | null;
  /** Цена родительского товара до подстановки минимальной цены варианта в выдаче. */
  basePrice?: number | null;
  priceWholesale?: number | null | undefined;
  minWholesaleQty?: number | null | undefined;
  purchasePrice?: number | null | undefined;
  dimensionLength?: number | null | undefined;
  dimensionWidth?: number | null | undefined;
  dimensionHeight?: number | null | undefined;
  dimensionUnit?: string | null | undefined;
  weight?: number | null | undefined;
  material?: string | null | undefined;
  packQty?: number | null | undefined;
  volume?: number | null | undefined;
  note?: string | null | undefined;
  inStock: boolean;
  stockQty?: number | null | undefined;
  stockWarnQty?: number | null | undefined;
  isPromo: boolean;
  promoLabel?: string | null | undefined;
  /** Метки товара («озон», «вб», «сдэк», «гост»...). Товар может
   *  входить сразу в несколько плиток главной. */
  tags?: string[] | undefined;
  promoLabelColor?: string | null | undefined;
  promoLabelTextColor?: string | null | undefined;
  madeToOrder?: boolean | null | undefined;
  madeToOrderMinQty?: number | null | undefined;
  // Вариативность рулон / метры (плёнка пузырчатая и т.п.)
  isCuttable?: boolean | null | undefined;
  cutMetersPerRoll?: number | null | undefined;
  cutPricePerMeter?: number | null | undefined;
  cutUnitName?: string | null | undefined;
  discountType?: "percent" | "fixed" | null | undefined;
  discountValue?: number | null | undefined;
  discountBadge?: string | null | undefined;
  /** Свой тип размеров товара (иначе — тип категории). */
  dimensionProfileId?: string | null | undefined;
  /** Размеры по профилю: [{key,label,value,unit}] — у каждого поля своя единица. */
  dimensionValues?: import("./dimension-profiles").DimensionValue[] | null | undefined;
  isVisible: boolean;
  isFeatured: boolean;
  /** Ручной порядок в блоке «Популярные товары» на главной. */
  featuredOrder?: number | null | undefined;
  /** Товар участвует в секции «Распродажа остатков» на главной. */
  isSale?: boolean | null | undefined;
  imageUrl?: string | null | undefined;
  images?: { url: string; publicId: string }[];
  viewCount?: number;
  averageRating?: number;
  totalReviews?: number;
  createdAt?: any;
  updatedAt?: any;
  // ── QR + штрихкод ──
  // Штрихкод EAN-13 (13 цифр, обычно с префиксом "200" — внутренний
  // диапазон магазина). ХРАНИТСЯ в БД (products.barcode) и
  // присваивается товару один раз — навсегда: не меняется ни при
  // каких правках товара, только вручную из карточки. У товаров,
  // созданных до появления колонки, значение может отсутствовать —
  // тогда на лету берётся детерминированный computeBarcode(id)
  // (ровно тот же код, что печатался на старых этикетках), а кнопка
  // «Обновить штрихкоды» дозаписывает его в БД.
  barcode?: string | null;
  // Короткий стабильный slug для URL сканирования (/q/{slug}).
  // Вычисляется детерминированно из id (см. lib/qr.ts).
  qrSlug?: string | null;
  // ── Связка карточек товаров (как на Ozon):
  //    каждый вариант — отдельная карточка товара со своим складом, SKU и ценой,
  //    а на витрине связанные карточки отображаются в одной карточке с мгновенным
  //    переключением без перезагрузки.
  linkGroupId?: string | null;
  isGroupPrimary?: boolean;
  linkedProductIds?: string[];
  linkedGroupTitle?: string | null;
  linkedVariantLabel?: string | null;
  linkedGroupLabels?: Record<string, string>;
  linkedCards?: import("./product-links").LinkedCardOption[];
  linkedGroupAnyInStock?: boolean;
}

export interface Promotion {
  id: string;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  imageUrl?: string | null;
  linkType: "product" | "url" | "none";
  productId?: string | null;
  linkUrl?: string | null;
  sortOrder: number;
  isVisible: boolean;
  createdAt?: any;
  // Additional fields for deal card display on main page
  icon?: string | null;
  color?: string | null;
  light?: string | null;
  deadline?: string | null;
  /** Показывать эту акцию поверх публичных страниц. */
  isPopup?: boolean | null;
  /** Локальные дата и время, начиная с которых окно можно показать. */
  popupStartAt?: string | null;
  /** Задержка после открытия страницы, в секундах. */
  popupDelaySeconds?: number | null;
  /** Сколько секунд окно остаётся на экране до автозакрытия. */
  popupDurationSeconds?: number | null;
}

export type PopupCampaignType = "banner" | "story";
export type PopupCampaignStyle = "info" | "promo" | "important";
export type PopupCampaignFrequency = "session" | "day" | "always";

export interface PopupCampaign {
  id: string;
  type: PopupCampaignType;
  title: string; // Internal name or banner title
  isActive: boolean;
  
  // Banner specific
  kicker?: string | null;
  description?: string | null;
  details?: string | null; // Bullets
  buttonText?: string | null;
  buttonUrl?: string | null;
  style?: PopupCampaignStyle;
  
  // Story specific
  imageUrl?: string | null;
  
  // Timing & Frequency
  startAt?: string | null;
  endAt?: string | null;
  delaySeconds: number;
  durationSeconds: number;
  frequency: PopupCampaignFrequency;
  
  sortOrder: number;
  createdAt?: any;
  updatedAt?: any;
}

export function getProductEffectivePrice(product: {
  price: number | null;
  discountType?: "percent" | "fixed" | null;
  discountValue?: number | null;
}): number | null {
  if (product.price == null) return null;
  if (!product.discountType || product.discountValue == null) return product.price;
  if (product.discountType === "percent") {
    return Math.max(0, Math.round(product.price * (1 - product.discountValue / 100)));
  }
  if (product.discountType === "fixed") {
    return Math.max(0, product.price - product.discountValue);
  }
  return product.price;
}

export interface OrderItem {
  productId: string;
  /** id варианта (если выбран). NULL — товар без вариантов */
  variantId?: string | null;
  /** Snapshot имени варианта (для бэкенда, чтобы не зависеть от
   *  переименований в админке). */
  variantName?: string | null;
  name: string;
  sku?: string | null;
  quantity: number;
  price: number;
}

export type OrderDeliveryType = "free" | "paid";

export interface FirestoreOrder {
  id: string;
  type: "order" | "inquiry";
  customerType: "individual" | "legal";
  customerName: string;
  customerPhone: string;
  /** Нормализованный телефон: 79XXXXXXXXX */
  customerPhoneDigits?: string | null;
  /** ID пользователя из коллекции users (если залогинен) */
  userId?: string | null;
  customerEmail?: string | null;
  // "telegram" — только для старых записей в БД: новые заявки этот способ
  // связи больше не предлагают (Telegram из проекта убран).
  communicationChannel: "telegram" | "whatsapp" | "max" | "call" | "email";
  paymentMethod?: "transfer" | "cash" | "invoice";
  items?: OrderItem[];
  totalSum?: number | null;
  productInfo?: string | null;
  quantity?: number | null;
  comment?: string | null;
  channel?: string | null;
  /**
   * Жизненный цикл заявки:
   * new (обработка) → in_progress (в работе) → ready (готов к выдаче)
   * → completed (проведена/архив) либо rejected (отменена).
   * Статусы синхронизированы между сайтом и личным кабинетом клиента.
   */
  status: "new" | "in_progress" | "ready" | "in_delivery" | "issued" | "completed" | "rejected";
  closeReason?: string | null;
  /** Короткий код выдачи заказа (для поиска на вкладке «Выдача товара») */
  pickupCode?: string | null;
  /** Когда товар выдан клиенту */
  issuedAt?: string | null;
  /** Связь с учётом: создаётся при «Передать в работу» */
  dealId?: string | null;
  dealNumber?: number | null;
  paymentId?: string | null;
  /** Адрес доставки (от клиента или из админки) */
  deliveryAddress?: string | null;
  /** Есть ли доставка у заказа */
  hasDelivery?: boolean;
  /** Бесплатная или платная */
  deliveryType?: OrderDeliveryType | null;
  /** Стоимость платной доставки, ₽ */
  deliveryCost?: number | null;
  /** Запланированная дата доставки YYYY-MM-DD */
  deliveryPlannedDate?: string | null;
  /** Когда заказ отпущен/доставлен */
  deliveryReleasedAt?: string | null;
  /** Заметка курьеру / по доставке */
  deliveryNote?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

// ===== NEW TYPES FOR PRODUCT INTERACTIONS =====

export interface ProductReview {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  orderId: string; // Reference to order to verify purchase
  rating: number; // 1-5 stars
  title?: string | null;
  text: string;
  pros?: string | null;
  cons?: string | null;
  images?: { url: string; publicId: string }[];
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  createdAt: any;
  updatedAt?: any;
  // Admin moderation
  isApproved: boolean;
  moderationStatus: "pending" | "approved" | "rejected";
  moderationNote?: string | null;
}

export interface ProductQuestion {
  id: string;
  productId: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  question: string;
  answer?: string | null;
  answerAuthor?: string | null; // "seller" | "user" | "admin"
  answeredAt?: any;
  isAnswered: boolean;
  helpfulCount: number;
  createdAt: any;
  updatedAt?: any;
  // Admin moderation
  isApproved: boolean;
  moderationStatus: "pending" | "approved" | "rejected";
  moderationNote?: string | null;
}

export interface ProductRating {
  productId: string;
  averageRating: number; // 0-5
  totalReviews: number;
  ratingDistribution: {
    5: number;
    4: number;
    3: number;
    2: number;
    1: number;
  };
  updatedAt: any;
}

export interface ProductView {
  id: string;
  productId: string;
  userId?: string | null; // null for anonymous
  sessionId: string; // For tracking unique views
  ipHash?: string | null; // Hashed IP for anonymous deduplication
  userAgent?: string | null;
  referrer?: string | null;
  viewedAt: any;
}

export interface UserProductView {
  productId: string;
  viewCount: number;
  lastViewedAt: any;
}

// ── Вариативность рулон / метры: хелперы отображения остатка ────────

export function getCuttableStockBreakdown(stockRolls: number | null | undefined, metersPerRoll: number | null | undefined) {
  const rolls = Math.max(0, Number(stockRolls) || 0);
  const mpr = Math.max(0, Number(metersPerRoll) || 0);
  if (!mpr) {
    return { fullRolls: Math.floor(rolls), remainderMeters: 0, totalMeters: rolls, rolls };
  }
  const fullRolls = Math.floor(rolls + 1e-9);
  const remainderFraction = rolls - fullRolls;
  const remainderMeters = Math.round(remainderFraction * mpr * 100) / 100;
  const totalMeters = Math.round(rolls * mpr * 100) / 100;
  return { fullRolls, remainderMeters, totalMeters, rolls };
}

export function formatCuttableStock(stockRolls: number | null | undefined, metersPerRoll: number | null | undefined, unitName?: string | null): string {
  const { fullRolls, remainderMeters, totalMeters } = getCuttableStockBreakdown(stockRolls, metersPerRoll);
  const u = unitName || 'м';
  if (!metersPerRoll) return `${Number(stockRolls || 0).toLocaleString('ru-RU')} шт.`;
  if (remainderMeters > 0.009) {
    return `${fullRolls} рул. + ${remainderMeters} ${u} (${totalMeters} ${u} всего)`;
  }
  return `${fullRolls} рул. · ${totalMeters} ${u}`;
}
