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
  name: string;
  sku?: string | null;
  quantity: number;
  price: number;
}

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
  totalSum?: number;
  productInfo?: string | null;
  quantity?: number | null;
  comment?: string | null;
  channel?: string | null;
  status: "new" | "in_progress" | "completed" | "rejected";
  closeReason?: string | null;
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
