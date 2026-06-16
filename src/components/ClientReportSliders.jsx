export const CLIENT_REPORT_FIELDS = [
  { key: "selfFeeling", legacyKeys: ["wellbeing", "wellbeing_score"], label: "Самочувствие", accent: "#7CE83A" },
  { key: "strength", legacyKeys: ["energy", "energy_score", "strength_score"], label: "Силы", accent: "#FFCC35" },
  { key: "sleepQuality", legacyKeys: ["sleep", "sleep_quality_score"], label: "Сон", accent: "#A855F7" },
  { key: "workoutFeeling", legacyKeys: ["workout", "workout_score"], label: "Тренировка", accent: "#4A95FF" },
];

export function scoreFromReport(report = {}, field) {
  const values = [report?.[field.key], ...(field.legacyKeys || []).map((key) => report?.[key])];
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return Math.max(1, Math.min(10, Math.round(number)));
  }
  return 0;
}

export function normalizeClientReportScores(report = {}, fallback = 7) {
  return CLIENT_REPORT_FIELDS.reduce((result, field) => {
    result[field.key] = scoreFromReport(report, field) || fallback;
    return result;
  }, {});
}

export function buildClientReportScores(values = {}) {
  const normalized = normalizeClientReportScores(values, 0);
  return {
    ...normalized,
    wellbeing: normalized.selfFeeling,
    energy: normalized.strength,
    sleep: normalized.sleepQuality,
    workout: normalized.workoutFeeling,
  };
}

export function ClientReportSliders({ values, onChange, disabled = false, compact = false }) {
  const normalized = normalizeClientReportScores(values, 7);
  return (
    <div className={compact ? "grid gap-2" : "grid gap-3"}>
      {CLIENT_REPORT_FIELDS.map((field, index) => {
        const selected = normalized[field.key];
        const fill = `${selected * 10}%`;
        return (
          <label
            key={field.key}
            className={`workout-report-row rounded-[14px] px-3 py-2 ${index % 2 ? "workout-report-row-alt" : ""}`}
            style={{ "--report-accent": field.accent, "--report-fill": fill }}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-black text-appText">{field.label}</span>
              <span className="text-[11px] font-black" style={{ color: field.accent }}>
                {selected}/10
              </span>
            </span>
            <span className="relative mt-1 block h-7">
              <span className="workout-report-track absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full">
                <span
                  className="block h-full rounded-full transition-[width]"
                  style={{
                    width: fill,
                    background: field.accent,
                    boxShadow: `0 0 14px ${field.accent}66`,
                  }}
                />
              </span>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={selected}
                disabled={disabled}
                onChange={(event) => onChange?.(field.key, Number(event.target.value))}
                className="fruitfit-report-range absolute inset-0 h-7 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-60"
                style={{ "--report-accent": field.accent, "--report-fill": fill }}
                aria-label={field.label}
              />
            </span>
          </label>
        );
      })}
    </div>
  );
}
