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

export const initUI = () => {
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
  return refs;
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
