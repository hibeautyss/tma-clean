const refs = {};

const formatDisplayDate = (date, options) =>
  new Intl.DateTimeFormat("en-US", options).format(date);

const formatTime = (minutes) => {
  const safe = Math.max(0, Math.min(minutes, 24 * 60));
  if (safe === 24 * 60) {
    return "24:00";
  }
  const hrs = String(Math.floor(safe / 60)).padStart(2, "0");
  const mins = String(safe % 60).padStart(2, "0");
  return `${hrs}:${mins}`;
};

const formatDuration = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
};

const formatTimestamp = (value) => {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const setScreenVisibility = (screen) => {
  if (refs.dashboardView) {
    refs.dashboardView.hidden = screen !== "dashboard";
  }
  if (refs.createView) {
    refs.createView.hidden = screen !== "create";
  }
};

export const initUI = () => {
  refs.dashboardView = document.getElementById("dashboardView");
  refs.createView = document.getElementById("createView");
  refs.newPollButton = document.getElementById("newPollButton");
  refs.backToDashboard = document.getElementById("backToDashboard");
  refs.joinCodeInput = document.getElementById("joinCodeInput");
  refs.joinPollButton = document.getElementById("joinPollButton");
  refs.joinFeedback = document.getElementById("joinFeedback");
  refs.titleInput = document.getElementById("title");
  refs.locationInput = document.getElementById("location");
  refs.descriptionInput = document.getElementById("description");
  refs.calendarGrid = document.getElementById("calendarGrid");
  refs.monthLabel = document.getElementById("monthLabel");
  refs.navButtons = document.querySelectorAll("[data-direction]");
  refs.timeToggle = document.getElementById("timeToggle");
  refs.selectionBody = document.getElementById("selectionBody");
  refs.selectionEmpty = document.getElementById("selectionEmpty");
  refs.selectionCount = document.getElementById("selectionCount");
  refs.timezoneButton = document.getElementById("timezoneButton");
  refs.timezoneLabel = document.getElementById("timezoneLabel");
  refs.timezonePopover = document.getElementById("timezonePopover");
  refs.timezoneSearch = document.getElementById("timezoneSearch");
  refs.timezoneList = document.getElementById("timezoneList");
  refs.timezoneEmpty = document.getElementById("timezoneEmpty");
  refs.timezoneClose = document.getElementById("timezoneClose");
  refs.createPollButton = document.getElementById("createPollButton");
  refs.pollTabs = document.querySelectorAll("[data-poll-status]");
  refs.createdOnlyToggle = document.getElementById("createdOnlyToggle");
  refs.pollsList = document.getElementById("pollsList");
  refs.pollsEmpty = document.getElementById("pollsEmpty");
  refs.formFeedback = document.getElementById("formFeedback");
  return refs;
};

export const setPollTabActive = (status) => {
  if (!refs.pollTabs) return;
  refs.pollTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.pollStatus === status);
  });
};

export const setCreatedOnlyFilter = (checked) => {
  if (refs.createdOnlyToggle) {
    refs.createdOnlyToggle.checked = checked;
  }
};

export const renderCalendar = (view, handlers = {}) => {
  if (!refs.calendarGrid || !refs.monthLabel) return;
  refs.monthLabel.textContent = view.monthLabel;
  refs.calendarGrid.innerHTML = "";
  view.cells.forEach((cell) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-cell";
    button.textContent = cell.label;

    if (!cell.isCurrentMonth) {
      button.classList.add("outside");
      button.disabled = true;
    } else {
      button.addEventListener("click", () => handlers.onDateToggle?.(cell.iso));
    }

    if (cell.isSelected) {
      button.classList.add("selected");
    }
    if (cell.isToday) {
      button.classList.add("today");
    }
    refs.calendarGrid.appendChild(button);
  });
};

export const renderSelection = (state, handlers = {}, options = {}) => {
  const { selectedDates, specifyTimesEnabled } = state;
  const { minutesInDay = 24 * 60, timeStep = 15 } = options;

  if (!refs.selectionBody || !refs.selectionEmpty || !refs.selectionCount) {
    return;
  }

  const total = selectedDates.size;
  refs.selectionCount.textContent = total ? `${total} date${total > 1 ? "s" : ""}` : "0 dates";
  refs.selectionBody.innerHTML = "";

  if (!total) {
    refs.selectionEmpty.hidden = false;
    refs.selectionBody.appendChild(refs.selectionEmpty);
    return;
  }

  refs.selectionEmpty.hidden = true;

  const sortedEntries = Array.from(selectedDates.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  const timePoints = [];
  for (let point = 0; point <= minutesInDay; point += timeStep) {
    timePoints.push(point);
  }

  sortedEntries.forEach(([iso, entry]) => {
    const container = document.createElement("div");
    container.className = "date-option";
    container.dataset.date = iso;

    const date = new Date(iso);
    const chip = document.createElement("div");
    chip.className = "date-chip";
    chip.innerHTML = `<span class="month">${formatDisplayDate(date, {
      month: "short",
    })}</span><span class="day">${date.getDate()}</span>`;

    const timeConfig = document.createElement("div");
    timeConfig.className = "time-config";

    if (!specifyTimesEnabled) {
      const hint = document.createElement("p");
      hint.className = "time-disabled-hint";
      hint.textContent = "Times not specified for this date.";
      timeConfig.appendChild(hint);
    } else {
      entry.slots.forEach((slot, index) => {
        const row = document.createElement("div");
        row.className = "time-row";

        const startSelect = document.createElement("select");
        startSelect.className = "time-select";
        timePoints.slice(0, -1).forEach((point) => {
          const option = document.createElement("option");
          option.value = point;
          option.textContent = formatTime(point);
          startSelect.appendChild(option);
        });
        startSelect.value = Math.min(slot.start, minutesInDay - timeStep);
        startSelect.addEventListener("change", () =>
          handlers.onSlotChange?.(iso, index, "start", Number(startSelect.value))
        );

        const endSelect = document.createElement("select");
        endSelect.className = "time-select";
        timePoints.forEach((point) => {
          const option = document.createElement("option");
          option.value = point;
          option.textContent = formatTime(point);
          endSelect.appendChild(option);
        });
        endSelect.value = Math.min(slot.end, minutesInDay);
        endSelect.addEventListener("change", () =>
          handlers.onSlotChange?.(iso, index, "end", Number(endSelect.value))
        );

        const durationBadge = document.createElement("span");
        durationBadge.className = "duration-badge";
        durationBadge.textContent = formatDuration(slot.end - slot.start);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "icon-btn";
        removeBtn.setAttribute("aria-label", "Remove time slot");
        removeBtn.textContent = "\u00D7";
        removeBtn.addEventListener("click", () => handlers.onRemoveSlot?.(iso, index));

        row.appendChild(startSelect);
        row.appendChild(endSelect);
        row.appendChild(durationBadge);
        row.appendChild(removeBtn);
        timeConfig.appendChild(row);
      });

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "add-slot-btn";
      addBtn.textContent = "+ Add time slot";
      addBtn.disabled = handlers.canAddSlot ? !handlers.canAddSlot(iso) : false;
      addBtn.addEventListener("click", () => handlers.onAddSlot?.(iso));
      timeConfig.appendChild(addBtn);
    }

    container.appendChild(chip);
    container.appendChild(timeConfig);
    refs.selectionBody.appendChild(container);
  });
};

export const setTimezoneLabel = (label) => {
  if (refs.timezoneLabel) {
    refs.timezoneLabel.textContent = label;
  }
};

export const setTimezonePopoverVisible = (visible) => {
  if (refs.timezonePopover) {
    refs.timezonePopover.hidden = !visible;
  }
};

export const isTimezonePopoverVisible = () => Boolean(refs.timezonePopover && !refs.timezonePopover.hidden);

export const renderTimezoneList = (entries, onSelect) => {
  if (!refs.timezoneList || !refs.timezoneEmpty) return;
  refs.timezoneList.innerHTML = "";
  if (!entries.length) {
    refs.timezoneEmpty.hidden = false;
    return;
  }
  refs.timezoneEmpty.hidden = true;
  entries.forEach((entry) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timezone-item";
    button.innerHTML = `<strong>${entry.offset} • ${entry.zone}</strong><span>${entry.cities.join(
      " · "
    )}</span>`;
    button.addEventListener("click", () => onSelect?.(entry.zone));
    li.appendChild(button);
    refs.timezoneList.appendChild(li);
  });
};

export const setTimezoneSearchValue = (value) => {
  if (refs.timezoneSearch) {
    refs.timezoneSearch.value = value;
  }
};

export const setCreatePollEnabled = (enabled) => {
  if (!refs.createPollButton) return;
  refs.createPollButton.disabled = !enabled;
  refs.createPollButton.classList.toggle("active", enabled);
};

export const setFormFeedback = (message = "", tone = "info") => {
  if (!refs.formFeedback) return;
  const content = message ?? "";
  refs.formFeedback.textContent = content;
  refs.formFeedback.hidden = !content;
  refs.formFeedback.classList.toggle("is-error", tone === "error");
  refs.formFeedback.classList.toggle("is-success", tone === "success");
};

export const setJoinFeedback = (message = "", tone = "info") => {
  if (!refs.joinFeedback) return;
  const content = message ?? "";
  refs.joinFeedback.textContent = content;
  refs.joinFeedback.hidden = !content;
  refs.joinFeedback.classList.toggle("is-error", tone === "error");
  refs.joinFeedback.classList.toggle("is-success", tone === "success");
};

const buildPollCard = (poll) => {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "poll-card";
  const relationLabel = poll.relation === "created" ? "Created by you" : "Participating";
  card.innerHTML = `
    <div class="poll-card-header">
      <h4>${poll.title ?? "Untitled poll"}</h4>
      <span class="status-pill">${poll.status ?? "live"}</span>
    </div>
    <div class="relation-tag">${relationLabel}</div>
    <div class="poll-card-footer">
      <span>Code: ${poll.share_code ?? "N/A"}</span>
      <span>${formatTimestamp(poll.timestamp)}</span>
    </div>
  `;
  return card;
};

export const renderPollHistory = (items = []) => {
  if (!refs.pollsList || !refs.pollsEmpty) return;
  refs.pollsList.innerHTML = "";
  if (!items.length) {
    refs.pollsEmpty.hidden = false;
    return;
  }
  refs.pollsEmpty.hidden = true;
  items.forEach((poll) => {
    refs.pollsList.appendChild(buildPollCard(poll));
  });
};
