// =========================================================
// FILE: tests/media-route.test.mjs
// Тесты прокси изображений (/media/<source>/...).
//
// Проверяем без сети: global fetch подменяется заглушкой, поэтому тест
// не зависит от доступности Cloudinary/Unsplash и работает в CI.
//
// Запуск: npm run test:media
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

import { GET } from "@/app/media/[...path]/route";

/** Запрос-заглушка: обработчику нужен только URL. */
function mockRequest(url) {
  return { url };
}

/** Ответ-заглушка апстрима. */
function imageResponse(body = "image-bytes", contentType = "image/png") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(body.length) },
  });
}

function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = original;
  });
}

const params = (segments) => Promise.resolve({ path: segments });

test("картинка отдаётся с нашего домена, апстрим — только известный хост", async () => {
  let requested = null;
  await withFetch(
    async (url) => {
      requested = String(url);
      return imageResponse();
    },
    async () => {
      const response = await GET(
        mockRequest(
          "http://localhost/media/cloudinary/demo/image/upload/sample.jpg?w=200&q=75"
        ),
        { params: params(["cloudinary", "demo", "image", "upload", "sample.jpg"]) }
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.match(
        response.headers.get("cache-control") || "",
        /immutable/
      );
    }
  );

  // Параметры ширины/качества превращаются в трансформацию Cloudinary.
  assert.match(
    requested,
    /^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/w_200,q_75,f_auto,c_limit\/sample\.jpg$/
  );
});

test("неизвестный источник, мусорный путь и обход каталога отклоняются", async () => {
  await withFetch(
    async () => {
      throw new Error("апстрим не должен вызываться");
    },
    async () => {
      const unknown = await GET(mockRequest("http://localhost/media/vk/photo.jpg"), {
        params: params(["vk", "photo.jpg"]),
      });
      assert.equal(unknown.status, 404);

      const traversal = await GET(
        mockRequest("http://localhost/media/unsplash/..%2F..%2Fsecret"),
        { params: params(["unsplash", "..", "..", "secret"]) }
      );
      assert.equal(traversal.status, 400);

      const noPath = await GET(mockRequest("http://localhost/media/cloudinary"), {
        params: params(["cloudinary"]),
      });
      assert.equal(noPath.status, 404);
    }
  );
});

test("чужое облако Cloudinary не проксируется, когда имя облака задано", async () => {
  const original = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "ourcloud";
  try {
    await withFetch(
      async () => {
        throw new Error("апстрим не должен вызываться");
      },
      async () => {
        const response = await GET(
          mockRequest("http://localhost/media/cloudinary/othercloud/image/upload/a.jpg"),
          { params: params(["cloudinary", "othercloud", "image", "upload", "a.jpg"]) }
        );
        assert.equal(response.status, 404);
      }
    );
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    else process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = original;
  }
});

test("не-картинка от апстрима не отдаётся посетителю", async () => {
  await withFetch(
    async () => imageResponse("<html>not an image</html>", "text/html"),
    async () => {
      const response = await GET(
        mockRequest("http://localhost/media/unsplash/photo-1?w=640"),
        { params: params(["unsplash", "photo-1"]) }
      );
      assert.equal(response.status, 404);
    }
  );
});
