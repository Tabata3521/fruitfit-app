import { decodeText } from "../utils/decodeText.js";

export const canonicalMuscleLabels = [
  "Косые мышцы живота",
  "Квадрицепс / ягодицы",
  "Широчайшие",
  "Большая ягодичная",
  "Широчайшие / бицепс",
  "Большие грудные",
  "Разгибатели позвоночника",
  "Квадратная мышца поясницы",
  "Средняя грудь",
  "Квадрицепс",
  "Нижняя грудь",
  "Бицепс бедра",
  "Верх груди",
  "Бицепс бедра / ягодицы",
  "Приводящие / ягодицы",
  "Средняя ягодичная / квадрицепс",
  "Приводящие / отводящие бедра",
  "Задняя дельта",
  "Передняя / средняя дельта",
  "Верх спины",
  "Ротаторная манжета плеча",
  "Средняя дельта",
  "Передняя дельта",
  "Кор",
  "Прямая мышца живота",
  "Грудные / трицепс",
  "Ягодицы / спина",
  "Трицепс",
  "Нижняя грудь / трицепс",
  "Бицепс",
  "Бицепс / брахиалис",
  "Брахиалис / предплечье",
  "Внутренняя головка бицепса",
  "Растяжка на все тело",
];

export const muscleLabelAliases = {
  "Средняя / передняя дельта": "Передняя / средняя дельта",
  "Средняя дельта / трапеция": "Средняя дельта",
  "Ягодицы / приводящие мышцы": "Приводящие / ягодицы",
  "Трицепс / грудь": "Грудные / трицепс",
  "Нижний пресс": "Прямая мышца живота",
  "Мышцы кора": "Кор",
  "Широчайшие мышцы спины": "Широчайшие",
  "Грудные мышцы": "Большие грудные",
  "Грудные": "Большие грудные",
  "Ягодицы": "Большая ягодичная",
  "Средняя ягодичная": "Средняя ягодичная / квадрицепс",
  "Приводящие": "Приводящие / ягодицы",
  "Отводящие бедра": "Приводящие / отводящие бедра",
  "Плечевой пояс": "Передняя / средняя дельта",
  "Кор / косые мышцы": "Косые мышцы живота",
  "Квадрицепс / ягодицы / кор": "Квадрицепс / ягодицы",
  "Ягодицы / квадрицепс": "Квадрицепс / ягодицы",
  "Внутренняя грудь": "Большие грудные",
  "Грудные / стабилизаторы": "Большие грудные",
  "Кор / стабилизаторы": "Кор",
  "Трапеция": "Верх спины",
  "Трапеции": "Верх спины",
  "Трапеция / широчайшие": "Верх спины",
  "Низ спины": "Разгибатели позвоночника",
  "Пресс": "Прямая мышца живота",
  "Прямая мышца живота / пресс": "Прямая мышца живота",
};

export const muscleImageMap = {
  "Косые мышцы живота": "/muscle-templates/manual/core_obliques.png",
  "Квадрицепс / ягодицы": "/muscle-templates/manual/lower_quads_glutes.png",
  "Широчайшие": "/muscle-templates/manual/upper_lats.png",
  "Большая ягодичная": "/muscle-templates/manual/lower_glute_maximus.png",
  "Широчайшие / бицепс": "/muscle-templates/manual/upper_lats_biceps.png",
  "Большие грудные": "/muscle-templates/manual/upper_chest.jpg",
  "Разгибатели позвоночника": "/muscle-templates/manual/lower_spinal_extensors.png",
  "Квадратная мышца поясницы": "/muscle-templates/manual/lower_quadratus_lumborum.png",
  "Средняя грудь": "/muscle-templates/manual/upper_mid_chest.jpg",
  "Квадрицепс": "/muscle-templates/manual/lower_quads.png",
  "Нижняя грудь": "/muscle-templates/manual/upper_lower_chest.jpg",
  "Бицепс бедра": "/muscle-templates/manual/lower_hamstrings.png",
  "Верх груди": "/muscle-templates/manual/upper_chest_incline.png",
  "Бицепс бедра / ягодицы": "/muscle-templates/manual/lower_hamstrings_glutes.png",
  "Приводящие / ягодицы": "/muscle-templates/manual/lower_adductors_glutes.png",
  "Средняя ягодичная / квадрицепс": "/muscle-templates/manual/lower_glute_med_quads.png",
  "Приводящие / отводящие бедра": "/muscle-templates/manual/lower_adductors_abductors.png",
  "Задняя дельта": "/muscle-templates/manual/upper_rear_delt.png",
  "Передняя / средняя дельта": "/muscle-templates/manual/upper_front_mid_delt.png",
  "Верх спины": "/muscle-templates/manual/upper_back.png",
  "Ротаторная манжета плеча": "/muscle-templates/manual/upper_rotator_cuff.png",
  "Средняя дельта": "/muscle-templates/manual/upper_lateral_delt.png",
  "Передняя дельта": "/muscle-templates/manual/upper_front_delt.png",
  "Кор": "/muscle-templates/manual/core.png",
  "Прямая мышца живота": "/muscle-templates/manual/core_rectus_abdominis.png",
  "Грудные / трицепс": "/muscle-templates/manual/upper_chest_triceps.jpg",
  "Ягодицы / спина": "/muscle-templates/manual/lower_glutes_back.png",
  "Трицепс": "/muscle-templates/manual/upper_triceps.png",
  "Нижняя грудь / трицепс": "/muscle-templates/manual/upper_lower_chest_triceps.jpg",
  "Бицепс": "/muscle-templates/manual/upper_biceps_needs_review.jpg",
  "Бицепс / брахиалис": "/muscle-templates/manual/upper_biceps_needs_review.jpg",
  "Брахиалис / предплечье": "/muscle-templates/manual/upper_biceps_needs_review.jpg",
  "Внутренняя головка бицепса": "/muscle-templates/manual/upper_biceps_needs_review.jpg",
  "Растяжка на все тело": "/muscle-templates/manual/stretching_full_body.png",
};

export const muscleImageReviewStatus = {
  "Бицепс": "needs_review: xlsx references missing xl/media/image35.png; using existing project biceps asset",
  "Бицепс / брахиалис": "needs_review: xlsx references missing xl/media/image35.png; using existing project biceps asset",
  "Брахиалис / предплечье": "needs_review: xlsx references missing xl/media/image35.png; using existing project biceps asset",
  "Внутренняя головка бицепса": "needs_review: xlsx references missing xl/media/image35.png; using existing project biceps asset",
};

function normalizeMuscleLabelKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\u00a0/g, " ")
    .replace(/[–—-]/g, "-")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

const canonicalByKey = Object.fromEntries(canonicalMuscleLabels.map((label) => [normalizeMuscleLabelKey(label), label]));
const aliasesByKey = Object.fromEntries(Object.entries(muscleLabelAliases).map(([alias, canonical]) => [normalizeMuscleLabelKey(alias), canonical]));

export function normalizeMuscleLabel(value) {
  const label = decodeText(String(value || ""))
    .replace(/\u00a0/g, " ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
  const key = normalizeMuscleLabelKey(label);

  return aliasesByKey[key] || canonicalByKey[key] || label;
}

export function getMuscleImageInfo(label) {
  const normalizedLabel = normalizeMuscleLabel(label);
  const image = muscleImageMap[normalizedLabel] || "";
  const aliasUsed = Boolean(label && normalizedLabel !== String(label).trim());

  return {
    inputLabel: String(label || "").trim(),
    normalizedLabel,
    image,
    aliasUsed,
    reviewStatus: muscleImageReviewStatus[normalizedLabel] || "approved",
    status: !label ? "missing_label" : image ? (aliasUsed ? "alias_used" : "ok") : "missing_image",
  };
}
