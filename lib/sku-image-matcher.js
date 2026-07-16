/* global self */
(function initSkuImageMatcher(globalObject) {
  "use strict";

  const MATERIALS = ["三防", "热敏", "不干胶", "面单", "合成纸", "铜版", "铜版纸", "彩色热敏", "彩色铜版"];
  const SHAPES = ["横版", "竖版", "方型", "方形", "圆形"];
  const COLORS = ["白底", "蓝底"];
  const IMAGE_FILE_RE = /(?:^|[\s/\\])([^/\\\s]+?\.(?:jpe?g|png|webp|gif|bmp))\b/gi;

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .replace(/\u00a0/g, " ")
      .replace(/[＊×*]/g, "x")
      .replace(/[，。；;：:、/\\()[\]【】{}<>《》"'`~!！?？|_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function compact(value) {
    return normalizeText(value).replace(/[^0-9a-z\u4e00-\u9fff]+/gi, "");
  }

  function extractSizes(value) {
    const text = String(value == null ? "" : value)
      .replace(/\u00a0/g, " ")
      .replace(/[＊×*]/g, "x")
      .replace(/[－—–_]/g, "-")
      .toLowerCase();
    const found = [];
    text.replace(/(?<!\d)(\d{1,4})\s*(?:x|-)\s*(\d{1,4})(?!\d)/g, (_, width, height) => {
      found.push(`${Number(width)}x${Number(height)}`);
      return "";
    });
    return [...new Set(found)];
  }

  function unique(items) {
    return [...new Set((items || []).filter(Boolean))];
  }

  function isPixelSize(size) {
    const [width, height] = String(size || "").split("x").map(Number);
    return width >= 300 && height >= 300;
  }

  function extractProductSizes(value) {
    return extractSizes(value).filter((size) => !isPixelSize(size));
  }

  function extractFileNames(value) {
    const text = ` ${String(value == null ? "" : value)} `;
    return unique([...text.matchAll(IMAGE_FILE_RE)].map((match) => match[1]));
  }

  function extractKeywords(value, keywords) {
    const text = compact(value);
    return keywords.filter((keyword) => text.includes(compact(keyword)));
  }

  function extractPackages(value) {
    const text = normalizeText(value);
    const found = new Set();
    text.replace(/(\d{1,6})\s*(张|卷|箱|包|枚|个|万张)/g, (_, amount, unit) => {
      found.add(`${Number(amount)}${unit}`);
      return "";
    });
    ["试用", "整箱", "小箱", "单卷", "折叠", "卷筒", "双排", "三排", "白底", "蓝底"].forEach((keyword) => {
      if (text.includes(keyword)) found.add(keyword);
    });
    return [...found];
  }

  function extractColors(value) {
    const text = String(value == null ? "" : value);
    const normalized = normalizeText(text);
    const compacted = compact(text);
    const found = new Set();
    if (compacted.includes("白底") || /白\s*\.(?:jpe?g|png|webp|gif|bmp)\b/i.test(text) || /(?:^|[\s_-])白(?:[\s_.-]|$)/i.test(text)) {
      found.add("白底");
    }
    if (compacted.includes("蓝底") || /蓝\s*\.(?:jpe?g|png|webp|gif|bmp)\b/i.test(text) || /(?:^|[\s_-])蓝(?:[\s_.-]|$)/i.test(text)) {
      found.add("蓝底");
    }
    COLORS.forEach((color) => {
      if (normalized.includes(color)) found.add(color);
    });
    return [...found];
  }

  function describeSku(raw) {
    const text = `${raw.sku_name || raw.skuName || ""} ${raw.merchant_code || raw.merchantCode || ""}`;
    return {
      ...raw,
      sku_name: raw.sku_name || raw.skuName || "",
      merchant_code: raw.merchant_code || raw.merchantCode || "",
      search_text: text,
      compact_text: compact(text),
      sizes: extractSizes(text),
      materials: extractKeywords(text, MATERIALS),
      shapes: extractKeywords(text, SHAPES),
      colors: extractColors(text),
      packages: extractPackages(text)
    };
  }

  function describeImage(raw) {
    const primaryText = [
      raw.name,
      raw.alt,
      raw.title,
      raw.assetName,
      raw.fileName,
      raw.relativePath
    ].filter(Boolean).join(" ");
    const secondaryText = [
      raw.cardText,
      raw.path,
      raw.folder,
      raw.src
    ].filter(Boolean).join(" ");
    const text = [primaryText, secondaryText].filter(Boolean).join(" ");
    const primaryFileNames = extractFileNames(primaryText);
    const secondaryFileNames = extractFileNames(secondaryText);
    const primaryFileSizes = unique(primaryFileNames.flatMap(extractProductSizes));
    const secondaryFileSizes = unique(secondaryFileNames.flatMap(extractProductSizes));
    const primarySizes = extractProductSizes(primaryText);
    const fallbackSizes = extractProductSizes(text);
    const secondaryConflictSizes = secondaryFileSizes.filter((size) => !primaryFileSizes.includes(size));
    const ambiguousSizes = primaryFileSizes.length > 1 || secondaryFileSizes.length > 1 && (!primaryFileSizes.length || secondaryConflictSizes.length > 0);
    const sizes = ambiguousSizes
      ? []
      : (primaryFileSizes.length ? primaryFileSizes : primarySizes.length ? primarySizes : secondaryFileSizes.length ? secondaryFileSizes : fallbackSizes);
    return {
      ...raw,
      search_text: text,
      compact_text: compact(text),
      sizes,
      primaryFileNames,
      secondaryFileNames,
      fileNames: unique([...primaryFileNames, ...secondaryFileNames]),
      ambiguousSizes,
      materials: extractKeywords(text, MATERIALS),
      shapes: extractKeywords(text, SHAPES),
      colors: extractColors(text),
      packages: extractPackages(text)
    };
  }

  function imageLogicalKey(rawImage) {
    const image = rawImage?.compact_text ? rawImage : describeImage(rawImage || {});
    const preferredFileNames = image.primaryFileNames?.length ? image.primaryFileNames : image.fileNames;
    const fileNames = unique(preferredFileNames || []).map((name) => compact(name)).sort();
    const explicitFolder = compact(image.folder || "");
    const relativeFolder = compact(String(image.relativePath || "").replace(/[^/\\]+$/, ""));
    if (fileNames.length === 1 && !image.ambiguousSizes) {
      return [
        `file:${fileNames[0]}`,
        `sizes:${[...(image.sizes || [])].sort().join(",")}`,
        `colors:${[...(image.colors || [])].sort().join(",")}`,
        `materials:${[...(image.materials || [])].sort().join(",")}`,
        `shapes:${[...(image.shapes || [])].sort().join(",")}`,
        `packages:${[...(image.packages || [])].sort().join(",")}`,
        `folder:${unique([explicitFolder, relativeFolder]).sort().join(",")}`
      ].join("|");
    }
    return `asset:${compact(image.src || image.path || image.name || image.cardText || "unknown")}`;
  }

  function collapseEquivalentImages(rawImages) {
    const collapsed = new Map();
    for (const rawImage of rawImages || []) {
      const image = rawImage?.compact_text ? rawImage : describeImage(rawImage);
      const logicalKey = imageLogicalKey(image);
      const existing = collapsed.get(logicalKey);
      if (!existing) {
        collapsed.set(logicalKey, {
          ...image,
          logicalKey,
          duplicateCount: 1,
          equivalentSources: unique([image.src]),
          equivalentPaths: unique([image.path])
        });
        continue;
      }
      existing.duplicateCount += 1;
      existing.equivalentSources = unique([...existing.equivalentSources, image.src]);
      existing.equivalentPaths = unique([...existing.equivalentPaths, image.path]);
    }
    return [...collapsed.values()];
  }

  function overlap(left, right) {
    const rightSet = new Set(right || []);
    return [...new Set(left || [])].filter((item) => rightSet.has(item));
  }

  function scoreCandidate(rawSku, rawImage) {
    const sku = rawSku.compact_text ? rawSku : describeSku(rawSku);
    const image = rawImage.compact_text ? rawImage : describeImage(rawImage);
    const merchant = compact(sku.merchant_code);
    const reasons = [];
    const flags = [];
    let score = 0;

    if (image.ambiguousSizes) {
      flags.push("图片卡片含多个尺寸，跳过自动填充");
      return {
        image,
        confidence: 0,
        reason: "图片卡片尺寸冲突",
        directSizeMatch: false,
        flags
      };
    }

    if (merchant && image.compact_text.includes(merchant)) {
      score += 0.48;
      reasons.push("商家编码");
    }

    const sizeHits = overlap(sku.sizes, image.sizes);
    if (sizeHits.length) {
      score += 0.82;
      reasons.push(`尺寸:${sizeHits.join(",")}`);
    } else if (sku.sizes.length && image.sizes.length) {
      const reversed = sku.sizes.map((size) => size.split("x").reverse().join("x"));
      const reversedHits = overlap(reversed, image.sizes);
      if (reversedHits.length) {
        score += 0.35;
        reasons.push(`反向尺寸:${reversedHits.join(",")}`);
        flags.push("图片尺寸顺序与SKU相反");
      }
    }

    const skuLane = sku.packages.includes("双排") ? "双排" : sku.packages.includes("三排") ? "三排" : "";
    const imageLaneText = `${(image.fileNames || []).join(" ")} ${image.search_text || ""}`;
    const imageLane = /双排|双\s*\d{1,4}\s*(?:x|-)/i.test(imageLaneText) ? "双排" : /三排/i.test(imageLaneText) ? "三排" : "";
    if (sizeHits.length && skuLane && imageLane === skuLane) {
      score += 0.07;
      reasons.push(`排版:${skuLane}`);
    } else if (sizeHits.length && skuLane && imageLane && imageLane !== skuLane) {
      score -= 0.08;
      flags.push("图片排版疑似不一致");
    } else if (sizeHits.length && !skuLane && imageLane) {
      score -= 0.04;
      flags.push("普通SKU疑似匹配到排版图");
    }

    const colorHits = overlap(sku.colors, image.colors);
    if (colorHits.length) {
      score += 0.18;
      reasons.push(`颜色:${colorHits.join(",")}`);
    } else if (sku.colors.length && image.colors.length) {
      score -= 0.25;
      flags.push("颜色不一致");
    } else if (sku.colors.length && !image.colors.length) {
      score -= 0.12;
      flags.push("图片颜色未识别");
    } else if (!sku.colors.length && image.colors.length) {
      score -= 0.04;
      flags.push("普通SKU疑似匹配到颜色图");
    }

    const materialHits = overlap(sku.materials, image.materials);
    if (materialHits.length) {
      score += 0.12;
      reasons.push(`材质:${materialHits.join(",")}`);
    }

    const shapeHits = overlap(sku.shapes, image.shapes);
    if (shapeHits.length) {
      score += 0.05;
      reasons.push(`版型:${shapeHits.join(",")}`);
    }

    const packageHits = overlap(sku.packages, image.packages);
    if (packageHits.length) {
      score += 0.09;
      reasons.push(`包装:${packageHits.join(",")}`);
    }

    if (!sizeHits.length && (sku.packages.includes("整箱") || sku.search_text.includes("/箱")) && !packageHits.length) {
      flags.push("箱装SKU复用小箱图需确认");
      score -= 0.08;
    }
    if (sku.sizes.length && !image.sizes.length) flags.push("图片名称未识别尺寸");
    if (!sizeHits.length && sku.materials.length && image.materials.length && !materialHits.length) {
      flags.push("材质疑似不一致");
      score -= 0.1;
    }

    score = Math.max(0, Math.min(1, score));
    return {
      image,
      confidence: Number(score.toFixed(3)),
      reason: reasons.join("，") || "弱匹配",
      directSizeMatch: sizeHits.length > 0,
      flags
    };
  }

  function classify(candidates, minConfidence) {
    const ranked = candidates
      .filter((candidate) => candidate.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
    const best = ranked[0] || null;
    if (!best || best.confidence < 0.25) return { status: "missing", best: null, candidates: ranked.slice(0, 5) };
    const second = ranked[1];
    const secondIsCloseDirect = second && second.directSizeMatch && second.confidence >= 0.5 && best.confidence - second.confidence < 0.08;
    const secondIsClearlyWorse = second?.flags?.some((flag) => /不一致|疑似匹配到|未识别|顺序与SKU相反/.test(flag));
    const bestHasExplicitPreference = /颜色:|排版:|商家编码|包装:|材质:|版型:/.test(best.reason || "");
    if (best.directSizeMatch && secondIsCloseDirect && !secondIsClearlyWorse && !bestHasExplicitPreference) {
      return { status: "ambiguous", best, candidates: ranked.slice(0, 5) };
    }
    const onlyLayoutWarnings = best.flags.length > 0 && best.flags.every((flag) => /排版|排版图/.test(flag));
    if (best.directSizeMatch && (best.confidence >= minConfidence || onlyLayoutWarnings) && !best.flags.includes("图片尺寸顺序与SKU相反")) {
      return { status: "auto", best, candidates: ranked.slice(0, 5) };
    }
    if (!best.directSizeMatch) {
      return { status: "review", best, candidates: ranked.slice(0, 5) };
    }
    if (second && second.confidence >= 0.5 && best.confidence - second.confidence < 0.08) {
      return { status: "ambiguous", best, candidates: ranked.slice(0, 5) };
    }
    if (best.confidence >= minConfidence && best.flags.length === 0) {
      return { status: "auto", best, candidates: ranked.slice(0, 5) };
    }
    return { status: "review", best, candidates: ranked.slice(0, 5) };
  }

  function buildMatchPlan(skus, images, options = {}) {
    const minConfidence = Number(options.minConfidence || 0.78);
    const describedImages = collapseEquivalentImages(images);
    const items = skus.map((rawSku, index) => {
      const sku = describeSku({ ...rawSku, index });
      const scored = describedImages.map((image) => scoreCandidate(sku, image));
      const match = classify(scored, minConfidence);
      return {
        index,
        row: sku.row,
        sku_name: sku.sku_name,
        merchant_code: sku.merchant_code,
        status: match.status,
        confidence: match.best?.confidence || 0,
        reason: match.best?.reason || "未找到可信图片",
        flags: match.best?.flags || [],
        image: match.best?.image || null,
        candidates: match.candidates.map((candidate) => ({
          confidence: candidate.confidence,
          reason: candidate.reason,
          directSizeMatch: candidate.directSizeMatch,
          flags: candidate.flags,
          image: candidate.image
        }))
      };
    });
    return {
      ok: items.every((item) => item.status === "auto"),
      sku_count: skus.length,
      image_count: images.length,
      logical_image_count: describedImages.length,
      duplicate_image_count: Math.max(0, images.length - describedImages.length),
      minConfidence,
      auto_count: items.filter((item) => item.status === "auto").length,
      review_count: items.filter((item) => item.status === "review").length,
      ambiguous_count: items.filter((item) => item.status === "ambiguous").length,
      missing_count: items.filter((item) => item.status === "missing").length,
      items
    };
  }

  const api = {
    MATERIALS,
    SHAPES,
    COLORS,
    normalizeText,
    compact,
    extractSizes,
    extractProductSizes,
    extractFileNames,
    extractPackages,
    extractColors,
    describeSku,
    describeImage,
    imageLogicalKey,
    collapseEquivalentImages,
    scoreCandidate,
    buildMatchPlan
  };

  globalObject.SkuImageMatcher = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
