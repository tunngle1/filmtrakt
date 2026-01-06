(function () {
    'use strict';

    // ========================================
    // TRAKT 365 - Плагин для челленджа 365 фильмов
    // ========================================

    var CONFIG = {
        CLIENT_ID: '4996442972d28503645be3ea45e191a45bd538d5d22b4d93a304f251e28f023f',
        CLIENT_SECRET: '70f26098058829f6d98a4b4907740a03c57f7573b150424fba4fbd2ce0dff62b',
        API_URL: 'https://api.trakt.tv',
        GOAL: 365,
        STORAGE_KEY: 'trakt365_data',
        VERSION: '1.0.0'
    };

    // Хранилище данных плагина
    var PluginData = {
        access_token: '',
        refresh_token: '',
        expires_at: 0,
        username: '',
        watched_count: 0,
        year: new Date().getFullYear()
    };

    // Сетевой модуль
    var network = new Lampa.Reguest();

    // ========================================
    // УТИЛИТЫ
    // ========================================

    function log(message, data) {
        console.log('[Trakt365] ' + message, data || '');
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

    function isAuthorized() {
        return PluginData.access_token && PluginData.expires_at > Date.now();
    }

    function getHeaders() {
        var headers = {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': CONFIG.CLIENT_ID
        };
        if (PluginData.access_token) {
            headers['Authorization'] = 'Bearer ' + PluginData.access_token;
        }
        return headers;
    }

    // ========================================
    // OAUTH DEVICE FLOW
    // ========================================

    function startAuth(onSuccess, onError) {
        log('Starting OAuth Device flow...');

        network.clear();
        network.timeout(30000);

        var body = JSON.stringify({
            client_id: CONFIG.CLIENT_ID
        });

        network.native(
            CONFIG.API_URL + '/oauth/device/code',
            function (response) {
                log('Device code received', response);
                showAuthModal(response, onSuccess, onError);
            },
            function (error) {
                log('Error getting device code', error);
                Lampa.Noty.show('Ошибка авторизации Trakt');
                if (onError) onError(error);
            },
            body,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
    }

    function showAuthModal(deviceData, onSuccess, onError) {
        var html = $('<div class="trakt365-auth-modal"></div>');

        html.append('<div class="trakt365-auth-title">Войти в Trakt.tv</div>');
        html.append('<div class="trakt365-auth-step">1. Открой <b>trakt.tv/activate</b></div>');
        html.append('<div class="trakt365-auth-step">2. Введи код:</div>');
        html.append('<div class="trakt365-auth-code">' + deviceData.user_code + '</div>');
        html.append('<div class="trakt365-auth-waiting">Ожидание авторизации...</div>');
        html.append('<div class="trakt365-auth-cancel selector">Отмена</div>');

        Lampa.Modal.open({
            title: '',
            html: html,
            onBack: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings_component');
            }
        });

        html.find('.trakt365-auth-cancel').on('hover:enter', function () {
            Lampa.Modal.close();
            Lampa.Controller.toggle('settings_component');
        });

        Lampa.Controller.add('modal', {
            toggle: function () {
                Lampa.Controller.collectionSet(html);
                Lampa.Controller.collectionFocus(false, html);
            },
            left: function () { },
            right: function () { },
            up: function () { },
            down: function () { },
            back: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings_component');
            }
        });

        Lampa.Controller.toggle('modal');

        // Polling for token
        pollForToken(deviceData, onSuccess, onError);
    }

    function pollForToken(deviceData, onSuccess, onError) {
        var interval = deviceData.interval * 1000;
        var expiresAt = Date.now() + (deviceData.expires_in * 1000);

        function poll() {
            if (Date.now() > expiresAt) {
                Lampa.Modal.close();
                Lampa.Noty.show('Время авторизации истекло');
                if (onError) onError('expired');
                return;
            }

            var body = JSON.stringify({
                code: deviceData.device_code,
                client_id: CONFIG.CLIENT_ID,
                client_secret: CONFIG.CLIENT_SECRET
            });

            network.clear();
            network.native(
                CONFIG.API_URL + '/oauth/device/token',
                function (response) {
                    log('Token received!', response);

                    PluginData.access_token = response.access_token;
                    PluginData.refresh_token = response.refresh_token;
                    PluginData.expires_at = Date.now() + (response.expires_in * 1000);

                    saveData();

                    Lampa.Modal.close();
                    Lampa.Noty.show('Успешно вошли в Trakt!');

                    // Получить информацию о пользователе
                    getUserInfo();

                    if (onSuccess) onSuccess();
                },
                function (error) {
                    // 400 = pending, keep polling
                    if (error && error.status === 400) {
                        setTimeout(poll, interval);
                    } else {
                        log('Token error', error);
                        setTimeout(poll, interval);
                    }
                },
                body,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
        }

        setTimeout(poll, interval);
    }

    function getUserInfo() {
        network.clear();
        network.silent(
            CONFIG.API_URL + '/users/me',
            function (user) {
                PluginData.username = user.username;
                saveData();
                log('User info:', user.username);

                // Обновить счётчик просмотров
                updateWatchedCount();
            },
            function (error) {
                log('Error getting user info', error);
            },
            false,
            { headers: getHeaders() }
        );
    }

    // ========================================
    // TRAKT API МЕТОДЫ
    // ========================================

    function updateWatchedCount(callback) {
        if (!isAuthorized()) {
            if (callback) callback(0);
            return;
        }

        var year = new Date().getFullYear();
        var startDate = year + '-01-01T00:00:00.000Z';
        var endDate = year + '-12-31T23:59:59.999Z';

        network.clear();
        network.silent(
            CONFIG.API_URL + '/users/me/watched/movies',
            function (movies) {
                // Фильтруем фильмы по году просмотра (по дате watched_at)
                var count = 0;

                if (Array.isArray(movies)) {
                    movies.forEach(function (item) {
                        if (item.last_watched_at) {
                            var watchedAt = new Date(item.last_watched_at);
                            if (watchedAt.getFullYear() === year) {
                                count++;
                            }
                        }
                    });
                }

                PluginData.watched_count = count;
                PluginData.year = year;
                saveData();

                log('Watched count for ' + year + ':', count);
                if (callback) callback(count);
            },
            function (error) {
                log('Error getting watched movies', error);
                if (callback) callback(0);
            },
            false,
            { headers: getHeaders() }
        );
    }

    function markAsWatched(movie, watchedAt, callback) {
        // Поддержка старого формата вызова (movie, callback)
        if (typeof watchedAt === 'function') {
            callback = watchedAt;
            watchedAt = null;
        }

        if (!isAuthorized()) {
            Lampa.Noty.show('Сначала войдите в Trakt');
            return;
        }

        var movieData = {
            movies: [{
                ids: {}
            }]
        };

        // Используем TMDB ID если есть
        if (movie.id) {
            movieData.movies[0].ids.tmdb = movie.id;
        }
        if (movie.imdb_id) {
            movieData.movies[0].ids.imdb = movie.imdb_id;
        }
        if (movie.trakt_id) {
            movieData.movies[0].ids.trakt = movie.trakt_id;
        }

        // Добавляем дату просмотра если указана
        if (watchedAt) {
            movieData.movies[0].watched_at = watchedAt;
        }

        var dateInfo = watchedAt ? ' (' + formatDate(new Date(watchedAt)) + ')' : '';
        log('Marking as watched:', movie.title || movie.name, dateInfo);

        network.clear();
        network.native(
            CONFIG.API_URL + '/sync/history',
            function (response) {
                log('Marked as watched!', response);
                Lampa.Noty.show('✓ ' + (movie.title || movie.name) + ' добавлен!' + dateInfo);

                updateWatchedCount();

                if (callback) callback(true);
            },
            function (error) {
                log('Error marking as watched', error);
                Lampa.Noty.show('Ошибка при добавлении в просмотренные');
                if (callback) callback(false);
            },
            JSON.stringify(movieData),
            {
                method: 'POST',
                headers: getHeaders()
            }
        );
    }

    function formatDate(date) {
        var day = String(date.getDate()).padStart(2, '0');
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var year = date.getFullYear();
        return day + '.' + month + '.' + year;
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
            // Парсим дату в формате ДД.ММ.ГГГГ
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

            // Проверка что дата не в будущем
            if (date > new Date()) {
                Lampa.Noty.show('Дата не может быть в будущем');
                return;
            }

            markAsWatched(movie, date.toISOString(), callback);
        });
    }

    function getWatchlist(callback) {
        if (!isAuthorized()) {
            callback([]);
            return;
        }

        network.clear();
        network.silent(
            CONFIG.API_URL + '/users/me/watchlist/movies',
            function (items) {
                var movies = items.map(function (item) {
                    return {
                        id: item.movie.ids.tmdb,
                        imdb_id: item.movie.ids.imdb,
                        title: item.movie.title,
                        year: item.movie.year,
                        trakt_id: item.movie.ids.trakt
                    };
                });
                callback(movies);
            },
            function (error) {
                log('Error getting watchlist', error);
                callback([]);
            },
            false,
            { headers: getHeaders() }
        );
    }

    function getRandomFromWatchlist(callback) {
        getWatchlist(function (movies) {
            if (movies.length === 0) {
                Lampa.Noty.show('Ваш Watchlist пуст');
                callback(null);
                return;
            }

            var randomIndex = Math.floor(Math.random() * movies.length);
            var randomMovie = movies[randomIndex];

            log('Random movie:', randomMovie.title);
            callback(randomMovie);
        });
    }

    function getRandomFromLampa() {
        // Получить фильмы из закладок Lampa
        var fav = Lampa.Favorite.all();
        var movies = [];

        // Собираем все фильмы из разных категорий
        ['wath', 'like', 'history'].forEach(function (key) {
            if (fav[key] && Array.isArray(fav[key])) {
                fav[key].forEach(function (item) {
                    if (item.type === 'movie' || !item.type) {
                        movies.push(item);
                    }
                });
            }
        });

        // Также проверяем карточки
        if (fav.card && Array.isArray(fav.card)) {
            fav.card.forEach(function (item) {
                if (item.type === 'movie' || !item.type) {
                    // Проверяем что это не сериал
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
    // ПОИСК ФИЛЬМОВ
    // ========================================

    function searchMovies(query, callback) {
        if (!query || query.trim().length < 2) {
            callback([]);
            return;
        }

        network.clear();
        network.silent(
            CONFIG.API_URL + '/search/movie?query=' + encodeURIComponent(query),
            function (results) {
                var movies = results
                    .filter(function (item) {
                        return item.type === 'movie' && item.movie;
                    })
                    .map(function (item) {
                        return {
                            id: item.movie.ids.tmdb,
                            imdb_id: item.movie.ids.imdb,
                            trakt_id: item.movie.ids.trakt,
                            title: item.movie.title,
                            year: item.movie.year,
                            overview: item.movie.overview || ''
                        };
                    });
                callback(movies);
            },
            function (error) {
                log('Search error', error);
                callback([]);
            },
            false,
            { headers: getHeaders() }
        );
    }

    function showSearchModal() {
        if (!isAuthorized()) {
            Lampa.Noty.show('Сначала войдите в Trakt');
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

            searchMovies(query, function (movies) {
                Lampa.Loading.stop();

                if (movies.length === 0) {
                    Lampa.Noty.show('Фильмы не найдены');
                    return;
                }

                // Показываем список найденных фильмов
                Lampa.Select.show({
                    title: 'Найдено: ' + movies.length,
                    items: movies.map(function (movie) {
                        return {
                            title: movie.title + (movie.year ? ' (' + movie.year + ')' : ''),
                            movie: movie
                        };
                    }),
                    onSelect: function (item) {
                        showMovieActionsMenu(item.movie);
                    },
                    onBack: function () {
                        Lampa.Controller.toggle('settings_component');
                    }
                });
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
                        showRatingDialog(movie);
                        break;
                    case 'comment':
                        showCommentDialog(movie);
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
        if (!isAuthorized()) {
            Lampa.Noty.show('Сначала войдите в Trakt');
            return;
        }

        var ratingData = {
            movies: [{
                rating: rating,
                ids: {}
            }]
        };

        if (movie.id) {
            ratingData.movies[0].ids.tmdb = movie.id;
        }
        if (movie.imdb_id) {
            ratingData.movies[0].ids.imdb = movie.imdb_id;
        }
        if (movie.trakt_id) {
            ratingData.movies[0].ids.trakt = movie.trakt_id;
        }

        log('Rating movie:', movie.title, 'Rating:', rating);

        network.clear();
        network.native(
            CONFIG.API_URL + '/sync/ratings',
            function (response) {
                log('Rated!', response);
                Lampa.Noty.show('⭐ ' + (movie.title || movie.name) + ': ' + rating + '/10');
                if (callback) callback(true);
            },
            function (error) {
                log('Rating error', error);
                Lampa.Noty.show('Ошибка при добавлении оценки');
                if (callback) callback(false);
            },
            JSON.stringify(ratingData),
            {
                method: 'POST',
                headers: getHeaders()
            }
        );
    }

    // ========================================
    // КОММЕНТАРИИ
    // ========================================

    function showCommentDialog(movie, callback) {
        Lampa.Input.edit({
            title: 'Комментарий к "' + (movie.title || movie.name) + '"',
            value: '',
            free: true,
            nosave: true
        }, function (comment) {
            if (!comment || comment.trim().length < 5) {
                Lampa.Noty.show('Комментарий слишком короткий (минимум 5 символов)');
                return;
            }

            addComment(movie, comment, callback);
        });
    }

    function addComment(movie, comment, callback) {
        if (!isAuthorized()) {
            Lampa.Noty.show('Сначала войдите в Trakt');
            return;
        }

        var commentData = {
            movie: {
                ids: {}
            },
            comment: comment,
            spoiler: false
        };

        if (movie.id) {
            commentData.movie.ids.tmdb = movie.id;
        }
        if (movie.imdb_id) {
            commentData.movie.ids.imdb = movie.imdb_id;
        }
        if (movie.trakt_id) {
            commentData.movie.ids.trakt = movie.trakt_id;
        }

        log('Adding comment to:', movie.title);

        network.clear();
        network.native(
            CONFIG.API_URL + '/comments',
            function (response) {
                log('Comment added!', response);
                Lampa.Noty.show('💬 Комментарий добавлен!');
                if (callback) callback(true);
            },
            function (error) {
                log('Comment error', error);
                // Trakt требует VIP для комментариев, покажем альтернативу
                if (error && error.status === 401) {
                    Lampa.Noty.show('Для комментариев нужен Trakt VIP');
                } else {
                    Lampa.Noty.show('Ошибка при добавлении комментария');
                }
                if (callback) callback(false);
            },
            JSON.stringify(commentData),
            {
                method: 'POST',
                headers: getHeaders()
            }
        );
    }

    // ========================================
    // СТАТИСТИКА
    // ========================================

    function getStatistics(callback) {
        if (!isAuthorized()) {
            callback(null);
            return;
        }

        var year = new Date().getFullYear();
        var now = new Date();
        var dayOfYear = Math.floor((now - new Date(year, 0, 0)) / (1000 * 60 * 60 * 24));

        network.clear();
        network.silent(
            CONFIG.API_URL + '/users/me/stats',
            function (stats) {
                var result = {
                    total_watched: PluginData.watched_count,
                    goal: CONFIG.GOAL,
                    progress_percent: Math.round((PluginData.watched_count / CONFIG.GOAL) * 100),
                    days_passed: dayOfYear,
                    days_remaining: 365 - dayOfYear,
                    needed_per_day: Math.max(0, Math.ceil((CONFIG.GOAL - PluginData.watched_count) / (365 - dayOfYear))),
                    on_track: (PluginData.watched_count / dayOfYear) >= (CONFIG.GOAL / 365)
                };

                callback(result);
            },
            function (error) {
                log('Error getting stats', error);
                callback(null);
            },
            false,
            { headers: getHeaders() }
        );
    }

    // ========================================
    // UI КОМПОНЕНТЫ
    // ========================================

    function addStyles() {
        var css = '\
            .trakt365-auth-modal { text-align: center; padding: 2em; }\
            .trakt365-auth-title { font-size: 1.5em; margin-bottom: 1em; color: #fff; }\
            .trakt365-auth-step { font-size: 1.1em; margin: 0.5em 0; color: #aaa; }\
            .trakt365-auth-code { font-size: 2.5em; font-weight: bold; color: #ed1d24; margin: 0.5em 0; letter-spacing: 0.1em; }\
            .trakt365-auth-waiting { color: #888; margin: 1em 0; }\
            .trakt365-auth-cancel { background: #333; padding: 0.8em 2em; border-radius: 0.3em; margin-top: 1.5em; display: inline-block; }\
            .trakt365-auth-cancel.focus { background: #ed1d24; }\
            \
            .trakt365-progress { display: flex; align-items: center; gap: 1em; }\
            .trakt365-progress-bar { flex: 1; height: 0.5em; background: #333; border-radius: 0.25em; overflow: hidden; }\
            .trakt365-progress-fill { height: 100%; background: linear-gradient(90deg, #ed1d24, #ff6b6b); transition: width 0.3s; }\
            .trakt365-progress-text { color: #fff; font-weight: bold; min-width: 5em; text-align: right; }\
            \
            .trakt365-stats { padding: 1em; }\
            .trakt365-stats-row { display: flex; justify-content: space-between; padding: 0.5em 0; border-bottom: 1px solid #333; }\
            .trakt365-stats-label { color: #888; }\
            .trakt365-stats-value { color: #fff; font-weight: bold; }\
            .trakt365-on-track { color: #4caf50; }\
            .trakt365-behind { color: #ff5722; }\
            \
            .trakt365-history-header { padding: 1.5em; text-align: center; margin-bottom: 1em; background: linear-gradient(135deg, rgba(237,29,36,0.2), rgba(0,0,0,0.5)); border-radius: 0.5em; }\
            .trakt365-history-title { font-size: 1.5em; color: #fff; margin-bottom: 0.5em; }\
            .trakt365-history-progress { font-size: 1.2em; color: #ed1d24; font-weight: bold; margin-bottom: 0.8em; }\
            .trakt365-history-bar { height: 0.5em; background: #333; border-radius: 0.25em; overflow: hidden; }\
            .trakt365-history-fill { height: 100%; background: linear-gradient(90deg, #ed1d24, #ff6b6b); transition: width 0.3s; }\
            \
            .trakt365-month-header { font-size: 1.2em; color: #fff; padding: 1em 0 0.5em; margin-top: 1em; border-bottom: 2px solid #ed1d24; }\
            \
            .trakt365-movie-card { display: flex; padding: 1em; margin: 0.5em 0; background: #1a1a1a; border-radius: 0.5em; transition: all 0.2s; cursor: pointer; }\
            .trakt365-movie-card.focus { background: #ed1d24; transform: scale(1.02); }\
            .trakt365-movie-poster { width: 80px; height: 120px; flex-shrink: 0; margin-right: 1em; border-radius: 0.3em; overflow: hidden; background: #333; }\
            .trakt365-movie-poster img { width: 100%; height: 100%; object-fit: cover; }\
            .trakt365-movie-info { flex: 1; display: flex; flex-direction: column; justify-content: center; }\
            .trakt365-movie-title { font-size: 1.1em; color: #fff; font-weight: bold; margin-bottom: 0.3em; }\
            .trakt365-movie-year { color: #888; font-size: 0.9em; margin-bottom: 0.3em; }\
            .trakt365-movie-date { color: #aaa; font-size: 0.9em; margin-bottom: 0.3em; }\
            .trakt365-movie-rating { color: #ffc107; font-size: 0.9em; }\
        ';

        var style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function createSettingsComponent() {
        Lampa.SettingsApi.addParam({
            component: 'trakt365',
            param: {
                name: 'trakt365_auth',
                type: 'button',
                default: ''
            },
            field: {
                name: isAuthorized() ? 'Вы авторизованы (' + (PluginData.username || 'user') + ')' : 'Войти в Trakt.tv',
                description: isAuthorized() ? 'Нажмите чтобы выйти' : 'Авторизация через PIN код'
            },
            onChange: function () {
                if (isAuthorized()) {
                    // Выход
                    PluginData.access_token = '';
                    PluginData.refresh_token = '';
                    PluginData.username = '';
                    saveData();
                    Lampa.Noty.show('Вы вышли из Trakt');
                    Lampa.Settings.update();
                } else {
                    startAuth(function () {
                        Lampa.Settings.update();
                    });
                }
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'trakt365',
            param: {
                name: 'trakt365_progress',
                type: 'static'
            },
            field: {
                name: 'Прогресс: ' + PluginData.watched_count + '/' + CONFIG.GOAL,
                description: Math.round((PluginData.watched_count / CONFIG.GOAL) * 100) + '% выполнено'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'trakt365',
            param: {
                name: 'trakt365_random',
                type: 'button',
                default: ''
            },
            field: {
                name: '🎲 Случайный фильм',
                description: 'Выбрать случайный фильм из Watchlist'
            },
            onChange: function () {
                if (!isAuthorized()) {
                    Lampa.Noty.show('Сначала войдите в Trakt');
                    return;
                }

                getRandomFromWatchlist(function (movie) {
                    if (movie && movie.id) {
                        Lampa.Activity.push({
                            url: '',
                            title: 'Случайный фильм',
                            component: 'full',
                            id: movie.id,
                            method: 'movie',
                            card: movie
                        });
                    }
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'trakt365',
            param: {
                name: 'trakt365_random_lampa',
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

        Lampa.SettingsApi.addParam({
            component: 'trakt365',
            param: {
                name: 'trakt365_stats',
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

        Lampa.SettingsApi.addParam({
            component: 'trakt365',
            param: {
                name: 'trakt365_search',
                type: 'button',
                default: ''
            },
            field: {
                name: '🔍 Добавить вручную',
                description: 'Поиск и добавление фильма со сторонней площадки'
            },
            onChange: function () {
                showSearchModal();
            }
        });
    }

    function showStatistics() {
        getStatistics(function (stats) {
            if (!stats) {
                Lampa.Noty.show('Ошибка загрузки статистики');
                return;
            }

            var html = $('<div class="trakt365-stats"></div>');

            var rows = [
                { label: 'Просмотрено', value: stats.total_watched + ' / ' + stats.goal },
                { label: 'Прогресс', value: stats.progress_percent + '%' },
                { label: 'Дней прошло', value: stats.days_passed },
                { label: 'Дней осталось', value: stats.days_remaining },
                { label: 'Нужно в день', value: stats.needed_per_day + ' фильмов' },
                { label: 'Статус', value: stats.on_track ? '✓ В графике' : '⚠ Позади графика', class: stats.on_track ? 'trakt365-on-track' : 'trakt365-behind' }
            ];

            rows.forEach(function (row) {
                var rowHtml = $('<div class="trakt365-stats-row"></div>');
                rowHtml.append('<span class="trakt365-stats-label">' + row.label + '</span>');
                rowHtml.append('<span class="trakt365-stats-value ' + (row.class || '') + '">' + row.value + '</span>');
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

    // Добавить кнопки на страницу фильма
    function addMovieButton() {
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') {
                var card = e.data.movie;

                // Только для фильмов
                if (!card || card.number_of_seasons) return;

                var panel = e.object.activity.render().find('.full-start__buttons');

                // Кнопка "Trakt" (меню действий)
                var mainButton = $('<div class="full-start__button selector view--trakt365-menu">\
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">\
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>\
                    </svg>\
                    <span>Trakt</span>\
                </div>');

                mainButton.on('hover:enter', function () {
                    if (!isAuthorized()) {
                        Lampa.Noty.show('Сначала войдите в Trakt (Настройки → Trakt 365)');
                        return;
                    }

                    // Показываем меню с действиями
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
                                    showRatingDialog(card);
                                    break;
                                case 'comment':
                                    showCommentDialog(card);
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

                // Добавляем кнопку в панель
                e.object.activity.render().find('.view--torrent').after(mainButton);
            }
        });
    }

    // ========================================
    // ИНИЦИАЛИЗАЦИЯ
    // ========================================

    function initPlugin() {
        if (window.trakt365_initialized) return;
        window.trakt365_initialized = true;

        log('Initializing Trakt 365 Plugin v' + CONFIG.VERSION);

        // Загружаем сохранённые данные
        loadData();

        // Добавляем стили
        addStyles();

        // Добавляем локализацию
        Lampa.Lang.add({
            trakt365_title: {
                ru: 'Trakt 365',
                en: 'Trakt 365',
                uk: 'Trakt 365'
            },
            trakt365_menu: {
                ru: '365 Challenge',
                en: '365 Challenge',
                uk: '365 Challenge'
            }
        });

        // Создаём раздел настроек
        Lampa.SettingsApi.addComponent({
            component: 'trakt365',
            name: 'Trakt 365 🎬',
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

        // Если авторизованы - обновляем счётчик
        if (isAuthorized()) {
            getUserInfo();
        }

        log('Plugin initialized successfully!');
    }

    // ========================================
    // БОКОВОЕ МЕНЮ И ИСТОРИЯ
    // ========================================

    function addMenuButton() {
        // Добавляем кнопку в боковое меню
        var menu_item = $('<li class="menu__item selector" data-action="trakt365_history">\
            <div class="menu__ico">\
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">\
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>\
                </svg>\
            </div>\
            <div class="menu__text">365 Challenge</div>\
        </li>');

        menu_item.on('hover:enter', function () {
            if (!isAuthorized()) {
                Lampa.Noty.show('Сначала войдите в Trakt (Настройки → Trakt 365)');
                return;
            }

            Lampa.Activity.push({
                url: '',
                title: '365 Challenge',
                component: 'trakt365_history',
                page: 1
            });
        });

        // Добавляем после "Закладки" или в конец меню
        var bookmarks = $('.menu .menu__list').find('[data-action="favorite"]');
        if (bookmarks.length) {
            bookmarks.after(menu_item);
        } else {
            $('.menu .menu__list').append(menu_item);
        }
    }

    function registerHistoryComponent() {
        // Регистрируем компонент для отображения истории
        Lampa.Component.add('trakt365_history', function () {
            var scroll, items, active, last;

            this.create = function () {
                var _this = this;
                scroll = new Lampa.Scroll({ mask: true, over: true });
                items = [];

                this.activity.loader(true);

                getWatchedHistory(function (movies) {
                    _this.activity.loader(false);

                    if (movies.length === 0) {
                        var empty = $('<div class="empty-box"><div class="empty-box__title">Нет просмотренных фильмов</div><div class="empty-box__descr">Добавьте фильмы через кнопку Trakt на странице любого фильма</div></div>');
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

                // Добавляем заголовок с прогрессом
                var yearMovies = movies.filter(function (m) {
                    return new Date(m.watched_at).getFullYear() === year;
                });

                var header = $('<div class="trakt365-history-header">\
                    <div class="trakt365-history-title">🎬 365 Challenge ' + year + '</div>\
                    <div class="trakt365-history-progress">' + yearMovies.length + ' / ' + CONFIG.GOAL + ' фильмов</div>\
                    <div class="trakt365-history-bar"><div class="trakt365-history-fill" style="width: ' + Math.min(100, (yearMovies.length / CONFIG.GOAL) * 100) + '%"></div></div>\
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

                // Сортируем месяцы по убыванию
                var sortedKeys = Object.keys(grouped).sort().reverse();

                sortedKeys.forEach(function (key) {
                    var group = grouped[key];

                    // Заголовок месяца
                    var monthHeader = $('<div class="trakt365-month-header">' + group.name + ' (' + group.movies.length + ')</div>');
                    scroll.append(monthHeader);

                    // Фильмы месяца
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

                var card = $('<div class="trakt365-movie-card selector" data-id="' + movie.tmdb_id + '">\
                    <div class="trakt365-movie-poster">\
                        <img src="' + (movie.poster || '') + '" />\
                    </div>\
                    <div class="trakt365-movie-info">\
                        <div class="trakt365-movie-title">' + movie.title + '</div>\
                        <div class="trakt365-movie-year">' + (movie.year || '') + '</div>\
                        <div class="trakt365-movie-date">📅 ' + formatDate(new Date(movie.watched_at)) + '</div>\
                        ' + (movie.rating ? '<div class="trakt365-movie-rating">⭐ ' + movie.rating + '/10 ' + stars + '</div>' : '') + '\
                    </div>\
                </div>');

                card.on('hover:enter', function () {
                    if (movie.tmdb_id) {
                        Lampa.Activity.push({
                            url: '',
                            title: movie.title,
                            component: 'full',
                            id: movie.tmdb_id,
                            method: 'movie'
                        });
                    }
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
            this.destroy = function () {
                scroll.destroy();
                items = null;
            };
        });
    }

    function getWatchedHistory(callback) {
        if (!isAuthorized()) {
            callback([]);
            return;
        }

        // Получаем историю просмотров
        network.clear();
        network.silent(
            CONFIG.API_URL + '/users/me/history/movies?limit=500',
            function (history) {
                // Получаем оценки
                network.silent(
                    CONFIG.API_URL + '/users/me/ratings/movies',
                    function (ratings) {
                        var ratingMap = {};
                        if (Array.isArray(ratings)) {
                            ratings.forEach(function (r) {
                                if (r.movie && r.movie.ids) {
                                    ratingMap[r.movie.ids.trakt] = r.rating;
                                }
                            });
                        }

                        var movies = [];
                        var seen = {};

                        if (Array.isArray(history)) {
                            history.forEach(function (item) {
                                if (item.movie && item.movie.ids) {
                                    var traktId = item.movie.ids.trakt;

                                    // Уникальные записи по дате
                                    var key = traktId + '_' + item.watched_at.split('T')[0];
                                    if (seen[key]) return;
                                    seen[key] = true;

                                    movies.push({
                                        title: item.movie.title,
                                        year: item.movie.year,
                                        tmdb_id: item.movie.ids.tmdb,
                                        trakt_id: traktId,
                                        watched_at: item.watched_at,
                                        rating: ratingMap[traktId] || null,
                                        poster: item.movie.ids.tmdb ? 'https://image.tmdb.org/t/p/w200/' : ''
                                    });
                                }
                            });
                        }

                        // Получаем постеры через TMDB (если нужно)
                        fetchPosters(movies, callback);
                    },
                    function (error) {
                        log('Error getting ratings', error);
                        callback([]);
                    },
                    false,
                    { headers: getHeaders() }
                );
            },
            function (error) {
                log('Error getting history', error);
                callback([]);
            },
            false,
            { headers: getHeaders() }
        );
    }

    function fetchPosters(movies, callback) {
        // Упрощённо - используем TMDB URL напрямую
        // В реальности нужен TMDB API, но Lampa уже имеет это
        movies.forEach(function (movie) {
            if (movie.tmdb_id) {
                movie.poster = 'https://image.tmdb.org/t/p/w200/' + movie.tmdb_id;
            }
        });

        callback(movies);
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
