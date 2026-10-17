// ==========================================
// PDF-бот Аганим — Google Apps Script
// Версия: v2.3 (актуальная структура таблицы — 17 колонок)
// ==========================================

// ==========================================
// НАСТРОЙКИ — ПОМЕНЯЙ НА СВОИ
// ==========================================
var BOT_TOKEN = "ВСТАВЬТЕ_ТОКЕН";

// TEST_CHAT_ID читается из вкладки "Настройки" (ячейка B1).
function getTestChatId() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var settings = ss.getSheetByName("Настройки");
    if (!settings) return "";
    var id = settings.getRange("B1").getValue();
    return String(id || "");
  } catch (e) {
    return "";
  }
}


// ==========================================
// МЕНЮ ТАБЛИЦЫ (появляется при открытии)
// ==========================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🤖 Easy Bot")
    .addItem("⚙️ Установить триггеры и бэкапы", "setupBackupSystem")
    .addItem("🔄 Пересчитать бонусы дизайнеров", "recalcAllDetails")
    .addItem("🦓 Применить зебру ко всей таблице", "applyZebraToAll")
    .addItem("💾 Сделать бэкап прямо сейчас", "dailyBackup")
    .addToUi();
}

// ==========================================
// СТОЛБЦЫ (номера, не буквы!) — АКТУАЛЬНАЯ СТРУКТУРА v2.3
// 17 колонок: A..Q
// ==========================================
var COL_INVOICE     = 1;  // A — № счёта
var COL_DATE        = 2;  // B — Дата счёта
var COL_CLIENT      = 3;  // C — Клиент
var COL_PHONE       = 4;  // D — Телефон клиента
var COL_DESIGNER    = 5;  // E — Дизайнер
var COL_QTY         = 6;  // F — к-во поз. (сюда пишем УВЕДОМЛЕНО после ТГ)
var COL_POSITIONS   = 7;  // G — Позиции ПОСТ
var COL_SUPPLIER    = 8;  // H — Поставщик
var COL_SUP_INV     = 9;  // I — № счёта ПОСТ / дата
var COL_PAY_DATE    = 10; // J — Дата опл ПОСТ
var COL_SHIP_DATE   = 11; // K — Дата отгр клиенту  ← подсветка зелёным при отгрузке
var COL_TK_SEND     = 12; // L — Отправка в тк от ПОСТ
var COL_TK_ARRIVAL  = 13; // M — Дата прихода ТК КЗН  ← триггер уведомления
var COL_WAREHOUSE   = 14; // N — Дата прихода СКЛАД   ← триггер уведомления
var COL_EXTRA       = 15; // O — Дополнительно
var COL_MANAGER     = 16; // P — Менеджер
var COL_PAYMENT     = 17; // Q — Форма оплаты

var TOTAL_COLS = 17;      // всего колонок в таблице

// ==========================================
// ЦВЕТА ФОРМАТИРОВАНИЯ
// ==========================================
var COLOR_ZEBRA_1    = "#FFFFFF"; // нечётный счёт — белый
var COLOR_ZEBRA_2    = "#F3F3F5"; // чётный счёт — светло-серый
var COLOR_NOTIFIED   = "#C8E6C9"; // УВЕДОМЛЕНО — светло-зелёный фон
var COLOR_NOTIFIED_T = "#1B5E20"; // УВЕДОМЛЕНО — тёмно-зелёный текст
var COLOR_SHIPPED    = "#DCEDC8"; // Дата отгрузки — зелёнее

// ==========================================
// onEdit — срабатывает при редактировании таблицы
// ==========================================
function onEditInstallable(e) {
  try {
    var sheet = e.source.getActiveSheet();
    var sheetName = sheet.getName();
    if (sheetName === "Telegram ID") return;
    if (sheetName === "Настройки") return;
    if (sheetName === "Проверка остатков") return;

    var range = e.range;
    var col = range.getColumn();
    var row = range.getRow();
    if (row <= 1) return;

    // ===== Лист «Детализация» (бонусы дизайнеров) =====
    if (sheetName === "Детализация") {
      onEditDetail(sheet, row, col);
      return;
    }

    // ===== Лист «Сводка» =====
    if (sheetName === "Сводка") {
      // только ручные правки даты выплаты перерисовывают
      recalcSummary();
      return;
    }

    // ===== Лист1 (счета) =====
    if (sheetName !== "Лист1") return;

    // 1. Зебра при изменении № счёта (A)
    if (col === COL_INVOICE) {
      recolorInvoiceBlock(sheet, row);
    }

    // 2. Подсветка зелёным при заполнении даты отгрузки (K)
    if (col === COL_SHIP_DATE) {
      highlightInvoiceIfShipped(sheet, row);
    }

    // 3. Триггер уведомления: редактирование M (ТК КЗН) или N (СКЛАД)
    if (col === COL_TK_ARRIVAL || col === COL_WAREHOUSE) {
      SpreadsheetApp.flush();
      checkAndNotify(sheet, row);
    }

  } catch (error) {
    Logger.log("ОШИБКА onEdit: " + error);
  }
}

// ==========================================
// ЗЕБРА: красим блок счёта белым/серым по порядку
// ==========================================
// Логика: считаем СКОЛЬКО разных номеров счетов выше текущего.
// Если чётное число — этот счёт белый, нечётное — серый.
function recolorInvoiceBlock(sheet, row) {
  var data = sheet.getDataRange().getValues();

  // № счёта в текущей строке
  var currentInvoice = data[row - 1][COL_INVOICE - 1];
  if (!currentInvoice) return;

  // Считаем уникальные номера счетов ВЫШЕ текущей строки
  var seen = {};
  var idx = 0;
  for (var i = 1; i < row - 1; i++) {
    var v = data[i][COL_INVOICE - 1];
    if (v && !seen[v]) {
      seen[v] = true;
      idx++;
    }
  }
  // idx = кол-во счетов выше. Текущий счёт имеет порядковый номер idx+1
  var bgColor = (idx % 2 === 0) ? COLOR_ZEBRA_1 : COLOR_ZEBRA_2;

  // Находим ВСЕ строки текущего счёта (включая пустые ниже)
  var startRow = row;
  var endRow = row;
  for (var j = row; j <= data.length; j++) {
    if (j > row) {
      var below = data[j - 1][COL_INVOICE - 1];
      if (below !== "" && below !== null) break;
    }
    endRow = j;
  }

  // Красим блок
  var block = sheet.getRange(startRow, 1, endRow - startRow + 1, TOTAL_COLS);
  block.setBackground(bgColor);
}

// ==========================================
// ПОДСВЕТКА ЗЕЛЁНЫМ при заполнении «Дата отгр клиенту»
// ==========================================
function highlightInvoiceIfShipped(sheet, row) {
  var invoiceRows = findInvoiceRows(sheet, row);
  if (invoiceRows.length === 0) return;

  var hasShipDate = false;
  for (var i = 0; i < invoiceRows.length; i++) {
    var shipVal = sheet.getRange(invoiceRows[i] + 1, COL_SHIP_DATE).getValue();
    if (shipVal) { hasShipDate = true; break; }
  }

  var firstRow = invoiceRows[0] + 1;
  var lastRow  = invoiceRows[invoiceRows.length - 1] + 1;
  var block = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, TOTAL_COLS);

  if (hasShipDate) {
    block.setBackground(COLOR_SHIPPED);
  } else {
    // Возвращаем зебру (определяем по позиции)
    recolorInvoiceBlock(sheet, firstRow);
  }
}

// ==========================================
// ПОИСК ВСЕХ СТРОК СЧЁТА (по № в колонке A)
// Возвращает массив 0-indexed индексов в data.
// Учитывает объединённые ячейки: строки ниже № счёта без своего номера.
// ==========================================
function findInvoiceRows(sheet, startRow) {
  var data = sheet.getDataRange().getValues();

  // № счёта в startRow (идём вверх если пусто)
  var invoiceNum = data[startRow - 1][COL_INVOICE - 1];
  if (!invoiceNum) {
    for (var r = startRow - 1; r >= 1; r--) {
      var val = data[r - 1][COL_INVOICE - 1];
      if (val) { invoiceNum = val; break; }
    }
  }
  if (!invoiceNum) return [];

  var firstIdx = -1;
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][COL_INVOICE - 1]) == String(invoiceNum)) {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx === -1) return [];

  var rows = [firstIdx];
  for (var j = firstIdx + 1; j < data.length; j++) {
    var v = data[j][COL_INVOICE - 1];
    if (String(v) === "" || v === null) {
      rows.push(j);
    } else {
      break;
    }
  }
  return rows;
}

// ==========================================
// ПРОВЕРКА И ОТПРАВКА УВЕДОМЛЕНИЙ
// ==========================================
function checkAndNotify(sheet, row) {
  var invoiceRows = findInvoiceRows(sheet, row);
  if (invoiceRows.length === 0) return;

  // Проверяем УЖЕ уведомлено? (F содержит "УВЕДОМЛЕНО")
  var firstRowData = sheet.getRange(invoiceRows[0] + 1, 1, 1, TOTAL_COLS).getValues()[0];
  var qtyVal = String(firstRowData[COL_QTY - 1] || "");
  if (qtyVal.indexOf("УВЕДОМЛЕНО") !== -1) return;

  // Определяем № счёта
  var invoice = firstRowData[COL_INVOICE - 1];
  if (!invoice) return;

  // Проверяем: у КАЖДОЙ строки заполнено M (ТК КЗН) или N (СКЛАД)
  var allComplete = true;
  var allData = sheet.getRange(invoiceRows[0] + 1, 1, invoiceRows.length, TOTAL_COLS).getValues();
  for (var j = 0; j < allData.length; j++) {
    var tkArrival = allData[j][COL_TK_ARRIVAL - 1];
    var warehouse = allData[j][COL_WAREHOUSE - 1];
    if (!tkArrival && !warehouse) { allComplete = false; break; }
  }
  if (!allComplete) return;

  // Собираем данные из первой строки
  var client   = firstRowData[COL_CLIENT - 1]   || "—";
  var designer = firstRowData[COL_DESIGNER - 1] || "—";
  var manager  = firstRowData[COL_MANAGER - 1]  || "—";

  // ====== ФОРМИРУЕМ ДВА СООБЩЕНИЯ ======
  // Полное (для менеджера, руководителя, общего чата): позиции + поставщики
  var compositionFull = "";
  // Краткое (для дизайнера и клиента): только позиции и место прихода
  var compositionBrief = "";
  for (var k = 0; k < allData.length; k++) {
    var positions  = allData[k][COL_POSITIONS - 1] || "?";
    var supplier   = allData[k][COL_SUPPLIER - 1]  || "—";
    var location   = getLocation(allData[k]);
    compositionFull  += "• поз. " + positions + " — " + supplier + " (" + location + ")\n";
    compositionBrief += "• поз. " + positions + " — " + location + "\n";
  }

  var designerText = (designer === "—" ? "не указан" : designer);
  var managerText  = (manager === "—" ? "не указан" : manager);

  var messageFull =
    "📦 Счёт №" + invoice + " — все позиции пришли\n" +
    "👤 Клиент: " + client + "\n" +
    "🎨 Дизайнер: " + designerText + "\n" +
    "👷 Менеджер: " + managerText + "\n" +
    "📋 Состав по позициям:\n" + compositionFull;

  var messageBrief =
    "📦 Счёт №" + invoice + " — все позиции пришли\n" +
    "👤 Клиент: " + client + "\n" +
    "📋 Состав:\n" + compositionBrief;

  // ====== ОТПРАВКА ======
  // Группа 1 (ПОЛНОЕ, без кнопок): менеджер, руководители, общий чат
  // Группа 2 (КРАТКОЕ, с кнопками доставки): дизайнер, клиент
  var groups = getRecipientGroups(manager, designer, invoice);

  for (var g1 = 0; g1 < groups.full.length; g1++) {
    sendTelegram(groups.full[g1], messageFull);
  }

  var keyboard = buildInlineKeyboard(invoice);
  for (var g2 = 0; g2 < groups.brief.length; g2++) {
    sendTelegram(groups.brief[g2], messageBrief, keyboard);
  }

  // ====== СТАВИМ "УВЕДОМЛЕНО" в F (к-во поз.) и красим зелёным ======
  // В F пишем "к-во — УВЕДОМЛЕНО", чтобы сохранить информацию и показать статус
  var qtyNumber = firstRowData[COL_QTY - 1];
  // Если в F уже число — оставляем число + статус; если текст — просто статус
  var newQty;
  if (typeof qtyNumber === "number") {
    newQty = qtyNumber + " — УВЕДОМЛЕНО";
  } else {
    newQty = "УВЕДОМЛЕНО";
  }
  sheet.getRange(invoiceRows[0] + 1, COL_QTY).setValue(newQty);

  // Красим ячейку F и весь блок счёта светло-зелёным
  var block = sheet.getRange(invoiceRows[0] + 1, 1, invoiceRows.length, TOTAL_COLS);
  block.setBackground(COLOR_NOTIFIED);
  // F — чуть акцентнее
  var fCell = sheet.getRange(invoiceRows[0] + 1, COL_QTY);
  fCell.setFontColor(COLOR_NOTIFIED_T).setFontWeight("bold");

  Logger.log("Уведомление отправлено для счёта " + invoice);
}

// ==========================================
// ОПРЕДЕЛЯЕМ МЕСТО ПРИХОДА
// ==========================================
function getLocation(rowData) {
  var tkArrival = rowData[COL_TK_ARRIVAL - 1];
  var warehouse = rowData[COL_WAREHOUSE - 1];
  if (tkArrival && warehouse) return "Склад + ТК";
  if (warehouse) return "Склад";
  if (tkArrival) return "ТК";
  return "—";
}

// ==========================================
// ГРУППЫ ПОЛУЧАТЕЛЕЙ
// ==========================================
function getRecipientGroups(managerName, designerName, invoice) {
  var full = [];
  var brief = [];

  full.push(getTestChatId());

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tgSheet = ss.getSheetByName("Telegram ID");
  if (!tgSheet) return {full: full, brief: brief};
  var tgData = tgSheet.getDataRange().getValues();

  // Менеджеры (делим по "/")
  var managerNames = String(managerName).split("/");
  for (var i = 0; i < managerNames.length; i++) {
    var mName = managerNames[i].trim().toLowerCase();
    if (!mName) continue;
    for (var j = 1; j < tgData.length; j++) {
      var tgName = String(tgData[j][0]).trim().toLowerCase();
      var tgId = String(tgData[j][1]).trim();
      var tgType = String(tgData[j][2]).trim().toLowerCase();
      if (tgName === mName && tgId && tgType === "менеджер") {
        full.push(tgId);
      }
    }
  }

  // Руководители
  for (var k = 1; k < tgData.length; k++) {
    var rType = String(tgData[k][2]).trim().toLowerCase();
    var rId = String(tgData[k][1]).trim();
    if (rType === "руководитель" && rId) full.push(rId);
  }

  // Дизайнеры
  var designerNames = String(designerName).split("/");
  for (var d = 0; d < designerNames.length; d++) {
    var dName = designerNames[d].trim().toLowerCase();
    if (!dName) continue;
    for (var e = 1; e < tgData.length; e++) {
      var dgName = String(tgData[e][0]).trim().toLowerCase();
      var dgId = String(tgData[e][1]).trim();
      var dgType = String(tgData[e][2]).trim().toLowerCase();
      if (dgName === dName && dgId && dgType === "дизайнер") {
        brief.push(dgId);
      }
    }
  }

  // Клиент (по № счёта)
  for (var c = 1; c < tgData.length; c++) {
    var cName = String(tgData[c][0]).trim();
    var cId = String(tgData[c][1]).trim();
    var cType = String(tgData[c][2]).trim().toLowerCase();
    if (cName == String(invoice) && cId && cType === "клиент") {
      brief.push(cId);
    }
  }

  return {full: uniqueArray(full), brief: uniqueArray(brief)};
}

function uniqueArray(arr) {
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    if (result.indexOf(arr[i]) === -1) result.push(arr[i]);
  }
  return result;
}

// ==========================================
// INLINE-КЛАВИАТУРА (КНОПКИ)
// ==========================================
function buildInlineKeyboard(invoice) {
  return {
    inline_keyboard: [
      [
        {text: "🚚 Заказать доставку", callback_data: "delivery:" + invoice},
        {text: "🏠 Заберу сам", callback_data: "pickup:" + invoice}
      ],
      [
        {text: "📞 Свяжитесь со мной", callback_data: "contact:" + invoice}
      ]
    ]
  };
}

// ==========================================
// ОТПРАВКА В TELEGRAM
// ==========================================
function sendTelegram(chatId, text, keyboard) {
  if (!chatId || !text) return null;
  if (text.length > 4000) {
    var chunks = text.match(/[\s\S]{1,4000}/g) || [text];
    var res = null;
    for (var i = 0; i < chunks.length; i++) {
      res = _sendTelegramRaw(chatId, chunks[i], (i === chunks.length - 1) ? keyboard : null);
    }
    return res;
  }
  return _sendTelegramRaw(chatId, text, keyboard);
}

function _sendTelegramRaw(chatId, text, keyboard) {
  var url = "https://api.telegram.org/bot" + BOT_TOKEN + "/sendMessage";
  var payload = {chat_id: chatId, text: text};
  if (keyboard) payload.reply_markup = keyboard;

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var result = JSON.parse(response.getContentText());
    if (!result.ok) Logger.log("Telegram API ошибка: " + response.getContentText());
    return result;
  } catch (error) {
    Logger.log("Ошибка отправки Telegram: " + error);
    return null;
  }
}

// ==========================================
// ==========================================
// doGet — API ДЛЯ ВНЕШНИХ ПРОГРАММ (бота и дашборда)
// ==========================================
// Вызывается через URL веб-приложения с параметрами:
//   ?action=notify&chat_id=ID&text=Текст
//   ?action=notifyArrival&invoice=NUM
//
// Используется чтобы отправлять Telegram-уведомления с ПК (где
// api.telegram.org заблокирован) ЧЕРЕЗ серверы Google.
function doGet(e) {
  try {
    var action = e.parameter.action;

        if (action === "setup") {
      setupBackupSystem();
      return ContentService.createTextOutput(JSON.stringify({ok: true, message: "Triggers and backup system configured"}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "notify") {
      // Простая отправка сообщения в указанный chat_id
      var chatId = e.parameter.chat_id;
      var text = decodeURIComponent(e.parameter.text || "");
      if (!chatId || !text) {
        return ContentService.createTextOutput(JSON.stringify({ok: false, error: "no chat_id/text"}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var result = sendTelegram(chatId, text);
      var sentOk = !!(result && result.ok);
      return ContentService.createTextOutput(JSON.stringify(
        sentOk ? {ok: true, sent: true}
               : {ok: true, sent: false, error: (result && result.description) || "send failed"}
      ))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "notifyDesigner") {
      // Отправка уведомления дизайнеру об оплате (по имени — сам найдём chat_id)
      var designerName = decodeURIComponent(e.parameter.designer || "");
      var invoice = e.parameter.invoice;
      var amount = decodeURIComponent(e.parameter.amount || "");
      var percent = decodeURIComponent(e.parameter.percent || "");
      var bonus = decodeURIComponent(e.parameter.bonus || "");
      var client = decodeURIComponent(e.parameter.client || "");
      if (!designerName || !invoice) {
        return ContentService.createTextOutput(JSON.stringify({ok: false, error: "no designer/invoice"}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      // Ищем chat_id дизайнера
      var tgSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Telegram ID");
      var chatId = null;
      if (tgSheet) {
        var td = tgSheet.getDataRange().getValues();
        for (var i = 1; i < td.length; i++) {
          if (String(td[i][0]).trim().toLowerCase() === designerName.toLowerCase() &&
              String(td[i][2]).trim().toLowerCase() === "дизайнер" &&
              String(td[i][1] || "").trim()) {
            chatId = String(td[i][1]).trim();
            break;
          }
        }
      }
      if (!chatId) {
        return ContentService.createTextOutput(JSON.stringify({ok: false, error: "designer not found or no chat_id"}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var msg = "💰 Счёт №" + invoice + " оплачен\n\n" +
                "👤 Клиент: " + client + "\n" +
                "💵 Сумма счёта: " + amount + " ₽\n" +
                "📊 Ваш бонус (" + percent + "%): " + bonus + " ₽\n" +
                "⏰ Выплата в течение 7 дней";
      var result = sendTelegram(chatId, msg);
      return ContentService.createTextOutput(JSON.stringify({ok: true, sent: !!(result && result.ok)}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "notifyArrival") {
      // Уведомление что все позиции счёта пришли.
      // Сам пересчёт дашборд уже сделал (покрасил + УВЕДОМЛЕНО),
      // здесь только отправляем ТГ.
      var invoice = e.parameter.invoice;
      if (!invoice) {
        return ContentService.createTextOutput(JSON.stringify({ok: false, error: "no invoice"}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Лист1");
      if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
      var data = sheet.getDataRange().getValues();

      // Находим строки счёта
      var rows = [];
      var firstIdx = -1;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][COL_INVOICE - 1]) === String(invoice)) {
          if (firstIdx === -1) firstIdx = i;
          rows.push(i);
        } else if (firstIdx !== -1 && (data[i][COL_INVOICE - 1] === "" || !data[i][COL_INVOICE - 1])) {
          rows.push(i);
        } else if (firstIdx !== -1) {
          break;
        }
      }
      if (rows.length === 0) {
        return ContentService.createTextOutput(JSON.stringify({ok: false, error: "invoice not found"}))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // Собираем данные
      var client = data[rows[0]][COL_CLIENT - 1] || "—";
      var designer = data[rows[0]][COL_DESIGNER - 1] || "—";
      var manager = data[rows[0]][COL_MANAGER - 1] || "—";

      var composition = "";
      for (var k = 0; k < rows.length; k++) {
        var positions = data[rows[k]][COL_POSITIONS - 1] || "?";
        var supplier = data[rows[k]][COL_SUPPLIER - 1] || "?";
        var tkArrival = data[rows[k]][COL_TK_ARRIVAL - 1];
        var warehouse = data[rows[k]][COL_WAREHOUSE - 1];
        var loc = (tkArrival && warehouse) ? "Склад + ТК" :
                  (warehouse ? "Склад" : (tkArrival ? "ТК" : "—"));
        composition += "• поз. " + positions + " — " + supplier + " (" + loc + ")\n";
      }

      var messageFull = "📦 Счёт №" + invoice + " — все позиции пришли\n" +
                        "👤 Клиент: " + client + "\n" +
                        "🎨 Дизайнер: " + designer + "\n" +
                        "👷 Менеджер: " + manager + "\n" +
                        "📋 Состав:\n" + composition;

      // Краткое сообщение для дизайнера/клиента (с кнопками)
      var compositionBrief2 = "";
      for (var k2 = 0; k2 < rows.length; k2++) {
        var positions2 = data[rows[k2]][COL_POSITIONS - 1] || "?";
        var tkA2 = data[rows[k2]][COL_TK_ARRIVAL - 1];
        var wh2 = data[rows[k2]][COL_WAREHOUSE - 1];
        var loc2 = (tkA2 && wh2) ? "Склад + ТК" :
                   (wh2 ? "Склад" : (tkA2 ? "ТК" : "—"));
        compositionBrief2 += "• поз. " + positions2 + " — " + loc2 + "\n";
      }
      var messageBrief2 = "📦 Счёт №" + invoice + " — все позиции пришли\n" +
                          "👤 Клиент: " + client + "\n" +
                          "📋 Состав:\n" + compositionBrief2;

      // Получатели: полное — менеджеру/руководителю/чату, краткое — дизайнеру/клиенту
      var groups = getRecipientGroups(manager, designer, invoice);
      var sent = 0;
      for (var g = 0; g < groups.full.length; g++) {
        var rFull = sendTelegram(groups.full[g], messageFull);
        if (rFull && rFull.ok) sent++;
      }
      var keyboard2 = buildInlineKeyboard(invoice);
      for (var g2 = 0; g2 < groups.brief.length; g2++) {
        var rBrief = sendTelegram(groups.brief[g2], messageBrief2, keyboard2);
        if (rBrief && rBrief.ok) sent++;
      }

      return ContentService.createTextOutput(JSON.stringify({ok: true, sent: sent}))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ok: false, error: "unknown action"}))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: String(err)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
// === Перманентная дедупликация по update_id (вместо кэша с TTL) ===
function _lastUpdateId() {
  try {
    return Number(PropertiesService.getScriptProperties()
      .getProperty("LAST_UPDATE_ID") || 0);
  } catch (e) { return 0; }
}

function _saveUpdateId(id) {
  try {
    if (Number(id) > _lastUpdateId()) {
      PropertiesService.getScriptProperties()
        .setProperty("LAST_UPDATE_ID", String(id));
    }
  } catch (e) {}
}
// ==========================================
// doPost — ОБРАБОТКА СООБЩЕНИЙ И КНОПОК
// ==========================================
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(30000);

  try {
    var data = JSON.parse(e.postData.contents);
        // Повторный апдейт — пропускаем молча (Telegram ретраит из-за 302)
    var uId = Number(data.update_id || 0);
    if (uId && uId <= _lastUpdateId()) {
      Logger.log("Повтор update_id=" + uId + " — уже обработан");
      if (lock.hasLock()) lock.releaseLock();
      return ContentService.createTextOutput("ok");
    }
    if (uId) _saveUpdateId(uId);

    var cache = CacheService.getScriptCache();
    var updateId = "";
    if (data.callback_query) {
      updateId = "cb_" + data.callback_query.id;
    } else if (data.message) {
      updateId = "msg_" + data.message.message_id;
    }

    if (updateId && cache.get(updateId)) {
      Logger.log("Дубль запроса, пропускаем: " + updateId);
      if (lock.hasLock()) lock.releaseLock();
      return ContentService.createTextOutput("ok");
    }
    if (updateId) cache.put(updateId, "done", 600);

    if (data.callback_query) {
      handleCallback(data.callback_query);
    } else if (data.message) {
      handleMessage(data.message);
    }

  } catch (error) {
    Logger.log("doPost ошибка: " + error);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }

  return ContentService.createTextOutput("ok");
}

// ==========================================
// ОБРАБОТКА НАЖАТИЙ КНОПОК
// ==========================================
function handleCallback(callback) {
  var chatId = String(callback.message.chat.id);
  var userName = callback.from.first_name || "Без имени";
  var data = callback.data;

  var parts = data.split(":");
  var action = parts[0];
  var invoice = parts[1];

  answerCallback(callback.id);

  if (action === "delivery") {
    var cache = CacheService.getScriptCache();
    cache.put("delivery_pending_" + chatId, invoice + "|" + userName, 600);
    var questions = "🚚 Для оформления доставки ответьте на это сообщение, указав:\n\n" +
                    "1. Адрес доставки\n2. Контакт для связи\n" +
                    "3. Нужна ли разгрузка\n4. Для юр.лиц: ЭДО или доверенность?\n\n" +
                    "✍️ Напишите ответ ОДНИМ сообщением:";
    sendTelegram(chatId, questions);
  } else if (action === "pickup") {
    sendTelegram(chatId, "👍 Менеджер свяжется с вами и объяснит, как и где забрать товар.");
    notifyManagers("🏠 КЛИЕНТ ЗАБЕРЁТ САМ\n📦 Счёт №" + invoice + "\n👤 От: " + userName, invoice);
  } else if (action === "contact") {
    sendTelegram(chatId, "📞 Менеджер свяжется с вами в ближайшее время.");
    notifyManagers("📞 ПРОСЬБА СВЯЗАТЬСЯ\n📦 Счёт №" + invoice + "\n👤 От: " + userName, invoice);
  }
}

// ==========================================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
// ==========================================
// Привязка ручная: человек пишет /start → получает свой ID →
// пересылает менеджеру → менеджер вписывает ID в «Telegram ID».
function handleMessage(message) {
  var chatId = String(message.chat.id);
  var text = message.text || "";
  var userName = message.from.first_name || "Без имени";

  if (text === "/start") {
    var reply =
      "👋 Это бот компании Аганим — уведомления о заказах.\n\n" +
      "🔑 Ваш Telegram ID: " + chatId + "\n\n" +
      "📤 Перешлите это сообщение менеджеру —\n" +
      "он привяжет вас к уведомлениям.";
    sendTelegram(chatId, reply);
    return;
  }

  var cache = CacheService.getScriptCache();
  var pending = cache.get("delivery_pending_" + chatId);

  if (pending) {
    cache.remove("delivery_pending_" + chatId);
    var parts = pending.split("|");
    var invoice = parts[0];
    var cachedName = parts[1] || userName;

    var msgLock = "msg_processed_" + chatId + "_" + invoice;
    if (cache.get(msgLock)) return;
    cache.put(msgLock, "locked", 60);

    notifyManagers("🚚 ЗАЯВКА НА ДОСТАВКУ\n📦 Счёт №" + invoice + "\n👤 От: " + cachedName +
                   "\n\n📝 Данные для доставки:\n" + text, invoice);
    sendTelegram(chatId, "✅ Ваша заявка на доставку передана менеджеру.\nМы свяжемся с вами.");
    return;
  }

  Logger.log("Сообщение от " + chatId + ": " + text);
}

// ==========================================
// УВЕДОМЛЕНИЕ МЕНЕДЖЕРОВ
// ==========================================
// Отправляет сообщение:
//   1. В общий рабочий чат (всегда)
//   2. Лично менеджеру счёта (если указан invoice и менеджер привязан)
//      Менеджер ищется в Лист1 по № счёта, затем его chat_id в «Telegram ID»
function notifyManagers(text, invoice) {
  // 1. Общий рабочий чат
  sendTelegram(getTestChatId(), text);

  // 2. Менеджер счёта
  if (!invoice) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Лист1");
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();

    // Ищем менеджера по № счёта
    var manager = "";
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][COL_INVOICE - 1]) === String(invoice)) {
        manager = String(data[i][COL_MANAGER - 1] || "").trim();
        break;
      }
    }
    if (!manager) return;

    // Ищем chat_id менеджера (поддержка «Имя1/Имя2»)
    var tgSheet = ss.getSheetByName("Telegram ID");
    if (!tgSheet) return;
    var tgData = tgSheet.getDataRange().getValues();
    var mainChat = getTestChatId();
    var names = manager.split("/");
    var sentList = [];

    for (var n = 0; n < names.length; n++) {
      var nm = names[n].trim().toLowerCase();
      if (!nm) continue;
      for (var j = 1; j < tgData.length; j++) {
        var tgName = String(tgData[j][0] || "").trim().toLowerCase();
        var tgId = String(tgData[j][1] || "").trim();
        var tgType = String(tgData[j][2] || "").trim().toLowerCase();
        if (tgName === nm && tgId && tgType === "менеджер") {
          // Не дублируем если это тот же чат что общий
          if (tgId !== mainChat && sentList.indexOf(tgId) === -1) {
            sendTelegram(tgId, text);
            sentList.push(tgId);
          }
          break;
        }
      }
    }
  } catch (e) {
    Logger.log("notifyManagers менеджеру: " + e);
  }
}

// ==========================================
// ПОДТВЕРЖДЕНИЕ НАЖАТИЯ КНОПКИ
// ==========================================
function answerCallback(callbackId) {
  var url = "https://api.telegram.org/bot" + BOT_TOKEN + "/answerCallbackQuery";
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({callback_query_id: callbackId}),
    muteHttpExceptions: true
  };
  try { UrlFetchApp.fetch(url, options); } catch (e) {}
}

// ==========================================
// ПЕРЕФОРМАТИРОВАНИЕ ВСЕЙ ТАБЛИЦЫ (зебра) — запуск вручную
// ==========================================
// Запускать из Apps Script: применяет зебру ко всем счетам сразу.
function applyZebraToAll() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Лист1");
  if (!sheet) sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var data = sheet.getDataRange().getValues();

  var seen = {};
  var order = 0;
  for (var i = 1; i < data.length; i++) {
    var inv = data[i][COL_INVOICE - 1];
    if (inv !== "" && inv !== null && !seen[inv]) {
      seen[inv] = order;
      order++;
    }
    var invOrder = seen[inv];
    var color = (invOrder % 2 === 0) ? COLOR_ZEBRA_1 : COLOR_ZEBRA_2;

    // Проверяем: если строка уже УВЕДОМЛЕНО/отгружена — не перезаписываем зелёный
    var qtyVal = String(data[i][COL_QTY - 1] || "");
    var shipVal = data[i][COL_SHIP_DATE - 1];
    if (qtyVal.indexOf("УВЕДОМЛЕНО") !== -1) {
      color = COLOR_NOTIFIED;
    } else if (shipVal) {
      color = COLOR_SHIPPED;
    }
    sheet.getRange(i + 1, 1, 1, TOTAL_COLS).setBackground(color);
  }
  Logger.log("Зебра применена к " + (data.length - 1) + " строкам");
}


// =================================================================
// === ДИЗАЙНЕРЫ: БОНУСЫ ===
// =================================================================
// Структура листа «Детализация»:
//   A № счёта | B Дата | C Клиент | D Форма оплаты | E Дизайнер
//   F Сумма счёта | G % (5/10/пусто) | H Бонус | I Срок выплаты
//   J Дата выплаты | K Статус | L Примечание
//
// ПРАВИЛО: 5% базово. Если дизайнер за последние 3 мес набрал счетов
// на 500 000 ₽ и более — его бонус повышается до 10%.

var DCOL_INVOICE  = 1;  // A
var DCOL_DATE     = 2;  // B
var DCOL_CLIENT   = 3;  // C
var DCOL_PAYMENT  = 4;  // D
var DCOL_DESIGNER = 5;  // E
var DCOL_SUM      = 6;  // F
var DCOL_PERCENT  = 7;  // G
var DCOL_BONUS    = 8;  // H
var DCOL_DUE      = 9;  // I
var DCOL_PAID     = 10; // J
var DCOL_STATUS   = 11; // K
var DCOL_NOTE     = 12; // L

var THRESHOLD_AMOUNT = 500000;  // порог суммы за 3 месяца для 10%
var THRESHOLD_MONTHS = 3;       // период в месяцах
var BASE_PERCENT = 5;
var HIGH_PERCENT = 10;

// Цвета для «Детализация»
var COLOR_DUE_WARN = "#FFF3CD";   // жёлтый — близится срок выплаты
var COLOR_DUE_LATE = "#F8D7DA";   // красный — просрочка
var COLOR_PAID     = "#D4EDDA";   // зелёный — выплачено

// ==========================================
// onEditDetail — обработка правок в «Детализация»
// ==========================================
function onEditDetail(sheet, row, col) {
  // Пересчёт строки: % → бонус → срок → статус
  recalcDetailRow(sheet, row);
  // Обновляем Сводку
  recalcSummary();
}

// ==========================================
// Перерасчёт одной строки «Детализация»
// ==========================================
function recalcDetailRow(sheet, row) {
  var data = sheet.getRange(row, 1, 1, DCOL_NOTE).getValues()[0];
  var designer = data[DCOL_DESIGNER - 1];
  var sumRaw   = data[DCOL_SUM - 1];
  var dateStr  = data[DCOL_DATE - 1];
  var percentManual = data[DCOL_PERCENT - 1];
  var paidDate = data[DCOL_PAID - 1];

  if (!designer) return;
  var sum = Number(String(sumRaw).replace(/[^\d.,]/g, "").replace(",", ".")) || 0;

  // 1. Процент: если стоит вручную (5/10) — берём его, иначе АВТО по правилу
  var percent;
  if (percentManual === 5 || percentManual === 10 ||
      String(percentManual) === "5" || String(percentManual) === "10") {
    percent = Number(percentManual);
  } else {
    percent = getDesignerPercent(designer, dateStr);
  }
  sheet.getRange(row, DCOL_PERCENT).setValue(percent);

  // 2. Бонус = сумма * процент / 100
  var bonus = Math.round(sum * percent / 100 * 100) / 100;
  sheet.getRange(row, DCOL_BONUS).setValue(bonus);

  // 3. Срок выплаты = дата счёта + 7 дней
  var dDue = parseDateAddDays(dateStr, 7);
  if (dDue) {
    sheet.getRange(row, DCOL_DUE).setValue(dDue).setNumberFormat("dd.MM.yyyy");
  }

  // 4. Статус
  var status;
  if (paidDate) {
    status = "Выплачено";
  } else if (sum > 0) {
    status = "К выплате";
  } else {
    status = "";
  }
  sheet.getRange(row, DCOL_STATUS).setValue(status);

  // 5. Покраска строки по статусу
  var bg = "#FFFFFF";
  if (paidDate) {
    bg = COLOR_PAID;
  } else if (dDue) {
    var today = new Date();
    var daysLeft = Math.round((dDue - today) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) {
      bg = COLOR_DUE_LATE;     // просрочка
    } else if (daysLeft <= 3) {
      bg = COLOR_DUE_WARN;     // скоро срок
    }
  }
  sheet.getRange(row, 1, 1, DCOL_NOTE).setBackground(bg);
}

// ==========================================
// ОПРЕДЕЛЕНИЕ % ДИЗАЙНЕРА (главное правило 5%/10%)
// ==========================================
// Если сумма всех счетов дизайнера за последние 3 месяца (от dateStr)
// >= 500 000 ₽ — возвращаем 10%, иначе 5%.
function getDesignerPercent(designer, dateStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var det = ss.getSheetByName("Детализация");
  if (!det) return BASE_PERCENT;

  var data = det.getDataRange().getValues();
  var designerLower = String(designer).trim().toLowerCase();

  // Определяем окно: 3 месяца НАЗАД от dateStr
  var endDate = parseDate(dateStr) || new Date();
  var startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - THRESHOLD_MONTHS);

  var totalSum = 0;
  for (var i = 1; i < data.length; i++) {
    var d = String(data[i][DCOL_DESIGNER - 1] || "").trim().toLowerCase();
    if (d !== designerLower) continue;

    var rowDate = parseDate(data[i][DCOL_DATE - 1]);
    if (!rowDate) continue;
    if (rowDate < startDate || rowDate > endDate) continue;

    var s = Number(String(data[i][DCOL_SUM - 1]).replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
    totalSum += s;
  }

  return (totalSum >= THRESHOLD_AMOUNT) ? HIGH_PERCENT : BASE_PERCENT;
}

// ==========================================
// ПЕРЕСЧЁТ ВСЕЙ «Детализация» — запуск вручную
// ==========================================
function recalcAllDetails() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var det = ss.getSheetByName("Детализация");
  if (!det) return;
  var lastRow = det.getLastRow();
  for (var r = 2; r <= lastRow; r++) {
    recalcDetailRow(det, r);
  }
  recalcSummary();
  Logger.log("Детализация пересчитана: " + (lastRow - 1) + " строк");
}

// ==========================================
// ЗАПОЛНЕНИЕ «Сводка» (агрегация по дизайнерам)
// ==========================================
function recalcSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var det = ss.getSheetByName("Детализация");
  var sv = ss.getSheetByName("Сводка");
  if (!det || !sv) return;

  var data = det.getDataRange().getValues();
  var now = new Date();
  var startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - THRESHOLD_MONTHS);

  // Группируем по дизайнеру
  var agg = {};  // designer → {count3, sum3, countAll, sumAll, bonusPaid, paidSum}
  for (var i = 1; i < data.length; i++) {
    var designer = String(data[i][DCOL_DESIGNER - 1] || "").trim();
    if (!designer) continue;
    if (!agg[designer]) {
      agg[designer] = {count3: 0, sum3: 0, countAll: 0, sumAll: 0,
                       bonusAll: 0, paidSum: 0};
    }
    var a = agg[designer];
    var d = parseDate(data[i][DCOL_DATE - 1]);
    var s = Number(String(data[i][DCOL_SUM - 1]).replace(/[^\d.,]/g, "").replace(",", ".")) || 0;
    var bonus = Number(data[i][DCOL_BONUS - 1]) || 0;
    var paidDate = data[i][DCOL_PAID - 1];

    a.countAll++;
    a.sumAll += s;
    a.bonusAll += bonus;
    if (paidDate) a.paidSum += bonus;
    if (d && d >= startDate && d <= now) {
      a.count3++;
      a.sum3 += s;
    }
  }

  // Очищаем старые данные Сводки (кроме заголовка)
  if (sv.getLastRow() > 1) {
    sv.getRange(2, 1, sv.getLastRow() - 1, 10).clearContent();
  }

  // Записываем
  var designers = Object.keys(agg).sort();
  var r = 2;
  for (var k = 0; k < designers.length; k++) {
    var name = designers[k];
    var a = agg[name];
    var percent = (a.sum3 >= THRESHOLD_AMOUNT) ? HIGH_PERCENT : BASE_PERCENT;
    var debt = a.bonusAll - a.paidSum;
    var status = (a.sum3 >= THRESHOLD_AMOUNT) ? "10%" : "5%";

    sv.getRange(r, 1).setValue(name);                  // A Дизайнер
    sv.getRange(r, 2).setValue(a.count3);              // B счёт за 3 мес
    sv.getRange(r, 3).setValue(a.sum3);                // C сумма за 3 мес
    sv.getRange(r, 4).setValue(percent);               // D текущий %
    sv.getRange(r, 5).setValue(a.countAll);            // E всего счетов
    sv.getRange(r, 6).setValue(a.sumAll);              // F сумма всех
    sv.getRange(r, 7).setValue(a.bonusAll);            // G бонус начислено
    sv.getRange(r, 8).setValue(a.paidSum);             // H выплачено
    sv.getRange(r, 9).setValue(debt);                  // I долг
    sv.getRange(r, 10).setValue(status);               // J статус

    // Формат денег
    sv.getRange(r, 3).setNumberFormat("#,##0.00");
    sv.getRange(r, 6).setNumberFormat("#,##0.00");
    sv.getRange(r, 7).setNumberFormat("#,##0.00");
    sv.getRange(r, 8).setNumberFormat("#,##0.00");
    sv.getRange(r, 9).setNumberFormat("#,##0.00");

    // Покраска: долг > 0 — жёлтый; 10% дизайнер — зелёный
    if (debt > 0) {
      sv.getRange(r, 9).setBackground(COLOR_DUE_WARN);
    }
    if (percent === HIGH_PERCENT) {
      sv.getRange(r, 4).setBackground(COLOR_PAID);
      sv.getRange(r, 10).setBackground(COLOR_PAID);
    }
    r++;
  }
  Logger.log("Сводка обновлена: " + designers.length + " дизайнеров");
}

// ==========================================
// ПАРСИНГ ДАТЫ «ДД.ММ.ГГГГ» → Date
// ==========================================
function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  var s = String(val).trim();
  // YYYY-MM-DD
  var mIso = s.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})$/);
  if (mIso) {
    return new Date(Number(mIso[1]), Number(mIso[2]) - 1, Number(mIso[3]));
  }
  // DD.MM.YYYY или DD.MM.YY
  var m = s.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{2,4})$/);
  if (m) {
    var year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

function parseDateAddDays(val, days) {
  var d = parseDate(val);
  if (!d) return null;
  d.setDate(d.getDate() + days);
  return d;
}


// =================================================================
// === БЭКАП И ЗАЩИТА ТАБЛИЦЫ ===
// =================================================================

var BACKUP_FOLDER = "Аганим — Бэкапы";   // папка на Google Drive
var BACKUP_KEEP_DAYS = 30;               // сколько дней хранить бэкапы
var BACKUP_SHEET = "_снапшот";           // скрытый лист часового снапшота

// ==========================================
// УСТАНОВКА ВСЕХ ТРИГГЕРОВ И ЗАЩИТЫ (запустить 1 раз вручную!)
// ==========================================
function setupBackupSystem() {
  // 1. Ежедневный полный бэкап в 23:23
  // Удаляем старые триггеры этого типа чтобы не плодить дубли
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "dailyBackup" || fn === "hourlySnapshot" ||
        fn === "onTableChange") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Полный бэкап — ежедневно 23:23
  ScriptApp.newTrigger("dailyBackup")
    .timeBased()
    .everyDays(1)
    .atHour(23)
    .create();

  // Часовой снапшот данных
  ScriptApp.newTrigger("hourlySnapshot")
    .timeBased()
    .everyHours(1)
    .create();

  // Тревога при удалении строк/столбцов
  ScriptApp.newTrigger("onTableChange")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onChange()
    .create();

  // Защита листов (предупреждение при удалении)

  // Сразу делаем первый снапшот
  hourlySnapshot();
  // Installable onEdit — имеет право на UrlFetchApp (Telegram-уведомления)
  var ss = SpreadsheetApp.getActive();
  var trigs = ScriptApp.getProjectTriggers();
  for (var t = 0; t < trigs.length; t++) {
    if (trigs[t].getHandlerFunction() === "onEditInstallable") {
      ScriptApp.deleteTrigger(trigs[t]);
    }
  }
  ScriptApp.newTrigger("onEditInstallable")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  // Поллинг Telegram — той же кнопкой
  setupPolling();
  Logger.log("✅ Система бэкапа установлена: 23:23 ежедневно + снапшот/час + тревога удаления");
}

// ==========================================
// ЕЖЕДНЕВНЫЙ ПОЛНЫЙ БЭКАП (23:23)
// ==========================================
function dailyBackup() {
  try {
    var ss = SpreadsheetApp.getActive();
    var file = DriveApp.getFileById(ss.getId());

    // Папка для бэкапов (создаём если нет)
    var folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
    var folder = folders.hasNext() ? folders.next() :
                 DriveApp.createFolder(BACKUP_FOLDER);

    // Имя: "Счета Аганим — бэкап 23.08.2026"
    var today = Utilities.formatDate(new Date(), "GMT+3", "dd.MM.yyyy");
    var name = "Счета Аганим — бэкап " + today;

    // Копируем (полная копия: все листы, цвета, формулы)
    var backup = file.makeCopy(name, folder);

    // Чистим старые бэкапы
    cleanOldBackups(folder);

    // Уведомление в ТГ
    sendTelegram(getTestChatId(),
      "💾 Бэкап создан: " + name + "\n" +
      "Папка: " + BACKUP_FOLDER + " на Google Drive\n" +
      "Хранение: " + BACKUP_KEEP_DAYS + " дней");

    Logger.log("Бэкап создан: " + name);
  } catch (e) {
    Logger.log("ОШИБКА бэкапа: " + e);
    try {
      sendTelegram(getTestChatId(), "❌ ОШИБКА бэкапа: " + e);
    } catch (e2) {}
  }
}

// ==========================================
// ОЧИСТКА СТАРЫХ БЭКАПОВ
// ==========================================
function cleanOldBackups(folder) {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BACKUP_KEEP_DAYS);
  var it = folder.getFiles();
  var removed = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.getDateCreated() < cutoff) {
      f.setTrashed(true);
      removed++;
    }
  }
  if (removed > 0) Logger.log("Удалено старых бэкапов: " + removed);
}

// ==========================================
// ЧАСОВОЙ СНАПШОТ (скрытый лист)
// ==========================================
function hourlySnapshot() {
  try {
    var ss = SpreadsheetApp.getActive();
    var snap = ss.getSheetByName(BACKUP_SHEET);
    if (!snap) {
      snap = ss.insertSheet(BACKUP_SHEET);
      snap.hideSheet();
    }

    // Копируем Лист1 (значения)
    var main = ss.getSheetByName("Лист1");
    if (main) {
      var data = main.getDataRange().getValues();
      snap.clear();
      if (data.length > 0) {
        snap.getRange(1, 1, data.length, data[0].length).setValues(data);
      }
      // Отметка времени снапшота
      snap.getRange(1, data[0].length + 2).setValue(
        "Снапшот: " + Utilities.formatDate(new Date(), "GMT+3", "dd.MM.yyyy HH:mm"));
    }

    // Копируем Детализацию (вторым блоком со смещением)
    var det = ss.getSheetByName("Детализация");
    if (det) {
      var detData = det.getDataRange().getValues();
      if (detData.length > 0) {
        var startRow = (main ? main.getLastRow() : 1) + 3;
        snap.getRange(startRow, 1, detData.length, detData[0].length).setValues(detData);
        snap.getRange(startRow - 1, 1).setValue("=== ДЕТАЛИЗАЦИЯ ===");
      }
    }

    Logger.log("Снапшот обновлён: " +
      Utilities.formatDate(new Date(), "GMT+3", "HH:mm"));
  } catch (e) {
    Logger.log("Ошибка снапшота: " + e);
  }
}

// ==========================================
// ВОССТАНОВЛЕНИЕ Лист1 ИЗ СНАПШОТА (ручной запуск)
// ==========================================
function restoreFromSnapshot() {
  var ss = SpreadsheetApp.getActive();
  var snap = ss.getSheetByName(BACKUP_SHEET);
  if (!snap) {
    Logger.log("Снапшота нет — сначала запустите hourlySnapshot");
    return;
  }
  var main = ss.getSheetByName("Лист1");
  if (!main) return;

  // Читаем снапшот до метки "=== ДЕТАЛИЗАЦИЯ ==="
  var snapData = snap.getDataRange().getValues();
  var rows = [];
  for (var i = 0; i < snapData.length; i++) {
    var first = String(snapData[i][0]);
    if (first.indexOf("=== ДЕТАЛИЗАЦИЯ ===") !== -1) break;
    // Пропускаем метку времени снапшота (справа)
    rows.push(snapData[i]);
  }

  if (rows.length === 0) {
    Logger.log("Снапшот пуст");
    return;
  }

  // Спрашиваем подтверждение
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    "Восстановление из снапшота",
    "Будет перезаписан Лист1 данными из последнего снапшота (" +
    "строк: " + rows.length + ").\nПродолжить?",
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  // Очищаем и заливаем
  var cols = Math.max(rows[0].length, main.getMaxColumns());
  main.getRange(1, 1, main.getMaxRows(), cols).clearContent();
  main.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  ui.alert("Готово", "Лист1 восстановлен из снапшота (" + rows.length + " строк)",
           ui.ButtonSet.OK);
}

// ==========================================
// ТРЕВОГА: удаление строк/столбцов (onChange триггер)
// ==========================================
function onTableChange(e) {
  try {
    var type = e.changeType; // REMOVE_ROW, REMOVE_COLUMN, INSERT_ROW, etc.

    if (type === "REMOVE_ROW" || type === "REMOVE_COLUMN") {
      var ss = SpreadsheetApp.getActive();

      // Мгновенная аварийная копия на Drive
      var file = DriveApp.getFileById(ss.getId());
      var folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
      var folder = folders.hasNext() ? folders.next() :
                   DriveApp.createFolder(BACKUP_FOLDER);
      var stamp = Utilities.formatDate(new Date(), "GMT+3", "dd.MM HH:mm");
      var what = (type === "REMOVE_ROW") ? "СТРОКИ" : "СТОЛБЦА";
      file.makeCopy("⚠️ АВТОСЕЙВ после удаления " + what + " — " + stamp, folder);

      // Алерт в ТГ
      sendTelegram(getTestChatId(),
        "⚠️ ВНИМАНИЕ! Обнаружено удаление " + what + "!\n\n" +
        "Время: " + stamp + "\n" +
        "Пользователь: " + (Session.getActiveUser().getEmail() || "неизвестен") + "\n\n" +
        "Создана аварийная копия таблицы.\n" +
        "Если удаление было случайным — запустите restoreFromSnapshot " +
        "в Apps Script или восстановите из копии на Drive.");

      Logger.log("ТРЕВОГА: " + type + " в " + stamp);
    }

    // На вставку тоже обновляем снапшот (структура могла измениться)
    if (type === "INSERT_ROW" || type === "INSERT_COLUMN" || type === "EDIT") {
      // лёгкое обновление не делаем — hourly справится
    }
  } catch (err) {
    Logger.log("Ошибка onTableChange: " + err);
  }
}

// ==========================================
// ЗАЩИТА ЛИСТОВ (предупреждение при удалении)
// ==========================================
function protectSheets() {
  var ss = SpreadsheetApp.getActive();
  var names = ["Лист1", "Детализация", "Сводка", "Календарь"];

  for (var i = 0; i < names.length; i++) {
    var sheet = ss.getSheetByName(names[i]);
    if (!sheet) continue;

    // Удаляем старую защиту с тем же описанием
    var prots = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var p = 0; p < prots.length; p++) {
      if (prots[p].getDescription() === "Бэкап-защита") {
        prots[p].remove();
      }
    }

    // Новая защита: предупреждение (не блокировка)
    var protection = sheet.protect().setDescription("Бэкап-защита");
    protection.setWarningOnly(true);
  }

  Logger.log("Защита-предупреждение установлена на: " + names.join(", "));
}

// ==========================================
// СПИСОК БЭКАПОВ (для проверки)
// ==========================================
function listBackups() {
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  if (!folders.hasNext()) {
    Logger.log("Папка бэкапов не найдена");
    return;
  }
  var folder = folders.next();
  var it = folder.getFiles();
  var out = "Бэкапы в папке «" + BACKUP_FOLDER + "»:\n";
  var count = 0;
  while (it.hasNext()) {
    var f = it.next();
    var d = Utilities.formatDate(f.getDateCreated(), "GMT+3", "dd.MM.yyyy HH:mm");
    out += "• " + f.getName() + " (" + d + ")\n";
    count++;
  }
  Logger.log(out + "Всего: " + count);
}
// ==========================================
// ПОЛЛИНГ getUpdates — вместо webhook (v2.4)
// Telegram НЕ шлёт апдейты: скрипт сам забирает их раз в минуту.
// Проблема 302 (webhook↔GAS) исчезает в корне. Спама больше нет.
// ==========================================
function setupPolling() {
  // 1. Удаляем webhook Telegram (если был установлен), чтобы getUpdates не выдавал 409 Conflict
  try {
    UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/deleteWebhook", { muteHttpExceptions: true });
  } catch (e) {
    Logger.log("Ошибка deleteWebhook: " + e);
  }

  // 2. Удаляем старые триггеры поллинга, чтобы не плодить дубли
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "pollUpdates") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("pollUpdates")
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log("✅ Поллинг установлен: pollUpdates каждую минуту");
}

function pollUpdates() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // защита от параллельного запуска

  try {
    var props = PropertiesService.getScriptProperties();
    var offset = Number(props.getProperty("TG_OFFSET") || 0);

    var url = "https://api.telegram.org/bot" + BOT_TOKEN +
              "/getUpdates?offset=" + (offset + 1) + "&limit=50&timeout=0";

    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, method: "get" });
    var data = JSON.parse(resp.getContentText());
    if (!data.ok || !data.result || data.result.length === 0) return;

    var maxId = offset;
    for (var i = 0; i < data.result.length; i++) {
      var upd = data.result[i];
      if (upd.update_id > maxId) maxId = upd.update_id;
      try {
        if (upd.callback_query) {
          handleCallback(upd.callback_query);   // кнопки: доставка/самовывоз/связаться
        } else if (upd.message) {
          handleMessage(upd.message);           // /start и заявки доставки
        }
      } catch (e) {
        Logger.log("Ошибка апдейта " + upd.update_id + ": " + e);
      }
    }
    // Сдвигаем offset: все апдейты до maxId считаем обработанными
    props.setProperty("TG_OFFSET", String(maxId));
  } catch (e) {
    Logger.log("Ошибка getUpdates: " + e);
  } finally {
    lock.releaseLock();
  }
}
// Снятие предупреждений с защищённых листов (тревога удаления остаётся — она в onTableChange)
function unprotectSheets() {
  var ss = SpreadsheetApp.getActive();
  var names = ["Лист1", "Детализация", "Сводка", "Календарь", "Настройки", "Telegram ID", "Проверка остатков"];
  var removed = 0;
  for (var i = 0; i < names.length; i++) {
    var sh = ss.getSheetByName(names[i]);
    if (!sh) continue;
    var prots = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    for (var p = 0; p < prots.length; p++) { prots[p].remove(); removed++; }
  }
  Logger.log("Снято защит-предупреждений: " + removed);
}
