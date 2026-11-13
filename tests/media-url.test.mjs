// =========================================================
// FILE: tests/media-url.test.mjs
// Тесты перевода внешних картинок на собственный домен (/media/...).
// =========================================================

import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  toSameOriginMediaUrl,
  toAbsoluteMediaUrl,
  localizeMediaDeep,
} from "@/lib/media";
import { buildUpstreamUrl } from "@/lib/media-proxy";

test("ссылки Cloudinary переводятся в /media/cloudinary/...", () => {
  assert.equal(
    toSameOriginMediaUrl(
      "https://res.cloudinary.com/mycloud/image/upload/v1712345678/sibgofrotorg/products/korob.jpg"
    ),
    "/media/cloudinary/mycloud/image/upload/v1712345678/sibgofrotorg/products/korob.jpg"
  );
});

test("ссылки Unsplash переводятся в /media/unsplash/... с параметрами", () => {
  assert.equal(
    toSameOriginMediaUrl(
      "https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=1400&q=80"
    ),
    "/media/unsplash/photo-1532996122724-e3c354a0b15b?w=1400&q=80"
  );
});

test("локальные файлы и посторонние ссылки не меняются", () => {
  assert.equal(toSameOriginMediaUrl("/icon-192.png"), "/icon-192.png");
  assert.equal(
    toSameOriginMediaUrl("/media/cloudinary/image/upload/a.jpg"),
    "/media/cloudinary/image/upload/a.jpg"
  );
  assert.equal(
    toSameOriginMediaUrl("https://example.com/photo.jpg"),
    "https://example.com/photo.jpg"
  );
  assert.equal(toSameOriginMediaUrl(""), "");
  assert.equal(toSameOriginMediaUrl(null), "");
});

test("og:image и JSON-LD получают абсолютный адрес нашего домена", () => {
  assert.equal(
    toAbsoluteMediaUrl(
      "https://res.cloudinary.com/mycloud/image/upload/v1/a.jpg",
      "https://sibgofrotorg.ru"
    ),
    "https://sibgofrotorg.ru/media/cloudinary/mycloud/image/upload/v1/a.jpg"
  );
  assert.equal(
    toAbsoluteMediaUrl("https://example.com/a.jpg", "https://sibgofrotorg.ru"),
    "https://example.com/a.jpg"
  );
  assert.equal(toAbsoluteMediaUrl(null, "https://sibgofrotorg.ru"), undefined);
});

test("localizeMediaDeep чистит данные страницы, но не трогает обычные ссылки", () => {
  const localized = localizeMediaDeep({
    products: [
      {
        name: "Короб",
        imageUrl: "https://res.cloudinary.com/mycloud/image/upload/v1/p/a.jpg",
        images: [{ url: "https://res.cloudinary.com/mycloud/image/upload/v1/p/b.jpg" }],
        link: "https://sibgofrotorg.ru/catalog",
      },
    ],
    channel: { iconUrl: "https://images.unsplash.com/photo-1?w=40" },
  });

  assert.equal(
    localized.products[0].imageUrl,
    "/media/cloudinary/mycloud/image/upload/v1/p/a.jpg"
  );
  assert.equal(
    localized.products[0].images[0].url,
    "/media/cloudinary/mycloud/image/upload/v1/p/b.jpg"
  );
  assert.equal(localized.products[0].link, "https://sibgofrotorg.ru/catalog");
  assert.equal(localized.channel.iconUrl, "/media/unsplash/photo-1?w=40");
});

test("апстрим для Cloudinary собирается с размерами и известным хостом", () => {
  assert.equal(
    buildUpstreamUrl(
      "cloudinary",
      "mycloud/image/upload/v17/sibgofrotorg/products/korob.jpg",
      640,
      75,
      "mycloud"
    ),
    "https://res.cloudinary.com/mycloud/image/upload/w_640,q_75,f_auto,c_limit/v17/sibgofrotorg/products/korob.jpg"
  );
  assert.equal(
    buildUpstreamUrl("unsplash", "photo-1532996122724-e3c354a0b15b", 828, 75, null),
    "https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=828&q=75&fit=max"
  );
});

test("неизвестные источники и опасные пути не превращаются в запрос", () => {
  assert.equal(
    buildUpstreamUrl("cloudinary", "image/upload/a.jpg", 100, 75, "mycloud"),
    null,
    "имя облака в пути обязательно"
  );
  assert.equal(
    buildUpstreamUrl(
      "cloudinary",
      "othercloud/image/upload/a.jpg",
      100,
      75,
      "mycloud"
    ),
    null,
    "чужое облако не проксируется"
  );
  assert.equal(
    buildUpstreamUrl("cloudinary", "mycloud/evil/path.jpg", 100, 75, "mycloud"),
    null,
    "путь вне image/upload/ отклоняется"
  );
  assert.equal(
    buildUpstreamUrl("other", "x.jpg", 100, 75, "mycloud"),
    null,
    "только хосты из белого списка"
  );
});

test("фото из загрузчика проходит полный путь /media → Cloudinary без блокировки CSP", () => {
  // Ровно такую форму возвращает /api/admin/upload (result.secure_url): имя облака,
  // image/upload/, версия, папка sibgofrotorg/products/….
  const secureUrl =
    "https://res.cloudinary.com/demo123/image/upload/v1763000000/sibgofrotorg/products/generated/gk-1_1763000000.png";
  const mapped = toSameOriginMediaUrl(secureUrl);
  assert.equal(
    mapped,
    "/media/cloudinary/demo123/image/upload/v1763000000/sibgofrotorg/products/generated/gk-1_1763000000.png"
  );
  // Имя облака из пути должно совпадать с NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  // иначе прокси отдаёт 404 и в конструкторе фото не появится.
  assert.equal(
    buildUpstreamUrl("cloudinary", mapped.slice("/media/cloudinary/".length), 800, 75, "demo123"),
    "https://res.cloudinary.com/demo123/image/upload/w_800,q_75,f_auto,c_limit/v1763000000/sibgofrotorg/products/generated/gk-1_1763000000.png"
  );
  assert.equal(buildUpstreamUrl("cloudinary", mapped.slice("/media/cloudinary/".length), null, null, "another-cloud"), null);
  // Повторный вызов безопасен: уже внутренний путь не меняется.
  assert.equal(toSameOriginMediaUrl(mapped), mapped);
});

test("конструктор фото грузит картинки только через собственный /media", () => {
  // CSP запрещает img-src для чужих хостов (src/proxy.ts), поэтому canvas обязан
  // получать внутренний путь — иначе загрузка в Cloudinary есть, а картинки нет.
  const source = fs.readFileSync("src/components/admin/PhotoTemplateGenerator.tsx", "utf8");
  const loader = /function loadImage\(src: string\)[\s\S]*?\n}/.exec(source);
  assert.ok(loader, "не найден loadImage");
  assert.match(loader[0], /toSameOriginMediaUrl\(src\)/, "loadImage обязан прогонять адрес через /media");
  assert.match(loader[0], /img\.src = url/, "в Image нужно отдавать уже переведённый адрес");
  const csp = fs.readFileSync("src/proxy.ts", "utf8");
  assert.match(csp, /img-src 'self' data: blob:/, "CSP: внешних CDN в img-src нет");
  assert.doesNotMatch(csp, /img-src[^"]*cloudinary/, "Cloudinary не должен попадать в img-src");
});
