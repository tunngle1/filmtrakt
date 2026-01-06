(function () {
    'use strict';

    // ========================================
    // 365 CHALLENGE - Плагин для челленджа 365 фильмов
    // Синхронизация через Firebase
    // ========================================

    var CONFIG = {
        FIREBASE_CONFIG: {
            apiKey: "AIzaSyAlnWPswarDG1-mpKb2iZpulHHOp9oxPgI",
            authDomain: "filmchallenge-bb8e7.firebaseapp.com",
            databaseURL: "https://filmchallenge-bb8e7-default-rtdb.europe-west1.firebasedatabase.app",
            projectId: "filmchallenge-bb8e7",
            storageBucket: "filmchallenge-bb8e7.firebasestorage.app"
        },
        GOAL: 365,
        STORAGE_KEY: 'challenge365_data',
        VERSION: '2.0.0'
    };

    // Хранилище данных плагина
    var PluginData = {
        pin: '',
        synced: false,
        watched_count: 0,
        year: new Date().getFullYear(),
        movies: {} // локальный кэш фильмов
    };

    // Firebase ссылки
    var firebaseApp = null;
    var database = null;
    var userRef = null;

    // ========================================
    // УТИЛИТЫ
    // ========================================

    function log(message, data) {
        console.log('[Challenge365] ' + message, data || '');
    }

    function saveData() {
        Lampa.Storage.set(CONFIG.STORAGE_KEY, PluginData);
    }

    function loadData() {
        var saved = Lampa.Storage.get(CONFIG.STORAGE_KEY);
        if (saved) {
            PluginData = Object.assign(PluginData, saved);
        }
    }

    function isSynced() {
        return PluginData.pin && PluginData.synced && database;
    }

    function formatDate(date) {
        var day = String(date.getDate()).padStart(2, '0');
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var year = date.getFullYear();
        return day + '.' + month + '.' + year;
    }

    function generatePin() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    // ========================================
    // FIREBASE ИНИЦИАЛИЗАЦИЯ
    // ========================================

    function loadFirebaseSDK(callback) {
        if (window.firebase) {
            callback();
            return;
        }

        log('Loading Firebase SDK...');

        // Загружаем Firebase App
        var script1 = document.createElement('script');
        script1.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
        script1.onload = function () {
            // Загружаем Firebase Database
            var script2 = document.createElement('script');
            script2.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js';
            script2.onload = function () {
                log('Firebase SDK loaded');
                callback();
            };
            document.head.appendChild(script2);
        };
        document.head.appendChild(script1);
    }

    function initFirebase(callback) {
        loadFirebaseSDK(function () {
            try {
                // Проверяем, не инициализирован ли уже Firebase
                if (!firebase.apps.length) {
                    firebaseApp = firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
                } else {
                    firebaseApp = firebase.apps[0];
                }
                database = firebase.database();
                log('Firebase initialized');
                if (callback) callback(true);
            } catch (error) {
                log('Firebase init error:', error);
                if (callback) callback(false);
            }
        });
    }

    // ========================================
    // PIN АВТОРИЗАЦИЯ
    // ========================================

    function showPinModal() {
        var html = $('<div class="challenge365-pin-modal"></div>');

        html.append('<div class="challenge365-pin-title">🎬 365 Challenge</div>');
        html.append('<div class="challenge365-pin-subtitle">Синхронизация между устройствами</div>');

        var buttonsHtml = $('<div class="challenge365-pin-buttons"></div>');

        var createBtn = $('<div class="challenge365-pin-btn selector" data-action="create">📱 Создать новый PIN</div>');
        var connectBtn = $('<div class="challenge365-pin-btn selector" data-action="connect">🔗 Ввести существующий PIN</div>');
        var cancelBtn = $('<div class="challenge365-pin-btn cancel selector" data-action="cancel">Отмена</div>');

        buttonsHtml.append(createBtn);
        buttonsHtml.append(connectBtn);
        buttonsHtml.append(cancelBtn);
        html.append(buttonsHtml);

        Lampa.Modal.open({
            title: '',
            html: html,
            onBack: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings_component');
            }
        });

        createBtn.on('hover:enter', function () {
            Lampa.Modal.close();
            createNewPin();
        });

        connectBtn.on('hover:enter', function () {
            Lampa.Modal.close();
            enterExistingPin();
        });

        cancelBtn.on('hover:enter', function () {
            Lampa.Modal.close();
            Lampa.Controller.toggle('settings_component');
        });

        Lampa.Controller.add('modal', {
            toggle: function () {
                Lampa.Controller.collectionSet(html);
                Lampa.Controller.collectionFocus(false, html);
            },
            back: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings_component');
            }
        });

        Lampa.Controller.toggle('modal');
    }

    function createNewPin() {
        initFirebase(function (success) {
            if (!success) {
                Lampa.Noty.show('Ошибка подключения к Firebase');
                return;
            }

            var pin = generatePin();

            // Проверяем что PIN не занят
            var pinRef = database.ref('users/' + pin);
            pinRef.once('value', function (snapshot) {
                if (snapshot.exists()) {
                    // PIN уже существует, генерируем новый
                    createNewPin();
                    return;
                }

                // Создаём запись в Firebase
                pinRef.set({
                    created_at: Date.now(),
                    movies: {}
                }).then(function () {
                    PluginData.pin = pin;
                    PluginData.synced = true;
                    PluginData.movies = {};
                    userRef = pinRef;
                    saveData();

                    showPinCreatedModal(pin);
                    updateWatchedCount();
                    Lampa.Settings.update();

                    log('Created new PIN:', pin);
                }).catch(function (error) {
                    log('Error creating PIN:', error);
                    Lampa.Noty.show('Ошибка создания PIN');
                });
            });
        });
    }

    function showPinCreatedModal(pin) {
        var html = $('<div class="challenge365-pin-modal"></div>');

        html.append('<div class="challenge365-pin-title">✅ PIN создан!</div>');
        html.append('<div class="challenge365-pin-code">' + pin + '</div>');
        html.append('<div class="challenge365-pin-hint">Запомните этот код для подключения других устройств</div>');
        html.append('<div class="challenge365-pin-btn ok selector">OK</div>');

        Lampa.Modal.open({
            title: '',
            html: html,
            onBack: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings_component');
            }
        });

        html.find('.ok').on('hover:enter', function () {
            Lampa.Modal.close();
            Lampa.Controller.toggle('settings_component');
        });

        Lampa.Controller.add('modal', {
            toggle: function () {
                Lampa.Controller.collectionSet(html);
                Lampa.Controller.collectionFocus(false, html);
            },
            back: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings_component');
            }
        });

        Lampa.Controller.toggle('modal');
    }

    function enterExistingPin() {
        Lampa.Input.edit({
            title: 'Введите 6-значный PIN',
            value: '',
            free: true,
            nosave: true
        }, function (pin) {
            pin = pin.trim();

            if (!/^\d{6}$/.test(pin)) {
                Lampa.Noty.show('PIN должен содержать 6 цифр');
                return;
            }

            connectWithPin(pin);
        });
    }

    function connectWithPin(pin) {
        initFirebase(function (success) {
            if (!success) {
                Lampa.Noty.show('Ошибка подключения к Firebase');
                return;
            }

            var pinRef = database.ref('users/' + pin);
            pinRef.once('value', function (snapshot) {
                if (!snapshot.exists()) {
                    Lampa.Noty.show('PIN не найден');
                    return;
                }

                PluginData.pin = pin;
                PluginData.synced = true;
                userRef = pinRef;
                saveData();

                // Загружаем данные
                syncFromFirebase(function () {
                    Lampa.Noty.show('✅ Подключено! PIN: ' + pin);
                    Lampa.Settings.update();
                });

                log('Connected with PIN:', pin);
            });
        });
    }

    function disconnect() {
        PluginData.pin = '';
        PluginData.synced = false;
        PluginData.movies = {};
        PluginData.watched_count = 0;
        userRef = null;
        saveData();

        Lampa.Noty.show('Отключено от синхронизации');
        Lampa.Settings.update();
    }

    // ========================================
    // FIREBASE СИНХРОНИЗАЦИЯ
    // ========================================

    function syncFromFirebase(callback) {
        if (!userRef) {
            if (callback) callback();
            return;
        }

        userRef.child('movies').once('value', function (snapshot) {
            var movies = snapshot.val() || {};
            PluginData.movies = movies;

            // Считаем просмотры за текущий год
            var year = new Date().getFullYear();
            var count = 0;
            Object.keys(movies).forEach(function (id) {
                var movie = movies[id];
                if (movie.watched_at) {
                    var watchedYear = new Date(movie.watched_at).getFullYear();
                    if (watchedYear === year) {
                        count++;
                    }
                }
            });

            PluginData.watched_count = count;
            saveData();

            log('Synced from Firebase:', count + ' movies this year');
            if (callback) callback();
        });
    }

    function syncMovieToFirebase(movie, callback) {
        if (!userRef) {
            Lampa.Noty.show('Сначала подключитесь (Настройки → 365 Challenge)');
            if (callback) callback(false);
            return;
        }

        var movieId = String(movie.id || movie.tmdb_id);
        var movieData = {
            tmdb_id: parseInt(movieId),
            watched_at: movie.watched_at || new Date().toISOString(),
            rating: movie.rating || null,
            comment: movie.comment || null
        };

        userRef.child('movies/' + movieId).set(movieData)
            .then(function () {
                PluginData.movies[movieId] = movieData;
                updateWatchedCount();
                saveData();

                log('Saved to Firebase:', movieId);
                if (callback) callback(true);
            })
            .catch(function (error) {
                log('Error saving to Firebase:', error);
                Lampa.Noty.show('Ошибка сохранения');
                if (callback) callback(false);
            });
    }

    function deleteFromFirebase(movieId, callback) {
        if (!userRef) {
            if (callback) callback(false);
            return;
        }

        movieId = String(movieId);

        userRef.child('movies/' + movieId).remove()
            .then(function () {
                delete PluginData.movies[movieId];
                updateWatchedCount();
                saveData();

                log('Deleted from Firebase:', movieId);
                if (callback) callback(true);
            })
            .catch(function (error) {
                log('Error deleting from Firebase:', error);
                if (callback) callback(false);
            });
    }

    function updateWatchedCount(callback) {
        var year = new Date().getFullYear();
        var count = 0;

        Object.keys(PluginData.movies).forEach(function (id) {
            var movie = PluginData.movies[id];
            if (movie.watched_at) {
                var watchedYear = new Date(movie.watched_at).getFullYear();
                if (watchedYear === year) {
                    count++;
                }
            }
        });

        PluginData.watched_count = count;
        saveData();

        if (callback) callback(count);
    }

    // ========================================
    // РАБОТА С ФИЛЬМАМИ
    // ========================================

    function markAsWatched(movie, watchedAt, callback) {
        // Поддержка старого формата вызова (movie, callback)
        if (typeof watchedAt === 'function') {
            callback = watchedAt;
            watchedAt = null;
        }

        if (!isSynced()) {
            Lampa.Noty.show('Сначала подключитесь (Настройки → 365 Challenge)');
            return;
        }

        var movieData = {
            id: movie.id,
            tmdb_id: movie.id,
            watched_at: watchedAt || new Date().toISOString(),
            rating: null,
            comment: null
        };

        var dateInfo = watchedAt ? ' (' + formatDate(new Date(watchedAt)) + ')' : '';
        log('Marking as watched:', movie.title || movie.name, dateInfo);

        syncMovieToFirebase(movieData, function (success) {
            if (success) {
                Lampa.Noty.show('✓ ' + (movie.title || movie.name) + ' добавлен!' + dateInfo);
            }
            if (callback) callback(success);
        });
    }

    function removeFromHistory(movie, callback) {
        if (!isSynced()) {
            Lampa.Noty.show('Сначала подключитесь');
            return;
        }

        var movieId = movie.tmdb_id || movie.id;
        log('Removing from history:', movie.title);

        deleteFromFirebase(movieId, function (success) {
            if (success) {
                Lampa.Noty.show('🗑️ ' + movie.title + ' удалён');
            } else {
                Lampa.Noty.show('Ошибка при удалении');
            }
            if (callback) callback(success);
        });
    }

    function showDatePicker(movie, callback) {
        var now = new Date();
        var items = [];

        // Сегодня
        items.push({
            title: '📅 Сегодня (' + formatDate(now) + ')',
            date: now.toISOString()
        });

        // Вчера
        var yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        items.push({
            title: '📅 Вчера (' + formatDate(yesterday) + ')',
            date: yesterday.toISOString()
        });

        // Последние 7 дней
        for (var i = 2; i <= 7; i++) {
            var d = new Date(now);
            d.setDate(d.getDate() - i);
            var dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
            items.push({
                title: dayNames[d.getDay()] + ', ' + formatDate(d),
                date: d.toISOString()
            });
        }

        // Разделитель
        items.push({ title: '─────────────', separator: true });

        // Выбрать дату вручную
        items.push({
            title: '✏️ Ввести дату вручную',
            action: 'custom'
        });

        Lampa.Select.show({
            title: 'Когда посмотрел "' + (movie.title || movie.name) + '"?',
            items: items,
            onSelect: function (item) {
                if (item.separator) return;

                if (item.action === 'custom') {
                    showCustomDateInput(movie, callback);
                } else {
                    markAsWatched(movie, item.date, callback);
                }
            },
            onBack: function () {
                Lampa.Controller.toggle('settings_component');
            }
        });
    }

    function showCustomDateInput(movie, callback) {
        Lampa.Input.edit({
            title: 'Введите дату (ДД.ММ.ГГГГ)',
            value: formatDate(new Date()),
            free: true,
            nosave: true
        }, function (dateStr) {
            var parts = dateStr.split('.');
            if (parts.length !== 3) {
                Lampa.Noty.show('Неверный формат даты. Используйте ДД.ММ.ГГГГ');
                return;
            }

            var day = parseInt(parts[0], 10);
            var month = parseInt(parts[1], 10) - 1;
            var year = parseInt(parts[2], 10);

            var date = new Date(year, month, day, 12, 0, 0);

            if (isNaN(date.getTime())) {
                Lampa.Noty.show('Неверная дата');
                return;
            }

            if (date > new Date()) {
                Lampa.Noty.show('Дата не может быть в будущем');
                return;
            }

            markAsWatched(movie, date.toISOString(), callback);
        });
    }

    // ========================================
    // ОЦЕНКИ (1-10)
    // ========================================

    function showRatingDialog(movie, callback) {
        var items = [];
        for (var i = 10; i >= 1; i--) {
            var stars = '';
            var fullStars = Math.round(i / 2);
            for (var s = 0; s < 5; s++) {
                stars += s < fullStars ? '★' : '☆';
            }
            items.push({
                title: i + '/10  ' + stars,
                rating: i
            });
        }

        Lampa.Select.show({
            title: 'Оценка: ' + (movie.title || movie.name),
            items: items,
            onSelect: function (item) {
                rateMovie(movie, item.rating, callback);
            },
            onBack: function () {
                Lampa.Controller.toggle('settings_component');
            }
        });
    }

    function rateMovie(movie, rating, callback) {
        if (!isSynced()) {
            Lampa.Noty.show('Сначала подключитесь');
            return;
        }

        var movieId = String(movie.tmdb_id || movie.id);

        // Обновляем только рейтинг
        userRef.child('movies/' + movieId + '/rating').set(rating)
            .then(function () {
                if (PluginData.movies[movieId]) {
                    PluginData.movies[movieId].rating = rating;
                }
                saveData();

                log('Rated movie:', movie.title, 'Rating:', rating);
                Lampa.Noty.show('⭐ ' + (movie.title || movie.name) + ': ' + rating + '/10');
                if (callback) callback(true);
            })
            .catch(function (error) {
                log('Rating error', error);
                Lampa.Noty.show('Ошибка при добавлении оценки');
                if (callback) callback(false);
            });
    }

    // ========================================
    // КОММЕНТАРИИ
    // ========================================

    function showCommentDialog(movie, callback) {
        var movieId = String(movie.tmdb_id || movie.id);
        var existingComment = PluginData.movies[movieId]?.comment || '';

        Lampa.Input.edit({
            title: 'Комментарий к "' + (movie.title || movie.name) + '"',
            value: existingComment,
            free: true,
            nosave: true
        }, function (comment) {
            if (!comment || comment.trim().length < 1) {
                return;
            }

            addComment(movie, comment.trim(), callback);
        });
    }

    function addComment(movie, comment, callback) {
        if (!isSynced()) {
            Lampa.Noty.show('Сначала подключитесь');
            return;
        }

        var movieId = String(movie.tmdb_id || movie.id);

        userRef.child('movies/' + movieId + '/comment').set(comment)
            .then(function () {
                if (PluginData.movies[movieId]) {
                    PluginData.movies[movieId].comment = comment;
                }
                saveData();

                log('Comment added to:', movie.title);
                Lampa.Noty.show('💬 Комментарий сохранён!');
                if (callback) callback(true);
            })
            .catch(function (error) {
                log('Comment error', error);
                Lampa.Noty.show('Ошибка при сохранении комментария');
                if (callback) callback(false);
            });
    }

    // ========================================
    // СЛУЧАЙНЫЙ ФИЛЬМ
    // ========================================

    function getRandomFromLampa() {
        var fav = Lampa.Favorite.all();
        var movies = [];

        ['wath', 'like', 'history'].forEach(function (key) {
            if (fav[key] && Array.isArray(fav[key])) {
                fav[key].forEach(function (item) {
                    if (item.type === 'movie' || !item.type) {
                        movies.push(item);
                    }
                });
            }
        });

        if (fav.card && Array.isArray(fav.card)) {
            fav.card.forEach(function (item) {
                if (item.type === 'movie' || !item.type) {
                    if (!item.number_of_seasons) {
                        movies.push(item);
                    }
                }
            });
        }

        if (movies.length === 0) {
            Lampa.Noty.show('Нет фильмов в закладках');
            return null;
        }

        var randomIndex = Math.floor(Math.random() * movies.length);
        return movies[randomIndex];
    }

    // ========================================
    // ПОИСК ФИЛЬМОВ (через TMDB/Lampa)
    // ========================================

    function showSearchModal() {
        if (!isSynced()) {
            Lampa.Noty.show('Сначала подключитесь (Настройки → 365 Challenge)');
            return;
        }

        Lampa.Input.edit({
            title: 'Поиск фильма',
            value: '',
            free: true,
            nosave: true
        }, function (query) {
            if (!query || query.trim().length < 2) {
                Lampa.Noty.show('Введите название фильма (минимум 2 символа)');
                return;
            }

            Lampa.Loading.start();

            // Используем Lampa TMDB API для поиска
            var url = Lampa.TMDB.api('search/movie?query=' + encodeURIComponent(query) + '&language=ru');

            $.get(url, function (response) {
                Lampa.Loading.stop();

                var movies = response.results || [];

                if (movies.length === 0) {
                    Lampa.Noty.show('Фильмы не найдены');
                    return;
                }

                Lampa.Select.show({
                    title: 'Найдено: ' + movies.length,
                    items: movies.slice(0, 20).map(function (movie) {
                        return {
                            title: movie.title + (movie.release_date ? ' (' + movie.release_date.substring(0, 4) + ')' : ''),
                            movie: {
                                id: movie.id,
                                title: movie.title,
                                year: movie.release_date ? movie.release_date.substring(0, 4) : '',
                                poster_path: movie.poster_path
                            }
                        };
                    }),
                    onSelect: function (item) {
                        showMovieActionsMenu(item.movie);
                    },
                    onBack: function () {
                        Lampa.Controller.toggle('settings_component');
                    }
                });
            }).fail(function () {
                Lampa.Loading.stop();
                Lampa.Noty.show('Ошибка поиска');
            });
        });
    }

    function showMovieActionsMenu(movie) {
        var items = [
            { title: '✅ Отметить как просмотренный (сегодня)', action: 'watched' },
            { title: '📅 Просмотрен в другой день...', action: 'watched_date' },
            { title: '⭐ Поставить оценку', action: 'rate' },
            { title: '💬 Добавить комментарий', action: 'comment' },
            { title: '✅⭐ Просмотрен + Оценка', action: 'watched_rate' },
            { title: '📅⭐ Другая дата + Оценка', action: 'date_rate' }
        ];

        Lampa.Select.show({
            title: movie.title + (movie.year ? ' (' + movie.year + ')' : ''),
            items: items,
            onSelect: function (item) {
                switch (item.action) {
                    case 'watched':
                        markAsWatched(movie);
                        break;
                    case 'watched_date':
                        showDatePicker(movie);
                        break;
                    case 'rate':
                        markAsWatched(movie, function () {
                            showRatingDialog(movie);
                        });
                        break;
                    case 'comment':
                        markAsWatched(movie, function () {
                            showCommentDialog(movie);
                        });
                        break;
                    case 'watched_rate':
                        markAsWatched(movie, function () {
                            showRatingDialog(movie);
                        });
                        break;
                    case 'date_rate':
                        showDatePicker(movie, function () {
                            showRatingDialog(movie);
                        });
                        break;
                }
            },
            onBack: function () {
                Lampa.Controller.toggle('settings_component');
            }
        });
    }

    // ========================================
    // СТАТИСТИКА
    // ========================================

    function getStatistics(callback) {
        var year = new Date().getFullYear();
        var now = new Date();
        var dayOfYear = Math.floor((now - new Date(year, 0, 0)) / (1000 * 60 * 60 * 24));

        var result = {
            total_watched: PluginData.watched_count,
            goal: CONFIG.GOAL,
            progress_percent: Math.round((PluginData.watched_count / CONFIG.GOAL) * 100),
            days_passed: dayOfYear,
            days_remaining: 365 - dayOfYear,
            needed_per_day: Math.max(0, Math.ceil((CONFIG.GOAL - PluginData.watched_count) / Math.max(1, 365 - dayOfYear))),
            on_track: (PluginData.watched_count / Math.max(1, dayOfYear)) >= (CONFIG.GOAL / 365)
        };

        callback(result);
    }

    function showStatistics() {
        getStatistics(function (stats) {
            var html = $('<div class="challenge365-stats"></div>');

            var rows = [
                { label: 'Просмотрено', value: stats.total_watched + ' / ' + stats.goal },
                { label: 'Прогресс', value: stats.progress_percent + '%' },
                { label: 'Дней прошло', value: stats.days_passed },
                { label: 'Дней осталось', value: stats.days_remaining },
                { label: 'Нужно в день', value: stats.needed_per_day + ' фильмов' },
                { label: 'Статус', value: stats.on_track ? '✓ В графике' : '⚠ Позади графика', class: stats.on_track ? 'challenge365-on-track' : 'challenge365-behind' }
            ];

            rows.forEach(function (row) {
                var rowHtml = $('<div class="challenge365-stats-row"></div>');
                rowHtml.append('<span class="challenge365-stats-label">' + row.label + '</span>');
                rowHtml.append('<span class="challenge365-stats-value ' + (row.class || '') + '">' + row.value + '</span>');
                html.append(rowHtml);
            });

            Lampa.Modal.open({
                title: '📊 Статистика 365 Challenge',
                html: html,
                onBack: function () {
                    Lampa.Modal.close();
                    Lampa.Controller.toggle('settings_component');
                }
            });
        });
    }

    // ========================================
    // UI КОМПОНЕНТЫ
    // ========================================

    function addStyles() {
        var css = '\
            .challenge365-pin-modal { text-align: center; padding: 2em; }\
            .challenge365-pin-title { font-size: 1.8em; margin-bottom: 0.3em; color: #fff; }\
            .challenge365-pin-subtitle { font-size: 1em; margin-bottom: 1.5em; color: #888; }\
            .challenge365-pin-buttons { display: flex; flex-direction: column; gap: 0.8em; }\
            .challenge365-pin-btn { background: #333; padding: 1em 2em; border-radius: 0.5em; font-size: 1.1em; }\
            .challenge365-pin-btn.focus { background: #e50914; }\
            .challenge365-pin-btn.cancel { background: #222; color: #888; }\
            .challenge365-pin-code { font-size: 3em; font-weight: bold; color: #e50914; margin: 0.5em 0; letter-spacing: 0.15em; }\
            .challenge365-pin-hint { color: #888; margin: 1em 0 1.5em; }\
            \
            .challenge365-stats { padding: 1em; }\
            .challenge365-stats-row { display: flex; justify-content: space-between; padding: 0.5em 0; border-bottom: 1px solid #333; }\
            .challenge365-stats-label { color: #888; }\
            .challenge365-stats-value { color: #fff; font-weight: bold; }\
            .challenge365-on-track { color: #4caf50; }\
            .challenge365-behind { color: #ff5722; }\
            \
            .challenge365-history-header { padding: 1.5em; text-align: center; margin-bottom: 1em; background: linear-gradient(135deg, rgba(229,9,20,0.2), rgba(0,0,0,0.5)); border-radius: 0.5em; }\
            .challenge365-history-title { font-size: 1.5em; color: #fff; margin-bottom: 0.5em; }\
            .challenge365-history-progress { font-size: 1.2em; color: #e50914; font-weight: bold; margin-bottom: 0.8em; }\
            .challenge365-history-bar { height: 0.5em; background: #333; border-radius: 0.25em; overflow: hidden; }\
            .challenge365-history-fill { height: 100%; background: linear-gradient(90deg, #e50914, #ff6b6b); transition: width 0.3s; }\
            \
            .challenge365-month-header { font-size: 1.2em; color: #fff; padding: 1em 0 0.5em; margin-top: 1em; border-bottom: 2px solid #e50914; }\
            \
            .challenge365-movie-card { display: flex; padding: 1em; margin: 0.5em 0; background: #1a1a1a; border-radius: 0.5em; transition: all 0.2s; cursor: pointer; }\
            .challenge365-movie-card.focus { background: #e50914; transform: scale(1.02); }\
            .challenge365-movie-poster { width: 80px; height: 120px; flex-shrink: 0; margin-right: 1em; border-radius: 0.3em; overflow: hidden; background: #333; }\
            .challenge365-movie-poster img { width: 100%; height: 100%; object-fit: cover; }\
            .challenge365-movie-info { flex: 1; display: flex; flex-direction: column; justify-content: center; }\
            .challenge365-movie-title { font-size: 1.1em; color: #fff; font-weight: bold; margin-bottom: 0.3em; }\
            .challenge365-movie-year { color: #888; font-size: 0.9em; margin-bottom: 0.3em; }\
            .challenge365-movie-date { color: #aaa; font-size: 0.9em; margin-bottom: 0.3em; }\
            .challenge365-movie-rating { color: #ffc107; font-size: 0.9em; }\
            .challenge365-movie-comment { color: #888; font-size: 0.85em; font-style: italic; margin-top: 0.3em; }\
        ';

        var style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function createSettingsComponent() {
        // Кнопка подключения/отключения
        Lampa.SettingsApi.addParam({
            component: 'challenge365',
            param: {
                name: 'challenge365_sync',
                type: 'button',
                default: ''
            },
            field: {
                name: isSynced() ? '✅ Подключено (PIN: ' + PluginData.pin + ')' : '🔗 Подключить синхронизацию',
                description: isSynced() ? 'Нажмите чтобы отключиться' : 'Создать PIN или ввести существующий'
            },
            onChange: function () {
                if (isSynced()) {
                    Lampa.Select.show({
                        title: 'Отключить синхронизацию?',
                        items: [
                            { title: '❌ Да, отключить', confirm: true },
                            { title: '↩️ Отмена', confirm: false }
                        ],
                        onSelect: function (item) {
                            if (item.confirm) {
                                disconnect();
                            }
                        },
                        onBack: function () {
                            Lampa.Controller.toggle('settings_component');
                        }
                    });
                } else {
                    showPinModal();
                }
            }
        });

        // Прогресс
        Lampa.SettingsApi.addParam({
            component: 'challenge365',
            param: {
                name: 'challenge365_progress',
                type: 'static'
            },
            field: {
                name: 'Прогресс: ' + PluginData.watched_count + '/' + CONFIG.GOAL,
                description: Math.round((PluginData.watched_count / CONFIG.GOAL) * 100) + '% выполнено'
            }
        });

        // Случайный фильм из закладок
        Lampa.SettingsApi.addParam({
            component: 'challenge365',
            param: {
                name: 'challenge365_random',
                type: 'button',
                default: ''
            },
            field: {
                name: '🎲 Случайный из закладок',
                description: 'Выбрать случайный фильм из закладок Lampa'
            },
            onChange: function () {
                var movie = getRandomFromLampa();
                if (movie) {
                    Lampa.Activity.push({
                        url: '',
                        title: 'Случайный фильм',
                        component: 'full',
                        id: movie.id,
                        method: movie.method || 'movie',
                        card: movie
                    });
                }
            }
        });

        // Статистика
        Lampa.SettingsApi.addParam({
            component: 'challenge365',
            param: {
                name: 'challenge365_stats',
                type: 'button',
                default: ''
            },
            field: {
                name: '📊 Статистика',
                description: 'Показать детальную статистику'
            },
            onChange: function () {
                showStatistics();
            }
        });

        // Поиск и добавление вручную
        Lampa.SettingsApi.addParam({
            component: 'challenge365',
            param: {
                name: 'challenge365_search',
                type: 'button',
                default: ''
            },
            field: {
                name: '🔍 Добавить вручную',
                description: 'Поиск и добавление фильма'
            },
            onChange: function () {
                showSearchModal();
            }
        });

        // Синхронизация
        Lampa.SettingsApi.addParam({
            component: 'challenge365',
            param: {
                name: 'challenge365_refresh',
                type: 'button',
                default: ''
            },
            field: {
                name: '🔄 Обновить данные',
                description: 'Загрузить данные из облака'
            },
            onChange: function () {
                if (!isSynced()) {
                    Lampa.Noty.show('Сначала подключитесь');
                    return;
                }

                Lampa.Loading.start();
                syncFromFirebase(function () {
                    Lampa.Loading.stop();
                    Lampa.Noty.show('✅ Данные обновлены');
                    Lampa.Settings.update();
                });
            }
        });
    }

    // Кнопка на странице фильма
    function addMovieButton() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') {
                var card = e.data.movie;

                // Только для фильмов
                if (!card || card.number_of_seasons) return;

                var panel = e.object.activity.render().find('.full-start__buttons');

                var mainButton = $('<div class="full-start__button selector view--challenge365-menu">\
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">\
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>\
                    </svg>\
                    <span>365</span>\
                </div>');

                mainButton.on('hover:enter', function () {
                    if (!isSynced()) {
                        Lampa.Noty.show('Сначала подключитесь (Настройки → 365 Challenge)');
                        return;
                    }

                    Lampa.Select.show({
                        title: card.title || card.name,
                        items: [
                            { title: '✅ Отметить просмотренным (сегодня)', action: 'watched' },
                            { title: '📅 Просмотрен в другой день...', action: 'watched_date' },
                            { title: '⭐ Поставить оценку', action: 'rate' },
                            { title: '💬 Добавить комментарий', action: 'comment' },
                            { title: '✅⭐ Просмотрен + Оценка', action: 'watched_rate' },
                            { title: '📅⭐ Другая дата + Оценка', action: 'date_rate' }
                        ],
                        onSelect: function (item) {
                            switch (item.action) {
                                case 'watched':
                                    markAsWatched(card);
                                    break;
                                case 'watched_date':
                                    showDatePicker(card);
                                    break;
                                case 'rate':
                                    markAsWatched(card, function () {
                                        showRatingDialog(card);
                                    });
                                    break;
                                case 'comment':
                                    markAsWatched(card, function () {
                                        showCommentDialog(card);
                                    });
                                    break;
                                case 'watched_rate':
                                    markAsWatched(card, function () {
                                        showRatingDialog(card);
                                    });
                                    break;
                                case 'date_rate':
                                    showDatePicker(card, function () {
                                        showRatingDialog(card);
                                    });
                                    break;
                            }
                        },
                        onBack: function () {
                            Lampa.Controller.toggle('full_start');
                        }
                    });
                });

                e.object.activity.render().find('.view--torrent').after(mainButton);
            }
        });
    }

    // ========================================
    // БОКОВОЕ МЕНЮ И ИСТОРИЯ
    // ========================================

    function addMenuButton() {
        var menu_item = $('<li class="menu__item selector" data-action="challenge365_history">\
            <div class="menu__ico">\
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">\
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>\
                </svg>\
            </div>\
            <div class="menu__text">365 Challenge</div>\
        </li>');

        menu_item.on('hover:enter', function () {
            if (!isSynced()) {
                Lampa.Noty.show('Сначала подключитесь (Настройки → 365 Challenge)');
                return;
            }

            Lampa.Activity.push({
                url: '',
                title: '365 Challenge',
                component: 'challenge365_history',
                page: 1
            });
        });

        var bookmarks = $('.menu .menu__list').find('[data-action="favorite"]');
        if (bookmarks.length) {
            bookmarks.after(menu_item);
        } else {
            $('.menu .menu__list').append(menu_item);
        }
    }

    function registerHistoryComponent() {
        Lampa.Component.add('challenge365_history', function () {
            var scroll, items, active, last;

            this.create = function () {
                var _this = this;
                scroll = new Lampa.Scroll({ mask: true, over: true });
                items = [];

                this.activity.loader(true);

                getWatchedHistory(function (movies) {
                    _this.activity.loader(false);

                    if (movies.length === 0) {
                        var empty = $('<div class="empty-box"><div class="empty-box__title">Нет просмотренных фильмов</div><div class="empty-box__descr">Добавьте фильмы через кнопку 365 на странице любого фильма</div></div>');
                        scroll.append(empty);
                    } else {
                        _this.build(movies);
                    }

                    _this.activity.toggle();
                });

                return this.render();
            };

            this.build = function (movies) {
                var _this = this;
                var year = new Date().getFullYear();

                var yearMovies = movies.filter(function (m) {
                    return new Date(m.watched_at).getFullYear() === year;
                });

                var header = $('<div class="challenge365-history-header">\
                    <div class="challenge365-history-title">🎬 365 Challenge ' + year + '</div>\
                    <div class="challenge365-history-progress">' + yearMovies.length + ' / ' + CONFIG.GOAL + ' фильмов</div>\
                    <div class="challenge365-history-bar"><div class="challenge365-history-fill" style="width: ' + Math.min(100, (yearMovies.length / CONFIG.GOAL) * 100) + '%"></div></div>\
                </div>');
                scroll.append(header);

                // Группируем по месяцам
                var grouped = {};
                movies.forEach(function (movie) {
                    var date = new Date(movie.watched_at);
                    var monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
                    var monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
                    var monthName = monthNames[date.getMonth()] + ' ' + date.getFullYear();

                    if (!grouped[monthKey]) {
                        grouped[monthKey] = { name: monthName, movies: [] };
                    }
                    grouped[monthKey].movies.push(movie);
                });

                var sortedKeys = Object.keys(grouped).sort().reverse();

                sortedKeys.forEach(function (key) {
                    var group = grouped[key];

                    var monthHeader = $('<div class="challenge365-month-header">' + group.name + ' (' + group.movies.length + ')</div>');
                    scroll.append(monthHeader);

                    group.movies.forEach(function (movie) {
                        var card = _this.createCard(movie);
                        scroll.append(card);
                        items.push(card);
                    });
                });
            };

            this.createCard = function (movie) {
                var stars = '';
                if (movie.rating) {
                    for (var i = 0; i < 5; i++) {
                        stars += i < Math.round(movie.rating / 2) ? '★' : '☆';
                    }
                }

                var commentHtml = movie.comment ? '<div class="challenge365-movie-comment">"' + movie.comment + '"</div>' : '';

                var card = $('<div class="challenge365-movie-card selector" data-id="' + movie.tmdb_id + '">\
                    <div class="challenge365-movie-poster">\
                        <img src="' + (movie.poster || '') + '" />\
                    </div>\
                    <div class="challenge365-movie-info">\
                        <div class="challenge365-movie-title">' + movie.title + '</div>\
                        <div class="challenge365-movie-year">' + (movie.year || '') + '</div>\
                        <div class="challenge365-movie-date">📅 ' + formatDate(new Date(movie.watched_at)) + '</div>\
                        ' + (movie.rating ? '<div class="challenge365-movie-rating">⭐ ' + movie.rating + '/10 ' + stars + '</div>' : '') + '\
                        ' + commentHtml + '\
                    </div>\
                </div>');

                card.on('hover:enter', function () {
                    Lampa.Select.show({
                        title: movie.title,
                        items: [
                            { title: '🎬 Открыть страницу фильма', action: 'open' },
                            { title: '📅 Изменить дату', action: 'change_date' },
                            { title: '⭐ Поставить/изменить оценку', action: 'rate' },
                            { title: '💬 Изменить комментарий', action: 'comment' },
                            { title: '🗑️ Удалить из истории', action: 'delete' }
                        ],
                        onSelect: function (item) {
                            switch (item.action) {
                                case 'open':
                                    if (movie.tmdb_id) {
                                        Lampa.Activity.push({
                                            url: '',
                                            title: movie.title,
                                            component: 'full',
                                            id: movie.tmdb_id,
                                            method: 'movie'
                                        });
                                    }
                                    break;
                                case 'change_date':
                                    removeFromHistory(movie, function (success) {
                                        if (success) {
                                            showDatePicker(movie, function () {
                                                Lampa.Activity.replace({
                                                    url: '',
                                                    title: '365 Challenge',
                                                    component: 'challenge365_history',
                                                    page: 1
                                                });
                                            });
                                        }
                                    });
                                    break;
                                case 'rate':
                                    showRatingDialog(movie, function () {
                                        Lampa.Activity.replace({
                                            url: '',
                                            title: '365 Challenge',
                                            component: 'challenge365_history',
                                            page: 1
                                        });
                                    });
                                    break;
                                case 'comment':
                                    showCommentDialog(movie, function () {
                                        Lampa.Activity.replace({
                                            url: '',
                                            title: '365 Challenge',
                                            component: 'challenge365_history',
                                            page: 1
                                        });
                                    });
                                    break;
                                case 'delete':
                                    Lampa.Select.show({
                                        title: 'Удалить "' + movie.title + '"?',
                                        items: [
                                            { title: '❌ Да, удалить', confirm: true },
                                            { title: '↩️ Отмена', confirm: false }
                                        ],
                                        onSelect: function (confirm) {
                                            if (confirm.confirm) {
                                                removeFromHistory(movie, function (success) {
                                                    if (success) {
                                                        card.remove();
                                                    }
                                                });
                                            }
                                        },
                                        onBack: function () {
                                            Lampa.Controller.toggle('content');
                                        }
                                    });
                                    break;
                            }
                        },
                        onBack: function () {
                            Lampa.Controller.toggle('content');
                        }
                    });
                });

                return card;
            };

            this.render = function () {
                return scroll.render();
            };

            this.toggle = function () {
                var _this = this;
                Lampa.Controller.add('content', {
                    toggle: function () {
                        Lampa.Controller.collectionSet(scroll.render());
                        Lampa.Controller.collectionFocus(items.length ? items[0] : false, scroll.render());
                    },
                    back: function () {
                        Lampa.Activity.backward();
                    },
                    up: function () {
                        if (Navigator.canmove('up')) Navigator.move('up');
                        else Lampa.Controller.toggle('head');
                    },
                    down: function () {
                        Navigator.move('down');
                    },
                    left: function () {
                        if (Navigator.canmove('left')) Navigator.move('left');
                        else Lampa.Controller.toggle('menu');
                    },
                    right: function () {
                        Navigator.move('right');
                    }
                });
                Lampa.Controller.toggle('content');
            };

            this.pause = function () { };
            this.stop = function () { };
            this.start = function () { };
            this.destroy = function () {
                scroll.destroy();
                items = null;
            };
        });
    }

    function getWatchedHistory(callback) {
        if (!isSynced()) {
            callback([]);
            return;
        }

        // Сначала синхронизируем данные
        syncFromFirebase(function () {
            var movies = [];
            var movieIds = Object.keys(PluginData.movies);

            if (movieIds.length === 0) {
                callback([]);
                return;
            }

            var pending = movieIds.length;

            function done() {
                pending--;
                if (pending <= 0) {
                    // Сортируем по дате просмотра
                    movies.sort(function (a, b) {
                        return new Date(b.watched_at) - new Date(a.watched_at);
                    });
                    callback(movies);
                }
            }

            movieIds.forEach(function (id) {
                var movieData = PluginData.movies[id];
                var tmdbId = movieData.tmdb_id || id;

                // Получаем данные о фильме через TMDB
                var url = Lampa.TMDB.api('movie/' + tmdbId + '?language=ru');

                $.get(url, function (data) {
                    if (data) {
                        movies.push({
                            tmdb_id: tmdbId,
                            title: data.title || 'Неизвестный фильм',
                            year: data.release_date ? data.release_date.substring(0, 4) : '',
                            poster: data.poster_path ? Lampa.TMDB.image('w200' + data.poster_path) : '',
                            watched_at: movieData.watched_at,
                            rating: movieData.rating,
                            comment: movieData.comment
                        });
                    }
                    done();
                }).fail(function () {
                    // Если не удалось получить данные, добавляем с минимальной информацией
                    movies.push({
                        tmdb_id: tmdbId,
                        title: 'Фильм #' + tmdbId,
                        year: '',
                        poster: '',
                        watched_at: movieData.watched_at,
                        rating: movieData.rating,
                        comment: movieData.comment
                    });
                    done();
                });
            });
        });
    }

    // ========================================
    // ИНИЦИАЛИЗАЦИЯ
    // ========================================

    function initPlugin() {
        if (window.challenge365_initialized) return;
        window.challenge365_initialized = true;

        log('Initializing 365 Challenge Plugin v' + CONFIG.VERSION);

        // Загружаем сохранённые данные
        loadData();

        // Добавляем стили
        addStyles();

        // Добавляем локализацию
        Lampa.Lang.add({
            challenge365_title: {
                ru: '365 Challenge',
                en: '365 Challenge',
                uk: '365 Challenge'
            }
        });

        // Создаём раздел настроек
        Lampa.SettingsApi.addComponent({
            component: 'challenge365',
            name: '365 Challenge 🎬',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>'
        });

        // Добавляем параметры настроек
        createSettingsComponent();

        // Добавляем кнопку на страницу фильма
        addMovieButton();

        // Добавляем пункт в боковое меню
        addMenuButton();

        // Регистрируем компонент истории
        registerHistoryComponent();

        // Если есть PIN - инициализируем Firebase и синхронизируем
        if (PluginData.pin) {
            initFirebase(function (success) {
                if (success) {
                    userRef = database.ref('users/' + PluginData.pin);
                    PluginData.synced = true;
                    syncFromFirebase();
                }
            });
        }

        log('Plugin initialized successfully!');
    }

    // Запуск плагина
    if (window.appready) {
        initPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                initPlugin();
            }
        });
    }

})();
