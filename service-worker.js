(() => {
    class ProjectodoWebCache {
        constructor() {
            // 앱 파일을 바꾸면 버전을 올려야 사용자 기기의 캐시가 갱신됩니다.
            this.STATIC_CACHE_NAME = 'projectodo_static_v0.13'
            this.DYNAMIC_CACHE_NAME = 'projectodo_dynamic_v0.13'
            this.STATIC_CACHE_LIST = [
                './',
                './index.html',
                './manifest.json',
                './config.js',
                './css/projectodo.css',
                './store/idb.js',
                './js/ui.js',
                './js/todo.js',
                './js/install.js',
                './js/init.js',
                './img/icons/icon-192.png',
                './img/icons/icon-512.png',
                './img/icons/favicon-32.png',
                './img/kofi_symbol.png',
                './lib/css/fontawesome5/all.min.css',
                './lib/css/webfonts/fa-solid-900.woff2',
                './lib/css/webfonts/fa-regular-400.woff2',
            ]
            this.init()
        }

        init() {
            self.addEventListener('install', this.staticCacheStrategy.bind(this))
            self.addEventListener('activate', this.deleteOldCache.bind(this))
            self.addEventListener('fetch', this.dynamicCacheStrategy.bind(this))
        }

        // 설치 시 앱 셸을 미리 캐시
        staticCacheStrategy(e) {
            e.waitUntil((async () => {
                const static_cache = await caches.open(this.STATIC_CACHE_NAME)
                // cache: 'reload' = 브라우저 보관함(HTTP 캐시)을 거치지 않고 서버에서 직접 받음.
                // 호스팅이 max-age=600으로 내려줘서, 그냥 받으면 배포 직후 옛 파일이 새 캐시에 들어가 버전이 안 올라감
                await static_cache.addAll(this.STATIC_CACHE_LIST.map(url => new Request(url, { cache: 'reload' })))
                await self.skipWaiting()
            })())
        }

        // 이전 버전 캐시 삭제
        deleteOldCache(e) {
            const cache_white_list = [this.STATIC_CACHE_NAME, this.DYNAMIC_CACHE_NAME]
            e.waitUntil((async () => {
                const cache_names = await caches.keys()
                await Promise.all(
                    cache_names
                        .filter(name => !cache_white_list.includes(name))
                        .map(name => caches.delete(name))
                )
                await self.clients.claim()
            })())
        }

        // 캐시 우선 + 백그라운드 갱신(stale-while-revalidate)
        // - 이 앱의 파일(같은 주소): 서버에 바뀌었는지 물어보고(no-cache), 바뀐 것은 실제로 쓰는 static 캐시에 덮어씀
        //   → 다음에 열 때 새 파일이 보임
        // - 바깥 파일(웹폰트 등): dynamic 캐시에 보관
        dynamicCacheStrategy(e) {
            if (e.request.method !== 'GET') return
            if (!e.request.url.startsWith('http')) return

            const is_app_file = new URL(e.request.url).origin === self.location.origin
            const is_page = e.request.mode === 'navigate'

            e.respondWith((async () => {
                const matched_response = await caches.match(e.request, { ignoreSearch: is_page })

                const network_fetch = fetch(e.request, is_app_file ? { cache: 'no-cache' } : undefined)
                    .then(async (fetched_response) => {
                        if (fetched_response && (fetched_response.ok || fetched_response.type === 'opaque')) {
                            const cache = await caches.open(is_app_file ? this.STATIC_CACHE_NAME : this.DYNAMIC_CACHE_NAME)
                            // 페이지는 주소 뒤 ?값이 달라도 같은 칸('./')에 저장
                            const key = is_page ? new URL('./', self.location.href).href : e.request
                            await cache.put(key, fetched_response.clone()).catch(() => {})
                        }
                        return fetched_response
                    })
                    .catch(() => null)

                if (matched_response) {
                    e.waitUntil(network_fetch)
                    return matched_response
                }

                const fetched_response = await network_fetch
                if (fetched_response) return fetched_response

                // 오프라인에서 페이지 이동이면 앱 셸로 대체
                if (is_page) {
                    return caches.match('./index.html')
                }
                return new Response('', { status: 504, statusText: 'offline' })
            })())
        }
    }

    new ProjectodoWebCache()
})()
