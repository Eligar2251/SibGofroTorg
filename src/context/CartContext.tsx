"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export interface CartItem {
  productId: string;
  name: string;
  sku?: string | null;
  price: number;
  quantity: number;
  imageUrl?: string | null;
  maxStock?: number | null;
}

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  clearCart: () => void;
  rawSubtotal: number;
  discountPercent: number;
  discountAmount: number;
  totalSum: number;
  totalItems: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("sib_cart");
    if (saved) {
      try {
        setCart(JSON.parse(saved));
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

  const addToCart = (product: Omit<CartItem, "quantity">, qty = 1) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.productId);
      if (existing) {
        const newQty = existing.quantity + qty;
        const finalQty = product.maxStock != null ? Math.min(newQty, product.maxStock) : newQty;
        return prev.map((item) =>
          item.productId === product.productId ? { ...item, quantity: finalQty } : item
        );
      }
      return [...prev, { ...product, quantity: qty }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const updateQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.productId === productId) {
          const finalQty = Math.max(1, qty);
          const validatedQty = item.maxStock != null ? Math.min(finalQty, item.maxStock) : finalQty;
          return { ...item, quantity: validatedQty };
        }
        return item;
      })
    );
  };

  const clearCart = () => setCart([]);

  const rawSubtotal = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0);

  // Скидки рассчитываются вручную в админке, автоматических скидок нет
  const discountPercent = 0;
  const discountAmount = 0;
  const totalSum = rawSubtotal;

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        removeFromCart,
        updateQty,
        clearCart,
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
