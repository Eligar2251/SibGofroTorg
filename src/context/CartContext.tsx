"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Позиция в корзине. Если у товара есть варианты (цвет/размер),
 * `variantId` непустой — именно он идентифицирует позицию вместе
 * с `productId`. У одного и того же товара в разных вариантах —
 * две разные строки в корзине.
 *
 * `variantName` хранится для UI (например «Ящик 670 / красный»)
 * и для бэкенда (в заказе мы храним snapshot, чтобы потом название
 * не «сломалось», если админ переименует вариант).
 */
export interface CartItem {
  productId: string;
  variantId?: string | null;
  variantName?: string | null;
  name: string;
  sku?: string | null;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  maxStock?: number | null;
}

/**
 * Событие «только что добавлено в корзину» — используется попапом
 * при добавлении товара, чтобы показать товар и кнопку «Перейти в корзину».
 */
export interface LastAddedItem {
  productId: string;
  name: string;
  imageUrl?: string | null;
  price: number;
  qty: number;
}

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  removeFromCart: (productId: string, variantId?: string | null) => void;
  updateQty: (productId: string, qty: number, variantId?: string | null) => void;
  clearCart: () => void;
  lastAdded: LastAddedItem | null;
  clearLastAdded: () => void;
  /** Плавающая корзина + попап над ней: только после добавления товара. */
  cartDockOpen: boolean;
  openCartDock: (item?: LastAddedItem) => void;
  hideCartDock: () => void;
  rawSubtotal: number;
  discountPercent: number;
  discountAmount: number;
  totalSum: number;
  totalItems: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

/**
 * Уникальный ключ позиции корзины. Учитывает вариант: один и тот
 * же товар в разных вариантах — это две разные строки.
 */
function cartItemKey(item: Pick<CartItem, "productId" | "variantId">): string {
  return `${item.productId}::${item.variantId || ""}`;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [lastAdded, setLastAdded] = useState<LastAddedItem | null>(null);
  // Не пишем в localStorage: после перезагрузки док не должен висеть «просто так».
  const [cartDockOpen, setCartDockOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sib_cart");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as CartItem[];
        // Обратная совместимость: в старой корзине не было
        // variantId — ставим пустую строку, чтобы ключ
        // совпадал с «товар без варианта».
        const normalized = (parsed || []).map((it) => ({
          ...it,
          variantId: it.variantId ?? null,
          variantName: it.variantName ?? null,
        }));
        setCart(normalized);
      } catch (e) {
        console.error("Ошибка парсинга корзины", e);
      }
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem("sib_cart", JSON.stringify(cart));
    }
  }, [cart, isLoaded]);

  const openCartDock = useCallback((item?: LastAddedItem) => {
    if (item) setLastAdded(item);
    setCartDockOpen(true);
  }, []);

  const hideCartDock = useCallback(() => {
    setLastAdded(null);
    setCartDockOpen(false);
  }, []);

  const addToCart = (product: Omit<CartItem, "quantity">, qty = 1) => {
    const addedQty = Math.max(1, Math.round(qty));
    const incomingKey = cartItemKey(product);
    const existing = cart.find((item) => cartItemKey(item) === incomingKey);
    let lineQty = addedQty;
    if (existing) {
      const newQty = existing.quantity + addedQty;
      lineQty = product.maxStock != null ? Math.min(newQty, product.maxStock) : newQty;
    } else if (product.maxStock != null) {
      lineQty = Math.min(addedQty, product.maxStock);
    }

    setCart((prev) => {
      const current = prev.find((item) => cartItemKey(item) === incomingKey);
      if (current) {
        const newQty = current.quantity + addedQty;
        const finalQty = product.maxStock != null ? Math.min(newQty, product.maxStock) : newQty;
        return prev.map((item) =>
          cartItemKey(item) === incomingKey ? { ...item, quantity: finalQty } : item
        );
      }
      const initialQty =
        product.maxStock != null ? Math.min(addedQty, product.maxStock) : addedQty;
      return [...prev, { ...product, quantity: initialQty }];
    });

    // Попап над плавающей корзиной: количество этой позиции и сумма корзины.
    // Не закрывается сам — только крестиком или переходом в корзину.
    openCartDock({
      productId: product.productId,
      name: product.name,
      imageUrl: product.imageUrl ?? null,
      price: product.price,
      qty: lineQty,
    });
  };

  const removeFromCart = (productId: string, variantId?: string | null) => {
    setCart((prev) =>
      prev.filter(
        (item) =>
          !(item.productId === productId && (item.variantId ?? null) === (variantId ?? null))
      )
    );
  };

  const updateQty = (productId: string, qty: number, variantId?: string | null) => {
    setCart((prev) =>
      prev.map((item) => {
        if (
          item.productId === productId &&
          (item.variantId ?? null) === (variantId ?? null)
        ) {
          const finalQty = Math.max(1, qty);
          const validatedQty = item.maxStock != null ? Math.min(finalQty, item.maxStock) : finalQty;
          return { ...item, quantity: validatedQty };
        }
        return item;
      })
    );
  };

  const clearCart = () => {
    setCart([]);
    hideCartDock();
  };

  const clearLastAdded = hideCartDock;

  useEffect(() => {
    if (isLoaded && cart.length === 0) {
      hideCartDock();
    }
  }, [cart.length, isLoaded, hideCartDock]);

  const rawSubtotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0);

  // Автоматическая скидка за объём заказа (информирование клиента):
  // От 25,000 ₽ -> 10%
  // От 20,000 ₽ до 24,999 ₽ -> 5%
  let discountPercent = 0;
  if (rawSubtotal >= 25000) {
    discountPercent = 10;
  } else if (rawSubtotal >= 20000) {
    discountPercent = 5;
  }

  const discountAmount = Math.round((rawSubtotal * discountPercent) / 100);
  const totalSum = Math.max(0, rawSubtotal - discountAmount);

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        updateQty,
        clearCart,
        lastAdded,
        clearLastAdded,
        cartDockOpen,
        openCartDock,
        hideCartDock,
        rawSubtotal,
        discountPercent,
        discountAmount,
        totalSum,
        totalItems,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
