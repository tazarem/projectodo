/**
 * 앱으로 설치 안내
 * - 안드로이드·PC(Chrome 계열): 브라우저가 주는 설치 창을 버튼으로 띄움 (beforeinstallprompt)
 * - 아이폰: 설치시키는 방법이 없어서 '공유 → 홈 화면에 추가' 순서를 보여 줌
 * - 카카오톡 등 앱 안 브라우저: 설치할 수 없으니 다른 브라우저로 열라고 안내
 * - 이미 설치해서 쓰는 중이면 안내를 숨김
 * 메뉴(≡)의 '앱으로 설치' 칸은 항상 있고, 화면 아래 안내 한 줄은 휴대폰 첫 방문 때 한 번만(닫으면 다시 안 뜸).
 */
class InstallGuide {
    DISMISS_KEY = 'pjtd_install_banner_dismissed'
    deferred_prompt = null // 브라우저가 건네준 설치 창 (한 번만 쓸 수 있음)

    constructor() {
        const ua = navigator.userAgent
        this.is_ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        this.is_android = /android/i.test(ua)
        this.is_mobile = this.is_ios || this.is_android
        this.is_in_app = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua)

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault() // 브라우저 기본 안내 대신 우리 버튼으로
            this.deferred_prompt = e
            this.render()
        })
        window.addEventListener('appinstalled', () => {
            this.deferred_prompt = null
            this.dismissBanner()
            this.render()
            ui.toast('설치됐어요! 홈 화면에서 열어 보세요')
        })
    }

    isInstalled() {
        return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
    }

    // installed | in-app | prompt | ios | manual
    mode() {
        if (this.isInstalled()) return 'installed'
        if (this.is_in_app) return 'in-app'
        if (this.deferred_prompt) return 'prompt'
        if (this.is_ios) return 'ios'
        return 'manual'
    }

    bannerDismissed() {
        try { return localStorage.getItem(this.DISMISS_KEY) === '1' } catch (e) { return false }
    }

    dismissBanner() {
        try { localStorage.setItem(this.DISMISS_KEY, '1') } catch (e) { }
        this.renderBanner()
    }

    init() {
        $('.install-section').addEventListener('click', (e) => this.onClick(e))
        $('.install-banner').addEventListener('click', (e) => this.onClick(e))
        this.render()
    }

    onClick(e) {
        const action = e.target.closest('[data-install]')?.dataset.install
        if (action === 'prompt') return this.promptInstall()
        if (action === 'guide') return this.openGuide()
        if (action === 'copy') return this.copyLink()
        if (action === 'dismiss') return this.dismissBanner()
    }

    render() {
        this.renderMenu()
        this.renderBanner()
    }

    // 메뉴(≡)의 '앱으로 설치' 칸
    renderMenu() {
        const el = $('.install-section')
        if (!el) return
        const mode = this.mode()
        const body = {
            installed: `<div class="config-caption"><i class="fas fa-check-circle"></i> 앱으로 설치해서 쓰고 있어요.</div>`,
            'in-app': `
                <div class="config-caption">지금 화면(카카오톡 등 앱 안의 브라우저)에서는 설치할 수 없어요. 주소를 복사해서 ${this.is_ios ? 'Safari' : 'Chrome'}에서 열어 주세요.</div>
                <button type="button" class="btn ghost" data-install="copy"><i class="far fa-copy"></i> 주소 복사</button>`,
            prompt: `
                <div class="config-caption">홈 화면에 추가하면 주소창 없이 앱처럼 쓸 수 있어요.</div>
                <button type="button" class="btn primary" data-install="prompt"><i class="fas fa-download"></i> 앱으로 설치</button>`,
            ios: `
                <div class="config-caption">홈 화면에 추가하면 앱처럼 쓸 수 있고, 적어 둔 내용도 더 안전하게 보관돼요.</div>
                <button type="button" class="btn primary" data-install="guide"><i class="fas fa-mobile-alt"></i> 설치 방법 보기</button>`,
            manual: `
                <div class="config-caption">${this.is_mobile ? '브라우저 메뉴에서 홈 화면에 추가하면 앱처럼 쓸 수 있어요.' : '브라우저의 설치 기능을 쓰면 따로 뜨는 창에서 앱처럼 쓸 수 있어요.'}</div>
                <button type="button" class="btn ghost" data-install="guide"><i class="fas fa-mobile-alt"></i> 설치 방법 보기</button>`,
        }[mode]
        el.innerHTML = body
    }

    // 화면 아래 안내 한 줄: 휴대폰에서, 설치 전이고, 닫은 적 없을 때만
    renderBanner() {
        const el = $('.install-banner')
        if (!el) return
        const mode = this.mode()
        // 안드로이드는 브라우저가 설치 창을 건네준 뒤에만(버튼이 실제로 동작할 때만) 보여 줌
        const show = this.is_mobile && !this.bannerDismissed() && ['prompt', 'ios', 'in-app'].includes(mode)
        el.classList.toggle('hide', !show)
        document.body.classList.toggle('has-install-banner', show)
        if (!show) return
        const action = {
            prompt: `<button type="button" class="btn primary" data-install="prompt">설치</button>`,
            ios: `<button type="button" class="btn primary" data-install="guide">방법 보기</button>`,
            'in-app': `<button type="button" class="btn primary" data-install="guide">방법 보기</button>`,
        }[mode]
        el.innerHTML = `
            <img class="install-banner-icon" src="./img/icons/favicon-32.png" alt="">
            <div class="install-banner-text">홈 화면에 추가하면 앱처럼 쓸 수 있어요</div>
            ${action}
            <button type="button" class="icon-btn" data-install="dismiss" aria-label="안내 닫기"><i class="fas fa-times"></i></button>`
    }

    async promptInstall() {
        const prompt = this.deferred_prompt
        if (!prompt) return this.openGuide()
        this.deferred_prompt = null // 한 번 쓰면 다시 못 씀
        prompt.prompt()
        const choice = await prompt.userChoice.catch(() => null)
        if (choice?.outcome === 'accepted') this.dismissBanner()
        this.render()
    }

    // 기기별 설치 순서 (아래에서 올라오는 창)
    openGuide() {
        const mode = this.mode()
        // 아이폰의 공유 버튼 모양 (네모에서 위로 나가는 화살표)
        const share_icon = `<svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M12 3l-4 4M12 3l4 4M6 10H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        let steps
        if (mode === 'in-app') {
            steps = [
                `이 화면은 다른 앱 안에서 열린 브라우저라 설치할 수 없어요.`,
                `아래 <b>주소 복사</b>를 누른 뒤 <b>${this.is_ios ? 'Safari' : 'Chrome'}</b>를 열어 주소창에 붙여넣어 주세요.`,
                `거기서 다시 메뉴(≡) → <b>앱으로 설치</b>를 눌러 주세요.`,
            ]
        } else if (this.is_ios) {
            steps = [
                `Safari 화면 아래(아이패드는 위)의 <b>공유 버튼</b> ${share_icon} 을 눌러요.`,
                `목록을 아래로 내려서 <b>홈 화면에 추가</b> <i class="far fa-plus-square"></i> 를 눌러요.`,
                `오른쪽 위의 <b>추가</b>를 누르면 홈 화면에 아이콘이 생겨요.`,
            ]
        } else if (this.is_android) {
            steps = [
                `Chrome 오른쪽 위의 <b>메뉴</b> <i class="fas fa-ellipsis-v"></i> 를 눌러요.`,
                `<b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 눌러요.`,
                `<b>설치</b>를 누르면 홈 화면에 아이콘이 생겨요.`,
            ]
        } else {
            steps = [
                `주소창 오른쪽 끝의 <b>설치 아이콘</b> <i class="fas fa-download"></i> 을 눌러요. (Chrome, Edge)`,
                `안 보이면 브라우저 메뉴 <i class="fas fa-ellipsis-v"></i> 에서 <b>앱 설치</b> 또는 <b>바로가기 만들기</b>를 찾아요.`,
                `<b>설치</b>를 누르면 따로 뜨는 창으로 쓸 수 있어요.`,
            ]
        }
        const copy_btn = mode === 'in-app' ? `<button type="button" class="btn ghost" data-install="copy"><i class="far fa-copy"></i> 주소 복사</button>` : ''
        const note = this.is_ios && mode !== 'in-app'
            ? `<p class="install-note">아이폰은 설치하지 않고 Safari에서만 쓰면, 오래 열지 않았을 때 적어 둔 내용이 지워질 수 있어요.</p>` : ''
        ui.openSheet({
            title: '앱으로 설치하는 방법',
            content: `
                <ol class="install-steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
                ${note}
                <div class="install-guide-btns">
                    ${copy_btn}
                    <button type="button" class="btn primary" data-sheet-value="ok">알겠어요</button>
                </div>`,
        })
        // 선택창 안의 '주소 복사' 버튼
        const copy = $('.sheet [data-install="copy"]')
        if (copy) copy.addEventListener('click', () => this.copyLink())
    }

    async copyLink() {
        const url = location.origin + location.pathname
        try {
            await navigator.clipboard.writeText(url)
            ui.toast('주소를 복사했어요')
        } catch (e) {
            ui.toast(url) // 복사가 막힌 환경: 주소를 보여 줌
        }
    }
}

const install_guide = new InstallGuide()
