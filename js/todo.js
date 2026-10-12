// 테마. 색 변수는 css의 :root 기본값을 덮어씁니다.
const THEMES = {
    sprout: {
        vars: { '--bg': '#D7ECD9', '--surface': '#F6FBF6', '--text': '#1E2A22', '--sub': '#5B6F61', '--accent': '#5CC98F', '--accent-text': '#10291C', '--line': '#0000001f', '--overlay': '#00000022' },
        meta_color: '#D7ECD9',
    },
    partynote: {
        vars: { '--bg': '#FFCCBC', '--surface': '#FFF4EF', '--text': '#2B1D1A', '--sub': '#7A5A52', '--accent': '#FF8A80', '--accent-text': '#2B1D1A', '--line': '#0000001f', '--overlay': '#00000026' },
        meta_color: '#FFCCBC',
    },
    cryptic: {
        vars: { '--bg': '#0D1117', '--surface': '#161B22', '--text': '#E6EDF3', '--sub': '#8B949E', '--accent': '#00D9FF', '--accent-text': '#0D1117', '--line': '#ffffff1f', '--overlay': '#00000066' },
        meta_color: '#0D1117',
    },
}

// 목록에 들어가는 두 종류
const ITEM_TYPES = {
    project: { label: '프로젝트', icon: 'fas fa-tasks' },
    memo: { label: '메모', icon: 'far fa-sticky-note' },
}

// 프로젝트 안의 두 칸
const SECTIONS = {
    now: { label: '할 일', placeholder: '할 일 추가' },
    next: { label: '다음 할 일', placeholder: '다음 할 일 추가' },
}

// 프로젝트 상태. order: 목록에서 진행 중 → 완료 → 중단 순으로
const PROJECT_STATUS = {
    active: { order: 0 },
    done: { order: 1, label: '완료한 프로젝트', icon: 'fas fa-trophy' },
    stopped: { order: 2, label: '중단한 프로젝트', icon: 'fas fa-pause' },
}
function statusOf(item) {
    return item.type === 'project' && ['done', 'stopped'].includes(item.status) ? item.status : 'active'
}

// 기기에 남기는 화면 설정 (테마, 마지막으로 보던 탭)
const todo_config = (() => {
    const KEY = 'pjtd_config'
    const defaults = { app_theme: 'sprout', tab: 'all' }
    let data = { ...defaults }
    try { data = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch (e) { }
    return {
        get: (key) => data[key],
        set: (key, value) => {
            data[key] = value
            try { localStorage.setItem(KEY, JSON.stringify(data)) } catch (e) { }
        },
    }
})()

function newUid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 기기 현지 날짜 YYYY-MM-DD
function dateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// '2026-10-12' → '10/12' (올해가 아니면 '2025/10/12')
function dateLabel(key) {
    const [y, m, d] = String(key).split('-').map(Number)
    const short = `${m}/${d}`
    return y === new Date().getFullYear() ? short : `${y}/${short}`
}

// 시각 → '2026년 10월 12일'
function fullDate(time) {
    const d = new Date(time)
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

// 시작한 날부터 오늘까지의 기간: '12일째', '3개월 5일째', '1년 2개월째' (시작한 날이 1일째)
function periodLabel(from, to = Date.now()) {
    const a = new Date(from), b = new Date(to)
    let months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth()
    let days = b.getDate() - a.getDate()
    if (days < 0) {
        months--
        // 지난달의 같은 날짜부터 센 날 수 (31일에 시작했는데 지난달이 28일까지면 28일부터)
        const prev_days = new Date(b.getFullYear(), b.getMonth(), 0).getDate()
        days = prev_days - Math.min(a.getDate(), prev_days) + b.getDate()
    }
    if (months <= 0) return `${Math.max(days, 0) + 1}일째`
    const parts = []
    if (months >= 12) parts.push(`${Math.floor(months / 12)}년`)
    if (months % 12) parts.push(`${months % 12}개월`)
    if (days) parts.push(`${days}일`)
    return `${parts.join(' ')}째`
}

class Projectodo {
    items = []          // 저장된 기록 전부 (메모 + 프로젝트)
    tab = 'all'         // all | project | memo
    q = ''              // 검색어
    open_id = null      // 지금 팝업에 열려 있는 기록
    show_next = false   // 다음 할 일이 없어도 그 칸을 펼쳐 둘지 (적어 두기 버튼을 눌렀을 때)
    memo_base = null    // 메모 편집을 시작할 때의 값 (바뀌었는지 비교용)

    async init() {
        this.applyTheme(todo_config.get('app_theme'))
        this.tab = ['all', 'project', 'memo'].includes(todo_config.get('tab')) ? todo_config.get('tab') : 'all'
        await idb.openDatabase()
        this.items = await idb.doSelectAll('item')
        this.render()
    }

    applyTheme(name) {
        if (!THEMES[name]) name = 'sprout'
        const theme = THEMES[name]
        Object.entries(theme.vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v))
        $('meta[name="theme-color"]').setAttribute('content', theme.meta_color)
        document.documentElement.dataset.theme = name
        $$('input[name="app_theme"]').forEach(el => el.checked = el.value === name)
    }

    find(id) {
        return this.items.find(i => i.id === id)
    }

    // 고친 기록을 저장하고 목록을 다시 그립니다.
    async save(item) {
        item.updated_at = Date.now()
        await idb.doUpdate('item', item.id, item)
        this.render()
    }

    async insert(values) {
        const now = Date.now()
        const item = { ...idb.newRecord('item'), uid: newUid(), created_at: now, updated_at: now, ...values }
        item.id = await idb.doInsert('item', item)
        this.items.push(item)
        this.render()
        return item
    }

    async remove(id) {
        await idb.doDelete('item', id)
        this.items = this.items.filter(i => i.id !== id)
        this.render()
    }

    /* ---------- 목록 ---------- */
    setTab(tab) {
        this.tab = tab
        todo_config.set('tab', tab)
        this.render()
    }

    render() {
        // 검색 중이면 탭의 개수도 검색 결과 기준
        const found = this.items.filter(i => this.matches(i))
        const count = (type) => found.filter(i => i.type === type).length
        const tabs = [
            { value: 'all', label: '전체', icon: 'fas fa-layer-group', count: found.length },
            { value: 'project', ...ITEM_TYPES.project, count: count('project') },
            { value: 'memo', ...ITEM_TYPES.memo, count: count('memo') },
        ]
        $('.type-tabs').innerHTML = tabs.map(t => `
            <button type="button" role="tab" data-tab="${t.value}" aria-selected="${this.tab === t.value}">
                <i class="${t.icon}"></i> ${t.label} <span class="count">${t.count}</span>
            </button>`).join('')

        const list = found
            .filter(i => this.tab === 'all' || i.type === this.tab)
            .sort((a, b) => PROJECT_STATUS[statusOf(a)].order - PROJECT_STATUS[statusOf(b)].order || b.updated_at - a.updated_at)
        const el = $('.item-list')
        if (!list.length && this.q.trim()) {
            el.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>'${esc(this.q.trim())}'에 맞는 것이 없어요.</p>
                </div>`
            return
        }
        if (!list.length) {
            const what = this.tab === 'memo' ? '메모가' : this.tab === 'project' ? '프로젝트가' : '적어 둔 것이'
            el.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-seedling"></i>
                    <p>아직 ${what} 없어요.</p>
                    <div class="empty-btns">
                        ${this.tab !== 'memo' ? `<button type="button" class="btn primary" data-action="new-project"><i class="${ITEM_TYPES.project.icon}"></i> 프로젝트 만들기</button>` : ''}
                        ${this.tab !== 'project' ? `<button type="button" class="btn ghost" data-action="new-memo"><i class="${ITEM_TYPES.memo.icon}"></i> 메모 쓰기</button>` : ''}
                    </div>
                </div>`
            return
        }
        el.innerHTML = list.map(i => i.type === 'project' ? this.projectRowHtml(i) : this.memoRowHtml(i)).join('')
    }

    // 검색: 띄어 쓴 낱말이 모두 들어 있어야 함 (제목, 메모 내용, 할 일, 히스토리)
    matches(item) {
        const words = this.q.toLowerCase().split(/\s+/).filter(Boolean)
        if (!words.length) return true
        const text = [
            item.title,
            item.content,
            ...item.todos.map(t => t.text),
            ...item.history.flatMap(h => h.items.map(i => i.text)),
        ].join('\n').toLowerCase()
        return words.every(w => text.includes(w))
    }

    projectRowHtml(p) {
        const now = p.todos.filter(t => t.section === 'now')
        const done = now.filter(t => t.done).length
        const next = p.todos.length - now.length
        const parts = [now.length ? `할 일 ${done}/${now.length}` : '지금 당장은 할 일이 없어요']
        if (next) parts.push(`다음 ${next}`)
        if (p.history.length) parts.push(`끝낸 날 ${p.history.length}`)
        const percent = now.length ? Math.round(done / now.length * 100) : 0
        const status = statusOf(p)
        const closed = PROJECT_STATUS[status].label // 완료·중단한 프로젝트는 할 일 요약 대신 상태를 보여 줌
        return `
            <div class="item-row project" data-id="${p.id}" data-status="${status}" tabindex="0" role="button">
                <i class="item-icon ${closed ? PROJECT_STATUS[status].icon : ITEM_TYPES.project.icon}"></i>
                <div class="item-body">
                    <div class="item-title">${esc(p.title)}</div>
                    <div class="item-sub">${closed ? `${closed} · ${esc(dateLabel(dateKey(new Date(p.status_at))))}` : parts.join(' · ')}</div>
                    ${now.length && !closed ? `<div class="progress" aria-hidden="true"><span style="width:${percent}%"></span></div>` : ''}
                </div>
                <i class="item-arrow fas fa-chevron-right"></i>
            </div>`
    }

    memoRowHtml(m) {
        return `
            <div class="item-row memo" data-id="${m.id}" tabindex="0" role="button">
                <i class="item-icon ${ITEM_TYPES.memo.icon}"></i>
                <div class="item-body">
                    <div class="item-title">${esc(m.title)}</div>
                    ${m.content.trim() ? `<div class="item-sub clip">${esc(m.content.trim().split('\n')[0])}</div>` : ''}
                </div>
                <i class="item-arrow fas fa-chevron-right"></i>
            </div>`
    }

    open(id) {
        const item = this.find(id)
        if (!item) return
        if (item.type === 'project') this.openProject(id)
        else this.openMemo(id)
    }

    // + 버튼: 무엇을 만들지 고르기
    async openNew() {
        const choice = await ui.openSheet({
            title: '새로 만들기',
            content: `
                <div class="sheet-options">
                    <button type="button" class="sheet-option" data-sheet-value="project"><i class="${ITEM_TYPES.project.icon}"></i> 프로젝트 투두</button>
                    <button type="button" class="sheet-option" data-sheet-value="memo"><i class="${ITEM_TYPES.memo.icon}"></i> 메모</button>
                </div>`,
        })
        if (choice === 'project') this.newProject()
        if (choice === 'memo') this.editMemo(null)
    }

    /* ---------- 프로젝트 ---------- */
    async newProject() {
        const title = await ui.prompt('새 프로젝트의 이름을 적어 주세요.', { placeholder: '프로젝트명', ok: '만들기', maxlength: 60 })
        if (!title) return
        const project = await this.insert({ type: 'project', title })
        this.openProject(project.id, 'now')
    }

    openProject(id, focus = null) {
        const p = this.find(id)
        if (!p) return
        this.open_id = id
        this.show_next = false
        ui.openPopup({
            title: '',
            actions: `
                <button type="button" class="icon-btn" data-action="project-info" aria-label="프로젝트 정보"><i class="fas fa-info-circle"></i></button>
                <button type="button" class="icon-btn" data-action="project-rename" aria-label="프로젝트명 고치기"><i class="fas fa-pen"></i></button>
                <button type="button" class="icon-btn" data-action="project-delete" aria-label="프로젝트 삭제"><i class="far fa-trash-alt"></i></button>`,
            content: `<div class="project-detail"></div>`,
        })
        this.renderProject(focus)
    }

    // 열려 있는 프로젝트의 내용만 다시 그립니다. (스크롤 위치는 그대로)
    // focus: 다시 그린 뒤 커서를 둘 입력칸 (now | next)
    renderProject(focus = null) {
        const p = this.find(this.open_id)
        const el = $('.project-detail')
        if (!p || !el) return
        $('.popup-header .title').innerHTML = `<i class="${ITEM_TYPES.project.icon}"></i> ${esc(p.title)}`

        const now = p.todos.filter(t => t.section === 'now')
        const next = p.todos.filter(t => t.section === 'next')
        const all_done = now.length > 0 && now.every(t => t.done)
        const history = [...p.history].sort((a, b) => b.date.localeCompare(a.date))

        const status = statusOf(p)
        el.dataset.status = status
        el.innerHTML = `
            ${status !== 'active' ? `
                <div class="status-banner">
                    <i class="${PROJECT_STATUS[status].icon}"></i>
                    <span>${PROJECT_STATUS[status].label}예요 · ${esc(fullDate(p.status_at))}</span>
                </div>` : ''}
            ${this.sectionHtml('now', now, all_done)}
            ${next.length || this.show_next
                ? this.sectionHtml('next', next)
                : `<button type="button" class="text-btn show-next" data-show-next><i class="fas fa-plus"></i> 다음 할 일 적어 두기</button>`}
            ${history.length ? `
                <div class="history">
                    <button type="button" class="text-btn history-clear" data-history-clear><i class="far fa-trash-alt"></i> 지난 히스토리 비우기</button>
                    ${history.map(day => `
                        <section class="todo-section past">
                            <div class="todo-head">
                                <h4>지난 히스토리 (${esc(dateLabel(day.date))})</h4>
                                <button type="button" class="icon-btn" data-history-more="${esc(day.date)}" aria-label="${esc(dateLabel(day.date))} 기록 더 보기"><i class="fas fa-ellipsis-h"></i></button>
                            </div>
                            <ul class="todo-list">
                                ${day.items.map(item => `
                                    <li class="todo done">
                                        <div class="todo-item"><span class="check"><i class="fas fa-check"></i></span><span class="todo-text">${esc(item.text)}</span></div>
                                    </li>`).join('')}
                            </ul>
                        </section>`).join('')}
                </div>` : ''}`
        if (focus) $(`.todo-input[data-section="${focus}"]`, el)?.focus()
    }

    sectionHtml(section, todos, all_done = false) {
        const info = SECTIONS[section]
        const done = todos.filter(t => t.done).length
        return `
            <section class="todo-section" data-section="${section}">
                <div class="todo-head">
                    <h4>${info.label}</h4>
                    ${todos.length ? `<span class="todo-count">${done}/${todos.length}</span>` : ''}
                </div>
                ${todos.length ? `
                    <ul class="todo-list">
                        ${todos.map(t => `
                            <li class="todo ${t.done ? 'done' : ''}">
                                <button type="button" class="todo-item" data-todo-toggle="${esc(t.id)}" aria-pressed="${!!t.done}">
                                    <span class="check"><i class="fas fa-check"></i></span><span class="todo-text">${esc(t.text)}</span>
                                </button>
                                <button type="button" class="icon-btn" data-todo-more="${esc(t.id)}" aria-label="더 보기"><i class="fas fa-ellipsis-h"></i></button>
                            </li>`).join('')}
                    </ul>` : section === 'now' ? `<p class="todo-empty">지금 당장은 할 일이 없어요</p>` : ''}
                ${all_done ? `
                    <div class="todo-finish">
                        <span>모두 끝냈어요! 🎉</span>
                        <button type="button" class="btn primary" data-todo-finish><i class="fas fa-flag-checkered"></i> 히스토리에 남기기</button>
                    </div>` : ''}
                <div class="todo-add">
                    <input type="text" class="todo-input" data-section="${section}" placeholder="${info.placeholder}" maxlength="200" enterkeyhint="done" autocomplete="off">
                    <button type="button" class="icon-btn solid" data-todo-add="${section}" aria-label="${info.placeholder}"><i class="fas fa-plus"></i></button>
                </div>
            </section>`
    }

    async addTodo(section) {
        const p = this.find(this.open_id)
        const input = $(`.todo-input[data-section="${section}"]`)
        if (!p || !input) return
        const text = input.value.trim()
        if (!text) return input.focus()
        p.todos.push({ id: newUid(), text, done: false, section })
        p.last_todo_at = Date.now()
        await this.save(p)
        this.renderProject(section) // 이어서 바로 적을 수 있게
    }

    async toggleTodo(todo_id) {
        const p = this.find(this.open_id)
        const todo = p?.todos.find(t => t.id === todo_id)
        if (!todo) return
        todo.done = !todo.done
        if (todo.done && !p.first_done_at) p.first_done_at = Date.now()
        await this.save(p)
        this.renderProject()
    }

    // 할 일 한 줄의 … 버튼: 고치기 / 칸 옮기기 / 삭제
    async openTodoMenu(todo_id) {
        const p = this.find(this.open_id)
        const todo = p?.todos.find(t => t.id === todo_id)
        if (!todo) return
        const move = todo.section === 'now'
            ? `<button type="button" class="sheet-option" data-sheet-value="move"><i class="fas fa-arrow-down"></i> 다음 할 일로 미루기</button>`
            : `<button type="button" class="sheet-option" data-sheet-value="move"><i class="fas fa-arrow-up"></i> 지금 할 일로 올리기</button>`
        const choice = await ui.openSheet({
            title: todo.text,
            content: `
                <div class="sheet-options">
                    <button type="button" class="sheet-option" data-sheet-value="edit"><i class="fas fa-pen"></i> 글 고치기</button>
                    ${move}
                    <button type="button" class="sheet-option danger" data-sheet-value="delete"><i class="far fa-trash-alt"></i> 삭제</button>
                </div>`,
        })
        if (choice === 'edit') {
            const text = await ui.prompt('할 일을 고쳐 주세요.', { value: todo.text, ok: '저장' })
            if (!text || text === todo.text) return
            todo.text = text
        } else if (choice === 'move') {
            // 옮겨 간 칸의 맨 아래로
            todo.section = todo.section === 'now' ? 'next' : 'now'
            p.todos = [...p.todos.filter(t => t !== todo), todo]
        } else if (choice === 'delete') {
            p.todos = p.todos.filter(t => t !== todo)
        } else {
            return
        }
        await this.save(p)
        this.renderProject()
    }

    // 할 일을 모두 끝냈을 때: 체크한 것들을 오늘 날짜의 히스토리로 보내고, 다음 할 일을 할 일로 올립니다.
    async finishTodos() {
        const p = this.find(this.open_id)
        if (!p) return
        const done = p.todos.filter(t => t.done)
        if (!done.length) return
        const today = dateKey()
        let day = p.history.find(h => h.date === today)
        if (!day) {
            day = { date: today, items: [] }
            p.history.push(day)
        }
        day.items.push(...done.map(t => ({ text: t.text })))
        p.todos = p.todos.filter(t => !t.done).map(t => ({ ...t, section: 'now' }))
        this.show_next = false
        await this.save(p)
        this.renderProject()
        ui.toast('히스토리에 남겼어요. 수고했어요!')
    }

    // 히스토리 한 날의 … 버튼: 되돌리기 / 삭제
    async openHistoryMenu(date) {
        const p = this.find(this.open_id)
        const day = p?.history.find(h => h.date === date)
        if (!day) return
        const choice = await ui.openSheet({
            title: `지난 히스토리 (${dateLabel(date)})`,
            content: `
                <div class="sheet-options">
                    <button type="button" class="sheet-option" data-sheet-value="restore"><i class="fas fa-undo"></i> 할 일로 되돌리기</button>
                    <button type="button" class="sheet-option danger" data-sheet-value="delete"><i class="far fa-trash-alt"></i> 이 날의 기록 삭제</button>
                </div>`,
        })
        if (choice === 'restore') {
            // 끝낸 상태 그대로 할 일 맨 위에 돌려놓음 (체크를 풀어서 다시 할 수 있음)
            const restored = day.items.map(item => ({ id: newUid(), text: item.text, done: true, section: 'now' }))
            p.todos = [...restored, ...p.todos]
        } else if (choice === 'delete') {
            const ok = await ui.confirm(`${dateLabel(date)}의 기록 ${day.items.length}개를 지울까요?`, { ok: '삭제', danger: true })
            if (!ok) return
        } else {
            return
        }
        p.history = p.history.filter(h => h !== day)
        await this.save(p)
        this.renderProject()
    }

    // 프로젝트 정보: 언제 만들었고 얼마나 해 왔는지
    async openProjectInfo() {
        const p = this.find(this.open_id)
        if (!p) return
        const status = statusOf(p)
        const end = status === 'active' ? Date.now() : p.status_at // 완료·중단했으면 기간도 거기서 멈춤
        const total_days = Math.round((new Date(dateKey(new Date(end))) - new Date(dateKey(new Date(p.created_at)))) / 86400000) + 1
        const period = `${periodLabel(p.created_at, end)}${total_days > 31 ? ` (${total_days}일)` : ''}`
        const done_count = p.history.reduce((sum, h) => sum + h.items.length, 0) + p.todos.filter(t => t.done).length
        const rows = [
            ['far fa-calendar-plus', '처음 만든 날', fullDate(p.created_at)],
            ['fas fa-flag', '첫 할 일을 끝낸 날', p.first_done_at ? fullDate(p.first_done_at) : '아직 없어요'],
            ['fas fa-hourglass-half', status === 'active' ? '진행해 온 기간' : '진행한 기간', status === 'active' ? period : period.replace('째', '')],
            ['fas fa-pen', '마지막으로 할 일을 적은 날', p.last_todo_at ? fullDate(p.last_todo_at) : '아직 없어요'],
            ['fas fa-check-double', '지금까지 끝낸 할 일', `${done_count}개`],
        ]
        if (status !== 'active') rows.push([PROJECT_STATUS[status].icon, status === 'done' ? '완료한 날' : '중단한 날', fullDate(p.status_at)])
        const choice = await ui.openSheet({
            title: p.title,
            content: `
                <dl class="info-list">
                    ${rows.map(([icon, label, value]) => `<div><dt><i class="${icon}"></i> ${label}</dt><dd>${esc(value)}</dd></div>`).join('')}
                </dl>
                <div class="status-actions">
                    ${status === 'active' ? `
                        <button type="button" class="status-btn done" data-sheet-value="done">
                            <b><i class="fas fa-trophy"></i> 프로젝트 완료하기</b>
                            <span>정말 프로젝트를 완전히 끝냈을 때</span>
                        </button>
                        <button type="button" class="status-btn stopped" data-sheet-value="stopped">
                            <b><i class="fas fa-pause"></i> 프로젝트 중단하기</b>
                            <span>불가피한 일로 중지하거나 포기해야 할 때</span>
                        </button>` : `
                        <button type="button" class="status-btn" data-sheet-value="active">
                            <b><i class="fas fa-play"></i> 프로젝트 재개하기</b>
                            <span>${status === 'done' ? '완료' : '중단'}를 취소하고 진행 중으로 되돌려요</span>
                        </button>`}
                </div>`,
        })
        if (choice) this.setProjectStatus(choice)
    }

    // 완료(폭죽) / 중단 / 재개
    async setProjectStatus(status) {
        const p = this.find(this.open_id)
        if (!p || !PROJECT_STATUS[status] || statusOf(p) === status) return
        p.status = status
        p.status_at = status === 'active' ? 0 : Date.now()
        await this.save(p)
        this.renderProject()
        $('.popup-content').scrollTop = 0 // 맨 위의 상태 띠가 보이게
        if (status === 'done') {
            this.burstConfetti()
            ui.toast('프로젝트 완료! 정말 수고했어요 🎉')
        } else {
            ui.toast(status === 'stopped' ? '프로젝트를 중단했어요' : '프로젝트를 재개했어요')
        }
    }

    // 폭죽 조각을 화면 가운데에서 사방으로 터뜨립니다. (기기의 '동작 줄이기' 설정과 상관없이)
    burstConfetti() {
        const colors = ['#FFD54F', '#FF8A80', '#80D8FF', '#B9F6CA', '#EA80FC', '#FFAB40', '#FFF59D', '#82B1FF']
        const layer = document.createElement('div')
        layer.className = 'confetti-layer'
        for (let i = 0; i < 72; i++) {
            const piece = document.createElement('i')
            const angle = Math.random() * Math.PI * 2
            const dist = 90 + Math.random() * 220
            piece.className = 'confetti'
            piece.style.setProperty('--x', `${Math.cos(angle) * dist}px`)
            piece.style.setProperty('--y', `${Math.sin(angle) * dist - 80}px`)
            piece.style.setProperty('--r', `${Math.random() * 720 - 360}deg`)
            piece.style.setProperty('--d', `${800 + Math.random() * 700}ms`)
            piece.style.background = colors[i % colors.length]
            if (i % 3 === 0) piece.style.borderRadius = '50%'
            layer.appendChild(piece)
        }
        document.body.appendChild(layer)
        setTimeout(() => layer.remove(), 1700)
    }

    // 지난 히스토리를 한꺼번에 비우기 (할 일·다음 할 일은 그대로)
    async clearHistory() {
        const p = this.find(this.open_id)
        if (!p?.history.length) return
        const count = p.history.reduce((sum, h) => sum + h.items.length, 0)
        const ok = await ui.confirm(`지난 히스토리 ${p.history.length}일치(${count}개)를 모두 지울까요?\n되돌릴 수 없어요.`, { ok: '비우기', danger: true })
        if (!ok) return
        p.history = []
        await this.save(p)
        this.renderProject()
        ui.toast('지난 히스토리를 비웠어요')
    }

    async renameProject() {
        const p = this.find(this.open_id)
        if (!p) return
        const title = await ui.prompt('프로젝트명을 고쳐 주세요.', { value: p.title, ok: '저장', maxlength: 60 })
        if (!title || title === p.title) return
        p.title = title
        await this.save(p)
        this.renderProject()
    }

    async deleteOpenItem() {
        const item = this.find(this.open_id)
        if (!item) return
        const label = ITEM_TYPES[item.type].label
        const ok = await ui.confirm(`'${item.title}' ${label}를 삭제할까요?\n되돌릴 수 없어요.`, { ok: '삭제', danger: true })
        if (!ok) return
        this.memo_base = null
        await this.remove(item.id)
        this.open_id = null
        ui.closePopup()
        ui.toast(`${label}를 삭제했어요`)
    }

    /* ---------- 메모 ---------- */
    openMemo(id) {
        const m = this.find(id)
        if (!m) return
        this.open_id = id
        this.memo_base = null
        ui.openPopup({
            title: `<i class="${ITEM_TYPES.memo.icon}"></i> ${esc(m.title)}`,
            actions: `
                <button type="button" class="icon-btn" data-action="memo-edit" aria-label="메모 고치기"><i class="fas fa-pen"></i></button>
                <button type="button" class="icon-btn" data-action="memo-delete" aria-label="메모 삭제"><i class="far fa-trash-alt"></i></button>`,
            content: `
                <div class="memo-view">
                    <h2 class="memo-title">${esc(m.title)}</h2>
                    ${m.content.trim() ? `<div class="memo-content">${linkify(m.content)}</div>` : `<p class="todo-empty">내용이 없어요</p>`}
                    <div class="memo-date">${esc(new Date(m.updated_at).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }))} 수정</div>
                </div>`,
        })
    }

    // id가 없으면 새 메모
    editMemo(id) {
        const m = id ? this.find(id) : null
        if (id && !m) return
        this.open_id = id
        this.memo_base = { title: m?.title || '', content: m?.content || '' }
        ui.openPopup({
            title: m ? '메모 고치기' : '메모 쓰기',
            content: `
                <form class="memo-editor" novalidate>
                    <input type="text" class="memo-title-input" placeholder="제목" maxlength="100" autocomplete="off" value="${esc(this.memo_base.title)}">
                    <textarea class="memo-content-input" rows="10" placeholder="내용">${esc(this.memo_base.content)}</textarea>
                    <div class="editor-btns">
                        <button type="button" class="btn ghost" data-action="memo-cancel">취소</button>
                        <button type="submit" class="btn primary"><i class="fas fa-check"></i> 저장</button>
                    </div>
                </form>`,
            // 쓰던 내용이 있으면 닫기 전에 묻습니다.
            before_close: async () => !this.memoChanged() || ui.confirm('쓰던 내용을 버릴까요?', { ok: '버리기', cancel: '계속 쓰기', danger: true }),
        })
        autoGrow($('.memo-content-input'))
        $(m ? '.memo-content-input' : '.memo-title-input').focus()
    }

    memoChanged() {
        const title = $('.memo-title-input'), content = $('.memo-content-input')
        if (!this.memo_base || !title || !content) return false
        return title.value !== this.memo_base.title || content.value !== this.memo_base.content
    }

    async saveMemo() {
        const content = $('.memo-content-input').value
        // 제목을 비우면 내용의 첫 줄을 제목으로
        const title = $('.memo-title-input').value.trim() || content.trim().split('\n')[0].slice(0, 100)
        if (!title) {
            ui.toast('제목이나 내용을 적어 주세요')
            return $('.memo-title-input').focus()
        }
        let m = this.open_id ? this.find(this.open_id) : null
        if (m) {
            m.title = title
            m.content = content
            await this.save(m)
        } else {
            m = await this.insert({ type: 'memo', title, content })
        }
        ui.toast('저장했어요')
        this.openMemo(m.id)
    }

    // 편집 취소: 고치던 메모면 조회 화면으로, 새 메모면 닫기
    async cancelMemoEdit() {
        if (!this.open_id) return ui.closePopup() // 닫기 전에 before_close가 물어봄
        if (this.memoChanged() && !(await ui.confirm('쓰던 내용을 버릴까요?', { ok: '버리기', cancel: '계속 쓰기', danger: true }))) return
        this.openMemo(this.open_id)
    }

    /* ---------- 백업 ---------- */
    exportBackup() {
        const payload = {
            app: APP_CONFIG.app_alias,
            version: APP_CONFIG.app_version,
            exported_at: new Date().toISOString(),
            items: this.items,
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `projectodo-${dateKey().replace(/-/g, '')}.json`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
        ui.toast(`${this.items.length}개를 내보냈어요`)
    }

    // 백업 파일의 기록 하나를 이 앱의 모양으로 다듬습니다. 못 쓰는 기록은 null.
    cleanImportedItem(raw) {
        if (!raw || typeof raw !== 'object') return null
        const text = (v, max) => (typeof v === 'string' ? v : '').slice(0, max)
        const time = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
        const type = raw.type === 'project' ? 'project' : raw.type === 'memo' ? 'memo' : null
        const title = text(raw.title, 100).trim()
        if (!type || !title) return null
        const item = {
            ...idb.newRecord('item'),
            uid: /^[a-z0-9]{6,40}$/.test(raw.uid) ? raw.uid : newUid(),
            type,
            title,
            created_at: time(raw.created_at),
            updated_at: time(raw.updated_at),
            status: ['done', 'stopped'].includes(raw.status) && type === 'project' ? raw.status : 'active',
            status_at: time(raw.status_at),
            first_done_at: time(raw.first_done_at),
            last_todo_at: time(raw.last_todo_at),
        }
        if (type === 'memo') {
            item.content = text(raw.content, 100000)
            return item
        }
        item.todos = (Array.isArray(raw.todos) ? raw.todos : [])
            .filter(t => t && typeof t.text === 'string' && t.text.trim())
            .map(t => ({ id: newUid(), text: t.text.trim().slice(0, 200), done: !!t.done, section: t.section === 'next' ? 'next' : 'now' }))
        item.history = (Array.isArray(raw.history) ? raw.history : [])
            .filter(h => h && /^\d{4}-\d{2}-\d{2}$/.test(h.date) && Array.isArray(h.items))
            .map(h => ({
                date: h.date,
                items: h.items.filter(i => i && typeof i.text === 'string' && i.text.trim()).map(i => ({ text: i.text.trim().slice(0, 200) })),
            }))
            .filter(h => h.items.length)
        return item
    }

    // 가져오기는 지금 있는 것에 합칩니다. 같은 기록(uid)이면 더 최근에 고친 쪽을 남깁니다.
    async importBackup(file) {
        let payload
        try {
            payload = JSON.parse(await file.text())
        } catch (e) {
            return ui.toast('백업 파일을 읽을 수 없어요')
        }
        if (payload?.app !== APP_CONFIG.app_alias || !Array.isArray(payload.items)) {
            return ui.toast('프로젝투두 백업 파일이 아니에요')
        }
        const incoming = payload.items.map(raw => this.cleanImportedItem(raw)).filter(Boolean)
        if (!incoming.length) return ui.toast('가져올 내용이 없어요')
        const ok = await ui.confirm(`백업의 ${incoming.length}개를 지금 목록에 합칠까요?\n같은 기록은 더 최근에 고친 쪽을 남겨요.`, { ok: '합치기' })
        if (!ok) return

        let added = 0, updated = 0
        for (const item of incoming) {
            const mine = this.items.find(i => i.uid === item.uid)
            if (!mine) {
                item.id = await idb.doInsert('item', item)
                this.items.push(item)
                added++
            } else if (item.updated_at > mine.updated_at) {
                Object.assign(mine, item, { id: mine.id })
                await idb.doUpdate('item', mine.id, mine)
                updated++
            }
        }
        this.render()
        ui.toast(added || updated ? `${added}개 추가, ${updated}개 갱신했어요` : '이미 모두 들어 있어요')
    }

    async deleteAll() {
        if (!this.items.length) return ui.toast('지울 것이 없어요')
        const ok = await ui.confirmTyped(`프로젝트와 메모 ${this.items.length}개를 모두 지워요.\n되돌릴 수 없어요.`, '정말로 전체 삭제')
        if (!ok) return
        await idb.doTruncate('item')
        this.items = []
        this.render()
        ui.setDrawer(false)
        ui.toast('모두 삭제했어요')
    }
}

const todo_app = new Projectodo()
