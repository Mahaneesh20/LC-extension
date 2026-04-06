importScripts("/src/shared/constants.js");

var C = globalThis.LEET_TRACKER || {};
var isProcessingQueue = false;

function defaults() {
  return {
    enabled: true,
    username: "",
    sheetName: "",
    endpointUrl: "",
    fields: C.DEFAULT_FIELDS || ["title", "url", "difficulty", "runtime", "memory", "timestamp"]
  };
}

function normalizeUserLabel(value) {
  var text = String(value || "").trim();
  return text || "default-user";
}

function sanitizeSheetName(value) {
  var text = normalizeUserLabel(value).replace(/[\\/\[\]:*?]/g, "-").replace(/\s+/g, " ");
  if (text.length > 90) {
    text = text.slice(0, 90).trim();
  }
  return text || "default-user";
}

function buildUploadContext(payload, settings) {
  var username = normalizeUserLabel((settings && settings.username) || (payload && payload.username));
  var sheetName = sanitizeSheetName((settings && settings.sheetName) || (payload && payload.sheetName) || username);
  var fields = ["username"].concat((settings && settings.fields) || defaults().fields || []);
  var seen = {};
  var uniqueFields = [];

  for (var i = 0; i < fields.length; i += 1) {
    var field = fields[i];
    if (!field || seen[field]) {
      continue;
    }
    seen[field] = true;
    uniqueFields.push(field);
  }

  return {
    payload: Object.assign({}, payload, {
      username: username,
      sheetName: sheetName
    }),
    fields: uniqueFields,
    username: username,
    sheetName: sheetName
  };
}

async function readSyncSettings() {
  var key = C.SETTINGS_KEY || "leetTrackerSettings";
  var syncRaw = await chrome.storage.sync.get([key]);
  var localRaw = await chrome.storage.local.get([key]);

  var syncSettings = syncRaw[key] || {};
  var localSettings = localRaw[key] || {};

  return Object.assign(defaults(), localSettings, syncSettings);
}

async function writeSettings(settings) {
  var key = C.SETTINGS_KEY || "leetTrackerSettings";
  var payload = {};
  payload[key] = settings;
  await chrome.storage.sync.set(payload);
  await chrome.storage.local.set(payload);
}

async function writeStatus(status) {
  var payload = {};
  payload[C.STATUS_KEY || "leetTrackerLastStatus"] = status;
  await chrome.storage.local.set(payload);
}

async function readLocalQueue() {
  var key = C.QUEUE_KEY || "leetTrackerQueue";
  var raw = await chrome.storage.local.get([key]);
  return Array.isArray(raw[key]) ? raw[key] : [];
}

async function writeLocalQueue(queue) {
  var payload = {};
  payload[C.QUEUE_KEY || "leetTrackerQueue"] = queue;
  await chrome.storage.local.set(payload);
}

async function readRecentKeys() {
  var key = C.RECENT_KEYS_KEY || "leetTrackerRecentKeys";
  var raw = await chrome.storage.local.get([key]);
  return raw[key] || {};
}

async function writeRecentKeys(map) {
  var payload = {};
  payload[C.RECENT_KEYS_KEY || "leetTrackerRecentKeys"] = map;
  await chrome.storage.local.set(payload);
}

async function addToQueue(item) {
  var queue = await readLocalQueue();
  queue.push({
    payload: item,
    retryCount: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now()
  });
  await writeLocalQueue(queue);
}

function computeBackoffMs(retryCount) {
  var base = 5000;
  var max = 10 * 60 * 1000;
  return Math.min(max, base * Math.pow(2, retryCount));
}

function buildRow(payload, fields) {
  var row = {};
  for (var i = 0; i < fields.length; i += 1) {
    var field = fields[i];
    row[field] = payload[field] || "";
  }
  return row;
}

async function scheduleNextAlarmFromQueue(queue) {
  var soonest = Number.MAX_SAFE_INTEGER;
  for (var i = 0; i < queue.length; i += 1) {
    soonest = Math.min(soonest, queue[i].nextAttemptAt || 0);
  }

  if (!isFinite(soonest) || soonest === Number.MAX_SAFE_INTEGER) {
    return;
  }

  var when = Math.max(Date.now() + 1000, soonest);
  await chrome.alarms.create("leet-tracker-process-queue", { when: when });
}

async function pruneRecentKeys(map) {
  var now = Date.now();
  var windowMs = C.DEDUPE_WINDOW_MS || 120000;
  var out = {};

  Object.keys(map || {}).forEach(function (key) {
    if (now - map[key] <= windowMs) {
      out[key] = map[key];
    }
  });

  return out;
}

async function postToEndpoint(endpointUrl, payload, fields) {
  var body = {
    source: "leetcode-extension",
    event: "accepted",
    row: buildRow(payload, fields),
    username: payload.username || "default-user",
    sheetName: payload.sheetName || sanitizeSheetName(payload.username),
    fields: fields,
    receivedAt: new Date().toISOString()
  };

  var response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error("Upload failed with status " + response.status);
  }

  var responseText = await response.text();
  if (responseText) {
    try {
      var parsed = JSON.parse(responseText);
      if (parsed && parsed.ok === false) {
        throw new Error(parsed.error || "Apps Script returned ok=false");
      }
    } catch (err) {
      if (String(err && err.message || err).indexOf("Unexpected token") === -1) {
        throw err;
      }
    }
  }

  return response;
}

async function processQueue() {
  if (isProcessingQueue) {
    return;
  }

  isProcessingQueue = true;
  try {
    var settings = await readSyncSettings();
    var queue = await readLocalQueue();

    if (!settings.enabled || !settings.endpointUrl) {
      await writeStatus({
        ok: false,
        message: "Set endpoint URL in popup to start uploading.",
        at: new Date().toISOString()
      });
      isProcessingQueue = false;
      return;
    }

    var now = Date.now();
    var pending = [];
    var recentKeys = await readRecentKeys();
    recentKeys = await pruneRecentKeys(recentKeys);

    for (var i = 0; i < queue.length; i += 1) {
      var item = queue[i];
      if ((item.nextAttemptAt || 0) > now) {
        pending.push(item);
        continue;
      }

      var dedupeKey = item.payload && item.payload.dedupeKey;
      if (dedupeKey && recentKeys[dedupeKey]) {
        continue;
      }

      try {
        var uploadContext = buildUploadContext(item.payload, settings);
        item.payload = uploadContext.payload;

        await postToEndpoint(settings.endpointUrl, item.payload, uploadContext.fields);

        if (dedupeKey) {
          recentKeys[dedupeKey] = Date.now();
        }

        await writeStatus({
          ok: true,
          message: "Uploaded: " + (item.payload.title || item.payload.slug || "submission"),
          at: new Date().toISOString()
        });
      } catch (error) {
        item.retryCount = (item.retryCount || 0) + 1;
        if (item.retryCount > (C.MAX_RETRIES || 5)) {
          await writeStatus({
            ok: false,
            message: "Dropped after retries: " + (error && error.message ? error.message : "Unknown error"),
            at: new Date().toISOString()
          });
          continue;
        }

        item.nextAttemptAt = Date.now() + computeBackoffMs(item.retryCount);
        pending.push(item);

        await writeStatus({
          ok: false,
          message: "Retry " + item.retryCount + ": " + (error && error.message ? error.message : "Upload failed"),
          at: new Date().toISOString()
        });
      }
    }

    await writeLocalQueue(pending);
    await writeRecentKeys(recentKeys);
    await scheduleNextAlarmFromQueue(pending);
  } finally {
    isProcessingQueue = false;
  }
}

chrome.runtime.onInstalled.addListener(async function () {
  var existing = await readSyncSettings();
  await writeSettings(Object.assign(defaults(), existing));

  await writeStatus({
    ok: true,
    message: "Extension ready. Set your endpoint URL in popup.",
    at: new Date().toISOString()
  });
});

chrome.runtime.onStartup.addListener(function () {
  processQueue();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm && alarm.name === "leet-tracker-process-queue") {
    processQueue();
  }
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message && message.type === "leet-tracker-settings-updated") {
    processQueue()
      .then(function () {
        sendResponse({ ok: true });
      })
      .catch(function (error) {
        sendResponse({ ok: false, error: error && error.message ? error.message : "settings update failed" });
      });
    return true;
  }

  if (!message || message.type !== (C.MESSAGE_ACCEPTED || "leetcode-accepted-event")) {
    return;
  }

  readSyncSettings()
    .then(function (settings) {
      var uploadContext = buildUploadContext(message.payload, settings);
      return addToQueue(uploadContext.payload);
    })
    .then(function () {
      return processQueue();
    })
    .then(function () {
      sendResponse({ ok: true });
    })
    .catch(function (error) {
      writeStatus({
        ok: false,
        message: error && error.message ? error.message : "Failed to enqueue submission.",
        at: new Date().toISOString()
      });
      sendResponse({ ok: false });
    });

  return true;
});
