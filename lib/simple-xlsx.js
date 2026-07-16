/* global self */
(function initSimpleXlsx(globalObject) {
  "use strict";

  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  function normalizeText(value) {
    return String(value == null ? "" : value).replace(/\u00a0/g, " ").trim();
  }

  function xmlEscape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function decodeXml(text) {
    return text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  function stripPrefix(name) {
    return name.includes(":") ? name.split(":").pop() : name;
  }

  function parseAttributes(raw) {
    const attributes = {};
    raw.replace(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g, (_, key, value) => {
      attributes[stripPrefix(key)] = decodeXml(value);
      return "";
    });
    return attributes;
  }

  function getText(xml, tagName) {
    const re = new RegExp(`<[^>:/]*:?${tagName}[^>]*>([\\s\\S]*?)<\\/[^>:/]*:?${tagName}>`, "i");
    const match = xml.match(re);
    return match ? decodeXml(match[1].replace(/<[^>]*>/g, "")) : "";
  }

  function columnIndex(ref) {
    const letters = String(ref || "").match(/[A-Z]+/i);
    if (!letters) return 0;
    let index = 0;
    for (const char of letters[0].toUpperCase()) {
      index = index * 26 + char.charCodeAt(0) - 64;
    }
    return index - 1;
  }

  function crc32(bytes) {
    let table = crc32.table;
    if (!table) {
      table = new Uint32Array(256);
      for (let i = 0; i < 256; i += 1) {
        let value = i;
        for (let bit = 0; bit < 8; bit += 1) {
          value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[i] = value >>> 0;
      }
      crc32.table = table;
    }
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function readUInt16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUInt32(view, offset) {
    return view.getUint32(offset, true);
  }

  function bytesToText(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  function textToBytes(text) {
    return new TextEncoder().encode(text);
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }

  function makeBuffer(size) {
    const buffer = new ArrayBuffer(size);
    return { buffer, view: new DataView(buffer), bytes: new Uint8Array(buffer) };
  }

  function dosTime(date = new Date()) {
    return (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  }

  function dosDate(date = new Date()) {
    return ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  }

  function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = new Date();
    const modTime = dosTime(now);
    const modDate = dosDate(now);
    for (const entry of entries) {
      const nameBytes = textToBytes(entry.name);
      const data = entry.data instanceof Uint8Array ? entry.data : textToBytes(entry.data || "");
      const crc = crc32(data);
      const local = makeBuffer(30 + nameBytes.length);
      local.view.setUint32(0, 0x04034b50, true);
      local.view.setUint16(4, 20, true);
      local.view.setUint16(6, 0x0800, true);
      local.view.setUint16(8, 0, true);
      local.view.setUint16(10, modTime, true);
      local.view.setUint16(12, modDate, true);
      local.view.setUint32(14, crc, true);
      local.view.setUint32(18, data.length, true);
      local.view.setUint32(22, data.length, true);
      local.view.setUint16(26, nameBytes.length, true);
      local.view.setUint16(28, 0, true);
      local.bytes.set(nameBytes, 30);
      localParts.push(local.bytes, data);

      const central = makeBuffer(46 + nameBytes.length);
      central.view.setUint32(0, 0x02014b50, true);
      central.view.setUint16(4, 20, true);
      central.view.setUint16(6, 20, true);
      central.view.setUint16(8, 0x0800, true);
      central.view.setUint16(10, 0, true);
      central.view.setUint16(12, modTime, true);
      central.view.setUint16(14, modDate, true);
      central.view.setUint32(16, crc, true);
      central.view.setUint32(20, data.length, true);
      central.view.setUint32(24, data.length, true);
      central.view.setUint16(28, nameBytes.length, true);
      central.view.setUint16(30, 0, true);
      central.view.setUint16(32, 0, true);
      central.view.setUint16(34, 0, true);
      central.view.setUint16(36, 0, true);
      central.view.setUint32(38, 0, true);
      central.view.setUint32(42, offset, true);
      central.bytes.set(nameBytes, 46);
      centralParts.push(central.bytes);

      offset += local.bytes.length + data.length;
    }
    const centralDirectory = concatBytes(centralParts);
    const end = makeBuffer(22);
    end.view.setUint32(0, 0x06054b50, true);
    end.view.setUint16(8, entries.length, true);
    end.view.setUint16(10, entries.length, true);
    end.view.setUint32(12, centralDirectory.length, true);
    end.view.setUint32(16, offset, true);
    end.view.setUint16(20, 0, true);
    return concatBytes([...localParts, centralDirectory, end.bytes]).buffer;
  }

  async function inflateRaw(bytes) {
    if (!globalObject.DecompressionStream) {
      throw new Error("当前 Chrome 不支持 DecompressionStream，无法离线解析 xlsx。");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new globalObject.DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const entries = {};
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
      if (readUInt32(view, i) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error("不是有效的 xlsx/zip 文件。");
    const count = readUInt16(view, end + 10);
    let offset = readUInt32(view, end + 16);
    for (let i = 0; i < count; i += 1) {
      if (readUInt32(view, offset) !== 0x02014b50) break;
      const method = readUInt16(view, offset + 10);
      const compressedSize = readUInt32(view, offset + 20);
      const uncompressedSize = readUInt32(view, offset + 24);
      const nameLength = readUInt16(view, offset + 28);
      const extraLength = readUInt16(view, offset + 30);
      const commentLength = readUInt16(view, offset + 32);
      const localOffset = readUInt32(view, offset + 42);
      const name = bytesToText(bytes.slice(offset + 46, offset + 46 + nameLength));
      offset += 46 + nameLength + extraLength + commentLength;
      if (!name || name.endsWith("/")) continue;
      const localNameLength = readUInt16(view, localOffset + 26);
      const localExtraLength = readUInt16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const payload = bytes.slice(dataStart, dataStart + compressedSize);
      let data;
      if (method === 0) {
        data = payload;
      } else if (method === 8) {
        data = await inflateRaw(payload);
      } else {
        throw new Error(`不支持的 zip 压缩方式：${method}`);
      }
      if (uncompressedSize && data.length !== uncompressedSize) {
        // Excel sometimes stores size 0 for streamed entries; only guard nonzero mismatches softly.
      }
      entries[name] = data;
    }
    return entries;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const values = [];
    const siRe = /<[^>:/]*:?si\b[^>]*>([\s\S]*?)<\/[^>:/]*:?si>/gi;
    let match;
    while ((match = siRe.exec(xml))) {
      const textParts = [];
      match[1].replace(/<[^>:/]*:?t\b[^>]*>([\s\S]*?)<\/[^>:/]*:?t>/gi, (_, text) => {
        textParts.push(decodeXml(text));
        return "";
      });
      values.push(textParts.join(""));
    }
    return values;
  }

  function parseWorkbook(entries) {
    const workbookXml = bytesToText(entries["xl/workbook.xml"] || new Uint8Array());
    const relsXml = bytesToText(entries["xl/_rels/workbook.xml.rels"] || new Uint8Array());
    const rels = {};
    relsXml.replace(/<[^>:/]*:?Relationship\b([^>]*)\/?>/gi, (_, rawAttrs) => {
      const attrs = parseAttributes(rawAttrs);
      if (attrs.Id && attrs.Target) rels[attrs.Id] = attrs.Target;
      return "";
    });
    const sheets = [];
    workbookXml.replace(/<[^>:/]*:?sheet\b([^>]*)\/?>/gi, (_, rawAttrs) => {
      const attrs = parseAttributes(rawAttrs);
      const relId = attrs.id || attrs["r:id"];
      let target = rels[relId] || "";
      if (target && !target.startsWith("xl/")) {
        target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      }
      sheets.push({ name: attrs.name || "Sheet", path: target || "xl/worksheets/sheet1.xml" });
      return "";
    });
    return sheets.length ? sheets : [{ name: "Sheet1", path: "xl/worksheets/sheet1.xml" }];
  }

  function parseSheet(xml, sharedStrings) {
    const rows = [];
    const rowRe = /<[^>:/]*:?row\b[^>]*>([\s\S]*?)<\/[^>:/]*:?row>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(xml))) {
      const row = [];
      const cellRe = /<[^>:/]*:?c\b([^>]*)>([\s\S]*?)<\/[^>:/]*:?c>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1]))) {
        const attrs = parseAttributes(cellMatch[1]);
        const type = attrs.t || "";
        const index = columnIndex(attrs.r);
        const inline = getText(cellMatch[2], "t");
        const rawValue = getText(cellMatch[2], "v");
        let value = rawValue;
        if (type === "s") value = sharedStrings[Number(rawValue)] || "";
        if (type === "inlineStr") value = inline;
        if (type === "b") value = rawValue === "1" ? "TRUE" : "FALSE";
        if (!type && rawValue !== "" && /^-?\d+(\.\d+)?$/.test(rawValue)) value = Number(rawValue);
        row[index] = value;
      }
      rows.push(row.map((cell) => (cell == null ? "" : cell)));
    }
    return rows;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === "," || char === "\t") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
    return rows;
  }

  async function readWorkbook(fileOrBuffer, name) {
    const arrayBuffer = fileOrBuffer instanceof ArrayBuffer ? fileOrBuffer : await fileOrBuffer.arrayBuffer();
    const fileName = name || fileOrBuffer.name || "";
    if (/^~\$/.test(fileName)) {
      throw new Error("不能读取 Excel 临时锁文件，请选择真正的 大箱价格.xlsx。");
    }
    if (/\.csv$|\.txt$/i.test(fileName)) {
      const text = new TextDecoder("utf-8").decode(arrayBuffer);
      return { sheets: [{ name: fileName || "CSV", rows: parseCsv(text) }], mime: "text/csv" };
    }
    const entries = await unzip(arrayBuffer);
    const sharedStrings = parseSharedStrings(bytesToText(entries["xl/sharedStrings.xml"] || new Uint8Array()));
    const workbookSheets = parseWorkbook(entries);
    const sheets = workbookSheets.map((sheet) => ({
      name: sheet.name,
      rows: parseSheet(bytesToText(entries[sheet.path] || new Uint8Array()), sharedStrings)
    }));
    return { sheets, mime: XLSX_MIME };
  }

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = normalizeText(value).replace(/,/g, "");
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function titleUnits(value) {
    let units = 0;
    for (const char of String(value || "")) {
      units += /[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1;
    }
    return units;
  }

  function trimToUnits(value, maxUnits) {
    let output = "";
    let units = 0;
    for (const char of String(value || "")) {
      const next = /[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1;
      if (units + next > maxUnits) break;
      output += char;
      units += next;
    }
    return output;
  }

  function normalizeSkuSeparators(value) {
    return normalizeText(value)
      .replace(/[＊×xX]/g, "*")
      .replace(/[－—–_]/g, "-")
      .replace(/\s+/g, "");
  }

  function shortenSkuDisplayName(value, maxUnits = 32) {
    const original = normalizeSkuSeparators(value);
    if (!original) return "";
    const withoutBracket = original
      .replace(/^【[^】]*】/, "")
      .replace(/^(\[[^\]]*\])/, "")
      .replace(/^(高清|优质)?(三防|热敏|不干胶)?(横版|竖版|方型|方形)?/, "");
    const candidates = [withoutBracket, original];
    const sizeMatch = original.match(/\d{1,4}\*\d{1,4}[\s\S]*/);
    if (sizeMatch) candidates.unshift(sizeMatch[0]);
    for (const candidate of candidates) {
      const cleaned = normalizeSkuSeparators(candidate);
      if (cleaned && titleUnits(cleaned) <= maxUnits) return cleaned;
    }
    for (const candidate of candidates) {
      const cleaned = normalizeSkuSeparators(candidate).replace(/\/箱$/, "");
      if (cleaned && titleUnits(cleaned) <= maxUnits) return cleaned;
    }
    const fallback = normalizeSkuSeparators(candidates[0] || original);
    return trimToUnits(fallback, maxUnits);
  }

  function columnName(index) {
    let value = index + 1;
    let name = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  }

  function createSheetXml(rows) {
    const rowXml = rows
      .map((row, rowIndex) => {
        const cells = row
          .map((cell, columnIndex) => {
            const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
            if (typeof cell === "number" && Number.isFinite(cell)) {
              return `<c r="${ref}"><v>${cell}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
          })
          .join("");
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join("");
    const lastColumn = columnName(Math.max(0, (rows[0] || []).length - 1));
    const lastRow = Math.max(1, rows.length);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
  }

  function createWorkbook(rows) {
    const entries = [
      {
        name: "[Content_Types].xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`
      },
      {
        name: "_rels/.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
      },
      {
        name: "xl/workbook.xml",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="SKU" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
      },
      {
        name: "xl/worksheets/sheet1.xml",
        data: createSheetXml(rows)
      }
    ];
    return createZip(entries);
  }

  function createSkuUploadWorkbook(skuRows) {
    const rows = [
      ["颜色分类", "客户到手价", "数量", "商家编码", "条形码"],
      ...(skuRows || []).map((row) => [
        row.sku_display_name || shortenSkuDisplayName(row.sku_name),
        row.price ?? row.integer_price ?? "",
        row.stock ?? "",
        row.merchant_code || "",
        row.barcode || ""
      ])
    ];
    return createWorkbook(rows);
  }

  const REQUIRED_ALIASES = {
    sku_name: ["颜色分类", "规格", "SKU", "sku", "颜色"],
    price: ["客户到手价", "价格", "一口价", "售价"],
    stock: ["数量", "库存", "商品数量"],
    merchant_code: ["商家编码", "商家SKU", "SKU编码", "编码"]
  };

  const OPTIONAL_ALIASES = {
    barcode: ["条形码", "条码", "barcode"]
  };

  function findHeader(rows) {
    const limit = Math.min(rows.length, 20);
    for (let index = 0; index < limit; index += 1) {
      const labels = rows[index].map(normalizeText);
      const mapping = {};
      for (const [field, aliases] of Object.entries({ ...REQUIRED_ALIASES, ...OPTIONAL_ALIASES })) {
        const found = aliases.find((alias) => labels.includes(alias));
        if (found) mapping[field] = labels.indexOf(found);
      }
      if (Object.keys(REQUIRED_ALIASES).every((field) => field in mapping)) {
        return { rowIndex: index, mapping, headers: labels };
      }
    }
    throw new Error("未找到包含 颜色分类/客户到手价/数量/商家编码 的表头行。");
  }

  function normalizeSkuRows(rows, sheetName) {
    const header = findHeader(rows);
    const items = [];
    const validItems = [];
    const errors = [];
    const warnings = [];
    for (let i = header.rowIndex + 1; i < rows.length; i += 1) {
      const row = rows[i] || [];
      if (!row.some((cell) => normalizeText(cell))) continue;
      const skuName = normalizeText(row[header.mapping.sku_name]);
      const price = toNumber(row[header.mapping.price]);
      const stock = toNumber(row[header.mapping.stock]);
      const merchantCode = normalizeText(row[header.mapping.merchant_code]);
      const barcode = "barcode" in header.mapping ? normalizeText(row[header.mapping.barcode]) : "";
      const rowNumber = i + 1;
      const rowErrors = [];
      if (!skuName) rowErrors.push(`第 ${rowNumber} 行缺少 SKU/颜色分类`);
      if (price == null) rowErrors.push(`第 ${rowNumber} 行价格无效`);
      if (stock == null) rowErrors.push(`第 ${rowNumber} 行库存/数量无效`);
      if (!merchantCode) rowErrors.push(`第 ${rowNumber} 行缺少商家编码`);
      errors.push(...rowErrors);
      if (price != null && !Number.isInteger(price)) warnings.push(`第 ${rowNumber} 行价格 ${price} 需要取整数`);
      if (!barcode) warnings.push(`第 ${rowNumber} 行条形码为空`);
      const skuDisplayName = shortenSkuDisplayName(skuName);
      if (skuDisplayName && skuDisplayName !== skuName) warnings.push(`第 ${rowNumber} 行 SKU 展示名已缩短为 ${skuDisplayName}`);
      const item = {
        row: rowNumber,
        sku_name: skuName,
        sku_display_name: skuDisplayName || skuName,
        price,
        integer_price: price == null ? null : Math.round(price),
        stock: stock == null ? null : Number.isInteger(stock) ? stock : stock,
        merchant_code: merchantCode,
        barcode
      };
      items.push(item);
      if (!rowErrors.length) validItems.push(item);
    }
    return {
      ok: validItems.length > 0,
      sheet: sheetName,
      header_row: header.rowIndex + 1,
      headers: header.headers,
      mapping: header.mapping,
      row_count: items.length,
      valid_row_count: validItems.length,
      errors,
      warnings: warnings.slice(0, 50),
      warning_count: warnings.length,
      rows: validItems
    };
  }

  globalObject.SimpleXlsx = {
    readWorkbook,
    normalizeSkuRows,
    normalizeText,
    shortenSkuDisplayName,
    titleUnits,
    createSkuUploadWorkbook
  };
})(typeof self !== "undefined" ? self : window);
