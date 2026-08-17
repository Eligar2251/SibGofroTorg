import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function NotFound() {
  return (
    <section className="py-32 lg:py-40 bg-paper corrugation-bg">
      <div className="container-wide max-w-xl text-center">
        <div className="font-display text-[8rem] lg:text-[12rem] text-stone leading-none select-none mb-4">
          404
        </div>
        <h1 className="font-display text-2xl lg:text-3xl text-ink mb-4">
          Страница не найдена
        </h1>
        <p className="text-slate font-light mb-10">
          Запрошенная страница не существует или была перемещена.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="btn-primary">
            На главную
          </Link>
          <Link href="/catalog" className="btn-outline">
            Каталог <ArrowRight size={14} />
          </Link>
        </div>
        {/* Популярные разделы — быстрый выход на живые страницы */}
        <div className="mt-10 text-sm text-slate flex flex-wrap gap-x-5 gap-y-2 justify-center">
          <Link href="/gofrotara" className="underline underline-offset-4 hover:text-ink">Гофротара оптом</Link>
          <Link href="/korobki-dlya-pereezda" className="underline underline-offset-4 hover:text-ink">Коробки для переезда</Link>
          <Link href="/korobki-dlya-marketplejsov" className="underline underline-offset-4 hover:text-ink">Коробки для WB и Ozon</Link>
          <Link href="/korobki-na-zakaz" className="underline underline-offset-4 hover:text-ink">Коробки на заказ</Link>
          <Link href="/search" className="underline underline-offset-4 hover:text-ink">Подбор по размеру</Link>
        </div>
      </div>
    </section>
  );
}