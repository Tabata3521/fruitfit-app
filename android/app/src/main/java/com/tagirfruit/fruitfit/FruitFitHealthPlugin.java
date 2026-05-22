package com.tagirfruit.fruitfit;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.health.connect.HealthConnectException;
import android.health.connect.HealthConnectManager;
import android.health.connect.HealthPermissions;
import android.health.connect.ReadRecordsRequestUsingFilters;
import android.health.connect.ReadRecordsResponse;
import android.health.connect.TimeInstantRangeFilter;
import android.health.connect.datatypes.ActiveCaloriesBurnedRecord;
import android.health.connect.datatypes.DistanceRecord;
import android.health.connect.datatypes.ExerciseSessionRecord;
import android.health.connect.datatypes.HeartRateRecord;
import android.health.connect.datatypes.SleepSessionRecord;
import android.health.connect.datatypes.StepsRecord;
import android.health.connect.datatypes.WeightRecord;
import android.net.Uri;
import android.os.Build;
import android.os.OutcomeReceiver;
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
import java.time.ZoneId;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;

@CapacitorPlugin(
    name = "FruitFitHealth",
    permissions = {
        @Permission(
            alias = "health",
            strings = {
                "android.permission.health.READ_STEPS",
                "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
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
    private static final List<String> HEALTH_PERMISSIONS = Arrays.asList(
        HealthPermissions.READ_STEPS,
        HealthPermissions.READ_ACTIVE_CALORIES_BURNED,
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
    public void getSteps(PluginCall call) {
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
                samples.put(sample);
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
            result.put("samples", samples);
            return result;
        });
    }

    @PluginMethod
    public void getCalories(PluginCall call) {
        TimeInstantRangeFilter filter = rangeFilter(call.getString("range", "today"));
        readRecords(call, ActiveCaloriesBurnedRecord.class, filter, records -> {
            double total = 0;
            JSArray samples = new JSArray();
            for (ActiveCaloriesBurnedRecord record : records) {
                double calories = record.getEnergy().getInCalories();
                String sourcePackage = sourcePackage(record);
                total += calories;
                JSObject sample = intervalSample(record.getStartTime(), record.getEndTime());
                sample.put("value", Math.round(calories));
                sample.put("sourcePackage", sourcePackage);
                sample.put("sourceName", sourceName(sourcePackage));
                samples.put(sample);
            }
            JSObject result = state(records.isEmpty() ? "no_data" : "connected", "Health Connect", records.isEmpty() ? "Нет активных калорий за период." : "Активные калории получены.");
            result.put("range", call.getString("range", "today"));
            result.put("active", Math.round(total));
            result.put("total", 0);
            result.put("samples", samples);
            return result;
        });
    }

    @PluginMethod
    public void getHeartRate(PluginCall call) {
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
                    samples.put(sample);
                }
            }
            JSObject result = state(count == 0 ? "no_data" : "connected", sourceName(latestSourcePackage), count == 0 ? "Нет данных пульса за период." : "Данные пульса получены.");
            result.put("range", call.getString("range", "today"));
            result.put("min", count == 0 ? null : min);
            result.put("avg", count == 0 ? null : Math.round((double) sum / count));
            result.put("max", count == 0 ? null : max);
            result.put("latestBpm", count == 0 ? null : latestBpm);
            result.put("latestTimestamp", count == 0 ? null : latestTime.toString());
            result.put("latestSourcePackage", latestSourcePackage);
            result.put("latestSourceName", sourceName(latestSourcePackage));
            result.put("recordsCount", records.size());
            result.put("samplesCount", count);
            result.put("sources", sourceBreakdown(countsBySource, latestSourcePackage));
            result.put("samples", samples);
            return result;
        });
    }

    @PluginMethod
    public void getSleep(PluginCall call) {
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
                    sessions.put(session);
                } else {
                    fragments.put(session);
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
            double meters = 0;
            JSArray samples = new JSArray();
            for (DistanceRecord record : records) {
                double value = record.getDistance().getInMeters();
                String sourcePackage = sourcePackage(record);
                meters += value;
                JSObject sample = intervalSample(record.getStartTime(), record.getEndTime());
                sample.put("value", value);
                sample.put("sourcePackage", sourcePackage);
                sample.put("sourceName", sourceName(sourcePackage));
                samples.put(sample);
            }
            JSObject result = state(records.isEmpty() ? "no_data" : "connected", "Health Connect", records.isEmpty() ? "Нет данных дистанции за период." : "Дистанция получена.");
            result.put("range", call.getString("range", "today"));
            result.put("meters", meters);
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
                sessions.put(session);
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
                samples.put(sample);
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

        ReadRecordsRequestUsingFilters<T> request = new ReadRecordsRequestUsingFilters.Builder<>(recordType)
            .setTimeRangeFilter(filter)
            .setAscending(true)
            .setPageSize(1000)
            .build();

        manager.readRecords(request, mainExecutor, new OutcomeReceiver<ReadRecordsResponse<T>, HealthConnectException>() {
            @Override
            public void onResult(ReadRecordsResponse<T> response) {
                call.resolve(builder.build(response.getRecords()));
            }

            @Override
            public void onError(@NonNull HealthConnectException error) {
                JSObject result = state("error", "Health Connect", error.getMessage() == null ? "Не удалось прочитать Health Connect." : error.getMessage());
                result.put("errorCode", error.getErrorCode());
                call.resolve(result);
            }
        });
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

    private String sourceName(String sourcePackage) {
        if (sourcePackage == null || sourcePackage.length() == 0 || "unknown".equalsIgnoreCase(sourcePackage)) return "Health Connect aggregate";
        String value = sourcePackage.toLowerCase();
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

    private JSArray sleepStages(SleepSessionRecord record) {
        JSArray stages = new JSArray();
        for (SleepSessionRecord.Stage stageRecord : record.getStages()) {
            JSObject stage = intervalSample(stageRecord.getStartTime(), stageRecord.getEndTime());
            stage.put("type", stageRecord.getType());
            stages.put(stage);
        }
        return stages;
    }

    private interface ResultBuilder<T extends android.health.connect.datatypes.Record> {
        JSObject build(List<T> records);
    }
}
