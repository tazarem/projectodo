/**
 * IndexedDB Client - Projectodo
 * 파티노트·레시피북의 IndexedDBClient 구조를 따릅니다.
 */
class IndexedDBClient {
    db
    DATABASE_NAME = APP_CONFIG.app_alias
    DATABASE_VERSION = 1
    TABLE_LIST = [
        {
            // 목록의 한 줄 = 기록 하나. 메모와 프로젝트를 같은 표에 두고 type으로 구분합니다.
            name: 'item',
            option: { keyPath: 'id', autoIncrement: true },
            indexes: [
                { name: 'type', params: 'type', unique: false },
                { name: 'updated_at', params: 'updated_at', unique: false },
            ],
            scheme: {
                uid: '',            // 기기와 상관없는 고유값 (백업을 합칠 때 같은 기록인지 알아보는 용도)
                type: 'memo',       // memo | project
                title: '',          // 메모 제목 / 프로젝트명
                content: '',        // 메모 내용 (프로젝트는 빈 값)
                // 아래 둘은 프로젝트 전용
                todos: [],          // [{ id, text, done, section }] section: now(할 일) | next(다음 할 일). 배열 순서 = 화면 순서
                history: [],        // [{ date: 'YYYY-MM-DD', items: [{ text }] }] 할 일을 모두 끝낸 날의 기록
                status: 'active',   // active(진행 중) | done(완료) | stopped(중단)
                status_at: 0,       // 완료·중단한 시각 (진행 중이면 0)
                first_done_at: 0,   // 처음으로 할 일을 끝낸(체크한) 시각. 한 번 정해지면 그대로 (0 = 아직 없음)
                last_todo_at: 0,    // 마지막으로 할 일을 적은 시각 (0 = 아직 없음)
                created_at: 0,
                updated_at: 0,
            }
        },
    ]

    openDatabase() {
        return new Promise((res, rej) => {
            const req = indexedDB.open(this.DATABASE_NAME, this.DATABASE_VERSION)

            req.onupgradeneeded = (e) => {
                this.db = e.target.result
                const transaction = e.target.transaction
                this.TABLE_LIST.forEach((table) => {
                    const store = this.db.objectStoreNames.contains(table.name)
                        ? transaction.objectStore(table.name)
                        : this.db.createObjectStore(table.name, table.option)
                    table.indexes.forEach((index) => {
                        if (!store.indexNames.contains(index.name)) {
                            store.createIndex(index.name, index.params, { unique: index.unique, multiEntry: !!index.multiEntry })
                        }
                    })
                })
            }
            req.onsuccess = (e) => {
                this.db = e.target.result
                // 다른 탭에서 새 버전으로 업그레이드하려 하면 이 연결을 닫고 새로고침합니다.
                this.db.onversionchange = () => {
                    this.db.close()
                    location.reload()
                }
                res(this.db)
            }
            req.onblocked = () => {
                console.log('indexedDB upgrade blocked: 다른 탭에 열린 프로젝투두가 있어요.')
            }
            req.onerror = (e) => rej(e)
        })
    }

    newRecord(table_name) {
        const table = this.TABLE_LIST.find(t => t.name === table_name)
        return structuredClone(table.scheme)
    }

    requestHandler(req) {
        return new Promise((res, rej) => {
            req.onsuccess = (e) => res(e.target.result)
            req.onerror = (e) => rej(e.target.error)
        })
    }

    store(table_name, mode = 'readonly') {
        return this.db.transaction([table_name], mode).objectStore(table_name)
    }

    doInsert(table_name, value) {
        const record = { ...value }
        delete record.id // autoIncrement 키를 받도록
        return this.requestHandler(this.store(table_name, 'readwrite').add(record))
    }

    doUpdate(table_name, id, value) {
        return this.requestHandler(this.store(table_name, 'readwrite').put({ ...value, id }))
    }

    doDelete(table_name, id) {
        return this.requestHandler(this.store(table_name, 'readwrite').delete(id))
    }

    doSelectOne(table_name, id) {
        return this.requestHandler(this.store(table_name).get(id))
    }

    doSelectAll(table_name) {
        return this.requestHandler(this.store(table_name).getAll())
    }

    doCountTotal(table_name) {
        return this.requestHandler(this.store(table_name).count())
    }

    doTruncate(table_name) {
        return this.requestHandler(this.store(table_name, 'readwrite').clear())
    }
}

const idb = new IndexedDBClient()
