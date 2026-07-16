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
  stockQty?: number | null | undefined; // Остаток на складе (баланс)
  isPromo: boolean;
  promoLabel?: string | null | undefined;
  isVisible: boolean;
  isFeatured: boolean;
  imageUrl?: string | null | undefined;
  images?: { url: string; publicId: string }[];
  createdAt?: any;
  updatedAt?: any;
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
  type: "order" | "inquiry"; // Заказ (с точными позициями) или Заявка (общий запрос)
  customerType: "individual" | "legal"; // Физ. лицо или Юр. лицо
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null; // Почта (обязательна для Юр. лиц)
  communicationChannel: "telegram" | "whatsapp" | "max" | "call" | "email"; // Способ связи
  paymentMethod?: "transfer" | "cash" | "invoice"; // Способ оплаты
  
  // Для Заказа (type: "order")
  items?: OrderItem[];
  totalSum?: number;

  // Для Заявки (type: "inquiry")
  productInfo?: string | null;
  quantity?: number | null;
  
  comment?: string | null;
  channel?: string | null; // Источник (сайт/бот)
  status: "new" | "in_progress" | "completed" | "rejected";
  createdAt?: any;
  updatedAt?: any;
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