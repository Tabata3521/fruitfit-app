export function programGender(course) {
  const explicitGender = String(course?.gender || "").trim().toLowerCase();
  if (["female", "woman", "women"].includes(explicitGender) || explicitGender.startsWith("\u0436\u0435\u043d")) return "female";
  if (["male", "man", "men"].includes(explicitGender) || explicitGender.startsWith("\u043c\u0443\u0436")) return "male";

  const title = `${course?.display_name || ""} ${course?.technical_name || ""}`.toLowerCase();
  if (title.includes("\u0436\u0435\u043d")) return "female";
  if (title.includes("\u043c\u0443\u0436")) return "male";
  return "";
}

export function programSummaryTitle(profile = {}, course = {}) {
  const gender = programGender(course) || profile.gender;
  const genderLabel = gender === "male" ? "Мужская программа" : gender === "female" ? "Женская программа" : "Персональная программа";
  const goal = String(profile.goal || course.goal || "").trim();
  const rawFrequency = String(profile.trainingFrequency || course.trainingFrequency || course.training_frequency || "").trim();
  const frequency = /^[23]$/.test(rawFrequency) ? `${rawFrequency} раза в неделю` : rawFrequency;
  return [genderLabel, goal, frequency].filter(Boolean).join(" · ");
}
