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

export const setScreenVisibility = (screen) => {
  if (refs.dashboardView) {
    refs.dashboardView.hidden = screen !== "dashboard";
  }
  if (refs.createView) {
    refs.createView.hidden = screen !== "create";
  }
  if (refs.pollView) {
    refs.pollView.hidden = screen !== "poll";
  }
};

export const initUI = () => {
  refs.dashboardView = document.getElementById("dashboardView");
  refs.createView = document.getElementById("createView");
  refs.pollView = document.getElementById("pollView");
  refs.newPollButton = document.getElementById("newPollButton");
  refs.backToDashboard = document.getElementById("backToDashboard");
  refs.backToDashboardFromPoll = document.getElementById("backToDashboardFromPoll");
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
  refs.pollTimezoneButton = document.getElementById("pollTimezoneButton");
  refs.pollTimezoneLabel = document.getElementById("pollTimezoneLabel");
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
  refs.pollTitle = document.getElementById("pollTitle");
  refs.pollMeta = document.getElementById("pollMeta");
  refs.pollDescription = document.getElementById("pollDescription");
  refs.pollStatusBadge = document.getElementById("pollStatusBadge");
  refs.pollManageButton = document.getElementById("pollManageButton");
  refs.pollOptionCount = document.getElementById("pollOptionCount");
  refs.participantCount = document.getElementById("participantCount");
  refs.pollGrid = document.getElementById("pollGrid");
  refs.voteComment = document.getElementById("voteComment");
  refs.voteFeedback = document.getElementById("voteFeedback");
  refs.resetVoteButton = document.getElementById("resetVoteButton");
  refs.continueVoteButton = document.getElementById("continueVoteButton");
  refs.commentList = document.getElementById("commentList");
  refs.commentsEmpty = document.getElementById("commentsEmpty");
  refs.modalScrim = document.getElementById("modalScrim");
  refs.nameModal = document.getElementById("nameModal");
  refs.voteNameInput = document.getElementById("voteNameInput");
  refs.modalBackButton = document.getElementById("modalBackButton");
  refs.closeNameModal = document.getElementById("closeNameModal");
  refs.submitVoteButton = document.getElementById("submitVoteButton");
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
  if (refs.pollTimezoneLabel) {
    refs.pollTimezoneLabel.textContent = label;
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
  if (!enabled) {
    refs.createPollButton.classList.remove("is-pressing");
  }
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

const buildPollCard = (poll, handlers = {}) => {
  const card = document.createElement("article");
  card.className = "poll-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.dataset.pollId = poll.id ?? "";
  card.dataset.shareCode = poll.share_code ?? "";
  const statusPill = `<span class="status-pill">${poll.status ?? "live"}</span>`;
  const manageButton =
    poll.relation === "created"
      ? '<button type="button" class="manage-btn" aria-label="Manage poll">Manage</button>'
      : "";
  card.innerHTML = `
    <div class="poll-card-header">
      <h4>${poll.title ?? "Untitled poll"}</h4>
      <div class="poll-card-actions">
        ${statusPill}
        ${manageButton}
      </div>
    </div>
    <div class="poll-card-footer">
      <span>Code: ${poll.share_code ?? "N/A"}</span>
    </div>
  `;
  const handleSelect = () => handlers.onSelect?.(poll);
  if (handleSelect) {
    card.addEventListener("click", handleSelect);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSelect();
      }
    });
  }
  if (poll.relation === "created") {
    const manageBtn = card.querySelector(".manage-btn");
    if (manageBtn && handlers.onManage) {
      manageBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        handlers.onManage(poll);
      });
    }
  }
  return card;
};

export const renderPollHistory = (items = [], handlers = {}) => {
  if (!refs.pollsList || !refs.pollsEmpty) return;
  refs.pollsList.innerHTML = "";
  if (!items.length) {
    refs.pollsEmpty.hidden = false;
    return;
  }
  refs.pollsEmpty.hidden = true;
  items.forEach((poll) => {
    refs.pollsList.appendChild(buildPollCard(poll, handlers));
  });
};

export const setVoteCommentValue = (value = "") => {
  if (refs.voteComment) {
    refs.voteComment.value = value ?? "";
  }
};

export const setVoteFeedbackMessage = (message = "", tone = "info") => {
  if (!refs.voteFeedback) return;
  refs.voteFeedback.textContent = message ?? "";
  refs.voteFeedback.classList.toggle("is-error", tone === "error");
  refs.voteFeedback.classList.toggle("is-success", tone === "success");
};

export const setContinueButtonEnabled = (enabled) => {
  if (!refs.continueVoteButton) return;
  refs.continueVoteButton.disabled = !enabled;
  refs.continueVoteButton.classList.toggle("active", enabled);
};

export const renderPollSummary = (poll = {}, participantCount = 0) => {
  if (refs.pollTitle) refs.pollTitle.textContent = poll.title ?? "Untitled poll";
  if (refs.pollDescription) {
    refs.pollDescription.textContent = poll.description ?? "";
    refs.pollDescription.hidden = !poll.description;
  }
  if (refs.pollMeta) {
    const creator = poll.creator?.username || poll.creator?.firstName || poll.creator?.id || "Anonymous";
    refs.pollMeta.textContent = `by ${creator}`;
  }
  if (refs.pollStatusBadge) {
    refs.pollStatusBadge.textContent = poll.status ?? "Live";
  }
  if (refs.pollManageButton) {
    const canManage = Boolean(poll.canManage);
    refs.pollManageButton.hidden = !canManage;
    refs.pollManageButton.disabled = !canManage;
  }
  if (refs.pollOptionCount) {
    refs.pollOptionCount.textContent = `${poll.poll_options?.length ?? 0} options`;
  }
  if (refs.participantCount) {
    refs.participantCount.textContent = `${participantCount} participant${participantCount === 1 ? "" : "s"}`;
  }
};

const statusSymbols = {
  yes: "✓",
  maybe: "≈",
  no: "✕",
};

const buildAvailabilityChip = (state, interactive = false, optionId, handler) => {
  const el = document.createElement(interactive ? "button" : "span");
  if (interactive) {
    el.type = "button";
    if (optionId) {
      el.dataset.optionId = optionId;
    }
    if (handler) {
      el.addEventListener("click", () => handler(optionId));
    }
  }
  el.className = "availability-chip";
  if (state) {
    el.classList.add(`chip-${state}`);
    el.textContent = statusSymbols[state] ?? "•";
  } else {
    el.textContent = "•";
  }
  return el;
};

const buildParticipantCell = (participant) => {
  const wrapper = document.createElement("div");
  wrapper.className = "participant-chip";
  const name = document.createElement("strong");
  name.textContent = participant.name ?? "Guest";
  wrapper.appendChild(name);
  return wrapper;
};

export const renderPollGrid = ({
  options = [],
  participants = [],
  draft = {},
  onToggle,
  isReadOnly = false,
} = {}) => {
  if (!refs.pollGrid) return;
  const table = document.createElement("table");
  table.className = "grid-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const nameTh = document.createElement("th");
  nameTh.textContent = "Participants";
  headerRow.appendChild(nameTh);
  options.forEach((option) => {
    const th = document.createElement("th");
    th.innerHTML = `
      <div class="option-header">
        <span class="option-date">${formatDisplayDate(new Date(option.option_date), {
          month: "short",
          day: "numeric",
        })}</span>
        <span class="option-time">${formatTime(option.start_minute ?? 0)}</span>
      </div>
    `;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  if (!isReadOnly) {
    const youRow = document.createElement("tr");
    youRow.className = "you-row";
    const youCell = document.createElement("td");
    youCell.innerHTML =
      '<div class="participant-chip"><strong>You</strong><small>Draft</small></div>';
    youRow.appendChild(youCell);
    options.forEach((option) => {
      const td = document.createElement("td");
      const chip = buildAvailabilityChip(draft[option.id] ?? null, true, option.id, onToggle);
      td.appendChild(chip);
      youRow.appendChild(td);
    });
    tbody.appendChild(youRow);
  }

  participants.forEach((participant) => {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.appendChild(buildParticipantCell(participant));
    row.appendChild(cell);
    options.forEach((option) => {
      const td = document.createElement("td");
      const chip = buildAvailabilityChip(participant.selections?.[option.id] ?? null);
      td.appendChild(chip);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  refs.pollGrid.innerHTML = "";
  refs.pollGrid.appendChild(table);
};

export const renderCommentList = (comments = []) => {
  if (!refs.commentList || !refs.commentsEmpty) return;
  refs.commentList.innerHTML = "";
  refs.commentsEmpty.hidden = Boolean(comments.length);
  if (!comments.length) return;
  comments.forEach((comment) => {
    const li = document.createElement("li");
    li.className = "comment-item";
    li.innerHTML = `<strong>${comment.name ?? "Guest"}</strong><p>${comment.body ?? ""}</p>`;
    refs.commentList.appendChild(li);
  });
};

export const setVoteNameValue = (value = "") => {
  if (refs.voteNameInput) {
    refs.voteNameInput.value = value ?? "";
  }
};

export const toggleNameModal = (open) => {
  if (refs.modalScrim) {
    refs.modalScrim.hidden = !open;
  }
  if (refs.nameModal) {
    refs.nameModal.hidden = !open;
  }
};
