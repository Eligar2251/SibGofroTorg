// =========================================================
// FILE: src/components/ui/Glyph.tsx
// =========================================================
// Единая точка иконок сайта. Вместо эмодзи в разметке и в данных
// (иконки категорий/акций хранятся в Firestore строками) используем
// SVG-иконки lucide. `GlyphIcon` принимает либо имя токена ("box"),
// либо legacy-эмодзи из базы ("📦") и рисует подходящую SVG-иконку.

import {
  AlertTriangle,
  Banknote,
  Bell,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  Coins,
  CreditCard,
  Factory,
  FileText,
  Flame,
  FolderOpen,
  Gift,
  Handshake,
  Hash,
  Lightbulb,
  Link2,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Megaphone,
  Menu,
  MessageCircle,
  MessagesSquare,
  NotebookPen,
  Package,
  Pencil,
  PenLine,
  Phone,
  Plus,
  Radio,
  ReceiptText,
  Recycle,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Star,
  Trash2,
  Truck,
  User,
  Users,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

/* Именные токены (так хранятся новые данные) */
const NAME_MAP: Record<string, LucideIcon> = {
  box: Package,
  star: Star,
  phone: Phone,
  mail: Mail,
  chat: MessageCircle,
  chats: MessagesSquare,
  send: Send,
  card: CreditCard,
  cash: Banknote,
  receipt: ReceiptText,
  building: Building2,
  user: User,
  users: Users,
  clipboard: ClipboardList,
  settings: Settings,
  flame: Flame,
  gift: Gift,
  truck: Truck,
  recycle: Recycle,
  zap: Zap,
  file: FileText,
  books: BookOpen,
  trash: Trash2,
  link: Link2,
  warning: AlertTriangle,
  ok: CheckCircle2,
  cancel: XCircle,
  check: Check,
  x: X,
  pencil: Pencil,
  penline: PenLine,
  plus: Plus,
  folder: FolderOpen,
  megaphone: Megaphone,
  handshake: Handshake,
  factory: Factory,
  bulb: Lightbulb,
  coins: Coins,
  lock: Lock,
  shield: ShieldCheck,
  search: Search,
  pin: MapPin,
  menu: Menu,
  cart: ShoppingCart,
  bell: Bell,
  hash: Hash,
  radio: Radio,
  note: NotebookPen,
  loader: Loader2,
};

/* Legacy-эмодзи из базы → токен (вариационный селектор FE0F срезаем) */
const EMOJI_MAP: Record<string, string> = {
  "📦": "box",
  "⭐": "star",
  "★": "star",
  "📞": "phone",
  "✉": "mail",
  "💬": "chat",
  "✈": "send",
  "💳": "card",
  "💵": "cash",
  "🧾": "receipt",
  "🏢": "building",
  "👤": "user",
  "👥": "users",
  "📋": "clipboard",
  "⚙": "settings",
  "🔥": "flame",
  "🎁": "gift",
  "🚚": "truck",
  "♻": "recycle",
  "⚡": "zap",
  "📄": "file",
  "📚": "books",
  "🗑": "trash",
  "🔗": "link",
  "⚠": "warning",
  "✅": "ok",
  "❌": "cancel",
  "✓": "check",
  "✕": "x",
  "✏": "pencil",
  "✍": "penline",
  "➕": "plus",
  "📂": "folder",
  "📢": "megaphone",
  "🤝": "handshake",
  "🏭": "factory",
  "💡": "bulb",
  "💰": "coins",
  "🔒": "lock",
  "🔐": "shield",
  "🔍": "search",
  "📍": "pin",
  "☰": "menu",
  "🛒": "cart",
  "🔔": "bell",
  "🔢": "hash",
  "📡": "radio",
  "📝": "note",
  "⏳": "loader",
};

export function resolveGlyph(value?: string | null): LucideIcon | null {
  if (!value) return null;
  const clean = value.replace(/️/g, "").trim(); // срезаем variation selector
  if (NAME_MAP[clean]) return NAME_MAP[clean];
  const token = EMOJI_MAP[clean];
  if (token) return NAME_MAP[token];
  const first = EMOJI_MAP[[...clean][0]];
  if (first) return NAME_MAP[first];
  return null;
}

export function GlyphIcon({
  value,
  size = 16,
  className,
  fallback = Package,
}: {
  value?: string | null;
  size?: number;
  className?: string;
  /** Иконка по умолчанию; null — не рисовать ничего */
  fallback?: LucideIcon | null;
}) {
  const Icon = resolveGlyph(value) ?? fallback;
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      className={className}
      strokeWidth={2}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    />
  );
}

/* Списки для селектов в админке (CategoryManager / PromotionsManager) */
export const GLYPH_CHOICES: { token: string; label: string }[] = [
  { token: "box", label: "Коробка" },
  { token: "truck", label: "Доставка" },
  { token: "recycle", label: "Макулатура" },
  { token: "zap", label: "Молния" },
  { token: "gift", label: "Подарок" },
  { token: "star", label: "Звезда" },
  { token: "flame", label: "Огонь / Хит" },
  { token: "file", label: "Документ" },
  { token: "books", label: "Книги" },
  { token: "trash", label: "Смешанная" },
  { token: "card", label: "Карта" },
  { token: "cash", label: "Наличные" },
  { token: "receipt", label: "Чек / Счёт" },
  { token: "building", label: "Компания" },
  { token: "user", label: "Человек" },
  { token: "users", label: "Люди" },
  { token: "phone", label: "Телефон" },
  { token: "mail", label: "Почта" },
  { token: "chat", label: "Сообщение" },
  { token: "cart", label: "Корзина" },
  { token: "pin", label: "Метка" },
  { token: "megaphone", label: "Акция" },
  { token: "handshake", label: "Партнёрство" },
  { token: "factory", label: "Завод" },
  { token: "coins", label: "Деньги" },
  { token: "bulb", label: "Идея" },
  { token: "clipboard", label: "Список" },
];
