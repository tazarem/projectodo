const $ = (selector, root = document) => root.querySelector(selector)
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)]

// 사용자가 입력한 문자열은 반드시 이걸 거쳐서 html에 넣습니다.
function esc(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

// 글 속의 http(s):// 주소를 링크로 바꿉니다. 나머지 글자는 모두 이스케이프합니다.
// - 주소 뒤에 붙은 한글("…com에서")과 끝 문장부호(. , ) 등)는 링크에서 뺍니다.
// - http/https로 확인된 주소만 링크가 되고, 누르면 이동 여부를 먼저 묻습니다(init.js).
function linkify(text) {
    const URL_PATTERN = /https?:\/\/[^\s<>"'\u3131-\u318E\uAC00-\uD7A3]+/g
    const src = String(text ?? '')
    let html = ''
    let last = 0
    for (const match of src.matchAll(URL_PATTERN)) {
        let url = match[0]
        const trail = url.match(/[.,!?;:)\]}]+$/)
        if (trail) url = url.slice(0, -trail[0].length)
        let valid = false
        try { valid = ['http:', 'https:'].includes(new URL(url).protocol) } catch (e) { }
        if (!valid) continue
        html += esc(src.slice(last, match.index))
        html += `<a class="ext-link" href="${esc(url)}" data-ext-link rel="noopener noreferrer" target="_blank">${esc(url)}</a>`
        last = match.index + url.length
    }
    return html + esc(src.slice(last))
}

// 글 길이만큼 textarea 높이를 맞춥니다. (rows 속성 높이보다 작아지지는 않음)
function autoGrow(textarea) {
    if (!textarea || !textarea.isConnected) return
    const style = getComputedStyle(textarea)
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
    // 높이를 잠깐 auto로 줄일 때 팝업 스크롤이 튀지 않게 위치를 지킵니다.
    const scroller = textarea.closest('.popup-content')
    const scroll_top = scroller ? scroller.scrollTop : 0
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight + border}px`
    if (scroller) scroller.scrollTop = scroll_top
}

class UIHandler {
    popup_open = false
    drawer = false
    before_close = null // 닫기 전에 확인할 함수 (편집 중 이탈 방지). false를 반환하면 닫지 않음
    own_backs = 0       // 우리가 직접 보낸 history.back() 중 아직 도착하지 않은 개수
    drawer_entry = false // 지금 열린 메뉴의 뒤로가기 기록이 실제로 쌓여 있는지
    popup_entry = false  // 지금 열린 팝업의 뒤로가기 기록이 실제로 쌓여 있는지
    sheet = null         // 아래에서 올라오는 선택창: { el, resolve, result, entry }

    constructor() {
        // 안드로이드 뒤로가기 / 브라우저 뒤로가기로 팝업, 메뉴를 닫습니다.
        window.addEventListener('popstate', async () => {
            // 우리가 직접 보낸 뒤로가기는 건너뜀 (늦게 도착해서 그새 다시 연 메뉴를 닫아 버리지 않게).
            // 그 사이에 메뉴를 다시 열었다면, 미뤄 둔 기록을 이제 쌓음 → 기록과 메뉴 상태가 어긋나지 않음
            if (this.own_backs > 0) {
                this.own_backs--
                if (this.own_backs === 0) this.pushDeferredEntries()
                return
            }
            // 맨 위에 떠 있는 것부터 닫음: 선택창 → 팝업 → 메뉴
            if (this.sheet) {
                this.sheet.entry = false
                this.hideSheet(null)
                return
            }
            if (this.popup_open) {
                this.popup_entry = false
                if (this.before_close && !(await this.before_close())) {
                    history.pushState({ layer: 'popup' }, '')
                    this.popup_entry = true
                    return
                }
                this.hidePopup()
            } else if (this.drawer) {
                this.setDrawer(false, true)
            }
        })
    }

    // 팝업 열기. 이미 열려 있으면 내용만 교체합니다.
    // variant: 팝업 모양 (''=기본)
    openPopup({ title = '', actions = '', content = '', before_close = null, variant = '' }) {
        $('.popup').dataset.variant = variant
        $('.popup-header .title').innerHTML = title
        $('.popup-header .actions').innerHTML = actions
        const content_el = $('.popup-content')
        content_el.innerHTML = content
        content_el.scrollTop = 0
        this.before_close = before_close

        if (!this.popup_open) {
            this.popup_open = true
            this.popup_entry = false
            this.pushDeferredEntries()
            $('.popup-overlay').classList.remove('hide')
            document.body.classList.add('no-scroll')
        }
    }

    // 닫기 버튼 → history.back() → popstate에서 실제로 닫힘
    async closePopup() {
        if (!this.popup_open) return
        if (this.popup_entry) return history.back()
        // 기록이 아직 안 쌓인 드문 경우(직전 뒤로가기가 도착하기 전): 바로 닫음
        if (this.before_close && !(await this.before_close())) return
        this.hidePopup()
    }

    // 열려 있는데 뒤로가기 기록이 아직 없는 것들의 기록을 쌓습니다. (아래에 깔린 것부터: 메뉴 → 팝업 → 선택창)
    // 우리가 보낸 뒤로가기가 아직 도착하지 않았으면 도착한 뒤(popstate)로 미룹니다.
    // → 빠르게 닫았다 열어도 기록과 화면 상태가 어긋나지 않음
    pushDeferredEntries() {
        if (this.own_backs > 0) return
        if (this.drawer && !this.drawer_entry) {
            history.pushState({ layer: 'drawer' }, '')
            this.drawer_entry = true
        }
        if (this.popup_open && !this.popup_entry) {
            history.pushState({ layer: 'popup' }, '')
            this.popup_entry = true
        }
        if (this.sheet && !this.sheet.entry) {
            history.pushState({ layer: 'sheet' }, '')
            this.sheet.entry = true
        }
    }

    /* ---------- 아래에서 올라오는 선택창 ---------- */
    // content 안의 [data-sheet-value]를 누르면 그 값으로 닫힙니다. 바깥·Esc·뒤로가기는 null(취소).
    openSheet({ title = '', content = '' }) {
        if (this.sheet) this.closeSheet(null)
        return new Promise((resolve) => {
            const el = document.createElement('div')
            el.className = 'sheet-overlay'
            el.innerHTML = `
                <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
                    <div class="sheet-handle" aria-hidden="true"></div>
                    <div class="sheet-title">${esc(title)}</div>
                    <div class="sheet-content">${content}</div>
                </div>`
            el.addEventListener('click', (e) => {
                const pick = e.target.closest('[data-sheet-value]')
                if (pick) return this.closeSheet(pick.dataset.sheetValue)
                if (e.target === el) this.closeSheet(null)
            })
            document.body.appendChild(el)
            void el.offsetWidth // 올라오는 애니메이션 시작점 확정
            el.classList.add('open')
            this.sheet = { el, resolve, result: null, entry: false }
            this.pushDeferredEntries()
        })
    }

    closeSheet(value) {
        if (!this.sheet) return
        const had_entry = this.sheet.entry
        this.hideSheet(value)
        if (had_entry) this.silentBack()
    }

    hideSheet(value) {
        const { el, resolve } = this.sheet
        this.sheet = null
        el.classList.remove('open')
        setTimeout(() => el.remove(), 300) // 내려가는 애니메이션 뒤에 제거
        resolve(value)
    }

    hidePopup() {
        this.popup_open = false
        this.before_close = null
        this.popup_entry = false
        $('.popup-overlay').classList.add('hide')
        $('.popup-content').innerHTML = ''
        $('.popup').dataset.variant = ''
        document.body.classList.remove('no-scroll')
    }

    toggleDrawer() {
        this.setDrawer(!this.drawer)
    }

    setDrawer(open, from_history = false) {
        if (this.drawer === open) return
        this.drawer = open
        $('.menu-overlay').classList.toggle('collapse-x', !open)
        $('.menu-btn').classList.toggle('active', open)
        if (from_history) { // 사용자가 누른 뒤로가기로 닫힘: 기록은 이미 빠졌음
            this.drawer_entry = false
            return
        }
        if (open) {
            this.pushDeferredEntries()
        } else if (this.drawer_entry) {
            this.drawer_entry = false
            this.silentBack()
        }
    }

    // 화면은 이미 정리했고 기록만 한 칸 되돌릴 때 (popstate에서 다시 처리하지 않도록 표시)
    silentBack() {
        this.own_backs++
        history.back()
    }

    toast(message) {
        const el = document.createElement('div')
        el.className = 'toast'
        el.textContent = message
        $('.toast-zone').appendChild(el)
        setTimeout(() => el.classList.add('out'), 1800)
        setTimeout(() => el.remove(), 2200)
    }

    // window.confirm 대체 (PWA standalone에서도 테마에 맞게)
    confirm(message, { ok = '확인', cancel = '취소', danger = false } = {}) {
        return new Promise((res) => {
            const overlay = document.createElement('div')
            overlay.className = 'dialog-overlay'
            overlay.innerHTML = `
                <div class="dialog" role="alertdialog" aria-modal="true">
                    <div class="dialog-message">${esc(message)}</div>
                    <div class="dialog-btns">
                        <button type="button" class="btn ghost" data-v="0">${esc(cancel)}</button>
                        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(ok)}</button>
                    </div>
                </div>`
            overlay.addEventListener('click', (e) => {
                const btn = e.target.closest('button')
                if (!btn && e.target !== overlay) return
                overlay.remove()
                res(btn ? btn.dataset.v === '1' : false)
            })
            document.body.appendChild(overlay)
            overlay.querySelector('[data-v="1"]').focus()
        })
    }

    // 여러 선택지 중 하나 고르기. 취소·바깥 누르기·Esc는 null.
    // options: [{ value, label, style: 'primary' | 'danger-ghost' | 'ghost' }] (마지막 것에 포커스)
    // stack: 버튼 글자가 길 때 위아래로 세워서 (선택지 먼저, 취소는 맨 아래)
    choose(message, options, { cancel = '취소', stack = false } = {}) {
        return new Promise((res) => {
            const overlay = document.createElement('div')
            overlay.className = 'dialog-overlay'
            overlay.innerHTML = `
                <div class="dialog" role="alertdialog" aria-modal="true">
                    <div class="dialog-message">${esc(message)}</div>
                    <div class="dialog-btns ${stack ? 'stack' : 'wrap'}">
                        ${stack ? '' : `<button type="button" class="btn ghost" data-choice="">${esc(cancel)}</button>`}
                        ${options.map(o => `<button type="button" class="btn ${o.style || 'ghost'}" data-choice="${esc(o.value)}">${esc(o.label)}</button>`).join('')}
                        ${stack ? `<button type="button" class="btn ghost" data-choice="">${esc(cancel)}</button>` : ''}
                    </div>
                </div>`
            const onKey = (e) => { if (e.key === 'Escape') close(null) }
            const close = (value) => {
                document.removeEventListener('keydown', onKey)
                overlay.remove()
                res(value || null)
            }
            overlay.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-choice]')
                if (btn) return close(btn.dataset.choice)
                if (e.target === overlay) close(null)
            })
            document.addEventListener('keydown', onKey)
            document.body.appendChild(overlay)
            // 추천 선택지에 포커스 (기본: 맨 뒤 선택지, 세로 배치: 맨 위 선택지)
            overlay.querySelector(stack ? '.dialog-btns button:first-child' : '.dialog-btns button:last-child').focus()
        })
    }

    // 한 줄 입력받기 (프로젝트 이름, 할 일 고치기). 취소·바깥 누르기·Esc는 null, 빈 값은 확인 불가.
    prompt(message, { value = '', placeholder = '', ok = '확인', cancel = '취소', maxlength = 200 } = {}) {
        return new Promise((res) => {
            const overlay = document.createElement('div')
            overlay.className = 'dialog-overlay'
            overlay.innerHTML = `
                <div class="dialog" role="dialog" aria-modal="true">
                    <div class="dialog-message">${esc(message)}</div>
                    <label class="dialog-typed">
                        <input type="text" autocomplete="off" maxlength="${Number(maxlength)}" placeholder="${esc(placeholder)}" value="${esc(value)}" enterkeyhint="done">
                    </label>
                    <div class="dialog-btns">
                        <button type="button" class="btn ghost" data-v="0">${esc(cancel)}</button>
                        <button type="button" class="btn primary" data-v="1">${esc(ok)}</button>
                    </div>
                </div>`
            const input = overlay.querySelector('input')
            const ok_btn = overlay.querySelector('[data-v="1"]')
            const sync = () => ok_btn.disabled = !input.value.trim()
            const onKey = (e) => {
                if (e.isComposing) return // 한글 조합 중 Enter는 무시
                if (e.key === 'Escape') close(null)
                if (e.key === 'Enter' && e.target === input && input.value.trim()) close(input.value.trim())
            }
            const close = (result) => {
                document.removeEventListener('keydown', onKey)
                overlay.remove()
                res(result)
            }
            input.addEventListener('input', sync)
            document.addEventListener('keydown', onKey)
            overlay.addEventListener('click', (e) => {
                const btn = e.target.closest('button')
                if (btn) return close(btn.dataset.v === '1' && input.value.trim() ? input.value.trim() : null)
                if (e.target === overlay) close(null)
            })
            document.body.appendChild(overlay)
            sync()
            input.focus()
            input.setSelectionRange(input.value.length, input.value.length)
        })
    }

    // 되돌릴 수 없는 큰 작업용: phrase를 똑같이 입력해야 확인 버튼이 눌립니다.
    confirmTyped(message, phrase, { ok = '삭제', cancel = '취소' } = {}) {
        return new Promise((res) => {
            const overlay = document.createElement('div')
            overlay.className = 'dialog-overlay'
            overlay.innerHTML = `
                <div class="dialog" role="alertdialog" aria-modal="true">
                    <div class="dialog-message">${esc(message)}</div>
                    <label class="dialog-typed">
                        <span>계속하려면 아래 칸에 <b>${esc(phrase)}</b> 를 입력하세요.</span>
                        <input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(phrase)}">
                    </label>
                    <div class="dialog-btns">
                        <button type="button" class="btn ghost" data-v="0">${esc(cancel)}</button>
                        <button type="button" class="btn danger" data-v="1" disabled>${esc(ok)}</button>
                    </div>
                </div>`
            const input = overlay.querySelector('input')
            const ok_btn = overlay.querySelector('[data-v="1"]')
            const matched = () => input.value.trim() === phrase
            // 포커스가 입력칸 밖에 있어도 Esc가 먹도록 문서 전체에서 키를 받습니다.
            const onKey = (e) => {
                if (e.isComposing) return
                if (e.key === 'Escape') close(false)
                if (e.key === 'Enter' && e.target === input && matched()) close(true)
            }
            const close = (result) => {
                document.removeEventListener('keydown', onKey)
                overlay.remove()
                res(result)
            }
            input.addEventListener('input', () => ok_btn.disabled = !matched())
            document.addEventListener('keydown', onKey)
            overlay.addEventListener('click', (e) => {
                const btn = e.target.closest('button')
                if (btn) return close(btn.dataset.v === '1' && matched())
                if (e.target === overlay) close(false)
            })
            document.body.appendChild(overlay)
            input.focus()
        })
    }
}

const ui = new UIHandler()
