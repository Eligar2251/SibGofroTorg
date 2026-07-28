export interface FirestoreCategory {
  id: string;
  name: string;
  slug: string;
  icon?: string | null | undefined;
  description?: string | null | undefined;
  sortOrder?: number | null | undefined;
  isVisible?: boolean | null | undefined;
  imageUrl?: string | null | undefined;
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
  priceWholesale?: number | null | undefined;
  minWholesaleQty?: number | null | undefined;
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
  madeToOrder?: boolean | null | undefined;
  discountType?: "percent" | "fixed" | null | undefined;
  discountValue?: number | null | undefined;
  discountBadge?: string | null | undefined;
  isVisible: boolean;
  isFeatured: boolean;
  imageUrl?: string | null | undefined;
  images?: { url: string; publicId: string }[];
  viewCount?: number;
  averageRating?: number;
  totalReviews?: number;
  createdAt?: any;
  updatedAt?: any;
  // ── QR + штрихкод ──
  // Стабильные коды, вычисляются детерминированно из `id` (см.
  // lib/qr.ts). Никогда не меняются при правке товара — даже если
  // переименовали, поменяли цену или категорию, QR остаётся тот же.
  // В БД не хранятся — генерируются на лету из `id`.
  // EAN-13 13 цифр, начинается с "200" (внутренний префикс магазина,
  // не конфликтует с реальными EAN стран).
  barcode?: string | null;
  // Короткий стабильный slug для URL сканирования (/admin/scan/{slug}).
  qrSlug?: string | null;
  // ── Сводные данные по вариантам (если они у товара есть).
  //    Используются в каталоге, чтобы показать диапазон цен
  //    «от X ₽» и сводный остаток. Не хранятся в products —
  //    считаются на лету из product_variants.
  variantCount?: number;
  hasVariants?: boolean;
  variantPriceMin?: number | null;
  variantPriceMax?: number | null;
  variantTotalStock?: number;
  // Список вариантов, который тянется на страницу товара и в админку.
  // На публичных карточках каталога — пустой (там нужны только
  // сводные min/max).
  variants?: ProductVariant[];
}

/**
 * Один вариант товара (цвет, размер, формат упаковки и т.п.).
 *
 * Хранится в отдельной таблице `product_variants`, чтобы у товара
 * могло быть несколько SKU/цен/остатков под одним карточным
 * «родителем». На странице товара клиент видит чипы с цветами/
 * размерами, в каталоге — диапазон «от X ₽».
 *
 * NULL-значения цены/SKU/размеров означают fallback на products.
 */
export interface ProductVariant {
  id: string;
  productId: string;
  /** Название: «красный», «XL», «пачка 50 шт.» */
  name: string;
  /** Группа: «color», «size», «pack», «material», или пустая */
  optionType: string;
  /** HEX цвета (если это цвет) — для кружочка на чипе */
  colorHex?: string | null;
  sortOrder: number;
  price: number | null;
  priceWholesale: number | null;
  sku: string | null;
  stockQty: number;
  stockWarnQty?: number | null;
  /** true → есть в наличии (для быстрой фильтрации) */
  inStock: boolean;
  images: { url: string; publicId: string }[];
  imageUrl: string | null;
  dimensionLength?: number | null;
  dimensionWidth?: number | null;
  dimensionHeight?: number | null;
  dimensionUnit?: string | null;
  weight?: number | null;
  packQty?: number | null;
  isVisible: boolean;
  createdAt?: any;
  updatedAt?: any;
}

/**
 * Объединённый остаток: variant + product. Используется в
 * каталоге, корзине и форме оформления — везде, где клиент видит
 * «этот товар + этот вариант». NULL-поля = берём с products.
 */
export interface ResolvedVariant {
  variant: ProductVariant;
  /** Эффективная цена (variant.price || product.price) */
  price: number | null;
  /** Эффективный wholesale (variant.priceWholesale || product.priceWholesale) */
  priceWholesale: number | null;
  /** Эффективный sku (variant.sku || product.sku) */
  sku: string | null;
  /** Эффективный остаток */
  stockQty: number;
  /** Эффективный imageUrl (variant.imageUrl || product.imageUrl) */
  imageUrl: string | null;
  /** Эффективные размеры */
  dimensionLength: number | null;
  dimensionWidth: number | null;
  dimensionHeight: number | null;
  dimensionUnit: string | null;
  /** Эффективный pack_qty */
  packQty: number | null;
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

/**
 * Разрешает вариант: где NULL — берёт поле с products.
 * Используется в каталоге, корзине, оформлении и админке —
 * единая точка «смешивания» variant + product.
 */
export function resolveVariant(
  variant: ProductVariant,
  product: Pick<
    FirestoreProduct,
    | "price"
    | "priceWholesale"
    | "sku"
    | "imageUrl"
    | "images"
    | "stockQty"
    | "dimensionLength"
    | "dimensionWidth"
    | "dimensionHeight"
    | "dimensionUnit"
    | "packQty"
  >,
): ResolvedVariant {
  return {
    variant,
    price: variant.price ?? product.price ?? null,
    priceWholesale:
      variant.priceWholesale ?? product.priceWholesale ?? null,
    sku: variant.sku ?? product.sku ?? null,
    stockQty:
      variant.stockQty > 0
        ? variant.stockQty
        : product.stockQty ?? 0,
    imageUrl: variant.imageUrl ?? product.imageUrl ?? null,
    dimensionLength: variant.dimensionLength ?? product.dimensionLength ?? null,
    dimensionWidth: variant.dimensionWidth ?? product.dimensionWidth ?? null,
    dimensionHeight:
      variant.dimensionHeight ?? product.dimensionHeight ?? null,
    dimensionUnit: variant.dimensionUnit ?? product.dimensionUnit ?? null,
    packQty: variant.packQty ?? product.packQty ?? null,
  };
}

/**
 * Эффективная цена «после скидки» — учитывает скидку с product
 * (discount_type/value), даже если цена пришла из варианта.
 * Скидка одна на товар-родитель и применяется ко всем его
 * вариантам (как на маркетплейсах).
 */
export function getEffectiveVariantPrice(
  variant: ProductVariant,
  product: Pick<
    FirestoreProduct,
    "price" | "discountType" | "discountValue"
  >,
): number | null {
  const raw = variant.price ?? product.price;
  return getProductEffectivePrice({
    price: raw,
    discountType: product.discountType,
    discountValue: product.discountValue,
  });
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
  communicationChannel: "telegram" | "whatsapp" | "max" | "call" | "email";
  paymentMethod?: "transfer" | "cash" | "invoice";
  items?: OrderItem[];
  totalSum?: number | null;
  productInfo?: string | null;
  quantity?: number | null;
  comment?: string | null;
  channel?: string | null;
  status: "new" | "in_progress" | "completed" | "rejected";
  closeReason?: string | null;
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
