document.addEventListener("DOMContentLoaded", () => {
  const { fromEvent, interval, merge, of } = rxjs;
  const { switchMap, startWith, map, catchError } = rxjs.operators;

  // Використовуємо офіційний dev-ендпоінт Launch Library 2 (без суворих обмежень rate-limit)
  const API_URL =
    "https://lldev.thespacedevs.com/2.2.0/launch/upcoming/?limit=20&hide_recent_previous=true";
  const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 хвилин (додаткове завдання)

  // DOM-елементи
  const agencySelect = document.querySelector("#agency-select");
  const refreshBtn = document.querySelector("#refresh-btn");
  const retryBtn = document.querySelector("#retry-btn");
  const launchesGrid = document.querySelector("#launches-grid");
  const loader = document.querySelector("#loader");
  const errorBanner = document.querySelector("#error-banner");
  const errorMessageText = document.querySelector("#error-message-text");
  const visibleCountEl = document.querySelector("#visible-count");
  const lastUpdatedText = document.querySelector("#last-updated-text");
  const syncIndicator = document.querySelector("#sync-indicator");

  // Елементи модального вікна
  const missionModal = document.querySelector("#mission-modal");
  const modalBody = document.querySelector("#modal-body");
  const closeModalBtn = document.querySelector("#close-modal-btn");

  // Локальний кеш завантажених запусків
  let allLaunches = [];

  /**
   * Асинхронний запит до Launch Library API з перевіркою статусу та обробкою помилок
   */
  async function fetchUpcomingLaunches() {
    setSyncState("loading", "Оновлення даних з API...");
    errorBanner.classList.add("hidden");
    if (allLaunches.length === 0) {
      loader.classList.remove("hidden");
    }

    try {
      const response = await fetch(API_URL);

      // Ручна перевірка HTTP-статусу (зокрема перевищення лімітів 429 або збій 500)
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            "Перевищено ліміт запитів до The Space Devs API (HTTP 429). Зачекайте хвилину.",
          );
        }
        throw new Error(
          `Сервер повернув помилку HTTP ${response.status} (${response.statusText})`,
        );
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.results)) {
        throw new Error("Отримано некоректну структуру JSON від сервера.");
      }

      allLaunches = data.results;
      populateAgencyFilter(allLaunches);
      renderFilteredLaunches();

      const nowStr = new Date().toLocaleTimeString("uk-UA");
      setSyncState("ok", `Синхронізовано о ${nowStr}`);
      return allLaunches;
    } catch (error) {
      console.error("Помилка завантаження запусків:", error);
      showError(
        error.message || "Не вдалося з’єднатися із сервером Launch Library.",
      );
      setSyncState("error", "Помилка з’єднання");
      return [];
    } finally {
      loader.classList.add("hidden");
    }
  }

  function setSyncState(state, text) {
    lastUpdatedText.textContent = text;
    syncIndicator.className = "pulse-dot";
    if (state === "loading") syncIndicator.classList.add("loading");
    if (state === "error") syncIndicator.classList.add("error");
  }

  function showError(message) {
    errorMessageText.textContent = message;
    errorBanner.classList.remove("hidden");
  }

  /**
   * Динамічне наповнення випадаючого списку агентств
   */
  function populateAgencyFilter(launches) {
    const currentSelection = agencySelect.value;
    const agenciesSet = new Set();

    launches.forEach((launch) => {
      const agencyName = launch.launch_service_provider?.name;
      if (agencyName) agenciesSet.add(agencyName);
    });

    const sortedAgencies = Array.from(agenciesSet).sort();
    agencySelect.innerHTML = '<option value="all">Усі агентства</option>';

    sortedAgencies.forEach((agency) => {
      const option = document.createElement("option");
      option.value = agency;
      option.textContent = agency;
      if (agency === currentSelection) option.selected = true;
      agencySelect.append(option);
    });
  }

  /**
   * Форматування залишку часу для зворотного відліку
   */
  function formatCountdown(targetIsoDate) {
    const targetTime = new Date(targetIsoDate).getTime();
    const diff = targetTime - Date.now();

    if (Number.isNaN(targetTime)) return "Дата уточнюється";
    if (diff <= 0) return "T+00:00:00 (Старт відбувся)";

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    const pad = (num) => String(num).padStart(2, "0");
    return `T-${days}д ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  /**
   * Рендеринг карток запусків відповідно до обраного агентства
   */
  function renderFilteredLaunches() {
    const selectedAgency = agencySelect.value;
    const filtered =
      selectedAgency === "all"
        ? allLaunches
        : allLaunches.filter(
            (l) => l.launch_service_provider?.name === selectedAgency,
          );

    visibleCountEl.textContent = filtered.length;
    launchesGrid.innerHTML = "";

    if (filtered.length === 0) {
      launchesGrid.innerHTML =
        '<p style="color: var(--text-muted);">Запусків для обраного агентства не знайдено.</p>';
      return;
    }

    filtered.forEach((launch) => {
      const card = document.createElement("article");
      card.className = "launch-card";
      card.dataset.id = launch.id;

      const missionName =
        launch.mission?.name || launch.name || "Невідома місія";
      const agencyName =
        launch.launch_service_provider?.name || "Невідоме агентство";
      const rocketName =
        launch.rocket?.configuration?.full_name ||
        launch.rocket?.configuration?.name ||
        "Невідома ракета";
      const padLocation = launch.pad?.location?.name || "Космодром уточнюється";
      const padName = launch.pad?.name || "";
      const statusAbbrev = launch.status?.abbrev || "TBD";
      const launchDateStr = new Date(launch.net).toLocaleString("uk-UA", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const statusClass =
        statusAbbrev === "Go"
          ? "status-go"
          : statusAbbrev === "TBD" || statusAbbrev === "TBC"
            ? "status-tbd"
            : "status-other";

      const fallbackImg =
        "https://images.unsplash.com/photo-1517976487492-5750f3195933?auto=format&fit=crop&w=800&q=60";
      const bannerUrl = launch.image || fallbackImg;

      card.innerHTML = `
        <div class="card-banner" style="background-image: url('${bannerUrl}')">
          <span class="status-badge ${statusClass}">${launch.status?.name || statusAbbrev}</span>
        </div>
        <div class="card-body">
          <span class="agency-tag">${agencyName}</span>
          <h2 class="mission-title">${missionName}</h2>
          <ul class="meta-list">
            <li><strong>Ракета:</strong> ${rocketName}</li>
            <li><strong>Космодром:</strong> ${padLocation} (${padName})</li>
            <li><strong>Дата старту:</strong> ${launchDateStr}</li>
          </ul>
          <div class="countdown-box">
            <span class="countdown-label">Зворотний відлік до старту</span>
            <div class="countdown-timer" data-net="${launch.net}">
              ${formatCountdown(launch.net)}
            </div>
          </div>
          <span class="card-hint">Натисніть для деталей місії →</span>
        </div>
      `;

      launchesGrid.append(card);
    });
  }

  /**
   * Відкриття модального вікна з деталями місії (Додаткове завдання)
   */
  function openMissionDetails(launchId) {
    const launch = allLaunches.find((item) => item.id === launchId);
    if (!launch) return;

    const missionTitle = launch.mission?.name || launch.name;
    const missionDesc =
      launch.mission?.description ||
      "Детальний опис корисного навантаження цієї місії наразі не опубліковано агентством.";
    const orbitName = launch.mission?.orbit?.name || "Не вказано";
    const missionType = launch.mission?.type || "Запуск";
    const agency = launch.launch_service_provider?.name || "Невідомо";
    const rocket = launch.rocket?.configuration?.full_name || "Невідомо";
    const pad = `${launch.pad?.name || ""}, ${launch.pad?.location?.name || ""}`;
    const statusDesc = launch.status?.description || launch.status?.name || "";
    const fallbackImg =
      "https://images.unsplash.com/photo-1517976487492-5750f3195933?auto=format&fit=crop&w=900&q=70";

    modalBody.innerHTML = `
      <img src="${launch.image || fallbackImg}" alt="${missionTitle}" class="modal-image">
      <span class="agency-tag">${agency} • ${missionType}</span>
      <h2 class="modal-title">${missionTitle}</h2>
      <p class="modal-description">${missionDesc}</p>
      <div class="modal-specs">
        <div class="spec-item">
          <span>Ракета-носій</span>
          <strong>${rocket}</strong>
        </div>
        <div class="spec-item">
          <span>Цільова орбіта</span>
          <strong>${orbitName}</strong>
        </div>
        <div class="spec-item">
          <span>Стартовий майданчик</span>
          <strong>${pad}</strong>
        </div>
        <div class="spec-item">
          <span>Поточний статус</span>
          <strong>${launch.status?.name || "TBD"}</strong>
        </div>
      </div>
      <p style="margin-top: 0.9rem; font-size: 0.85rem; color: var(--text-muted);">${statusDesc}</p>
    `;

    missionModal.classList.remove("hidden");
  }

  function closeModal() {
    missionModal.classList.add("hidden");
  }

  // =========================================================================
  // РЕАКТИВНІ ПОТОКИ ПОДІЙ (RxJS)
  // =========================================================================

  // 1. Потік завантаження та автооновлення кожні 5 хвилин (interval + switchMap)
  const manualRefresh$ = fromEvent(refreshBtn, "click");
  const retryClick$ = fromEvent(retryBtn, "click");
  const autoRefresh$ = interval(AUTO_REFRESH_MS);

  merge(manualRefresh$, retryClick$, autoRefresh$)
    .pipe(
      startWith(null), // Миттєвий перший запит при відкритті сторінки
      switchMap(() => fetchUpcomingLaunches()), // Скасовує попередній запит при новому тригері
    )
    .subscribe();

  // 2. Потік таймера зворотного відліку щосекунди (RxJS interval)
  interval(1000).subscribe(() => {
    const timerElements = document.querySelectorAll(".countdown-timer");
    timerElements.forEach((el) => {
      const net = el.dataset.net;
      if (net) {
        el.textContent = formatCountdown(net);
      }
    });
  });

  // 3. Потік зміни фільтра агентств (RxJS fromEvent)
  fromEvent(agencySelect, "change").subscribe(() => {
    renderFilteredLaunches();
  });

  // 4. Потік кліків по картках запусків для відкриття деталей місії (делегування через RxJS)
  fromEvent(launchesGrid, "click")
    .pipe(map((event) => event.target.closest(".launch-card")))
    .subscribe((card) => {
      if (card && card.dataset.id) {
        openMissionDetails(card.dataset.id);
      }
    });

  // 5. Закриття модального вікна (клік по хрестику, фону або клавіша Escape)
  fromEvent(closeModalBtn, "click").subscribe(closeModal);
  fromEvent(missionModal, "click").subscribe((event) => {
    if (event.target === missionModal) closeModal();
  });
  fromEvent(document, "keydown").subscribe((event) => {
    if (event.key === "Escape" && !missionModal.classList.contains("hidden")) {
      closeModal();
    }
  });
});
