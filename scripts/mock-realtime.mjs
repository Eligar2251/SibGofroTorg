// =========================================================
// scripts/mock-realtime.mjs
// Мини-мок Supabase Realtime для сквозного теста SSE-контура
// (реально запустить сам Supabase в песочнице нельзя).
//
// Протокол (phoenix-совместимый, по @supabase/realtime-js):
//   phx_join  → phx_reply {ok, postgres_changes:[{id, ...}]}
//   heartbeat → rep {ok}
// Потом сервер пушит postgres_changes-события — скрипт сам,
// через N секунд после старта, «вставляет» заказ в orders
// и «обновляет» зарплату в salaries, а по Ctrl+C — ничего.
//
// Запуск: node scripts/mock-realtime.mjs [port]
// =========================================================

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.argv[2] || 3200);
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ── минимальные WS-фреймы ────────────────────────────────
function encodeText(str) {
  const payload = Buffer.from(str, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrame(buf) {
  // Один текст-фрейм с маской (от клиента). Хвост — в остатке.
  if (buf.length < 2) return { frame: null, rest: buf };
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return { frame: null, rest: buf };
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return { frame: null, rest: buf };
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return { frame: null, rest: buf };
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return { frame: null, rest: buf };
  const payload = Buffer.from(buf.subarray(offset, offset + len));
  if (masked && mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { frame: { opcode, payload }, rest: buf.subarray(offset + len) };
}

// ── сервер ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "mock-supabase-realtime" }));
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const send = (obj) => {
    try {
      socket.write(encodeText(JSON.stringify(obj)));
    } catch {
      /* соединение уже мёртво */
    }
  };

  let buf = Buffer.alloc(0);
  let joinFilters = [];
  let eventSeq = 100;

  // Wire-формат @supabase/phoenix (JSON-массив):
  //   [join_ref, ref, topic, event, payload]
  const sendMsg = ([joinRef, ref, topic, event, payload]) =>
    send([joinRef, ref, topic, event, payload]);

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    let parsed;
    while ((parsed = decodeFrame(buf)).frame) {
      buf = parsed.rest;
      const { opcode, payload } = parsed.frame;
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode !== 0x1) continue;
      let msg;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch (e) {
        console.log(`[mock] JSON parse failed: ${e.message}`);
        continue;
      }
      if (!Array.isArray(msg) || msg.length < 5) {
        console.log(`[mock] неожиданный формат: ${payload.subarray(0, 80).toString("utf8")}`);
        continue;
      }
      const [, ref, topic, event, msgPayload] = msg;

      if (event === "phx_join" && topic === "realtime:sgt-admin-hub") {
        // Запоминаем фильтры и выдаём каждому server-side binding id.
        joinFilters = (msgPayload?.config?.postgres_changes || []).map(
          (f, i) => ({ id: `bind-${i}`, ...f })
        );
        console.log(
          `[mock] phx_join: фильтров=${joinFilters.length} (${joinFilters
            .slice(0, 3)
            .map((f) => f.table)
            .join(", ")}…)`
        );
        sendMsg([null, ref, topic, "phx_reply", {
          status: "ok",
          response: { postgres_changes: joinFilters },
        }]);
        scheduleEvents();
      } else if (event === "heartbeat" && topic === "phoenix") {
        sendMsg([null, ref, topic, "heartbeat", { status: "ok" }]);
      } else if (event === "phx_leave") {
        sendMsg([null, ref, topic, "phx_reply", { status: "ok", response: {} }]);
      }
    }
  });

  function pushChange(table, type, record, oldRecord) {
    const bindIdx = joinFilters.findIndex((f) => f.table === table);
    if (bindIdx < 0) {
      console.log(`[mock] пропускаю ${table}: фильтра нет`);
      return;
    }
    eventSeq += 1;
    sendMsg([null, null, "realtime:sgt-admin-hub", "postgres_changes", {
      ids: [joinFilters[bindIdx].id],
      data: {
        schema: "public",
        table,
        commit_timestamp: new Date().toISOString(),
        type,
        record: type === "DELETE" ? null : record,
        old_record: oldRecord || null,
        columns: record
          ? Object.keys(record).map((k) => ({ name: k, type: "text" }))
          : oldRecord
            ? Object.keys(oldRecord).map((k) => ({ name: k, type: "text" }))
            : [],
      },
    }]);
    console.log(`[mock] push: ${table} ${type}`);
  }

  function scheduleEvents() {
    // Эмуляция: через 3 сек новый заказ, через 6 сек изменение зарплаты.
    setTimeout(
      () =>
        pushChange("orders", "INSERT", {
          id: "11111111-2222-3333-4444-555555555555",
          type: "order",
          status: "new",
          customer_name: "Тестов Иван",
          customer_phone: "+7 900 000-00-00",
          total_sum: 1250,
          created_at: new Date().toISOString(),
        }),
      3000
    );
    setTimeout(
      () =>
        pushChange("salaries", "UPDATE", { id: "s1", amount: 50000, is_paid: true }, { id: "s1", amount: 50000, is_paid: false }),
      6000
    );
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock] Supabase Realtime мок на http://127.0.0.1:${PORT}/realtime/v1/websocket`);
});
