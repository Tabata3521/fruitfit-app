import fs from "node:fs";
import path from "node:path";
import { Innertube } from "youtubei.js";

const CHANNEL_ID = "UCNvRQaFdfLynkkh3y5bWXIA";
const CHANNEL_URL = "https://youtube.com/@tagirfruit";
const OUT_DIR = "youtube-exercise-library";
const EXERCISE_CATALOG_PATH = "public/data/exercise-catalog.json";

const exerciseCatalogNames = fs.existsSync(EXERCISE_CATALOG_PATH)
  ? JSON.parse(fs.readFileSync(EXERCISE_CATALOG_PATH, "utf8"))
    .map((item) => lowerForMatch(item.name))
    .filter((name) => name.length >= 6 && !/^\d+$/.test(name))
  : [];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+[—-]\s*техника выполнения упражнения.*$/i, "")
    .replace(/\s+техника выполнения упражнения.*$/i, "")
    .replace(/\s+техника выполнения.*$/i, "")
    .replace(/[|#].*$/g, "")
    .trim();
}

function stripTags(value) {
  return normalize(value)
    .replace(/#[^\s#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lowerForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value) {
  return normalize(value).toLowerCase().replace(/ё/g, "е");
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function bestThumbnail(thumbnails = [], videoId) {
  const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function titleFromGridItem(item) {
  return item?.overlay_metadata?.primary_text?.text || item?.title?.text || item?.title || "";
}

function videoIdFromGridItem(item) {
  return item?.on_tap_endpoint?.payload?.videoId || item?.id || "";
}

function isExerciseVideo(title) {
  const text = lower(title);
  const clean = lowerForMatch(stripTags(title));

  if (/техника выполнения упражнения|техника выполнения/.test(text)) return true;
  if (
    clean.length >= 4 &&
    exerciseCatalogNames.some((name) => clean === name || clean.includes(name) || (clean.length >= 8 && name.includes(clean)))
  ) {
    return true;
  }

  const exerciseKeyword = /(бицепс|трицепс|гильотина|жим|тяга|подтяг|присед|выпад|планк|планка|скручив|сгибание|разгибание|махи|гиперэкстенз|ягодич|мост|кроссовер|скамь[ея] скотта|гантел|штанг|резинк|кардио|зарядка|растяжк|осанк|пресс|дельт|грудн|широч)/.test(clean);
  const educationalOnly = /^(как|почему|зачем|а |ты |если |какими |какой |какая |какое |что |в чем |ген|диет|питани|мотивац|здоров|сон|метаболизм)/.test(clean);

  if (exerciseKeyword && !educationalOnly) return true;
  if (/#упражнения|#грудные|#бицепс|#трицепс|#пресс|#ягодицы|#осанка|#растяжка/i.test(title) && exerciseKeyword) return true;

  return false;
}

function categorize(title) {
  const text = lower(title);

  if (/груд|отжим|жим леж|сведение рук|бабочк/.test(text)) return "грудь";
  if (/спин|подтяг|тяга верх|вертикальн.*тяга|горизонтальн.*тяга|гребн.*тяга|тяга к пояс|широч/.test(text)) return "спина";
  if (/ног|присед|выпад|разгибание ног|сгибание ног|жим ног|икр|голен|квадрицепс|бедр/.test(text)) return "ноги";
  if (/ягод|хип траст|мост|отведение бедра|разведение ног/.test(text)) return "ягодицы";
  if (/плеч|дельт|махи|подъем.*рук|жим сидя|армейский жим|разведение.*гантел/.test(text)) return "плечи";
  if (/бицепс|сгибание рук|молот|зотман/.test(text)) return "бицепс";
  if (/трицепс|разгибание рук|французский жим/.test(text)) return "трицепс";
  if (/пресс|скручив|планк|планка|кор|вакуум|подъем ног/.test(text)) return "пресс";

  return "needs_review";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function writeCsv(filePath, rows, columns) {
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, `\uFEFF${csv}\n`, "utf8");
}

async function collectGridItems(yt) {
  const channel = await yt.getChannel(CHANNEL_ID);
  const seen = new Map();
  const sources = [];

  async function collectFromPage(source, page) {
    let current = page;
    let pageIndex = 0;

    while (current) {
      const items = current.videos || [];
      for (const item of items) {
        const videoId = videoIdFromGridItem(item);
        if (!videoId || seen.has(videoId)) continue;
        seen.set(videoId, {
          video_id: videoId,
          title: titleFromGridItem(item),
          source,
          source_page: pageIndex,
        });
      }

      try {
        current = await current.getContinuation();
        pageIndex += 1;
        await sleep(150);
      } catch (_) {
        current = null;
      }
    }
  }

  if (channel.has_videos) {
    sources.push(["videos", await channel.getVideos()]);
  }

  if (channel.has_shorts) {
    sources.push(["shorts", await channel.getShorts()]);
  }

  for (const [source, page] of sources) {
    await collectFromPage(source, page);
  }

  return [...seen.values()];
}

async function getInfoWithRetry(yt, videoId, attempt = 1) {
  try {
    return await yt.getInfo(videoId);
  } catch (error) {
    if (attempt >= 3) throw error;
    await sleep(800 * attempt);
    return getInfoWithRetry(yt, videoId, attempt + 1);
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  ensureDir(OUT_DIR);

  const yt = await Innertube.create();
  const gridItems = await collectGridItems(yt);
  console.log(`Found ${gridItems.length} channel video items. Fetching metadata...`);

  const allVideos = await mapLimit(gridItems, 4, async (item, index) => {
    try {
      const info = await getInfoWithRetry(yt, item.video_id);
      const basic = info.basic_info || {};
      const title = basic.title || item.title || "";
      const uploadDate = info.primary_info?.published?.text || info.primary_info?.relative_date?.text || "";

      if ((index + 1) % 25 === 0 || index === gridItems.length - 1) {
        console.log(`Metadata ${index + 1}/${gridItems.length}`);
      }

      return {
        title,
        normalized_title: normalize(title),
        youtube_url: `https://www.youtube.com/watch?v=${item.video_id}`,
        shorts_url: `https://www.youtube.com/shorts/${item.video_id}`,
        video_id: item.video_id,
        thumbnail_url: bestThumbnail(basic.thumbnail || [], item.video_id),
        duration: formatDuration(Number(basic.duration || 0)),
        duration_seconds: Number(basic.duration || 0) || "",
        upload_date: uploadDate,
        category: categorize(title),
        source: item.source,
        is_exercise_video: isExerciseVideo(title),
      };
    } catch (error) {
      console.warn(`Failed ${item.video_id}: ${error.message}`);
      return {
        title: item.title || "",
        normalized_title: normalize(item.title || ""),
        youtube_url: `https://www.youtube.com/watch?v=${item.video_id}`,
        shorts_url: `https://www.youtube.com/shorts/${item.video_id}`,
        video_id: item.video_id,
        thumbnail_url: bestThumbnail([], item.video_id),
        duration: "",
        duration_seconds: "",
        upload_date: "",
        category: categorize(item.title || ""),
        source: item.source,
        is_exercise_video: isExerciseVideo(item.title || ""),
        error: error.message,
      };
    }
  });

  const exercises = allVideos
    .filter((item) => item.is_exercise_video)
    .map((item) => ({
      title: item.title,
      normalized_title: item.normalized_title,
      youtube_url: item.youtube_url,
      video_id: item.video_id,
      thumbnail_url: item.thumbnail_url,
      duration: item.duration,
      upload_date: item.upload_date,
      category: item.category,
      shorts_url: item.shorts_url,
      source: item.source,
    }))
    .sort((a, b) => a.normalized_title.localeCompare(b.normalized_title, "ru"));

  const allSorted = allVideos.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  const breakdown = exercises.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});

  const compactColumns = ["title", "normalized_title", "youtube_url", "thumbnail_url", "category"];
  const fullColumns = [
    "title",
    "normalized_title",
    "youtube_url",
    "video_id",
    "thumbnail_url",
    "duration",
    "upload_date",
    "category",
    "shorts_url",
    "source",
  ];

  fs.writeFileSync(path.join(OUT_DIR, "all_videos.json"), `${JSON.stringify(allSorted, null, 2)}\n`, "utf8");
  writeCsv(path.join(OUT_DIR, "all_videos.csv"), allSorted, [...fullColumns, "is_exercise_video"]);

  fs.writeFileSync(path.join(OUT_DIR, "exercises.json"), `${JSON.stringify(exercises, null, 2)}\n`, "utf8");
  writeCsv(path.join(OUT_DIR, "exercises.csv"), exercises, fullColumns);
  writeCsv(path.join(OUT_DIR, "exercises_compact.csv"), exercises, compactColumns);

  fs.writeFileSync(path.join(OUT_DIR, "youtube_links.txt"), `${exercises.map((item) => item.youtube_url).join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "all_youtube_links.txt"), `${allSorted.map((item) => item.youtube_url).join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "export-log.json"), `${JSON.stringify({
    channel_id: CHANNEL_ID,
    channel_url: CHANNEL_URL,
    exported_at: new Date().toISOString(),
    all_video_items: allSorted.length,
    exercise_videos: exercises.length,
    category_breakdown: Object.fromEntries(Object.entries(breakdown).sort((a, b) => a[0].localeCompare(b[0], "ru"))),
    files: [
      "all_videos.json",
      "all_videos.csv",
      "exercises.json",
      "exercises.csv",
      "exercises_compact.csv",
      "youtube_links.txt",
      "all_youtube_links.txt",
    ],
  }, null, 2)}\n`, "utf8");

  console.log(JSON.stringify({
    channel_id: CHANNEL_ID,
    all_video_items: allSorted.length,
    exercise_videos: exercises.length,
    category_breakdown: Object.fromEntries(Object.entries(breakdown).sort((a, b) => a[0].localeCompare(b[0], "ru"))),
    output_dir: path.resolve(OUT_DIR),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
