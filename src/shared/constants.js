(function initConstants(globalObj) {
  var constants = {
    MESSAGE_ACCEPTED: "leetcode-accepted-event",
    SETTINGS_KEY: "leetTrackerSettings",
    QUEUE_KEY: "leetTrackerQueue",
    STATUS_KEY: "leetTrackerLastStatus",
    RECENT_KEYS_KEY: "leetTrackerRecentKeys",
    DEFAULT_FIELDS: [
      "title",
      "url",
      "difficulty",
      "runtime",
      "memory",
      "timestamp"
    ],
    FIELD_LABELS: {
      title: "Problem title",
      url: "Problem URL/slug",
      difficulty: "Difficulty",
      runtime: "Runtime",
      memory: "Memory",
      timestamp: "Timestamp"
    },
    MAX_RETRIES: 5,
    DEDUPE_WINDOW_MS: 2 * 60 * 1000
  };

  globalObj.LEET_TRACKER = constants;
})(globalThis);
