package com.tagirfruit.fruitfit;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.health.connect.AggregateRecordsGroupedByDurationResponse;
import android.health.connect.AggregateRecordsGroupedByPeriodResponse;
import android.health.connect.AggregateRecordsRequest;
import android.health.connect.AggregateRecordsResponse;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.HealthPermissions;
import android.health.connect.LocalTimeRangeFilter;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.AggregationType;
import android.health.connect.datatypes.ActiveCaloriesBurnedRecord;
import android.health.connect.datatypes.BasalMetabolicRateRecord;
import android.health.connect.datatypes.DataOrigin;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.HeartRateRecord;
import android.health.connect.datatypes.SleepSessionRecord;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.TotalCaloriesBurnedRecord;
import android.health.connect.datatypes.WeightRecord;
import android.health.connect.datatypes.units.Energy;
import android.net.Uri;
import android.os.Build;
import android.os.OutcomeReceiver;
import android.webkit.WebView;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.Period;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executor;
import java.io.File;
import java.io.FileInputStream;
import java.lang.reflect.Method;

@CapacitorPlugin(
    name = "FruitFitHealth",
    permissions = {
        @Permission(
            alias = "health",
            strings = {
                "android.permission.health.READ_STEPS",
                "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
                "android.permission.health.READ_TOTAL_CALORIES_BURNED",
                "android.permission.health.READ_HEART_RATE",
                "android.permission.health.READ_SLEEP",
                "android.permission.health.READ_DISTANCE",
                "android.permission.health.READ_EXERCISE",
                "android.permission.health.READ_WEIGHT"
            }
        )
    }
)
public class FruitFitHealthPlugin extends Plugin {
    private final Executor mainExecutor = command -> getActivity().runOnUiThread(command);
    private static final double CALORIES_PER_KILOCALORIE = 1000.0;
    private static final String ENERGY_RAW_UNIT = "cal";
    private static final String ENERGY_UI_UNIT = "kcal";
    private static final int READ_PAGE_SIZE = 500;
    private static final int MAX_READ_PAGES = 4;
    private static final int MAX_SAMPLE_RECORDS = 120;
    private static final int MAX_HEART_SAMPLES = 96;
    private static final int MAX_SLEEP_SESSIONS = 30;
    private static final int MAX_SLEEP_STAGES = 120;
    private static final int MAX_DIAGNOSTIC_TEXT_BYTES = 24000;
    private static final List<String> DIAGNOSTIC_PACKAGES = Arrays.asList(
        "com.huawei.health",
        "com.huawei.hms",
        "com.huawei.hwid",
        "com.huawei.appmarket",
        "com.huawei.wearengine",
        "com.huawei.bone",
        "com.huawei.healthcloud",
        "com.google.android.apps.healthdata",
        "com.google.android.apps.fitness",
        "com.xiaomi.wearable",
        "com.mi.health",
        "com.xiaomi.hm.health",
        "com.huami.watch.hmwatchmanager",
        "com.zepp.z",
        "com.sec.android.app.shealth"
    );
    private static final List<String> HEALTH_PERMISSIONS = Arrays.asList(
        HealthPermissions.READ_STEPS,
        HealthPermissions.READ_ACTIVE_CALORIES_BURNED,
        HealthPermissions.READ_TOTAL_CALORIES_BURNED,
        HealthPermissions.READ_HEART_RATE,
        HealthPermissions.READ_SLEEP,
        HealthPermissions.READ_DISTANCE,
        HealthPermissions.READ_EXERCISE,
        HealthPermissions.READ_WEIGHT
    );

    @PluginMethod
    public void getHealthAvailability(PluginCall call) {
        call.resolve(availability());
    }

    @PluginMethod
    public void requestHealthPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT < 34) {
            call.resolve(state("not_supported", "Health Connect", "Для чтения данных нужен Android 14+ или системный Health Connect."));
            return;
        }
        if (getManager() == null) {
            call.resolve(state("not_installed", "Health Connect", "Health Connect недоступен на этом устройстве."));
            return;
        }
        if (hasHealthPermissions()) {
            JSObject result = state("connected", "Health Connect", "Разрешения Health Connect уже выданы.");
            result.put("permissionStatus", permissionStatus());
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("health", call, "healthPermissionsCallback");
    }

    @PermissionCallback
    private void healthPermissionsCallback(PluginCall call) {
        call.resolve(availability());
    }

    @PluginMethod
    public void openHealthSettings(PluginCall call) {
        try {
            Intent intent = new Intent(HealthConnectManager.ACTION_MANAGE_HEALTH_PERMISSIONS);
            intent.addCategory(HealthConnectManager.CATEGORY_HEALTH_PERMISSIONS);
            intent.putExtra(Intent.EXTRA_PACKAGE_NAME, getContext().getPackageName());
            getActivity().startActivity(intent);
            call.resolve(state("permissions_required", "Health Connect", "Открыл настройки Health Connect. Выдайте FruitFit доступ к данным."));
        } catch (Exception error) {
            call.reject("Не удалось открыть настройки Health Connect: " + error.getMessage());
        }
    }

    @PluginMethod
    public void openHealthSource(PluginCall call) {
        String sourceId = call.getString("sourceId", "health_connect");
        if ("health_connect".equals(sourceId)) {
            openHealthSettings(call);
            return;
        }

        String[] packages = packagesForSource(sourceId);
        String primaryPackage = packages.length > 0 ? packages[0] : "";
        try {
            for (String packageName : packages) {
                Intent launchIntent = getContext().getPackageManager().getLaunchIntentForPackage(packageName);
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(launchIntent);
                    JSObject result = state("connected", sourceName(packageName), "Открыл приложение источника данных.");
                    result.put("sourceId", sourceId);
                    result.put("packageName", packageName);
                    result.put("action", "launch_app");
                    call.resolve(result);
                    return;
                }
            }

            if (primaryPackage.length() > 0) {
                Intent marketIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + primaryPackage));
                marketIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    getContext().startActivity(marketIntent);
                } catch (Exception marketError) {
                    Intent webIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + primaryPackage));
                    webIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(webIntent);
                }
                JSObject result = state("not_installed", sourceName(primaryPackage), "Открыл страницу установки источника данных.");
                result.put("sourceId", sourceId);
                result.put("packageName", primaryPackage);
                result.put("action", "open_store");
                call.resolve(result);
                return;
            }
            call.resolve(state("not_installed", "Health Connect", "Источник данных не найден."));
        } catch (Exception error) {
            call.reject("Не удалось открыть источник данных: " + error.getMessage());
        }
    }

    @PluginMethod
    public void getDeviceDiagnostics(PluginCall call) {
        JSObject result = new JSObject();
        result.put("platform", "android");
        result.put("packageName", getContext().getPackageName());
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("brand", Build.BRAND);
        result.put("model", Build.MODEL);
        result.put("device", Build.DEVICE);
        result.put("product", Build.PRODUCT);
        result.put("hardware", Build.HARDWARE);
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("release", Build.VERSION.RELEASE);
        result.put("incremental", Build.VERSION.INCREMENTAL);
        result.put("fingerprint", Build.FINGERPRINT);
        result.put("emuiVersion", systemProperty("ro.build.version.emui"));
        result.put("magicUiVersion", systemProperty("ro.build.version.magic"));
        result.put("romDisplayVersion", systemProperty("ro.build.display.id"));
        result.put("isHuaweiDevice", isHuaweiDevice());
        result.put("webView", webViewDiagnostic());
        result.put("healthConnect", availability());
        result.put("permissionStatus", permissionStatus());
        result.put("installedPackages", installedPackageDiagnostics());
        result.put("lastNativeCrash", readDiagnosticFile("fruitfit_last_native_crash.txt"));
        result.put("diagnosticLimits", diagnosticLimits());
        call.resolve(result);
    }

    @PluginMethod
    public void getSteps(PluginCall call) {
        if (shouldUseAggregateApi()) {
            String range = call.getString("range", "today");
            String preferredSourcePackage = normalizeDataOriginPackage(call.getString("preferredSourcePackage", ""));
            boolean includeSourceDiagnostics = Boolean.TRUE.equals(call.getBoolean("includeSourceDiagnostics", false));
            TimeInstantRangeFilter filter = rangeFilter(range);
            HealthConnectManager manager = managerOrResolve(call);
            if (manager == null || !ensureHealthPermission(call, HealthPermissions.READ_STEPS)) return;

            aggregateLongBuckets(manager, filter, range, preferredSourcePackage, StepsRecord.STEPS_COUNT_TOTAL, value -> value, new LongBucketsCallback() {
                @Override
                public void onResult(double total, JSArray samples, JSArray dataOrigins, int bucketsCount) {
                    long roundedTotal = Math.round(total);
                    JSObject result = state(roundedTotal > 0 ? "connected" : "no_data", "Health Connect aggregate", roundedTotal > 0 ? "Steps read from Health Connect aggregate." : "No steps for this period.");
                    result.put("range", range);
                    result.put("total", roundedTotal);
                    result.put("rawTotal", roundedTotal);
                    result.put("aggregateStrategy", "health_connect_aggregate");
                    result.put("selectedSourceStrategy", preferredSourcePackage.isEmpty() ? "health_connect_aggregate" : "health_connect_aggregate_data_origin_filter");
                    result.put("selectedSourcePackage", preferredSourcePackage.isEmpty() ? null : preferredSourcePackage);
                    result.put("selectedSourceName", preferredSourcePackage.isEmpty() ? "Health Connect aggregate" : sourceName(preferredSourcePackage));
                    result.put("sourceName", preferredSourcePackage.isEmpty() ? "Health Connect aggregate" : sourceName(preferredSourcePackage));
                    result.put("sources", new JSArray());
                    result.put("dataOrigins", dataOrigins);
                    result.put("recordsCount", bucketsCount);
                    result.put("bucketsCount", bucketsCount);
                    result.put("samples", samples);
                    attachAggregateMetadata(result, 1);
                    if (!includeSourceDiagnostics) {
                        call.resolve(result);
                        return;
                    }
                    readStepSourceDiagnostics(manager, filter, new SourceDiagnosticsCallback() {
                        @Override
                        public void onResult(JSObject diagnostics) {
                            result.put("sources", diagnostics.opt("sources"));
                            result.put("sourceSamples", diagnostics.opt("sourceSamples"));
                            result.put("sourceRecordsCount", diagnostics.optInt("sourceRecordsCount", 0));
                            result.put("recordsCountRaw", diagnostics.optInt("recordsCountRaw", 0));
                            result.put("recordsCountUnique", diagnostics.optInt("recordsCountUnique", 0));
                            result.put("duplicateRows", diagnostics.optInt("duplicateRows", 0));
                            result.put("maxRepeat", diagnostics.optInt("maxRepeat", 0));
                            result.put("rawSourceTotal", diagnostics.opt("rawTotal"));
                            result.put("uniqueTotal", diagnostics.opt("uniqueTotal"));
                            result.put("dedupeApplied", diagnostics.opt("dedupeApplied"));
                            call.resolve(result);
                        }

                        @Override
                        public void onError(@NonNull Exception error) {
                            result.put("sourceDiagnosticsError", aggregateErrorObject("StepsRecordSourceDiagnostics", error));
                            call.resolve(result);
                        }
                    });
                }

                @Override
                public void onError(@NonNull Exception error) {
                    resolveAggregateError(call, "StepsRecord", error, 1);
                }
            });
            return;
        }
        TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "today"));
        String preferredSourcePackage = call.getString("preferredSourcePackage", "");
        readRecords(call, StepsRecord.class, filter, records -> {
            long rawTotal = 0;
            Map<String, Long> totalsBySource = new HashMap<>();
            JSArray samples = new JSArray();

            for (StepsRecord record : records) {
                String sourcePackage = sourcePackage(record);
                rawTotal += record.getCount();
                totalsBySource.put(sourcePackage, totalsBySource.getOrDefault(sourcePackage, 0L) + record.getCount());

                JSObject sample = intervalSample(record.getStartTime(), record.getEndTime());
                sample.put("value", record.getCount());
                sample.put("sourcePackage", sourcePackage);
                sample.put("sourceName", sourceName(sourcePackage));
                putLimited(samples, sample, MAX_SAMPLE_RECORDS);
            }

            String selectedSourcePackage = choosePreferredSource(totalsBySource, preferredSourcePackage);
            long selectedTotal = selectedSourcePackage == null ? rawTotal : totalsBySource.getOrDefault(selectedSourcePackage, rawTotal);
            JSObject result = state(records.isEmpty() ? "no_data" : "connected", sourceName(selectedSourcePackage), records.isEmpty() ? "Нет данных шагов за период." : "Данные шагов получены.");
            result.put("range", call.getString("range", "today"));
            result.put("total", selectedTotal);
            result.put("rawTotal", rawTotal);
            result.put("aggregateStrategy", "selected_origin_not_blind_sum");
            result.put("preferredSourcePackage", preferredSourcePackage);
            result.put("selectedSourcePackage", selectedSourcePackage);
            result.put("sourceName", sourceName(selectedSourcePackage));
            result.put("sources", sourceBreakdown(totalsBySource, selectedSourcePackage));
            result.put("recordsCount", records.size());
            result.put("samples", samples);
            return result;
        });
    }

    @PluginMethod
    public void getCalories(PluginCall call) {
        if (shouldUseAggregateApi()) {
            String range = call.getString("range", "today");
            String preferredSourcePackage = normalizeDataOriginPackage(call.getString("preferredSourcePackage", ""));
            boolean includeSourceDiagnostics = Boolean.TRUE.equals(call.getBoolean("includeSourceDiagnostics", false));
            TimeInstantRangeFilter filter = rangeFilter(range);
            HealthConnectManager manager = managerOrResolve(call);
            if (manager == null) return;
            if (!hasHealthPermissionGranted(HealthPermissions.READ_ACTIVE_CALORIES_BURNED)
                && !hasHealthPermissionGranted(HealthPermissions.READ_TOTAL_CALORIES_BURNED)) {
                resolveMissingPermission(call, HealthPermissions.READ_ACTIVE_CALORIES_BURNED);
                return;
            }
            aggregateCalories(call, manager, filter, range, preferredSourcePackage, includeSourceDiagnostics);
            return;
        }
        TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "today"));
        readRecords(call, ActiveCaloriesBurnedRecord.class, filter, records -> {
            double rawCaloriesTotal = 0;
            double kilocaloriesTotal = 0;
            Map<String, Double> rawCaloriesBySource = new HashMap<>();
            Map<String, Long> recordCountsBySource = new HashMap<>();
            JSArray samples = new JSArray();
            for (ActiveCaloriesBurnedRecord record : records) {
                double rawCalories = record.getEnergy().getInCalories();
                double kilocalories = rawCalories / CALORIES_PER_KILOCALORIE;
                String sourcePackage = sourcePackage(record);
                rawCaloriesTotal += rawCalories;
                kilocaloriesTotal += kilocalories;
                rawCaloriesBySource.put(sourcePackage, rawCaloriesBySource.getOrDefault(sourcePackage, 0.0) + rawCalories);
                recordCountsBySource.put(sourcePackage, recordCountsBySource.getOrDefault(sourcePackage, 0L) + 1);
                JSObject sample = intervalSample(record.getStartTime(), record.getEndTime());
                sample.put("value", Math.round(kilocalories));
                sample.put("rawValue", rawCalories);
                sample.put("rawUnit", ENERGY_RAW_UNIT);
                sample.put("convertedValue", kilocalories);
                sample.put("convertedUnit", ENERGY_UI_UNIT);
                sample.put("sourcePackage", sourcePackage);
                sample.put("sourceName", sourceName(sourcePackage));
                putLimited(samples, sample, MAX_SAMPLE_RECORDS);
            }
            JSObject result = state(records.isEmpty() ? "no_data" : "connected", "Health Connect", records.isEmpty() ? "Нет активных калорий за период." : "Активные калории получены.");
            result.put("range", call.getString("range", "today"));
            result.put("active", Math.round(kilocaloriesTotal));
            result.put("convertedActive", kilocaloriesTotal);
            result.put("unit", ENERGY_UI_UNIT);
            result.put("rawActive", rawCaloriesTotal);
            result.put("rawUnit", ENERGY_RAW_UNIT);
            result.put("total", 0);
            result.put("recordsCount", records.size());
            result.put("sources", calorieSourceBreakdown(rawCaloriesBySource, recordCountsBySource));
            result.put("samples", samples);
            return result;
        });
    }

    @PluginMethod
    public void getHeartRate(PluginCall call) {
        if (shouldUseAggregateApi()) {
            TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "today"));
            HealthConnectManager manager = managerOrResolve(call);
            if (manager == null || !ensureHealthPermission(call, HealthPermissions.READ_HEART_RATE)) return;
            aggregateHeartStats(manager, filter, new HeartAggregateCallback() {
                @Override
                public void onResult(HeartAggregateStats stats) {
                    readHeartRateRecords(call, filter, stats);
                }

                @Override
                public void onError(@NonNull Exception error) {
                    HeartAggregateStats stats = new HeartAggregateStats();
                    stats.error = aggregateErrorObject("HeartRateRecord", error);
                    readHeartRateRecords(call, filter, stats);
                }
            });
            return;
        }
        TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "today"));
        readRecords(call, HeartRateRecord.class, filter, records -> {
            long min = Long.MAX_VALUE;
            long max = 0;
            long sum = 0;
            long count = 0;
            long latestBpm = 0;
            Instant latestTime = Instant.MIN;
            String latestSourcePackage = null;
            Map<String, Long> countsBySource = new HashMap<>();
            JSArray samples = new JSArray();
            for (HeartRateRecord record : records) {
                String sourcePackage = sourcePackage(record);
                countsBySource.put(sourcePackage, countsBySource.getOrDefault(sourcePackage, 0L) + record.getSamples().size());
                for (HeartRateRecord.HeartRateSample sampleRecord : record.getSamples()) {
                    long bpm = sampleRecord.getBeatsPerMinute();
                    min = Math.min(min, bpm);
                    max = Math.max(max, bpm);
                    sum += bpm;
                    count++;
                    if (sampleRecord.getTime().isAfter(latestTime)) {
                        latestTime = sampleRecord.getTime();
                        latestBpm = bpm;
                        latestSourcePackage = sourcePackage;
                    }
                    JSObject sample = new JSObject();
                    sample.put("time", sampleRecord.getTime().toString());
                    sample.put("value", bpm);
                    sample.put("sourcePackage", sourcePackage);
                    sample.put("sourceName", sourceName(sourcePackage));
                    putLimited(samples, sample, MAX_HEART_SAMPLES);
                }
            }
            JSObject result = state(count == 0 ? "no_data" : "connected", sourceName(latestSourcePackage), count == 0 ? "Нет данных пульса за период." : "Данные пульса получены.");
            result.put("range", call.getString("range", "today"));
            result.put("min", count == 0 ? null : min);
            result.put("avg", count == 0 ? null : Math.round((double) sum / count));
            result.put("max", count == 0 ? null : max);
            result.put("latestBpm", count == 0 ? null : latestBpm);
            result.put("latestTimestamp", count == 0 ? null : latestTime.toString());
            result.put("latestAgeMinutes", count == 0 ? null : Math.max(0, Duration.between(latestTime, Instant.now()).toMinutes()));
            result.put("latestSourcePackage", latestSourcePackage);
            result.put("latestSourceName", sourceName(latestSourcePackage));
            result.put("recordsCount", records.size());
            result.put("recordsRawCount", records.size());
            result.put("samplesCount", count);
            result.put("sources", sourceBreakdown(countsBySource, latestSourcePackage));
            result.put("samples", samples);
            return result;
        });
    }

    @PluginMethod
    public void getSleep(PluginCall call) {
        if (shouldUseAggregateApi()) {
            String range = call.getString("range", "today");
            TimeInstantRangeFilter filter = rangeFilter(range);
            HealthConnectManager manager = managerOrResolve(call);
            if (manager == null || !ensureHealthPermission(call, HealthPermissions.READ_SLEEP)) return;
            aggregateLongBuckets(manager, filter, range, "", SleepSessionRecord.SLEEP_DURATION_TOTAL, value -> value / 60000.0, new LongBucketsCallback() {
                @Override
                public void onResult(double total, JSArray samples, JSArray dataOrigins, int bucketsCount) {
                    readSleepRecords(call, filter, Math.round(total), samples, dataOrigins, null);
                }

                @Override
                public void onError(@NonNull Exception error) {
                    readSleepRecords(call, filter, null, new JSArray(), new JSArray(), aggregateErrorObject("SleepSessionRecord", error));
                }
            });
            return;
        }
        TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "today"));
        readRecords(call, SleepSessionRecord.class, filter, records -> {
            long totalMinutes = 0;
            JSArray sessions = new JSArray();
            JSArray fragments = new JSArray();
            for (SleepSessionRecord record : records) {
                long minutes = Duration.between(record.getStartTime(), record.getEndTime()).toMinutes();
                String sourcePackage = sourcePackage(record);
                JSObject session = intervalSample(record.getStartTime(), record.getEndTime());
                session.put("minutes", minutes);
                session.put("stages", sleepStages(record));
                session.put("sourcePackage", sourcePackage);
                session.put("sourceName", sourceName(sourcePackage));

                if (minutes >= 120) {
                    totalMinutes += minutes;
                    putLimited(sessions, session, MAX_SLEEP_SESSIONS);
                } else {
                    putLimited(fragments, session, MAX_SLEEP_SESSIONS);
                }
            }
            JSObject result = state(sessions.length() == 0 ? "no_data" : "connected", "Health Connect", sessions.length() == 0 ? "Нет основного сна за период. Короткие записи сохранены как фрагменты." : "Данные сна получены.");
            result.put("range", call.getString("range", "today"));
            result.put("minutes", totalMinutes);
            result.put("sessions", sessions);
            result.put("fragments", fragments);
            return result;
        });
    }

    @PluginMethod
    public void getSleepStages(PluginCall call) {
        getSleep(call);
    }

    @PluginMethod
    public void getDistance(PluginCall call) {
        TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "today"));
        readRecords(call, DistanceRecord.class, filter, records -> {
            double rawMeters = 0;
            double meters = 0;
            Map<String, Double> rawMetersBySource = new HashMap<>();
            Map<String, Double> uniqueMetersBySource = new HashMap<>();
            Map<String, Long> rawCountsBySource = new HashMap<>();
            Map<String, Long> uniqueCountsBySource = new HashMap<>();
            Map<String, Integer> keyCounts = new HashMap<>();
            JSArray samples = new JSArray();
            for (DistanceRecord record : records) {
                double value = record.getDistance().getInMeters();
                String sourcePackage = sourcePackage(record);
                String key = exactRecordKey(sourcePackage, record.getStartTime(), record.getEndTime(), Math.round(value * 1000.0));
                int repeat = keyCounts.getOrDefault(key, 0) + 1;
                keyCounts.put(key, repeat);
                rawMeters += value;
                rawMetersBySource.put(sourcePackage, rawMetersBySource.getOrDefault(sourcePackage, 0.0) + value);
                rawCountsBySource.put(sourcePackage, rawCountsBySource.getOrDefault(sourcePackage, 0L) + 1);
                if (repeat > 1) continue;
                meters += value;
                uniqueMetersBySource.put(sourcePackage, uniqueMetersBySource.getOrDefault(sourcePackage, 0.0) + value);
                uniqueCountsBySource.put(sourcePackage, uniqueCountsBySource.getOrDefault(sourcePackage, 0L) + 1);
                JSObject sample = intervalSample(record.getStartTime(), record.getEndTime());
                sample.put("value", value);
                sample.put("sourcePackage", sourcePackage);
                sample.put("sourceName", sourceName(sourcePackage));
                putLimited(samples, sample, MAX_SAMPLE_RECORDS);
            }
            JSObject result = state(records.isEmpty() ? "no_data" : "connected", "Health Connect", records.isEmpty() ? "Нет данных дистанции за период." : "Дистанция получена.");
            result.put("range", call.getString("range", "today"));
            DedupeStats stats = dedupeStats(keyCounts, records.size());
            result.put("meters", meters);
            result.put("rawMeters", rawMeters);
            result.put("rawTotal", rawMeters);
            result.put("uniqueTotal", meters);
            result.put("recordsCountRaw", stats.recordsCountRaw);
            result.put("recordsCountUnique", stats.recordsCountUnique);
            result.put("duplicateRows", stats.duplicateRows);
            result.put("maxRepeat", stats.maxRepeat);
            result.put("dedupeApplied", true);
            result.put("sources", dedupedDoubleSourceBreakdown(uniqueMetersBySource, rawMetersBySource, uniqueCountsBySource, rawCountsBySource));
            result.put("samples", samples);
            return result;
        });
    }

    @PluginMethod
    public void getExerciseSessions(PluginCall call) {
        TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "week"));
        readRecords(call, ExerciseSessionRecord.class, filter, records -> {
            JSArray sessions = new JSArray();
            for (ExerciseSessionRecord record : records) {
                String sourcePackage = sourcePackage(record);
                JSObject session = intervalSample(record.getStartTime(), record.getEndTime());
                session.put("title", String.valueOf(record.getTitle() == null ? "" : record.getTitle()));
                session.put("exerciseType", record.getExerciseType());
                session.put("sourcePackage", sourcePackage);
                session.put("sourceName", sourceName(sourcePackage));
                putLimited(sessions, session, MAX_SAMPLE_RECORDS);
            }
            JSObject result = state(records.isEmpty() ? "no_data" : "connected", "Health Connect", records.isEmpty() ? "Нет тренировочных сессий за период." : "Тренировки получены.");
            result.put("range", call.getString("range", "week"));
            result.put("sessions", sessions);
            return result;
        });
    }

    @PluginMethod
    public void getWeight(PluginCall call) {
        TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "month"));
        readRecords(call, WeightRecord.class, filter, records -> {
            JSArray samples = new JSArray();
            Double latest = null;
            Instant latestTime = Instant.MIN;
            for (WeightRecord record : records) {
                String sourcePackage = sourcePackage(record);
                double kg = record.getWeight().getInGrams() / 1000.0;
                JSObject sample = new JSObject();
                sample.put("time", record.getTime().toString());
                sample.put("value", kg);
                sample.put("sourcePackage", sourcePackage);
                sample.put("sourceName", sourceName(sourcePackage));
                putLimited(samples, sample, MAX_SAMPLE_RECORDS);
                if (record.getTime().isAfter(latestTime)) {
                    latestTime = record.getTime();
                    latest = kg;
                }
            }
            JSObject result = state(records.isEmpty() ? "no_data" : "connected", "Health Connect", records.isEmpty() ? "Нет данных веса за период." : "Вес получен.");
            result.put("range", call.getString("range", "month"));
            result.put("value", latest);
            result.put("samples", samples);
            return result;
        });
    }

    private boolean shouldUseAggregateApi() {
        return true;
    }

    private HealthConnectManager managerOrResolve(PluginCall call) {
        HealthConnectManager manager = getManager();
        if (manager == null) {
            call.resolve(state("not_installed", "Health Connect", "Health Connect is unavailable on this device."));
        }
        return manager;
    }

    private boolean ensureHealthPermission(PluginCall call, String permission) {
        if (hasHealthPermissionGranted(permission)) return true;
        resolveMissingPermission(call, permission);
        return false;
    }

    private void resolveMissingPermission(PluginCall call, String permission) {
        JSObject result = state("permissions_required", "Health Connect", "Health Connect permission is missing.");
        result.put("permission", permissionLabel(permission));
        result.put("permissionStatus", permissionStatus());
        call.resolve(result);
    }

    private String normalizeDataOriginPackage(String value) {
        String text = value == null ? "" : value.trim();
        if (text.isEmpty() || "auto".equalsIgnoreCase(text)) return "";
        String lower = text.toLowerCase();
        if ("fitbit".equals(lower)) return "com.fitbit.FitbitMobile";
        if ("zepp".equals(lower) || "amazfit".equals(lower)) return "com.huami.watch.hmwatchmanager";
        if ("samsung".equals(lower) || "shealth".equals(lower)) return "com.sec.android.app.shealth";
        if ("mi".equals(lower) || "mi_fitness".equals(lower) || "xiaomi".equals(lower)) return "com.xiaomi.wearable";
        return text;
    }

    private <T> void addDataOriginFilter(AggregateRecordsRequest.Builder<T> builder, String preferredSourcePackage) {
        String packageName = normalizeDataOriginPackage(preferredSourcePackage);
        if (packageName.isEmpty()) return;
        builder.addDataOriginsFilter(new DataOrigin.Builder().setPackageName(packageName).build());
    }

    private void aggregateLongBuckets(
        HealthConnectManager manager,
        TimeInstantRangeFilter filter,
        String range,
        String preferredSourcePackage,
        AggregationType<Long> aggregationType,
        LongValueConverter converter,
        LongBucketsCallback callback
    ) {
        try {
            AggregateRecordsRequest.Builder<Long> requestBuilder = new AggregateRecordsRequest.Builder<Long>(filter)
                .addAggregationType(aggregationType);
            addDataOriginFilter(requestBuilder, preferredSourcePackage);
            AggregateRecordsRequest<Long> request = requestBuilder.build();

            if (usesDurationBuckets(range)) {
                manager.aggregateGroupByDuration(request, Duration.ofHours(1), mainExecutor, new OutcomeReceiver<List<AggregateRecordsGroupedByDurationResponse<Long>>, HealthConnectException>() {
                    @Override
                    public void onResult(List<AggregateRecordsGroupedByDurationResponse<Long>> responses) {
                        JSArray samples = new JSArray();
                        Set<String> origins = new LinkedHashSet<>();
                        double total = 0;
                        for (AggregateRecordsGroupedByDurationResponse<Long> response : responses) {
                            Long rawValue = response.get(aggregationType);
                            if (rawValue == null) continue;
                            double value = converter.convert(rawValue);
                            if (!Double.isFinite(value) || value <= 0) continue;
                            total += value;
                            JSObject sample = intervalSample(response.getStartTime(), response.getEndTime());
                            sample.put("value", Math.round(value));
                            sample.put("rawValue", rawValue);
                            samples.put(sample);
                            collectDataOrigins(origins, response.getDataOrigins(aggregationType));
                        }
                        callback.onResult(total, samples, dataOriginPackagesArray(origins), samples.length());
                    }

                    @Override
                    public void onError(@NonNull HealthConnectException error) {
                        callback.onError(error);
                    }
                });
                return;
            }

            AggregateRecordsRequest.Builder<Long> periodRequestBuilder = new AggregateRecordsRequest.Builder<Long>(localRangeFilter(range))
                .addAggregationType(aggregationType);
            addDataOriginFilter(periodRequestBuilder, preferredSourcePackage);
            AggregateRecordsRequest<Long> periodRequest = periodRequestBuilder.build();
            manager.aggregateGroupByPeriod(periodRequest, Period.ofDays(1), mainExecutor, new OutcomeReceiver<List<AggregateRecordsGroupedByPeriodResponse<Long>>, HealthConnectException>() {
                @Override
                public void onResult(List<AggregateRecordsGroupedByPeriodResponse<Long>> responses) {
                    JSArray samples = new JSArray();
                    Set<String> origins = new LinkedHashSet<>();
                    double total = 0;
                    ZoneId zone = ZoneId.systemDefault();
                    for (AggregateRecordsGroupedByPeriodResponse<Long> response : responses) {
                        Long rawValue = response.get(aggregationType);
                        if (rawValue == null) continue;
                        double value = converter.convert(rawValue);
                        if (!Double.isFinite(value) || value <= 0) continue;
                        total += value;
                        JSObject sample = intervalSample(response.getStartTime().atZone(zone).toInstant(), response.getEndTime().atZone(zone).toInstant());
                        sample.put("value", Math.round(value));
                        sample.put("rawValue", rawValue);
                        samples.put(sample);
                        collectDataOrigins(origins, response.getDataOrigins(aggregationType));
                    }
                    callback.onResult(total, samples, dataOriginPackagesArray(origins), samples.length());
                }

                @Override
                public void onError(@NonNull HealthConnectException error) {
                    callback.onError(error);
                }
            });
        } catch (Exception error) {
            callback.onError(error);
        }
    }

    private void aggregateCalories(PluginCall call, HealthConnectManager manager, TimeInstantRangeFilter filter, String range, String preferredSourcePackage, boolean includeSourceDiagnostics) {
        boolean canReadActive = hasHealthPermissionGranted(HealthPermissions.READ_ACTIVE_CALORIES_BURNED);
        boolean canReadTotal = hasHealthPermissionGranted(HealthPermissions.READ_TOTAL_CALORIES_BURNED);
        boolean canReadBasal = hasHealthPermissionGranted(HealthPermissions.READ_BASAL_METABOLIC_RATE);

        try {
            AggregateRecordsRequest.Builder<Energy> builder = new AggregateRecordsRequest.Builder<Energy>(filter);
            if (canReadActive) builder.addAggregationType(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL);
            if (canReadTotal) builder.addAggregationType(TotalCaloriesBurnedRecord.ENERGY_TOTAL);
            if (canReadBasal) builder.addAggregationType(BasalMetabolicRateRecord.BASAL_CALORIES_TOTAL);
            addDataOriginFilter(builder, preferredSourcePackage);
            AggregateRecordsRequest<Energy> request = builder.build();

            manager.aggregate(request, mainExecutor, new OutcomeReceiver<AggregateRecordsResponse<Energy>, HealthConnectException>() {
                @Override
                public void onResult(AggregateRecordsResponse<Energy> response) {
                    double activeRaw = canReadActive ? rawCalories(response.get(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)) : 0;
                    double totalRaw = canReadTotal ? rawCalories(response.get(TotalCaloriesBurnedRecord.ENERGY_TOTAL)) : 0;
                    double basalRaw = canReadBasal ? rawCalories(response.get(BasalMetabolicRateRecord.BASAL_CALORIES_TOTAL)) : 0;
                    JSObject origins = new JSObject();
                    if (canReadActive) origins.put("active", dataOriginsArray(response.getDataOrigins(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)));
                    if (canReadTotal) origins.put("total", dataOriginsArray(response.getDataOrigins(TotalCaloriesBurnedRecord.ENERGY_TOTAL)));
                    if (canReadBasal) origins.put("resting", dataOriginsArray(response.getDataOrigins(BasalMetabolicRateRecord.BASAL_CALORIES_TOTAL)));

                    if (!canReadActive) {
                        resolveCaloriesAggregateResult(call, range, activeRaw, totalRaw, basalRaw, new JSArray(), new JSArray(), new JSArray(), origins, 1, null);
                        return;
                    }

                    aggregateEnergyBuckets(manager, filter, range, preferredSourcePackage, ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL, new EnergyBucketsCallback() {
                        @Override
                        public void onResult(JSArray activeSamples, JSArray bucketOrigins, int bucketsCount) {
                            origins.put("activeBuckets", bucketOrigins);
                            readAdditionalCaloriesBuckets(call, manager, filter, range, preferredSourcePackage, includeSourceDiagnostics, activeRaw, totalRaw, basalRaw, activeSamples, origins, 2, null, canReadTotal, canReadBasal);
                        }

                        @Override
                        public void onError(@NonNull Exception error) {
                            readAdditionalCaloriesBuckets(call, manager, filter, range, preferredSourcePackage, includeSourceDiagnostics, activeRaw, totalRaw, basalRaw, new JSArray(), origins, 2, aggregateErrorObject("ActiveCaloriesBurnedRecord", error), canReadTotal, canReadBasal);
                        }
                    });
                }

                @Override
                public void onError(@NonNull HealthConnectException error) {
                    resolveAggregateError(call, "CaloriesAggregate", error, 1);
                }
            });
        } catch (Exception error) {
            resolveAggregateError(call, "CaloriesAggregate", error, 1);
        }
    }

    private void readAdditionalCaloriesBuckets(
        PluginCall call,
        HealthConnectManager manager,
        TimeInstantRangeFilter filter,
        String range,
        String preferredSourcePackage,
        boolean includeSourceDiagnostics,
        double activeRaw,
        double totalRaw,
        double basalRaw,
        JSArray activeSamples,
        JSObject origins,
        int queryCount,
        JSObject aggregateError,
        boolean canReadTotal,
        boolean canReadBasal
    ) {
        if (!canReadTotal) {
            resolveCaloriesAggregateResultMaybeWithSourceDiagnostics(call, manager, filter, range, includeSourceDiagnostics, activeRaw, totalRaw, basalRaw, activeSamples, new JSArray(), new JSArray(), origins, queryCount, aggregateError);
            return;
        }
        aggregateEnergyBuckets(manager, filter, range, preferredSourcePackage, TotalCaloriesBurnedRecord.ENERGY_TOTAL, new EnergyBucketsCallback() {
            @Override
            public void onResult(JSArray totalSamples, JSArray bucketOrigins, int bucketsCount) {
                origins.put("totalBuckets", bucketOrigins);
                readBasalCaloriesBuckets(call, manager, filter, range, preferredSourcePackage, includeSourceDiagnostics, activeRaw, totalRaw, basalRaw, activeSamples, totalSamples, origins, queryCount + 1, aggregateError, canReadBasal);
            }

            @Override
            public void onError(@NonNull Exception error) {
                JSObject errorObject = aggregateError != null ? aggregateError : aggregateErrorObject("TotalCaloriesBurnedRecord", error);
                readBasalCaloriesBuckets(call, manager, filter, range, preferredSourcePackage, includeSourceDiagnostics, activeRaw, totalRaw, basalRaw, activeSamples, new JSArray(), origins, queryCount + 1, errorObject, canReadBasal);
            }
        });
    }

    private void readBasalCaloriesBuckets(
        PluginCall call,
        HealthConnectManager manager,
        TimeInstantRangeFilter filter,
        String range,
        String preferredSourcePackage,
        boolean includeSourceDiagnostics,
        double activeRaw,
        double totalRaw,
        double basalRaw,
        JSArray activeSamples,
        JSArray totalSamples,
        JSObject origins,
        int queryCount,
        JSObject aggregateError,
        boolean canReadBasal
    ) {
        if (!canReadBasal) {
            resolveCaloriesAggregateResultMaybeWithSourceDiagnostics(call, manager, filter, range, includeSourceDiagnostics, activeRaw, totalRaw, basalRaw, activeSamples, totalSamples, new JSArray(), origins, queryCount, aggregateError);
            return;
        }
        aggregateEnergyBuckets(manager, filter, range, preferredSourcePackage, BasalMetabolicRateRecord.BASAL_CALORIES_TOTAL, new EnergyBucketsCallback() {
            @Override
            public void onResult(JSArray restingSamples, JSArray bucketOrigins, int bucketsCount) {
                origins.put("restingBuckets", bucketOrigins);
                resolveCaloriesAggregateResultMaybeWithSourceDiagnostics(call, manager, filter, range, includeSourceDiagnostics, activeRaw, totalRaw, basalRaw, activeSamples, totalSamples, restingSamples, origins, queryCount + 1, aggregateError);
            }

            @Override
            public void onError(@NonNull Exception error) {
                JSObject errorObject = aggregateError != null ? aggregateError : aggregateErrorObject("BasalMetabolicRateRecord", error);
                resolveCaloriesAggregateResultMaybeWithSourceDiagnostics(call, manager, filter, range, includeSourceDiagnostics, activeRaw, totalRaw, basalRaw, activeSamples, totalSamples, new JSArray(), origins, queryCount + 1, errorObject);
            }
        });
    }

    private void resolveCaloriesAggregateResultMaybeWithSourceDiagnostics(
        PluginCall call,
        HealthConnectManager manager,
        TimeInstantRangeFilter filter,
        String range,
        boolean includeSourceDiagnostics,
        double activeRaw,
        double totalRaw,
        double basalRaw,
        JSArray activeSamples,
        JSArray totalSamples,
        JSArray restingSamples,
        JSObject origins,
        int queryCount,
        JSObject aggregateError
    ) {
        if (!includeSourceDiagnostics) {
            resolveCaloriesAggregateResult(call, range, activeRaw, totalRaw, basalRaw, activeSamples, totalSamples, restingSamples, origins, queryCount, aggregateError);
            return;
        }
        readCaloriesSourceDiagnostics(manager, filter, new SourceDiagnosticsCallback() {
            @Override
            public void onResult(JSObject diagnostics) {
                resolveCaloriesAggregateResult(call, range, activeRaw, totalRaw, basalRaw, activeSamples, totalSamples, restingSamples, origins, queryCount, aggregateError, diagnostics);
            }

            @Override
            public void onError(@NonNull Exception error) {
                JSObject diagnostics = new JSObject();
                diagnostics.put("sourceDiagnosticsError", aggregateErrorObject("ActiveCaloriesSourceDiagnostics", error));
                resolveCaloriesAggregateResult(call, range, activeRaw, totalRaw, basalRaw, activeSamples, totalSamples, restingSamples, origins, queryCount, aggregateError, diagnostics);
            }
        });
    }

    private void aggregateEnergyBuckets(
        HealthConnectManager manager,
        TimeInstantRangeFilter filter,
        String range,
        String preferredSourcePackage,
        AggregationType<Energy> aggregationType,
        EnergyBucketsCallback callback
    ) {
        try {
            AggregateRecordsRequest.Builder<Energy> requestBuilder = new AggregateRecordsRequest.Builder<Energy>(filter)
                .addAggregationType(aggregationType);
            addDataOriginFilter(requestBuilder, preferredSourcePackage);
            AggregateRecordsRequest<Energy> request = requestBuilder.build();

            if (usesDurationBuckets(range)) {
                manager.aggregateGroupByDuration(request, Duration.ofHours(1), mainExecutor, new OutcomeReceiver<List<AggregateRecordsGroupedByDurationResponse<Energy>>, HealthConnectException>() {
                    @Override
                    public void onResult(List<AggregateRecordsGroupedByDurationResponse<Energy>> responses) {
                        JSArray samples = new JSArray();
                        Set<String> origins = new LinkedHashSet<>();
                        for (AggregateRecordsGroupedByDurationResponse<Energy> response : responses) {
                            Energy energy = response.get(aggregationType);
                            double kilocalories = kilocalories(energy);
                            if (!Double.isFinite(kilocalories) || kilocalories <= 0) continue;
                            JSObject sample = intervalSample(response.getStartTime(), response.getEndTime());
                            sample.put("value", Math.round(kilocalories));
                            sample.put("rawValue", rawCalories(energy));
                            sample.put("rawUnit", ENERGY_RAW_UNIT);
                            sample.put("convertedValue", kilocalories);
                            sample.put("convertedUnit", ENERGY_UI_UNIT);
                            samples.put(sample);
                            collectDataOrigins(origins, response.getDataOrigins(aggregationType));
                        }
                        callback.onResult(samples, dataOriginPackagesArray(origins), samples.length());
                    }

                    @Override
                    public void onError(@NonNull HealthConnectException error) {
                        callback.onError(error);
                    }
                });
                return;
            }

            AggregateRecordsRequest.Builder<Energy> periodRequestBuilder = new AggregateRecordsRequest.Builder<Energy>(localRangeFilter(range))
                .addAggregationType(aggregationType);
            addDataOriginFilter(periodRequestBuilder, preferredSourcePackage);
            AggregateRecordsRequest<Energy> periodRequest = periodRequestBuilder.build();
            manager.aggregateGroupByPeriod(periodRequest, Period.ofDays(1), mainExecutor, new OutcomeReceiver<List<AggregateRecordsGroupedByPeriodResponse<Energy>>, HealthConnectException>() {
                @Override
                public void onResult(List<AggregateRecordsGroupedByPeriodResponse<Energy>> responses) {
                    JSArray samples = new JSArray();
                    Set<String> origins = new LinkedHashSet<>();
                    ZoneId zone = ZoneId.systemDefault();
                    for (AggregateRecordsGroupedByPeriodResponse<Energy> response : responses) {
                        Energy energy = response.get(aggregationType);
                        double kilocalories = kilocalories(energy);
                        if (!Double.isFinite(kilocalories) || kilocalories <= 0) continue;
                        JSObject sample = intervalSample(response.getStartTime().atZone(zone).toInstant(), response.getEndTime().atZone(zone).toInstant());
                        sample.put("value", Math.round(kilocalories));
                        sample.put("rawValue", rawCalories(energy));
                        sample.put("rawUnit", ENERGY_RAW_UNIT);
                        sample.put("convertedValue", kilocalories);
                        sample.put("convertedUnit", ENERGY_UI_UNIT);
                        samples.put(sample);
                        collectDataOrigins(origins, response.getDataOrigins(aggregationType));
                    }
                    callback.onResult(samples, dataOriginPackagesArray(origins), samples.length());
                }

                @Override
                public void onError(@NonNull HealthConnectException error) {
                    callback.onError(error);
                }
            });
        } catch (Exception error) {
            callback.onError(error);
        }
    }

    private void resolveCaloriesAggregateResult(
        PluginCall call,
        String range,
        double activeRaw,
        double totalRaw,
        double basalRaw,
        JSArray samples,
        JSArray totalSamples,
        JSArray restingSamples,
        JSObject dataOrigins,
        int queryCount,
        JSObject aggregateError
    ) {
        resolveCaloriesAggregateResult(call, range, activeRaw, totalRaw, basalRaw, samples, totalSamples, restingSamples, dataOrigins, queryCount, aggregateError, null);
    }

    private void resolveCaloriesAggregateResult(
        PluginCall call,
        String range,
        double activeRaw,
        double totalRaw,
        double basalRaw,
        JSArray samples,
        JSArray totalSamples,
        JSArray restingSamples,
        JSObject dataOrigins,
        int queryCount,
        JSObject aggregateError,
        JSObject sourceDiagnostics
    ) {
        double activeKcal = activeRaw / CALORIES_PER_KILOCALORIE;
        double totalKcal = totalRaw / CALORIES_PER_KILOCALORIE;
        double basalKcal = basalRaw / CALORIES_PER_KILOCALORIE;
        boolean hasData = activeKcal > 0 || totalKcal > 0 || basalKcal > 0 || samples.length() > 0;
        JSObject result = state(hasData ? "connected" : "no_data", "Health Connect aggregate", hasData ? "Calories read from Health Connect aggregate." : "No calories for this period.");
        result.put("range", range);
        result.put("active", Math.round(activeKcal));
        result.put("convertedActive", activeKcal);
        result.put("rawActive", activeRaw);
        result.put("total", Math.round(totalKcal));
        result.put("convertedTotal", totalKcal);
        result.put("rawTotalCalories", totalRaw);
        result.put("resting", Math.round(basalKcal));
        result.put("convertedResting", basalKcal);
        result.put("rawRestingCalories", basalRaw);
        result.put("unit", ENERGY_UI_UNIT);
        result.put("rawUnit", ENERGY_RAW_UNIT);
        result.put("aggregateStrategy", "health_connect_aggregate");
        result.put("selectedSourceStrategy", "health_connect_aggregate");
        result.put("selectedSourceReason", "Health Connect aggregate calories; total and resting are included when permissions are granted.");
        result.put("selectedSourcePackage", null);
        result.put("selectedSourceName", "Health Connect aggregate");
        result.put("sources", new JSArray());
        result.put("dataOrigins", dataOrigins);
        result.put("recordsCount", samples.length());
        result.put("bucketsCount", samples.length());
        result.put("samples", samples);
        result.put("activeSamples", samples);
        result.put("totalSamples", totalSamples);
        result.put("restingSamples", restingSamples);
        if (sourceDiagnostics != null) {
            if (sourceDiagnostics.has("sources")) result.put("sources", sourceDiagnostics.opt("sources"));
            if (sourceDiagnostics.has("sourceSamples")) result.put("sourceSamples", sourceDiagnostics.opt("sourceSamples"));
            if (sourceDiagnostics.has("sourceRecordsCount")) result.put("sourceRecordsCount", sourceDiagnostics.optInt("sourceRecordsCount", 0));
            if (sourceDiagnostics.has("recordsCountRaw")) result.put("recordsCountRaw", sourceDiagnostics.optInt("recordsCountRaw", 0));
            if (sourceDiagnostics.has("recordsCountUnique")) result.put("recordsCountUnique", sourceDiagnostics.optInt("recordsCountUnique", 0));
            if (sourceDiagnostics.has("duplicateRows")) result.put("duplicateRows", sourceDiagnostics.optInt("duplicateRows", 0));
            if (sourceDiagnostics.has("maxRepeat")) result.put("maxRepeat", sourceDiagnostics.optInt("maxRepeat", 0));
            if (sourceDiagnostics.has("rawTotal")) result.put("rawSourceTotal", sourceDiagnostics.opt("rawTotal"));
            if (sourceDiagnostics.has("uniqueTotal")) result.put("uniqueTotal", sourceDiagnostics.opt("uniqueTotal"));
            if (sourceDiagnostics.has("dedupeApplied")) result.put("dedupeApplied", sourceDiagnostics.opt("dedupeApplied"));
            if (sourceDiagnostics.has("sourceDiagnosticsError")) result.put("sourceDiagnosticsError", sourceDiagnostics.opt("sourceDiagnosticsError"));
        }
        if (aggregateError != null) result.put("aggregateError", aggregateError);
        attachAggregateMetadata(result, queryCount);
        call.resolve(result);
    }

    private void aggregateHeartStats(HealthConnectManager manager, TimeInstantRangeFilter filter, HeartAggregateCallback callback) {
        try {
            AggregateRecordsRequest<Long> request = new AggregateRecordsRequest.Builder<Long>(filter)
                .addAggregationType(HeartRateRecord.BPM_MIN)
                .addAggregationType(HeartRateRecord.BPM_AVG)
                .addAggregationType(HeartRateRecord.BPM_MAX)
                .addAggregationType(HeartRateRecord.HEART_MEASUREMENTS_COUNT)
                .build();

            manager.aggregate(request, mainExecutor, new OutcomeReceiver<AggregateRecordsResponse<Long>, HealthConnectException>() {
                @Override
                public void onResult(AggregateRecordsResponse<Long> response) {
                    HeartAggregateStats stats = new HeartAggregateStats();
                    stats.min = response.get(HeartRateRecord.BPM_MIN);
                    stats.avg = response.get(HeartRateRecord.BPM_AVG);
                    stats.max = response.get(HeartRateRecord.BPM_MAX);
                    stats.count = response.get(HeartRateRecord.HEART_MEASUREMENTS_COUNT);
                    Set<String> origins = new LinkedHashSet<>();
                    collectDataOrigins(origins, response.getDataOrigins(HeartRateRecord.BPM_MIN));
                    collectDataOrigins(origins, response.getDataOrigins(HeartRateRecord.BPM_AVG));
                    collectDataOrigins(origins, response.getDataOrigins(HeartRateRecord.BPM_MAX));
                    collectDataOrigins(origins, response.getDataOrigins(HeartRateRecord.HEART_MEASUREMENTS_COUNT));
                    stats.dataOrigins = dataOriginPackagesArray(origins);
                    callback.onResult(stats);
                }

                @Override
                public void onError(@NonNull HealthConnectException error) {
                    callback.onError(error);
                }
            });
        } catch (Exception error) {
            callback.onError(error);
        }
    }

    private void readHeartRateRecords(PluginCall call, TimeInstantRangeFilter filter, HeartAggregateStats aggregateStats) {
        readRecords(call, HeartRateRecord.class, filter, records -> {
            long min = Long.MAX_VALUE;
            long max = 0;
            long sum = 0;
            long count = 0;
            long latestBpm = 0;
            Instant latestTime = Instant.MIN;
            String latestSourcePackage = null;
            Map<String, Long> countsBySource = new HashMap<>();
            JSArray samples = new JSArray();
            for (HeartRateRecord record : records) {
                String sourcePackage = sourcePackage(record);
                countsBySource.put(sourcePackage, countsBySource.getOrDefault(sourcePackage, 0L) + record.getSamples().size());
                for (HeartRateRecord.HeartRateSample sampleRecord : record.getSamples()) {
                    long bpm = sampleRecord.getBeatsPerMinute();
                    min = Math.min(min, bpm);
                    max = Math.max(max, bpm);
                    sum += bpm;
                    count++;
                    if (sampleRecord.getTime().isAfter(latestTime)) {
                        latestTime = sampleRecord.getTime();
                        latestBpm = bpm;
                        latestSourcePackage = sourcePackage;
                    }
                    JSObject sample = new JSObject();
                    sample.put("time", sampleRecord.getTime().toString());
                    sample.put("value", bpm);
                    sample.put("sourcePackage", sourcePackage);
                    sample.put("sourceName", sourceName(sourcePackage));
                    putLimited(samples, sample, MAX_HEART_SAMPLES);
                }
            }
            boolean hasAggregate = aggregateStats != null && aggregateStats.count != null && aggregateStats.count > 0;
            boolean hasData = count > 0 || hasAggregate;
            JSObject result = state(hasData ? "connected" : "no_data", sourceName(latestSourcePackage), hasData ? "Heart rate data read." : "No heart rate data for this period.");
            result.put("range", call.getString("range", "today"));
            result.put("min", aggregateStats != null && aggregateStats.min != null ? aggregateStats.min : (count == 0 ? null : min));
            result.put("avg", aggregateStats != null && aggregateStats.avg != null ? aggregateStats.avg : (count == 0 ? null : Math.round((double) sum / count)));
            result.put("max", aggregateStats != null && aggregateStats.max != null ? aggregateStats.max : (count == 0 ? null : max));
            result.put("latestBpm", count == 0 ? null : latestBpm);
            result.put("latestTimestamp", count == 0 ? null : latestTime.toString());
            result.put("latestAgeMinutes", count == 0 ? null : Math.max(0, Duration.between(latestTime, Instant.now()).toMinutes()));
            result.put("latestSourcePackage", latestSourcePackage);
            result.put("latestSourceName", sourceName(latestSourcePackage));
            result.put("recordsCount", records.size());
            result.put("recordsRawCount", records.size());
            result.put("samplesCount", count);
            result.put("aggregateSamplesCount", aggregateStats == null || aggregateStats.count == null ? null : aggregateStats.count);
            result.put("aggregateStrategy", "health_connect_aggregate_with_latest_raw");
            result.put("dataOrigins", aggregateStats == null ? new JSArray() : aggregateStats.dataOrigins);
            if (aggregateStats != null && aggregateStats.error != null) result.put("aggregateError", aggregateStats.error);
            result.put("queryCount", 1);
            result.put("sources", sourceBreakdown(countsBySource, latestSourcePackage));
            result.put("samples", samples);
            return result;
        });
    }

    private void readSleepRecords(PluginCall call, TimeInstantRangeFilter filter, Long aggregateMinutes, JSArray aggregateSamples, JSArray dataOrigins, JSObject aggregateError) {
        readRecords(call, SleepSessionRecord.class, filter, records -> {
            long rawSessionMinutes = 0;
            JSArray sessions = new JSArray();
            JSArray fragments = new JSArray();
            JSArray naps = new JSArray();
            List<SleepCandidate> deduped = dedupeSleepRecords(records);
            SleepCandidate latest = null;
            for (SleepCandidate candidate : deduped) {
                JSObject session = sleepCandidateObject(candidate);
                if (candidate.minutes >= 120) {
                    rawSessionMinutes += candidate.minutes;
                    putLimited(sessions, session, MAX_SLEEP_SESSIONS);
                } else {
                    putLimited(fragments, session, MAX_SLEEP_SESSIONS);
                    putLimited(naps, session, MAX_SLEEP_SESSIONS);
                }
                if (latest == null || candidate.end.isAfter(latest.end)) latest = candidate;
            }

            boolean aggregateDuplicateSuspected = aggregateMinutes != null
                && aggregateMinutes > 0
                && rawSessionMinutes > 0
                && aggregateMinutes >= Math.round(rawSessionMinutes * 1.5);
            long canonicalMinutes = aggregateMinutes != null && aggregateMinutes > 0 && !aggregateDuplicateSuspected ? aggregateMinutes : rawSessionMinutes;
            JSArray canonicalSamples = aggregateDuplicateSuspected || aggregateSamples.length() == 0 ? sleepSamples(deduped) : aggregateSamples;
            boolean hasData = canonicalMinutes > 0 || sessions.length() > 0 || fragments.length() > 0;
            JSObject result = state(hasData ? "connected" : "no_data", "Health Connect aggregate", hasData ? "Sleep data read from Health Connect." : "No sleep data for this period.");
            result.put("range", call.getString("range", "today"));
            result.put("minutes", canonicalMinutes);
            result.put("aggregateMinutes", aggregateMinutes);
            result.put("rawSessionMinutes", rawSessionMinutes);
            result.put("aggregateStrategy", aggregateDuplicateSuspected ? "deduped_raw_sleep_sessions_over_duplicate_aggregate" : (aggregateMinutes != null ? "health_connect_sleep_aggregate" : "deduped_raw_sleep_sessions"));
            result.put("dedupeStrategy", "overlap_75_keep_more_stages_or_longer");
            result.put("aggregateDuplicateSuspected", aggregateDuplicateSuspected);
            result.put("recordsRawCount", records.size());
            result.put("recordsCount", deduped.size());
            result.put("sessions", sessions);
            result.put("fragments", fragments);
            result.put("naps", naps);
            result.put("samples", canonicalSamples);
            result.put("dataOrigins", dataOrigins);
            if (latest != null) result.put("latestSleep", sleepCandidateObject(latest));
            if (aggregateError != null) result.put("aggregateError", aggregateError);
            result.put("queryCount", aggregateMinutes != null || aggregateError != null ? 1 : 0);
            return result;
        });
    }

    private JSArray sleepSamples(List<SleepCandidate> candidates) {
        JSArray samples = new JSArray();
        for (SleepCandidate candidate : candidates) {
            JSObject sample = intervalSample(candidate.start, candidate.end);
            sample.put("value", candidate.minutes);
            sample.put("sourcePackage", candidate.sourcePackage);
            sample.put("sourceName", candidate.sourceName);
            putLimited(samples, sample, MAX_SLEEP_SESSIONS);
        }
        return samples;
    }

    private List<SleepCandidate> dedupeSleepRecords(List<SleepSessionRecord> records) {
        List<SleepCandidate> candidates = new ArrayList<>();
        for (SleepSessionRecord record : records) {
            SleepCandidate candidate = sleepCandidate(record);
            if (candidate != null) candidates.add(candidate);
        }
        candidates.sort((left, right) -> left.start.compareTo(right.start));

        List<SleepCandidate> kept = new ArrayList<>();
        for (SleepCandidate candidate : candidates) {
            int duplicateIndex = -1;
            for (int index = 0; index < kept.size(); index++) {
                if (sleepOverlapRatio(candidate, kept.get(index)) >= 0.75) {
                    duplicateIndex = index;
                    break;
                }
            }
            if (duplicateIndex < 0) {
                kept.add(candidate);
            } else if (isBetterSleepCandidate(candidate, kept.get(duplicateIndex))) {
                kept.set(duplicateIndex, candidate);
            }
        }
        kept.sort((left, right) -> left.start.compareTo(right.start));
        return kept;
    }

    private SleepCandidate sleepCandidate(SleepSessionRecord record) {
        Instant start = record.getStartTime();
        Instant end = record.getEndTime();
        if (start == null || end == null || !end.isAfter(start)) return null;
        SleepCandidate candidate = new SleepCandidate();
        candidate.start = start;
        candidate.end = end;
        candidate.minutes = Duration.between(start, end).toMinutes();
        candidate.durationMillis = Duration.between(start, end).toMillis();
        candidate.sourcePackage = sourcePackage(record);
        candidate.sourceName = sourceName(candidate.sourcePackage);
        candidate.stages = sleepStages(record);
        candidate.stageCount = record.getStages().size();
        return candidate;
    }

    private JSObject sleepCandidateObject(SleepCandidate candidate) {
        JSObject session = intervalSample(candidate.start, candidate.end);
        session.put("minutes", candidate.minutes);
        session.put("stages", candidate.stages);
        session.put("sourcePackage", candidate.sourcePackage);
        session.put("sourceName", candidate.sourceName);
        session.put("stageCount", candidate.stageCount);
        return session;
    }

    private double sleepOverlapRatio(SleepCandidate left, SleepCandidate right) {
        long overlapStart = Math.max(left.start.toEpochMilli(), right.start.toEpochMilli());
        long overlapEnd = Math.min(left.end.toEpochMilli(), right.end.toEpochMilli());
        long overlap = Math.max(0, overlapEnd - overlapStart);
        long shortest = Math.min(left.durationMillis, right.durationMillis);
        return shortest <= 0 ? 0 : (double) overlap / shortest;
    }

    private boolean isBetterSleepCandidate(SleepCandidate candidate, SleepCandidate current) {
        if (candidate.stageCount != current.stageCount) return candidate.stageCount > current.stageCount;
        return candidate.durationMillis > current.durationMillis;
    }

    private JSObject availability() {
        if (Build.VERSION.SDK_INT < 34) {
            return state("not_supported", "Health Connect", "Для чтения данных нужен Android 14+ или системный Health Connect.");
        }
        if (getManager() == null) {
            return state("not_installed", "Health Connect", "Health Connect недоступен на этом устройстве.");
        }

        int granted = grantedPermissionCount();
        JSObject result;
        if (granted == 0) {
            result = state("permissions_required", "Health Connect", "Разрешите FruitFit доступ к Health Connect.");
        } else if (granted < HEALTH_PERMISSIONS.size()) {
            result = state("partially_granted", "Health Connect", "Часть разрешений Health Connect выдана.");
        } else {
            result = state("connected", "Health Connect", "Health Connect подключён.");
        }
        result.put("permissionStatus", permissionStatus());
        return result;
    }

    private HealthConnectManager getManager() {
        if (Build.VERSION.SDK_INT < 34) return null;
        return (HealthConnectManager) getContext().getSystemService(Context.HEALTHCONNECT_SERVICE);
    }

    private boolean hasHealthPermissions() {
        return grantedPermissionCount() == HEALTH_PERMISSIONS.size();
    }

    private int grantedPermissionCount() {
        if (Build.VERSION.SDK_INT < 34) return 0;
        int count = 0;
        for (String permission : HEALTH_PERMISSIONS) {
            if (hasHealthPermissionGranted(permission)) count++;
        }
        return count;
    }

    private boolean hasHealthPermissionGranted(String permission) {
        if (Build.VERSION.SDK_INT < 34) return false;
        return ActivityCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private JSObject permissionStatus() {
        JSObject object = new JSObject();
        object.put("steps", hasHealthPermissionGranted(HealthPermissions.READ_STEPS));
        object.put("calories", hasHealthPermissionGranted(HealthPermissions.READ_ACTIVE_CALORIES_BURNED));
        object.put("totalCalories", hasHealthPermissionGranted(HealthPermissions.READ_TOTAL_CALORIES_BURNED));
        object.put("heartRate", hasHealthPermissionGranted(HealthPermissions.READ_HEART_RATE));
        object.put("sleep", hasHealthPermissionGranted(HealthPermissions.READ_SLEEP));
        object.put("distance", hasHealthPermissionGranted(HealthPermissions.READ_DISTANCE));
        object.put("workouts", hasHealthPermissionGranted(HealthPermissions.READ_EXERCISE));
        object.put("weight", hasHealthPermissionGranted(HealthPermissions.READ_WEIGHT));
        return object;
    }

    private String permissionForRecord(Class<?> recordType) {
        if (recordType == StepsRecord.class) return HealthPermissions.READ_STEPS;
        if (recordType == ActiveCaloriesBurnedRecord.class) return HealthPermissions.READ_ACTIVE_CALORIES_BURNED;
        if (recordType == TotalCaloriesBurnedRecord.class) return HealthPermissions.READ_TOTAL_CALORIES_BURNED;
        if (recordType == HeartRateRecord.class) return HealthPermissions.READ_HEART_RATE;
        if (recordType == SleepSessionRecord.class) return HealthPermissions.READ_SLEEP;
        if (recordType == DistanceRecord.class) return HealthPermissions.READ_DISTANCE;
        if (recordType == ExerciseSessionRecord.class) return HealthPermissions.READ_EXERCISE;
        if (recordType == WeightRecord.class) return HealthPermissions.READ_WEIGHT;
        return null;
    }

    private String permissionLabel(String permission) {
        if (HealthPermissions.READ_STEPS.equals(permission)) return "steps";
        if (HealthPermissions.READ_ACTIVE_CALORIES_BURNED.equals(permission)) return "calories";
        if (HealthPermissions.READ_TOTAL_CALORIES_BURNED.equals(permission)) return "totalCalories";
        if (HealthPermissions.READ_HEART_RATE.equals(permission)) return "heartRate";
        if (HealthPermissions.READ_SLEEP.equals(permission)) return "sleep";
        if (HealthPermissions.READ_DISTANCE.equals(permission)) return "distance";
        if (HealthPermissions.READ_EXERCISE.equals(permission)) return "workouts";
        if (HealthPermissions.READ_WEIGHT.equals(permission)) return "weight";
        return "health";
    }

    private TimeInstantRangeFilter rangeFilter(String range) {
        ZoneId zone = ZoneId.systemDefault();
        LocalDate today = LocalDate.now(zone);
        Instant end = Instant.now();
        Instant start;
        if ("last15min".equals(range)) {
            start = end.minus(Duration.ofMinutes(15));
        } else if ("last24h".equals(range)) {
            start = end.minus(Duration.ofHours(24));
        } else if ("month".equals(range)) {
            start = today.minusDays(29).atStartOfDay(zone).toInstant();
        } else if ("week".equals(range)) {
            start = today.minusDays(6).atStartOfDay(zone).toInstant();
        } else {
            start = today.atStartOfDay(zone).toInstant();
        }
        return new TimeInstantRangeFilter.Builder().setStartTime(start).setEndTime(end).build();
    }

    private LocalTimeRangeFilter localRangeFilter(String range) {
        ZoneId zone = ZoneId.systemDefault();
        LocalDate today = LocalDate.now(zone);
        LocalDateTime end = LocalDateTime.now(zone);
        LocalDateTime start;
        if ("last15min".equals(range)) {
            start = end.minusMinutes(15);
        } else if ("last24h".equals(range)) {
            start = end.minusHours(24);
        } else if ("month".equals(range)) {
            start = today.minusDays(29).atStartOfDay();
        } else if ("week".equals(range)) {
            start = today.minusDays(6).atStartOfDay();
        } else {
            start = today.atStartOfDay();
        }
        return new LocalTimeRangeFilter.Builder().setStartTime(start).setEndTime(end).build();
    }

    private <T extends android.health.connect.datatypes.Record> void readRecords(
        PluginCall call,
        Class<T> recordType,
        TimeInstantRangeFilter filter,
        ResultBuilder<T> builder
    ) {
        HealthConnectManager manager = getManager();
        if (manager == null) {
            call.resolve(state("not_installed", "Health Connect", "Health Connect недоступен на этом устройстве."));
            return;
        }

        String permission = permissionForRecord(recordType);
        if (permission != null && !hasHealthPermissionGranted(permission)) {
            JSObject result = state("permissions_required", "Health Connect", "Разрешение не выдано.");
            result.put("permission", permissionLabel(permission));
            result.put("permissionStatus", permissionStatus());
            call.resolve(result);
            return;
        }

        readRecordsPage(call, manager, recordType, filter, builder, 0L, new ArrayList<>(), 0);
    }

    private void readStepSourceDiagnostics(HealthConnectManager manager, TimeInstantRangeFilter filter, SourceDiagnosticsCallback callback) {
        readDiagnosticRecordsPage(manager, StepsRecord.class, filter, 0L, new ArrayList<>(), 0, new DiagnosticRecordsCallback<StepsRecord>() {
            @Override
            public void onResult(List<StepsRecord> records, int pagesRead, boolean truncated) {
                Map<String, Long> rawTotalsBySource = new HashMap<>();
                Map<String, Long> uniqueTotalsBySource = new HashMap<>();
                Map<String, Long> rawCountsBySource = new HashMap<>();
                Map<String, Long> uniqueCountsBySource = new HashMap<>();
                Map<String, Map<String, Long>> uniqueTotalsBySourceDate = new HashMap<>();
                Map<String, Map<String, Long>> uniqueCountsBySourceDate = new HashMap<>();
                Map<String, Integer> keyCounts = new HashMap<>();
                long rawTotal = 0;
                long uniqueTotal = 0;
                JSArray samples = new JSArray();
                for (StepsRecord record : records) {
                    long count = record.getCount();
                    String sourcePackage = sourcePackage(record);
                    String key = exactRecordKey(sourcePackage, record.getStartTime(), record.getEndTime(), count);
                    int repeat = keyCounts.getOrDefault(key, 0) + 1;
                    keyCounts.put(key, repeat);
                    rawTotal += count;
                    rawTotalsBySource.put(sourcePackage, rawTotalsBySource.getOrDefault(sourcePackage, 0L) + count);
                    rawCountsBySource.put(sourcePackage, rawCountsBySource.getOrDefault(sourcePackage, 0L) + 1);
                    if (repeat > 1) continue;
                    uniqueTotal += count;
                    uniqueTotalsBySource.put(sourcePackage, uniqueTotalsBySource.getOrDefault(sourcePackage, 0L) + count);
                    uniqueCountsBySource.put(sourcePackage, uniqueCountsBySource.getOrDefault(sourcePackage, 0L) + 1);
                    String dateKey = localDateKey(record.getStartTime());
                    putDailyLong(uniqueTotalsBySourceDate, sourcePackage, dateKey, count);
                    putDailyLong(uniqueCountsBySourceDate, sourcePackage, dateKey, 1L);
                    JSObject sample = intervalSample(record.getStartTime(), record.getEndTime());
                    sample.put("value", count);
                    sample.put("sourcePackage", sourcePackage);
                    sample.put("sourceName", sourceName(sourcePackage));
                putLimited(samples, sample, MAX_SAMPLE_RECORDS);
                }
                DedupeStats stats = dedupeStats(keyCounts, records.size());
                JSObject result = new JSObject();
                result.put("sources", dedupedLongSourceBreakdown(uniqueTotalsBySource, rawTotalsBySource, uniqueCountsBySource, rawCountsBySource));
                result.put("sourceDaily", longSourceDailyBreakdown(uniqueTotalsBySourceDate, uniqueCountsBySourceDate));
                result.put("sourceSamples", samples);
                result.put("sourceRecordsCount", stats.recordsCountUnique);
                result.put("recordsCountRaw", stats.recordsCountRaw);
                result.put("recordsCountUnique", stats.recordsCountUnique);
                result.put("duplicateRows", stats.duplicateRows);
                result.put("maxRepeat", stats.maxRepeat);
                result.put("rawTotal", rawTotal);
                result.put("uniqueTotal", uniqueTotal);
                result.put("dedupeApplied", true);
                result.put("sourcePagesRead", pagesRead);
                result.put("sourceTruncated", truncated);
                callback.onResult(result);
            }

            @Override
            public void onError(@NonNull Exception error) {
                callback.onError(error);
            }
        });
    }

    private void readCaloriesSourceDiagnostics(HealthConnectManager manager, TimeInstantRangeFilter filter, SourceDiagnosticsCallback callback) {
        readDiagnosticRecordsPage(manager, ActiveCaloriesBurnedRecord.class, filter, 0L, new ArrayList<>(), 0, new DiagnosticRecordsCallback<ActiveCaloriesBurnedRecord>() {
            @Override
            public void onResult(List<ActiveCaloriesBurnedRecord> records, int pagesRead, boolean truncated) {
                Map<String, Double> rawCaloriesBySource = new HashMap<>();
                Map<String, Double> uniqueCaloriesBySource = new HashMap<>();
                Map<String, Long> rawCountsBySource = new HashMap<>();
                Map<String, Long> uniqueCountsBySource = new HashMap<>();
                Map<String, Map<String, Double>> uniqueCaloriesBySourceDate = new HashMap<>();
                Map<String, Map<String, Long>> uniqueCountsBySourceDate = new HashMap<>();
                Map<String, Integer> keyCounts = new HashMap<>();
                double rawTotal = 0;
                double uniqueTotal = 0;
                JSArray samples = new JSArray();
                for (ActiveCaloriesBurnedRecord record : records) {
                    double rawCalories = record.getEnergy().getInCalories();
                    double kilocalories = rawCalories / CALORIES_PER_KILOCALORIE;
                    String sourcePackage = sourcePackage(record);
                    String key = exactRecordKey(sourcePackage, record.getStartTime(), record.getEndTime(), Math.round(rawCalories * 1000.0));
                    int repeat = keyCounts.getOrDefault(key, 0) + 1;
                    keyCounts.put(key, repeat);
                    rawTotal += rawCalories;
                    rawCaloriesBySource.put(sourcePackage, rawCaloriesBySource.getOrDefault(sourcePackage, 0.0) + rawCalories);
                    rawCountsBySource.put(sourcePackage, rawCountsBySource.getOrDefault(sourcePackage, 0L) + 1);
                    if (repeat > 1) continue;
                    uniqueTotal += rawCalories;
                    uniqueCaloriesBySource.put(sourcePackage, uniqueCaloriesBySource.getOrDefault(sourcePackage, 0.0) + rawCalories);
                    uniqueCountsBySource.put(sourcePackage, uniqueCountsBySource.getOrDefault(sourcePackage, 0L) + 1);
                    String dateKey = localDateKey(record.getStartTime());
                    putDailyDouble(uniqueCaloriesBySourceDate, sourcePackage, dateKey, rawCalories / CALORIES_PER_KILOCALORIE);
                    putDailyLong(uniqueCountsBySourceDate, sourcePackage, dateKey, 1L);
                    JSObject sample = intervalSample(record.getStartTime(), record.getEndTime());
                    sample.put("value", Math.round(kilocalories));
                    sample.put("rawValue", rawCalories);
                    sample.put("rawUnit", ENERGY_RAW_UNIT);
                    sample.put("convertedValue", kilocalories);
                    sample.put("convertedUnit", ENERGY_UI_UNIT);
                    sample.put("sourcePackage", sourcePackage);
                    sample.put("sourceName", sourceName(sourcePackage));
                    putLimited(samples, sample, MAX_SAMPLE_RECORDS);
                }
                DedupeStats stats = dedupeStats(keyCounts, records.size());
                JSObject result = new JSObject();
                result.put("sources", dedupedCalorieSourceBreakdown(uniqueCaloriesBySource, rawCaloriesBySource, uniqueCountsBySource, rawCountsBySource));
                result.put("sourceDaily", doubleSourceDailyBreakdown(uniqueCaloriesBySourceDate, uniqueCountsBySourceDate));
                result.put("sourceSamples", samples);
                result.put("sourceRecordsCount", stats.recordsCountUnique);
                result.put("recordsCountRaw", stats.recordsCountRaw);
                result.put("recordsCountUnique", stats.recordsCountUnique);
                result.put("duplicateRows", stats.duplicateRows);
                result.put("maxRepeat", stats.maxRepeat);
                result.put("rawTotal", rawTotal / CALORIES_PER_KILOCALORIE);
                result.put("uniqueTotal", uniqueTotal / CALORIES_PER_KILOCALORIE);
                result.put("dedupeApplied", true);
                result.put("sourcePagesRead", pagesRead);
                result.put("sourceTruncated", truncated);
                callback.onResult(result);
            }

            @Override
            public void onError(@NonNull Exception error) {
                callback.onError(error);
            }
        });
    }

    private <T extends android.health.connect.datatypes.Record> void readDiagnosticRecordsPage(
        HealthConnectManager manager,
        Class<T> recordType,
        TimeInstantRangeFilter filter,
        long pageToken,
        List<T> collectedRecords,
        int pageIndex,
        DiagnosticRecordsCallback<T> callback
    ) {
        try {
            ReadRecordsRequestUsingFilters.Builder<T> requestBuilder = new ReadRecordsRequestUsingFilters.Builder<>(recordType)
                .setTimeRangeFilter(filter)
                .setPageSize(READ_PAGE_SIZE);
            if (pageToken > 0) {
                requestBuilder.setPageToken(pageToken);
                clearReadRecordsSortOrderForPageToken(requestBuilder);
            }
            manager.readRecords(requestBuilder.build(), mainExecutor, new OutcomeReceiver<ReadRecordsResponse<T>, HealthConnectException>() {
                @Override
                public void onResult(ReadRecordsResponse<T> response) {
                    collectedRecords.addAll(response.getRecords());
                    long nextPageToken = response.getNextPageToken();
                    if (nextPageToken != 0 && pageIndex + 1 < MAX_READ_PAGES) {
                        readDiagnosticRecordsPage(manager, recordType, filter, nextPageToken, collectedRecords, pageIndex + 1, callback);
                        return;
                    }
                    callback.onResult(sortRecordsByTime(collectedRecords), pageIndex + 1, nextPageToken != 0);
                }

                @Override
                public void onError(@NonNull HealthConnectException error) {
                    callback.onError(error);
                }
            });
        } catch (Exception error) {
            callback.onError(error);
        }
    }

    private <T extends android.health.connect.datatypes.Record> void readRecordsPage(
        PluginCall call,
        HealthConnectManager manager,
        Class<T> recordType,
        TimeInstantRangeFilter filter,
        ResultBuilder<T> builder,
        long pageToken,
        List<T> collectedRecords,
        int pageIndex
    ) {
        try {
        ReadRecordsRequestUsingFilters.Builder<T> requestBuilder = new ReadRecordsRequestUsingFilters.Builder<>(recordType)
            .setTimeRangeFilter(filter)
            .setPageSize(READ_PAGE_SIZE);

        if (pageToken > 0) {
            requestBuilder.setPageToken(pageToken);
            try {
                // In some Android 14 versions, clearAscending() or clearSortOrder() is available
                java.lang.reflect.Method clearAsc = requestBuilder.getClass().getMethod("clearAscending");
                clearAsc.invoke(requestBuilder);
            } catch (Exception e1) {
                try {
                    java.lang.reflect.Method clearSort = requestBuilder.getClass().getMethod("clearSortOrder");
                    clearSort.invoke(requestBuilder);
                } catch (Exception e2) {
                    try {
                        // Workaround to unset the flag using reflection if method is hidden
                        java.lang.reflect.Field f = requestBuilder.getClass().getDeclaredField("mAscendingSet");
                        f.setAccessible(true);
                        f.set(requestBuilder, false);
                    } catch (Exception e3) {}
                }
            }
        }

        ReadRecordsRequestUsingFilters<T> request = requestBuilder.build();

        manager.readRecords(request, mainExecutor, new OutcomeReceiver<ReadRecordsResponse<T>, HealthConnectException>() {
            @Override
            public void onResult(ReadRecordsResponse<T> response) {
                collectedRecords.addAll(response.getRecords());
                long nextPageToken = response.getNextPageToken();
                if (nextPageToken != 0 && pageIndex + 1 < MAX_READ_PAGES) {
                    readRecordsPage(call, manager, recordType, filter, builder, nextPageToken, collectedRecords, pageIndex + 1);
                    return;
                }
                JSObject result = builder.build(sortRecordsByTime(collectedRecords));
                attachReadMetadata(result, pageIndex + 1, nextPageToken != 0);
                call.resolve(result);
            }

            @Override
            public void onError(@NonNull HealthConnectException error) {
                JSObject result = state("error", "Health Connect", error.getMessage() == null ? "Не удалось прочитать Health Connect." : error.getMessage());
                result.put("errorCode", error.getErrorCode());
                result.put("recordType", recordType.getSimpleName());
                result.put("pageIndex", pageIndex);
                result.put("pageTokenUsed", pageToken > 0);
                result.put("pagesRead", pageIndex + 1);
                result.put("maxPages", MAX_READ_PAGES);
                result.put("truncated", false);
                result.put("queryCount", 1);
                result.put("quotaExceeded", error.getErrorCode() == 7 || String.valueOf(error.getMessage()).toLowerCase().contains("quota"));
                call.resolve(result);
            }
        });
        } catch (Exception error) {
            resolveReadError(call, recordType, error, pageIndex, pageToken);
        }
    }

    private <T extends android.health.connect.datatypes.Record> void clearReadRecordsSortOrderForPageToken(ReadRecordsRequestUsingFilters.Builder<T> requestBuilder) {
        try {
            java.lang.reflect.Method clearAsc = requestBuilder.getClass().getMethod("clearAscending");
            clearAsc.invoke(requestBuilder);
        } catch (Exception e1) {
            try {
                java.lang.reflect.Method clearSort = requestBuilder.getClass().getMethod("clearSortOrder");
                clearSort.invoke(requestBuilder);
            } catch (Exception e2) {
                try {
                    java.lang.reflect.Field f = requestBuilder.getClass().getDeclaredField("mAscendingSet");
                    f.setAccessible(true);
                    f.set(requestBuilder, false);
                } catch (Exception e3) {
                    // Best-effort compatibility workaround for page-token reads.
                }
            }
        }
    }

    private <T extends android.health.connect.datatypes.Record> List<T> sortRecordsByTime(List<T> records) {
        List<T> sortedRecords = new ArrayList<>(records);
        sortedRecords.sort((left, right) -> recordSortInstant(left).compareTo(recordSortInstant(right)));
        return sortedRecords;
    }

    private Instant recordSortInstant(android.health.connect.datatypes.Record record) {
        Instant startTime = invokeInstantGetter(record, "getStartTime");
        if (startTime != null) return startTime;
        Instant time = invokeInstantGetter(record, "getTime");
        if (time != null) return time;
        return Instant.EPOCH;
    }

    private Instant invokeInstantGetter(android.health.connect.datatypes.Record record, String methodName) {
        try {
            java.lang.reflect.Method method = record.getClass().getMethod(methodName);
            Object value = method.invoke(record);
            if (value instanceof Instant) return (Instant) value;
        } catch (Exception ignored) {
            // Health Connect record types expose either getStartTime or getTime.
        }
        return null;
    }

    private void resolveReadError(PluginCall call, Class<?> recordType, Exception error, int pageIndex, long pageToken) {
        JSObject result = state("error", "Health Connect", error.getMessage() == null ? "Не удалось прочитать Health Connect." : error.getMessage());
        if (error instanceof HealthConnectException) {
            result.put("errorCode", ((HealthConnectException) error).getErrorCode());
        }
        result.put("recordType", recordType.getSimpleName());
        result.put("pageIndex", pageIndex);
        result.put("pageTokenUsed", pageToken > 0);
        result.put("pagesRead", pageIndex + 1);
        result.put("maxPages", MAX_READ_PAGES);
        result.put("truncated", false);
        result.put("queryCount", 1);
        result.put("quotaExceeded", (error instanceof HealthConnectException && ((HealthConnectException) error).getErrorCode() == 7) || String.valueOf(error.getMessage()).toLowerCase().contains("quota"));
        call.resolve(result);
    }

    private void attachReadMetadata(JSObject result, int pagesRead, boolean truncated) {
        int existingQueryCount = result.optInt("queryCount", 0);
        result.put("pagesRead", pagesRead);
        result.put("maxPages", MAX_READ_PAGES);
        result.put("truncated", truncated);
        result.put("omittedRecordsCount", null);
        result.put("queryCount", existingQueryCount > 0 ? existingQueryCount + 1 : 1);
        result.put("quotaExceeded", false);
    }

    private void putLimited(JSArray array, JSObject value, int limit) {
        if (array.length() < limit) array.put(value);
    }

    private JSObject state(String state, String source, String message) {
        JSObject object = new JSObject();
        object.put("state", state);
        object.put("source", source);
        object.put("message", message);
        return object;
    }

    private JSObject intervalSample(Instant start, Instant end) {
        JSObject object = new JSObject();
        object.put("start", start.toString());
        object.put("end", end.toString());
        return object;
    }

    private String sourcePackage(android.health.connect.datatypes.Record record) {
        try {
            return record.getMetadata().getDataOrigin().getPackageName();
        } catch (Exception error) {
            return "unknown";
        }
    }

    private boolean isHuaweiDevice() {
        String raw = (Build.MANUFACTURER + " " + Build.BRAND + " " + Build.MODEL + " " + systemProperty("ro.build.version.emui")).toLowerCase();
        return raw.contains("huawei") || raw.contains("honor") || raw.contains("emui");
    }

    private JSObject webViewDiagnostic() {
        JSObject object = new JSObject();
        try {
            PackageInfo webViewPackage = Build.VERSION.SDK_INT >= 26 ? WebView.getCurrentWebViewPackage() : null;
            if (webViewPackage == null) {
                object.put("packageName", null);
                object.put("versionName", null);
                object.put("available", false);
                return object;
            }
            object.put("packageName", webViewPackage.packageName);
            object.put("versionName", webViewPackage.versionName);
            object.put("versionCode", packageVersionCode(webViewPackage));
            object.put("available", true);
        } catch (Exception error) {
            object.put("available", false);
            object.put("error", error.getMessage());
        }
        return object;
    }

    private JSArray installedPackageDiagnostics() {
        JSArray items = new JSArray();
        PackageManager packageManager = getContext().getPackageManager();
        for (String packageName : DIAGNOSTIC_PACKAGES) {
            JSObject item = new JSObject();
            item.put("packageName", packageName);
            item.put("sourceName", sourceName(packageName));
            try {
                PackageInfo info = packageManager.getPackageInfo(packageName, 0);
                item.put("installed", true);
                item.put("versionName", info.versionName);
                item.put("versionCode", packageVersionCode(info));
                item.put("hasLaunchIntent", packageManager.getLaunchIntentForPackage(packageName) != null);
            } catch (PackageManager.NameNotFoundException error) {
                item.put("installed", false);
            } catch (Exception error) {
                item.put("installed", false);
                item.put("error", error.getMessage());
            }
            items.put(item);
        }
        return items;
    }

    private long packageVersionCode(PackageInfo info) {
        if (info == null) return 0;
        if (Build.VERSION.SDK_INT >= 28) return info.getLongVersionCode();
        return info.versionCode;
    }

    private String systemProperty(String key) {
        try {
            Class<?> systemProperties = Class.forName("android.os.SystemProperties");
            Method get = systemProperties.getMethod("get", String.class);
            Object value = get.invoke(null, key);
            return value == null ? "" : String.valueOf(value);
        } catch (Exception error) {
            return "";
        }
    }

    private JSObject diagnosticLimits() {
        JSObject object = new JSObject();
        object.put("readPageSize", READ_PAGE_SIZE);
        object.put("maxReadPages", MAX_READ_PAGES);
        object.put("maxSampleRecords", MAX_SAMPLE_RECORDS);
        object.put("maxHeartSamples", MAX_HEART_SAMPLES);
        object.put("maxSleepSessions", MAX_SLEEP_SESSIONS);
        object.put("maxSleepStages", MAX_SLEEP_STAGES);
        return object;
    }

    private JSObject readDiagnosticFile(String fileName) {
        JSObject object = new JSObject();
        File file = findDiagnosticFile(fileName);
        object.put("fileName", fileName);
        if (file == null || !file.exists()) {
            object.put("exists", false);
            object.put("text", null);
            return object;
        }
        object.put("exists", true);
        object.put("pathHint", "app cache diagnostics/" + fileName);
        object.put("sizeBytes", file.length());
        try (FileInputStream stream = new FileInputStream(file)) {
            long skipped = 0;
            long length = file.length();
            if (length > MAX_DIAGNOSTIC_TEXT_BYTES) {
                skipped = length - MAX_DIAGNOSTIC_TEXT_BYTES;
                long remainingSkip = skipped;
                while (remainingSkip > 0) {
                    long nextSkipped = stream.skip(remainingSkip);
                    if (nextSkipped <= 0) break;
                    remainingSkip -= nextSkipped;
                }
            }
            byte[] buffer = new byte[(int) Math.min(MAX_DIAGNOSTIC_TEXT_BYTES, Math.max(0, length - skipped))];
            int read = stream.read(buffer);
            String text = read > 0 ? new String(buffer, 0, read, "UTF-8") : "";
            object.put("truncatedHeadBytes", skipped);
            object.put("text", text);
        } catch (Exception error) {
            object.put("readError", error.getMessage());
            object.put("text", null);
        }
        return object;
    }

    private File findDiagnosticFile(String fileName) {
        File internal = new File(new File(getContext().getCacheDir(), "diagnostics"), fileName);
        if (internal.exists()) return internal;
        File externalCache = getContext().getExternalCacheDir();
        if (externalCache == null) return internal;
        File external = new File(new File(externalCache, "diagnostics"), fileName);
        return external.exists() ? external : internal;
    }

    private String sourceName(String sourcePackage) {
        if (sourcePackage == null || sourcePackage.length() == 0 || "unknown".equalsIgnoreCase(sourcePackage)) return "Health Connect aggregate";
        String value = sourcePackage.toLowerCase();
        if (value.contains("huawei")) return "Huawei Health";
        if (value.contains("com.google.android.apps.fitness") || value.contains("google.android.apps.fitness") || value.contains("googlefit")) return "Google Fit";
        if (value.contains("xiaomi") || value.contains("mi.health") || value.contains("mihealth") || value.contains("mifitness")) return "Mi Fitness";
        if (value.contains("huami") || value.contains("zepp") || value.contains("amazfit")) return "Zepp / Amazfit";
        if (value.contains("samsung")) return "Samsung Health";
        if (value.contains("fitness")) return "Google Fit";
        if (value.contains("garmin")) return "Garmin";
        if (value.contains("fitbit")) return "Fitbit";
        if (value.contains("oura")) return "Oura";
        if (value.contains("whoop")) return "WHOOP";
        if (value.contains("healthdata") || value.contains("healthconnect")) return "Health Connect aggregate";
        return sourcePackage;
    }

    private String[] packagesForSource(String sourceId) {
        if ("huawei_health".equals(sourceId)) return new String[] { "com.huawei.health" };
        if ("samsung_health".equals(sourceId)) return new String[] { "com.sec.android.app.shealth" };
        if ("google_fit".equals(sourceId)) return new String[] { "com.google.android.apps.fitness" };
        if ("zepp".equals(sourceId)) return new String[] { "com.huami.watch.hmwatchmanager", "com.zepp.z" };
        if ("mi_fitness".equals(sourceId)) return new String[] { "com.xiaomi.wearable", "com.mi.health", "com.xiaomi.hm.health" };
        if ("whoop".equals(sourceId)) return new String[] { "com.whoop.android", "com.whoop" };
        return new String[] {};
    }

    private String choosePreferredSource(Map<String, Long> totalsBySource, String requestedSourcePackage) {
        if (totalsBySource.isEmpty()) return null;
        if (requestedSourcePackage != null && requestedSourcePackage.length() > 0) {
            for (String source : totalsBySource.keySet()) {
                if (source != null && source.equalsIgnoreCase(requestedSourcePackage)) return source;
            }
        }
        String[] preferred = {
            "xiaomi",
            "mi.health",
            "mihealth",
            "mifitness",
            "huami",
            "zepp",
            "amazfit",
            "huawei",
            "com.google.android.apps.fitness",
            "google.android.apps.fitness",
            "googlefit",
            "fitness",
            "samsung"
        };
        for (String keyword : preferred) {
            for (String source : totalsBySource.keySet()) {
                if (source != null && source.toLowerCase().contains(keyword)) return source;
            }
        }
        String bestSource = null;
        long bestTotal = -1;
        for (Map.Entry<String, Long> entry : totalsBySource.entrySet()) {
            if (entry.getValue() > bestTotal) {
                bestTotal = entry.getValue();
                bestSource = entry.getKey();
            }
        }
        return bestSource;
    }

    private JSArray sourceBreakdown(Map<String, Long> totalsBySource, String selectedSourcePackage) {
        JSArray sources = new JSArray();
        for (Map.Entry<String, Long> entry : totalsBySource.entrySet()) {
            JSObject item = new JSObject();
            item.put("sourcePackage", entry.getKey());
            item.put("sourceName", sourceName(entry.getKey()));
            item.put("total", entry.getValue());
            item.put("selected", entry.getKey() != null && entry.getKey().equals(selectedSourcePackage));
            sources.put(item);
        }
        return sources;
    }

    private JSArray dedupedLongSourceBreakdown(
        Map<String, Long> uniqueTotalsBySource,
        Map<String, Long> rawTotalsBySource,
        Map<String, Long> uniqueCountsBySource,
        Map<String, Long> rawCountsBySource
    ) {
        JSArray sources = new JSArray();
        Set<String> packages = new LinkedHashSet<>();
        packages.addAll(rawTotalsBySource.keySet());
        packages.addAll(uniqueTotalsBySource.keySet());
        for (String sourcePackage : packages) {
            long rawTotal = rawTotalsBySource.getOrDefault(sourcePackage, 0L);
            long uniqueTotal = uniqueTotalsBySource.getOrDefault(sourcePackage, 0L);
            long rawCount = rawCountsBySource.getOrDefault(sourcePackage, 0L);
            long uniqueCount = uniqueCountsBySource.getOrDefault(sourcePackage, 0L);
            JSObject item = new JSObject();
            item.put("sourcePackage", sourcePackage);
            item.put("sourceName", sourceName(sourcePackage));
            item.put("total", uniqueTotal);
            item.put("rawTotal", rawTotal);
            item.put("uniqueTotal", uniqueTotal);
            item.put("recordsCountRaw", rawCount);
            item.put("recordsCountUnique", uniqueCount);
            item.put("duplicateRows", Math.max(0L, rawCount - uniqueCount));
            item.put("dedupeApplied", true);
            item.put("selected", false);
            sources.put(item);
        }
        return sources;
    }

    private JSArray dedupedDoubleSourceBreakdown(
        Map<String, Double> uniqueTotalsBySource,
        Map<String, Double> rawTotalsBySource,
        Map<String, Long> uniqueCountsBySource,
        Map<String, Long> rawCountsBySource
    ) {
        JSArray sources = new JSArray();
        Set<String> packages = new LinkedHashSet<>();
        packages.addAll(rawTotalsBySource.keySet());
        packages.addAll(uniqueTotalsBySource.keySet());
        for (String sourcePackage : packages) {
            double rawTotal = rawTotalsBySource.getOrDefault(sourcePackage, 0.0);
            double uniqueTotal = uniqueTotalsBySource.getOrDefault(sourcePackage, 0.0);
            long rawCount = rawCountsBySource.getOrDefault(sourcePackage, 0L);
            long uniqueCount = uniqueCountsBySource.getOrDefault(sourcePackage, 0L);
            JSObject item = new JSObject();
            item.put("sourcePackage", sourcePackage);
            item.put("sourceName", sourceName(sourcePackage));
            item.put("total", uniqueTotal);
            item.put("rawTotal", rawTotal);
            item.put("uniqueTotal", uniqueTotal);
            item.put("recordsCountRaw", rawCount);
            item.put("recordsCountUnique", uniqueCount);
            item.put("duplicateRows", Math.max(0L, rawCount - uniqueCount));
            item.put("dedupeApplied", true);
            item.put("selected", false);
            sources.put(item);
        }
        return sources;
    }

    private JSArray dedupedCalorieSourceBreakdown(
        Map<String, Double> uniqueCaloriesBySource,
        Map<String, Double> rawCaloriesBySource,
        Map<String, Long> uniqueCountsBySource,
        Map<String, Long> rawCountsBySource
    ) {
        JSArray sources = new JSArray();
        Set<String> packages = new LinkedHashSet<>();
        packages.addAll(rawCaloriesBySource.keySet());
        packages.addAll(uniqueCaloriesBySource.keySet());
        for (String sourcePackage : packages) {
            double rawCalories = rawCaloriesBySource.getOrDefault(sourcePackage, 0.0);
            double uniqueCalories = uniqueCaloriesBySource.getOrDefault(sourcePackage, 0.0);
            long rawCount = rawCountsBySource.getOrDefault(sourcePackage, 0L);
            long uniqueCount = uniqueCountsBySource.getOrDefault(sourcePackage, 0L);
            JSObject item = new JSObject();
            item.put("sourcePackage", sourcePackage);
            item.put("sourceName", sourceName(sourcePackage));
            item.put("rawValue", uniqueCalories);
            item.put("rawTotal", rawCalories / CALORIES_PER_KILOCALORIE);
            item.put("uniqueTotal", uniqueCalories / CALORIES_PER_KILOCALORIE);
            item.put("rawUnit", ENERGY_RAW_UNIT);
            item.put("convertedValue", uniqueCalories / CALORIES_PER_KILOCALORIE);
            item.put("convertedUnit", ENERGY_UI_UNIT);
            item.put("total", Math.round(uniqueCalories / CALORIES_PER_KILOCALORIE));
            item.put("recordsCount", uniqueCount);
            item.put("recordsCountRaw", rawCount);
            item.put("recordsCountUnique", uniqueCount);
            item.put("duplicateRows", Math.max(0L, rawCount - uniqueCount));
            item.put("dedupeApplied", true);
            sources.put(item);
        }
        return sources;
    }

    private String localDateKey(Instant instant) {
        return instant.atZone(ZoneId.systemDefault()).toLocalDate().toString();
    }

    private void putDailyLong(Map<String, Map<String, Long>> target, String sourcePackage, String dateKey, long value) {
        if (dateKey == null || dateKey.isEmpty()) return;
        Map<String, Long> byDate = target.computeIfAbsent(sourcePackage, ignored -> new LinkedHashMap<>());
        byDate.put(dateKey, byDate.getOrDefault(dateKey, 0L) + value);
    }

    private void putDailyDouble(Map<String, Map<String, Double>> target, String sourcePackage, String dateKey, double value) {
        if (dateKey == null || dateKey.isEmpty()) return;
        Map<String, Double> byDate = target.computeIfAbsent(sourcePackage, ignored -> new LinkedHashMap<>());
        byDate.put(dateKey, byDate.getOrDefault(dateKey, 0.0) + value);
    }

    private JSObject longSourceDailyBreakdown(
        Map<String, Map<String, Long>> totalsBySourceDate,
        Map<String, Map<String, Long>> countsBySourceDate
    ) {
        JSObject result = new JSObject();
        for (Map.Entry<String, Map<String, Long>> sourceEntry : totalsBySourceDate.entrySet()) {
            String sourcePackage = sourceEntry.getKey();
            JSArray days = new JSArray();
            Map<String, Long> countsByDate = countsBySourceDate.getOrDefault(sourcePackage, new HashMap<>());
            for (Map.Entry<String, Long> dayEntry : sourceEntry.getValue().entrySet()) {
                JSObject day = new JSObject();
                day.put("date", dayEntry.getKey());
                day.put("value", dayEntry.getValue());
                day.put("recordsCount", countsByDate.getOrDefault(dayEntry.getKey(), 0L));
                day.put("sourcePackage", sourcePackage);
                day.put("sourceName", sourceName(sourcePackage));
                days.put(day);
            }
            result.put(sourcePackage, days);
        }
        return result;
    }

    private JSObject doubleSourceDailyBreakdown(
        Map<String, Map<String, Double>> totalsBySourceDate,
        Map<String, Map<String, Long>> countsBySourceDate
    ) {
        JSObject result = new JSObject();
        for (Map.Entry<String, Map<String, Double>> sourceEntry : totalsBySourceDate.entrySet()) {
            String sourcePackage = sourceEntry.getKey();
            JSArray days = new JSArray();
            Map<String, Long> countsByDate = countsBySourceDate.getOrDefault(sourcePackage, new HashMap<>());
            for (Map.Entry<String, Double> dayEntry : sourceEntry.getValue().entrySet()) {
                JSObject day = new JSObject();
                day.put("date", dayEntry.getKey());
                day.put("value", Math.round(dayEntry.getValue()));
                day.put("rawValue", dayEntry.getValue());
                day.put("recordsCount", countsByDate.getOrDefault(dayEntry.getKey(), 0L));
                day.put("sourcePackage", sourcePackage);
                day.put("sourceName", sourceName(sourcePackage));
                days.put(day);
            }
            result.put(sourcePackage, days);
        }
        return result;
    }

    private String exactRecordKey(String sourcePackage, Instant start, Instant end, long value) {
        return String.valueOf(sourcePackage) + "|" + start.toString() + "|" + end.toString() + "|" + value;
    }

    private DedupeStats dedupeStats(Map<String, Integer> keyCounts, int rawCount) {
        DedupeStats stats = new DedupeStats();
        stats.recordsCountRaw = rawCount;
        stats.recordsCountUnique = keyCounts.size();
        stats.duplicateRows = Math.max(0, rawCount - keyCounts.size());
        int maxRepeat = 0;
        for (Integer count : keyCounts.values()) {
            if (count != null && count > maxRepeat) maxRepeat = count;
        }
        stats.maxRepeat = maxRepeat;
        return stats;
    }

    private JSArray calorieSourceBreakdown(Map<String, Double> rawCaloriesBySource, Map<String, Long> recordCountsBySource) {
        JSArray sources = new JSArray();
        for (Map.Entry<String, Double> entry : rawCaloriesBySource.entrySet()) {
            double rawCalories = entry.getValue();
            JSObject item = new JSObject();
            item.put("sourcePackage", entry.getKey());
            item.put("sourceName", sourceName(entry.getKey()));
            item.put("rawValue", rawCalories);
            item.put("rawUnit", ENERGY_RAW_UNIT);
            item.put("convertedValue", rawCalories / CALORIES_PER_KILOCALORIE);
            item.put("convertedUnit", ENERGY_UI_UNIT);
            item.put("total", Math.round(rawCalories / CALORIES_PER_KILOCALORIE));
            item.put("recordsCount", recordCountsBySource.getOrDefault(entry.getKey(), 0L));
            sources.put(item);
        }
        return sources;
    }

    private boolean usesDurationBuckets(String range) {
        return "today".equals(range) || "last24h".equals(range) || "last15min".equals(range);
    }

    private double rawCalories(Energy energy) {
        return energy == null ? 0 : energy.getInCalories();
    }

    private double kilocalories(Energy energy) {
        return rawCalories(energy) / CALORIES_PER_KILOCALORIE;
    }

    private void collectDataOrigins(Set<String> packages, Set<DataOrigin> origins) {
        if (origins == null) return;
        for (DataOrigin origin : origins) {
            if (origin == null || origin.getPackageName() == null || origin.getPackageName().length() == 0) continue;
            packages.add(origin.getPackageName());
        }
    }

    private JSArray dataOriginsArray(Set<DataOrigin> origins) {
        Set<String> packages = new LinkedHashSet<>();
        collectDataOrigins(packages, origins);
        return dataOriginPackagesArray(packages);
    }

    private JSArray dataOriginPackagesArray(Set<String> packages) {
        JSArray array = new JSArray();
        for (String packageName : packages) {
            JSObject item = new JSObject();
            item.put("sourcePackage", packageName);
            item.put("sourceName", sourceName(packageName));
            array.put(item);
        }
        return array;
    }

    private JSObject aggregateErrorObject(String recordType, Exception error) {
        JSObject object = new JSObject();
        object.put("recordType", recordType);
        object.put("message", error.getMessage() == null ? "Health Connect aggregate failed." : error.getMessage());
        if (error instanceof HealthConnectException) {
            object.put("errorCode", ((HealthConnectException) error).getErrorCode());
            object.put("quotaExceeded", ((HealthConnectException) error).getErrorCode() == HealthConnectException.ERROR_RATE_LIMIT_EXCEEDED);
        } else {
            object.put("quotaExceeded", String.valueOf(error.getMessage()).toLowerCase().contains("quota"));
        }
        return object;
    }

    private void resolveAggregateError(PluginCall call, String recordType, Exception error, int queryCount) {
        JSObject result = state("error", "Health Connect", error.getMessage() == null ? "Health Connect aggregate failed." : error.getMessage());
        if (error instanceof HealthConnectException) {
            result.put("errorCode", ((HealthConnectException) error).getErrorCode());
        }
        result.put("recordType", recordType);
        result.put("aggregateStrategy", "health_connect_aggregate");
        result.put("pagesRead", 0);
        result.put("maxPages", null);
        result.put("truncated", false);
        result.put("queryCount", queryCount);
        result.put("quotaExceeded", (error instanceof HealthConnectException && ((HealthConnectException) error).getErrorCode() == HealthConnectException.ERROR_RATE_LIMIT_EXCEEDED) || String.valueOf(error.getMessage()).toLowerCase().contains("quota"));
        call.resolve(result);
    }

    private void attachAggregateMetadata(JSObject result, int queryCount) {
        result.put("pagesRead", 0);
        result.put("maxPages", null);
        result.put("truncated", false);
        result.put("omittedRecordsCount", null);
        result.put("queryCount", queryCount);
        result.put("quotaExceeded", false);
    }

    private JSArray sleepStages(SleepSessionRecord record) {
        JSArray stages = new JSArray();
        for (SleepSessionRecord.Stage stageRecord : record.getStages()) {
            if (stages.length() >= MAX_SLEEP_STAGES) break;
            JSObject stage = intervalSample(stageRecord.getStartTime(), stageRecord.getEndTime());
            stage.put("type", stageRecord.getType());
            stages.put(stage);
        }
        return stages;
    }

    private interface ResultBuilder<T extends android.health.connect.datatypes.Record> {
        JSObject build(List<T> records);
    }

    private interface LongValueConverter {
        double convert(long value);
    }

    private interface LongBucketsCallback {
        void onResult(double total, JSArray samples, JSArray dataOrigins, int bucketsCount);
        void onError(@NonNull Exception error);
    }

    private interface EnergyBucketsCallback {
        void onResult(JSArray samples, JSArray dataOrigins, int bucketsCount);
        void onError(@NonNull Exception error);
    }

    private interface SourceDiagnosticsCallback {
        void onResult(JSObject diagnostics);
        void onError(@NonNull Exception error);
    }

    private interface DiagnosticRecordsCallback<T extends android.health.connect.datatypes.Record> {
        void onResult(List<T> records, int pagesRead, boolean truncated);
        void onError(@NonNull Exception error);
    }

    private interface HeartAggregateCallback {
        void onResult(HeartAggregateStats stats);
        void onError(@NonNull Exception error);
    }

    private static class HeartAggregateStats {
        Long min;
        Long avg;
        Long max;
        Long count;
        JSArray dataOrigins = new JSArray();
        JSObject error;
    }

    private static class DedupeStats {
        int recordsCountRaw;
        int recordsCountUnique;
        int duplicateRows;
        int maxRepeat;
    }

    private static class SleepCandidate {
        Instant start;
        Instant end;
        long minutes;
        long durationMillis;
        String sourcePackage;
        String sourceName;
        JSArray stages;
        int stageCount;
    }
}
