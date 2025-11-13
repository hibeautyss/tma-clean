const STORAGE_PREFIX = "planner-state";
const SUPABASE_URL = "https://dkphckosxmwtrhajkzog.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KBnOAUzowc5hKJojPMN9Tg_Xzns04Zs";
const SUPABASE_REST_URL = `${SUPABASE_URL}/rest/v1`;

const buildKey = (telegramId) => `${STORAGE_PREFIX}:${telegramId ?? "guest"}`;

const prepareForStorage = (state) => ({
  selectedDates: Array.from(state.selectedDates?.entries?.() ?? []),
  specifyTimesEnabled: Boolean(state.specifyTimesEnabled),
  timezone: state.timezone ?? "UTC",
  timezoneSearch: state.timezoneSearch ?? "",
  today: state.today?.toISOString?.() ?? null,
  currentView: state.currentView?.toISOString?.() ?? null,
  screen: state.screen ?? "dashboard",
  pollHistory: Array.isArray(state.pollHistory) ? state.pollHistory : [],
  pollFilters: {
    status: state.pollFilters?.status ?? "live",
    createdOnly: Boolean(state.pollFilters?.createdOnly),
  },
});

const baseHeaders = Object.freeze({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
});

const clampMinutes = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.min(Math.max(Math.round(value), 0), 24 * 60);
};

const buildRestPath = (path, params = {}) => {
  const url = new URL(path, SUPABASE_REST_URL);
  Object.entries(params).forEach(([key, rawValue]) => {
    if (rawValue === undefined || rawValue === null || rawValue === false) {
      return;
    }
    if (Array.isArray(rawValue)) {
      rawValue.forEach((value) => url.searchParams.append(key, value));
      return;
    }
    url.searchParams.append(key, String(rawValue));
  });
  return `${url.pathname}${url.search}`;
};

const parseResponse = async (response) => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.message ?? `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.details = payload;
    throw error;
  }
  return payload;
};

const supabaseRequest = async (resource, { headers = {}, ...options } = {}) => {
  const url = resource.startsWith("http") ? resource : `${SUPABASE_REST_URL}${resource}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...baseHeaders,
      "Content-Type": "application/json",
      ...headers,
    },
  });
  return parseResponse(response);
};

const ensureShareableSlots = (slots = [], specifyTimesEnabled = false) => {
  if (!Array.isArray(slots) || !slots.length || !specifyTimesEnabled) {
    return [
      {
        start: null,
        end: null,
      },
    ];
  }
  return slots
    .map((slot) => ({
      start: clampMinutes(slot?.start),
      end: clampMinutes(slot?.end),
    }))
    .filter((slot) => slot.start !== null && slot.end !== null && slot.end > slot.start);
};

const mapSelectedDatesToOptions = (selectedDates, specifyTimesEnabled) => {
  const entries = selectedDates instanceof Map ? selectedDates.entries() : Object.entries(selectedDates ?? {});
  const options = [];
  for (const [iso, entry] of entries) {
    const normalizedSlots = ensureShareableSlots(entry?.slots, specifyTimesEnabled);
    normalizedSlots.forEach((slot) => {
      options.push({
        option_date: iso,
        start_minute: slot.start,
        end_minute: slot.end,
      });
    });
  }
  return options;
};

const buildCreatorMetadata = (telegramUser) => {
  if (!telegramUser) return null;
  const { id, username, first_name: firstName, last_name: lastName } = telegramUser;
  return {
    id,
    username,
    firstName,
    lastName,
  };
};

const safeTrim = (value) => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export const loadUserState = async (telegramId) => {
  try {
    const raw = localStorage.getItem(buildKey(telegramId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (error) {
    console.error("Failed to load user state", error);
    return null;
  }
};

export const saveUserState = async (telegramId, state) => {
  try {
    localStorage.setItem(buildKey(telegramId), JSON.stringify(prepareForStorage(state)));
    return true;
  } catch (error) {
    console.error("Failed to save user state", error);
    return false;
  }
};

export const createRemotePoll = async ({
  title,
  location,
  description,
  timezone,
  specifyTimesEnabled,
  selectedDates,
  telegramUser,
}) => {
  const normalizedTitle = safeTrim(title);
  if (!normalizedTitle) {
    throw new Error("Title is required.");
  }
  if (!selectedDates || (!selectedDates.size && !Object.keys(selectedDates ?? {}).length)) {
    throw new Error("Pick at least one date for your poll.");
  }

  const optionRows = mapSelectedDatesToOptions(selectedDates, specifyTimesEnabled);
  if (!optionRows.length) {
    throw new Error("Unable to derive options from your selection.");
  }

  const pollPayload = {
    title: normalizedTitle,
    location: safeTrim(location),
    description: safeTrim(description),
    timezone: timezone || "UTC",
    specify_times: Boolean(specifyTimesEnabled),
    creator: buildCreatorMetadata(telegramUser),
  };

  const inserted = await supabaseRequest("/polls", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(pollPayload),
  });
  const poll = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!poll?.id) {
    throw new Error("Supabase did not return the created poll.");
  }

  const optionsWithPoll = optionRows.map((row) => ({
    poll_id: poll.id,
    ...row,
  }));

  try {
    await supabaseRequest("/poll_options", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(optionsWithPoll),
    });
  } catch (error) {
    await supabaseRequest(buildRestPath("/polls", { id: `eq.${poll.id}` }), {
      method: "DELETE",
    }).catch(() => {});
    throw error;
  }

  return {
    ...poll,
    options: optionsWithPoll,
  };
};

export const updatePollDetails = async ({ pollId, title, location, description }) => {
  if (!pollId) {
    throw new Error("pollId is required.");
  }
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  if (!normalizedTitle) {
    throw new Error("Title is required.");
  }
  const payload = {
    title: normalizedTitle,
    location: safeTrim(location),
    description: safeTrim(description),
  };
  const rows = await supabaseRequest(buildRestPath("/polls", { id: `eq.${pollId}` }), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  const updated = Array.isArray(rows) ? rows[0] : rows;
  if (!updated) {
    throw new Error("Poll update failed.");
  }
  return updated;
};

export const updatePollOptions = async ({
  pollId,
  specifyTimesEnabled = false,
  options = [],
  removedOptionIds = [],
}) => {
  if (!pollId) {
    throw new Error("pollId is required.");
  }
  if (!Array.isArray(options) || !options.length) {
    throw new Error("Provide at least one option to save.");
  }

  const normalizedOptions = options.map((option) => {
    const optionDate = option.option_date ?? option.date;
    if (!optionDate) {
      throw new Error("Each option must include a date.");
    }
    const payload = {
      id: option.id ?? null,
      option_date: optionDate,
      start_minute: null,
      end_minute: null,
    };
    if (specifyTimesEnabled) {
      const start = clampMinutes(option.start_minute ?? option.startMinute);
      const end = clampMinutes(option.end_minute ?? option.endMinute);
      if (start === null || end === null || end <= start) {
        throw new Error("Each option must include a valid time range.");
      }
      payload.start_minute = start;
      payload.end_minute = end;
    }
    return payload;
  });

  const sanitizedRemovals = (removedOptionIds ?? [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value));

  if (sanitizedRemovals.length) {
    await supabaseRequest(
      buildRestPath("/poll_options", { id: `in.(${sanitizedRemovals.join(",")})` }),
      {
        method: "DELETE",
      }
    );
  }

  const updates = normalizedOptions.filter((option) => option.id);
  const creations = normalizedOptions.filter((option) => !option.id);

  await Promise.all(
    updates.map((option) =>
      supabaseRequest(buildRestPath("/poll_options", { id: `eq.${option.id}` }), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          option_date: option.option_date,
          start_minute: option.start_minute,
          end_minute: option.end_minute,
        }),
      })
    )
  );

  if (creations.length) {
    const payload = creations.map((option) => ({
      poll_id: pollId,
      option_date: option.option_date,
      start_minute: option.start_minute,
      end_minute: option.end_minute,
    }));
    await supabaseRequest("/poll_options", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
  }

  await supabaseRequest(buildRestPath("/polls", { id: `eq.${pollId}` }), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ specify_times: specifyTimesEnabled }),
  });
};

export const fetchPoll = async ({ pollId, shareCode }) => {
  const params = {
    select:
      "id,share_code,title,description,location,timezone,specify_times,created_at,poll_options(id,option_date,start_minute,end_minute,created_at)",
    limit: "1",
  };
  if (pollId) {
    params.id = `eq.${pollId}`;
  } else if (shareCode) {
    params.share_code = `eq.${shareCode}`;
  } else {
    throw new Error("Provide either pollId or shareCode.");
  }

  const rows = await supabaseRequest(buildRestPath("/polls", params), {
    method: "GET",
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
};

export const submitVote = async ({ pollId, voterName, voterContact, selections }) => {
  if (!pollId) throw new Error("pollId is required.");
  if (!voterName?.trim()) throw new Error("voterName is required.");
  if (!Array.isArray(selections) || !selections.length) {
    throw new Error("Provide at least one selection.");
  }

  const votePayload = {
    poll_id: pollId,
    voter_name: voterName.trim(),
    voter_contact: safeTrim(voterContact),
  };

  const insertedVotes = await supabaseRequest("/votes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(votePayload),
  });
  const vote = Array.isArray(insertedVotes) ? insertedVotes[0] : insertedVotes;
  if (!vote?.id) {
    throw new Error("Failed to record the vote.");
  }

  const selectionRows = selections
    .map((selection) => {
      if (!selection?.optionId) return null;
      const availability = (selection.availability || "yes").toLowerCase();
      if (!["yes", "no", "maybe"].includes(availability)) {
        return null;
      }
      return {
        vote_id: vote.id,
        poll_option_id: selection.optionId,
        availability,
      };
    })
    .filter(Boolean);

  if (!selectionRows.length) {
    throw new Error("Selections are invalid.");
  }

  try {
    await supabaseRequest("/vote_selections", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(selectionRows),
    });
  } catch (error) {
    await supabaseRequest(buildRestPath("/votes", { id: `eq.${vote.id}` }), {
      method: "DELETE",
    }).catch(() => {});
    throw error;
  }

  return {
    ...vote,
    selections: selectionRows,
  };
};

export const fetchPollDetail = async ({ pollId, shareCode }) => {
  const params = {
    select:
      "id,title,description,location,timezone,specify_times,share_code,creator,created_at,poll_options(id,option_date,start_minute,end_minute,created_at),votes(id,voter_name,voter_contact,created_at,vote_selections(poll_option_id,availability))",
    limit: "1",
  };
  if (pollId) {
    params.id = `eq.${pollId}`;
  } else if (shareCode) {
    params.share_code = `eq.${shareCode}`;
  } else {
    throw new Error("Provide either pollId or shareCode.");
  }
  const rows = await supabaseRequest(buildRestPath("/polls", params), {
    method: "GET",
  });
  if (!Array.isArray(rows) || !rows.length) {
    return null;
  }
  const poll = rows[0];
  poll.poll_options = Array.isArray(poll.poll_options) ? poll.poll_options : [];
  poll.votes = Array.isArray(poll.votes) ? poll.votes : [];
  poll.votes = poll.votes.map((vote) => ({
    ...vote,
    vote_selections: Array.isArray(vote.vote_selections) ? vote.vote_selections : [],
  }));
  return poll;
};
