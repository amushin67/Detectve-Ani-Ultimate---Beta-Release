// ==UserScript==
// @name         Ultimate UUID Finder (Best One)
// @namespace    https://github.com/amushin67
// @version      2.2.5
// @description  Find original Grok posts online and on Grok itself. Strict extraction, /rest/assets, detail panel. old.reddit listing + www.reddit.com/r/{Community}/ infinite feed (queued text-source, concurrency 4) + comments pages. Hard reset on URL change. Grok icon 🔍. Thumbs toggle panel. Detail panels always on top document (outside iframes). Created date fixed.
// @author       Amu + Grok
// @match        *://*/*
// @icon         https://grok.com/images/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// @connect      grok.com
// @connect      assets.grok.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

// ========== SCRIPT 1: Detective (Grok) – mobile-optimized positioning ==========
(function () {
    'use strict';

    const MAX_DEPTH = 4;
    const BTN_ID = 'dani-btn';
    const DROP_ID = 'dani-drop';
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

    const cache = new Map();
    let rafId = 0;

    function isMobileViewport() {
        return window.innerWidth < 768 ||
            /Mobi|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            (window.matchMedia && window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 900);
    }

    function lastUuid(str) {
        if (!str) return null;
        const m = String(str).match(UUID_RE);
        return m ? m[m.length - 1].toLowerCase() : null;
    }

    function getPostUuid() {
        const m = location.pathname.match(/^\/imagine\/post\/([0-9a-f-]{36})/i);
        return m ? m[1].toLowerCase() : null;
    }

    async function fetchAsset(uuid) {
        if (cache.has(uuid)) return cache.get(uuid);
        try {
            const res = await fetch('/rest/assets/' + uuid, { credentials: 'include' });
            if (!res.ok) return null;
            const data = await res.json();
            cache.set(uuid, data);
            return data;
        } catch {
            return null;
        }
    }

    function extractRefs(data, exclude) {
        const found = new Set();
        const mgi = data?.mediaGenInput;

        if (mgi && typeof mgi === 'object') {
            for (const key of Object.keys(mgi)) {
                const block = mgi[key];
                if (Array.isArray(block?.inputAssets)) {
                    for (const id of block.inputAssets) {
                        if (typeof id === 'string' && id.length > 30) {
                            found.add(id.toLowerCase());
                        }
                    }
                }
            }
        }

        try {
            let raw = data?.auxKeys?.image_references;
            if (raw) {
                const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (Array.isArray(arr)) {
                    for (const url of arr) {
                        const u = lastUuid(url);
                        if (u) found.add(u);
                    }
                }
            }
        } catch {}

        if (exclude) found.delete(exclude);
        return [...found];
    }

    /** Extract prompt text from /rest/assets/{uuid} response */
    function extractPrompt(data) {
        if (!data) return '';
        const mgi = data.mediaGenInput;
        if (mgi && typeof mgi === 'object') {
            const KINDS = ['textToImage', 'imageToImage', 'textToVideo', 'imageToVideo', 'referenceToVideo', 'videoExtension'];
            for (const k of KINDS) {
                const block = mgi[k];
                if (block && typeof block === 'object' && block.prompt) {
                    return String(block.prompt).trim();
                }
            }
            for (const value of Object.values(mgi)) {
                if (value && typeof value === 'object' && value.prompt) {
                    return String(value.prompt).trim();
                }
            }
        }
        if (data.summary) return String(data.summary).trim();
        if (data.prompt) return String(data.prompt).trim();
        if (data.originalPrompt) return String(data.originalPrompt).trim();
        return '';
    }

    /** File type, extension, create date from asset data */
    function extractMeta(data) {
        if (!data) return { kind: '', ext: '', created: '' };
        const mime = String(data.mimeType || data.mime_type || '').toLowerCase();
        let kind = '';
        let ext = '';
        if (mime.startsWith('video/') || /video/i.test(mime)) {
            kind = 'Video';
            if (mime.includes('mp4')) ext = '.mp4';
            else if (mime.includes('webm')) ext = '.webm';
            else if (mime.includes('quicktime') || mime.includes('mov')) ext = '.mov';
            else if (mime.includes('m4v')) ext = '.m4v';
            else ext = '.mp4';
        } else if (mime.startsWith('image/') || mime) {
            kind = 'Image';
            if (mime.includes('png')) ext = '.png';
            else if (mime.includes('webp')) ext = '.webp';
            else if (mime.includes('gif')) ext = '.gif';
            else if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
            else ext = '.jpg';
        } else {
            // Infer from mediaGenInput keys
            const mgi = data.mediaGenInput;
            if (mgi && typeof mgi === 'object') {
                const keys = Object.keys(mgi).join(' ').toLowerCase();
                if (/video/.test(keys)) {
                    kind = 'Video';
                    ext = '.mp4';
                } else {
                    kind = 'Image';
                    ext = '.jpg';
                }
            }
        }

        let created = '';
        const raw = data.createTime || data.createdAt || data.create_time || data.created_at || '';
        if (raw) {
            const d = new Date(raw);
            if (!Number.isNaN(d.getTime())) {
                created = d.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } else {
                created = String(raw);
            }
        }
        return { kind, ext, created };
    }

    function buildThumbCandidates(uuid, owner, data) {
        const list = [];

        try {
            let raw = data?.auxKeys?.image_references;
            if (raw) {
                const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (Array.isArray(arr)) {
                    for (const u of arr) if (typeof u === 'string' && u.startsWith('http')) list.push(u);
                }
            }
        } catch {}

        const preview = data?.auxKeys?.['preview-image'];
        if (preview) list.push('https://assets.grok.com/' + preview + '?cache=1');

        if (owner) {
            list.push(`https://assets.grok.com/users/${owner}/generated/${uuid}/image.jpg?cache=1`);
            list.push(`https://assets.grok.com/users/${owner}/${uuid}/content?cache=1`);
            list.push(`https://assets.grok.com/users/${owner}/generated/${uuid}/content?cache=1`);
        }

        list.push(`https://assets.grok.com/generated/${uuid}/image.jpg?cache=1`);
        list.push(`https://assets.grok.com/generated/${uuid}/content?cache=1`);

        return [...new Set(list)];
    }

    async function collectParents(root) {
        const ordered = [];
        const seen = new Set([root]);
        let frontier = [root];
        let depth = 0;

        while (frontier.length && depth < MAX_DEPTH) {
            depth++;
            const next = [];
            for (const id of frontier) {
                const data = await fetchAsset(id);
                if (!data) continue;

                for (const ref of extractRefs(data, root)) {
                    if (seen.has(ref)) continue;
                    seen.add(ref);

                    const refData = await fetchAsset(ref);
                    const owner = (refData && refData.ownerUserId) || data.ownerUserId || null;
                    const isComposer = !(refData && refData.mediaGenInput);
                    const prompt = extractPrompt(refData) || extractPrompt(data) || '';
                    const meta = extractMeta(refData);

                    ordered.push({
                        uuid: ref,
                        depth,
                        ownerUserId: owner,
                        isComposer,
                        thumbs: buildThumbCandidates(ref, owner, refData),
                        prompt,
                        kind: meta.kind,
                        ext: meta.ext,
                        created: meta.created
                    });
                    next.push(ref);
                }
            }
            frontier = next;
        }

        ordered.sort((a, b) => {
            if (a.isComposer && !b.isComposer) return -1;
            if (!a.isComposer && b.isComposer) return 1;
            return a.depth - b.depth;
        });

        return ordered;
    }

    function css() {
        if (document.getElementById('dani-css')) return;
        const s = document.createElement('style');
        s.id = 'dani-css';
        s.textContent = `
#${DROP_ID}{
  position:fixed!important;z-index:2147483647!important;
  display:none!important;
  flex-direction:column!important;flex-wrap:nowrap!important;gap:6px!important;
  padding:8px!important;border-radius:12px!important;
  background:#181716!important;
  border:none!important;
  box-shadow:0 12px 32px rgba(0,0,0,.6)!important;
  max-width:90px!important;max-height:55vh!important;overflow-y:auto!important;
  -webkit-overflow-scrolling:touch!important;
  overscroll-behavior:contain!important;
}
#${DROP_ID}.open{display:flex!important}

#${DROP_ID} .thumb{
  width:72px!important;height:72px!important;
  object-fit:cover!important;border-radius:8px!important;
  cursor:pointer!important;border:none!important;
  transition:transform .12s,opacity .12s!important;
  background:#2a2a2a;
  flex-shrink:0!important;
  touch-action:manipulation!important;
}
#${DROP_ID} .thumb:hover,
#${DROP_ID} .thumb:active{
  transform:scale(1.08)!important;opacity:.9!important;
}

#dani-detail-panel{
  position:fixed!important;z-index:2147483647!important;
  display:none!important;
  flex-direction:column!important;
  width:340px!important;
  height:640px!important;
  max-width:calc(100vw - 16px)!important;
  max-height:calc(100vh - 16px)!important;
  overflow:hidden!important;
  padding:0!important;
  border-radius:14px!important;
  background:rgba(16,15,14,.98)!important;
  border:1px solid rgba(255,255,255,.14)!important;
  box-shadow:0 16px 48px rgba(0,0,0,.65)!important;
  color:#f0ebe6!important;
  font-size:12px!important;line-height:1.45!important;
  font-family:system-ui,-apple-system,sans-serif!important;
  -webkit-overflow-scrolling:touch!important;
  box-sizing:border-box!important;
}
#dani-detail-panel.open{display:flex!important}
#dani-detail-panel .dp-head{
  display:flex!important;align-items:center!important;justify-content:space-between!important;
  padding:10px 12px 8px!important;
  border-bottom:1px solid rgba(255,255,255,.08)!important;
  flex-shrink:0!important;
}
#dani-detail-panel .dp-title{
  font-size:13px!important;font-weight:600!important;opacity:.9!important;
}
#dani-detail-panel .dp-close{
  width:28px!important;height:28px!important;border:none!important;
  border-radius:8px!important;background:rgba(255,255,255,.08)!important;
  color:#fff!important;font-size:16px!important;line-height:1!important;
  cursor:pointer!important;display:flex!important;align-items:center!important;
  justify-content:center!important;padding:0!important;
  touch-action:manipulation!important;
}
#dani-detail-panel .dp-close:hover{background:rgba(255,255,255,.16)!important}
#dani-detail-panel .dp-body{
  overflow-y:auto!important;padding:12px!important;flex:1!important;
  min-height:0!important;
}
#dani-detail-panel .dp-thumb-wrap{
  display:flex!important;justify-content:center!important;
  margin-bottom:12px!important;border-radius:10px!important;
  overflow:hidden!important;background:#1a1918!important;
  flex-shrink:0!important;
}
#dani-detail-panel .dp-thumb{
  height:200px!important;width:auto!important;max-width:100%!important;
  object-fit:contain!important;display:block!important;
  background:#1a1918!important;
}
#dani-detail-panel .dp-row{
  margin-bottom:8px!important;font-size:12px!important;line-height:1.45!important;
  flex-shrink:0!important;
}
#dani-detail-panel .dp-label{
  display:block!important;opacity:.5!important;font-weight:600!important;
  font-size:10px!important;text-transform:uppercase!important;
  letter-spacing:.04em!important;margin-bottom:2px!important;
}
#dani-detail-panel .dp-value{
  word-break:break-word!important;
}
#dani-detail-panel .dp-uuid{
  font-family:ui-monospace,monospace!important;font-size:11px!important;
  word-break:break-all!important;opacity:.9!important;
}
#dani-detail-panel .dp-prompt-box{
  margin-top:4px!important;padding:10px!important;
  background:rgba(255,255,255,.04)!important;
  border:1px solid rgba(255,255,255,.08)!important;
  border-radius:8px!important;
  white-space:pre-wrap!important;word-break:break-word!important;
  /* ~6 lines @ 12px / 1.5 ≈ scrollbar after that */
  max-height:calc(1.5em * 6 + 20px)!important;
  overflow-y:auto!important;
  font-size:12px!important;line-height:1.5!important;
  -webkit-overflow-scrolling:touch!important;
}
#dani-detail-panel .dp-prompt-empty{
  opacity:.5!important;font-style:italic!important;
}
#dani-detail-panel .dp-actions{
  display:flex!important;flex-wrap:wrap!important;gap:8px!important;
  padding:10px 12px 12px!important;
  border-top:1px solid rgba(255,255,255,.08)!important;
  flex-shrink:0!important;
  box-sizing:border-box!important;
}
#dani-detail-panel .dp-btn{
  display:inline-flex!important;align-items:center!important;justify-content:center!important;
  gap:6px!important;padding:8px 12px!important;
  border-radius:8px!important;border:none!important;
  font-size:12px!important;font-weight:600!important;
  cursor:pointer!important;touch-action:manipulation!important;
  text-decoration:none!important;color:#fff!important;
  transition:background .12s,transform .12s!important;
}
#dani-detail-panel .dp-btn:active{transform:scale(.97)!important}
#dani-detail-panel .dp-btn-open{
  background:#299fff!important;
  border:none!important;
}
#dani-detail-panel .dp-btn-open:hover{background:#1a8ee6!important}
#dani-detail-panel .dp-btn-copy{
  background:rgba(255,255,255,.1)!important;
  border:1px solid rgba(255,255,255,.14)!important;
}
#dani-detail-panel .dp-btn-copy:hover{background:rgba(255,255,255,.18)!important}
#dani-detail-panel .dp-btn-copy.copied{background:#16a34a!important;border-color:transparent!important}

#${BTN_ID}{
  position:fixed!important;
  width:40px!important;height:40px!important;
  min-width:40px!important;min-height:40px!important;
  padding:0!important;margin:0!important;border:none!important;
  background:rgba(24,23,22,.9)!important;
  border-radius:12px!important;
  cursor:pointer!important;z-index:2147483646!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
  box-shadow:0 4px 14px rgba(0,0,0,.5)!important;
  transition:transform .12s,background .12s!important;
  font-size:18px!important;line-height:1!important;
  color:#fff!important;user-select:none!important;
  touch-action:manipulation!important;
  -webkit-tap-highlight-color:transparent!important;
}
#${BTN_ID}:hover,
#${BTN_ID}:active{transform:scale(1.08)!important;background:rgba(40,38,36,.97)!important}
#${BTN_ID}.empty{display:none!important}
#${BTN_ID} .count{
  position:absolute!important;top:-6px!important;right:-6px!important;
  background:#299fff!important;color:#fff!important;
  font-size:11px!important;font-weight:700!important;
  min-width:18px!important;height:18px!important;
  border-radius:9px!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
  padding:0 4px!important;box-shadow:0 2px 6px rgba(0,0,0,.4)!important;
}

@media (max-width: 767px), (pointer: coarse) {
  #${BTN_ID}{
    width:44px!important;height:44px!important;
    min-width:44px!important;min-height:44px!important;
    font-size:20px!important;
    border-radius:14px!important;
  }
  #${DROP_ID}{
    max-height:50vh!important;
    max-width:100px!important;
    gap:8px!important;
    padding:10px!important;
  }
  #${DROP_ID} .thumb{
    width:80px!important;height:80px!important;
  }
}
`;
        (document.head || document.documentElement).appendChild(s);
    }

    function findZoomButton() {
        const candidates = document.querySelectorAll('button, [role="button"], a');
        let best = null;
        for (const el of candidates) {
            const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).toLowerCase();
            if (
                label.includes('zoom in') ||
                label.includes('zoom out') ||
                label.includes('reset zoom') ||
                label === 'zoom' ||
                label.includes('fullscreen') ||
                label.includes('full screen') ||
                label.includes('expand') ||
                label.includes('maximize') ||
                label.includes('ampliar') ||
                label.includes('tela cheia')
            ) {
                if (!best) {
                    best = el;
                } else {
                    const r1 = best.getBoundingClientRect();
                    const r2 = el.getBoundingClientRect();
                    if (r2.top < r1.top - 5 || (Math.abs(r2.top - r1.top) < 10 && r2.left > r1.left)) {
                        best = el;
                    }
                }
            }
        }
        if (best) return best;

        const postActions = document.querySelector('[aria-label="Post actions"], [aria-label*="Post action" i]');
        if (postActions) return postActions;

        for (const b of document.querySelectorAll('button')) {
            const t = (b.textContent || '').trim();
            if (t === 'Regenerate' || t === 'Share' || t === 'Extend' || t === 'Presets') {
                return b.closest('div[class*="flex"]') || b.parentElement;
            }
        }
        return null;
    }

    function getSafeBottomOffset() {
        const input = document.querySelector('input[placeholder*="imagine" i], textarea[placeholder*="imagine" i], [contenteditable="true"]');
        if (input) {
            const r = input.getBoundingClientRect();
            if (r.top > window.innerHeight * 0.5) {
                return Math.max(16, window.innerHeight - r.top + 12);
            }
        }
        const safe = parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)') || '0', 10) || 0;
        return 24 + safe + (isMobileViewport() ? 56 : 16);
    }

    function findMainMedia() {
        // Prefer the large hero media on /imagine/post/ pages (image or video)
        const candidates = [];
        document.querySelectorAll('video, img').forEach(el => {
            if (!el.isConnected) return;
            if (el.closest('#' + DROP_ID) || el.closest('#dani-detail-panel')) return;
            if (el.classList.contains('thumb') || el.classList.contains('dp-thumb')) return;
            const r = el.getBoundingClientRect();
            const area = r.width * r.height;
            // Must be reasonably large and mostly in view
            if (r.width < 120 || r.height < 120) return;
            if (r.bottom < 40 || r.top > window.innerHeight - 40) return;
            if (area < 20000) return;
            candidates.push({ el, area, r });
        });
        if (!candidates.length) return null;
        candidates.sort((a, b) => b.area - a.area);
        return candidates[0];
    }

    function updatePos() {
        const wrap = document.getElementById(BTN_ID);
        if (!wrap) return;

        const btnSize = isMobileViewport() ? 44 : 40;
        const margin = 10;
        let left = null, top = null, right = null, bottom = null;
        let dropLeft = null, dropTop = null, dropRight = null, dropBottom = null;

        const media = findMainMedia();
        if (media) {
            const r = media.r;
            // Always top-right corner of the main media (image or video)
            left = Math.round(r.right - btnSize - margin);
            top = Math.round(r.top + margin);
            // Clamp to viewport
            if (left < 8) left = 8;
            if (left + btnSize > window.innerWidth - 8) left = window.innerWidth - btnSize - 8;
            if (top < 8) top = 8;
            if (top + btnSize > window.innerHeight - 8) top = window.innerHeight - btnSize - 8;

            dropLeft = left;
            // Prefer dropdown below the button; flip above if not enough space
            const dropH = 200;
            if (top + btnSize + 8 + dropH < window.innerHeight - 8) {
                dropTop = top + btnSize + 6;
                dropBottom = null;
            } else {
                dropTop = null;
                dropBottom = window.innerHeight - top + 6;
            }
            dropRight = null;
        } else {
            // Fallback: top-right of viewport
            left = window.innerWidth - btnSize - 16;
            top = 16;
            dropLeft = left;
            dropTop = top + btnSize + 6;
            dropRight = null;
            dropBottom = null;
        }

        const btnParts = ['position:fixed!important'];
        if (left != null) btnParts.push(`left:${left}px!important`);
        else btnParts.push('left:auto!important');
        if (right != null) btnParts.push(`right:${right}px!important`);
        else btnParts.push('right:auto!important');
        if (top != null) btnParts.push(`top:${top}px!important`);
        else btnParts.push('top:auto!important');
        if (bottom != null) btnParts.push(`bottom:${bottom}px!important`);
        else btnParts.push('bottom:auto!important');
        wrap.style.cssText = btnParts.join(';');

        const drop = document.getElementById(DROP_ID);
        if (drop) {
            const dropParts = ['position:fixed!important'];
            if (dropLeft != null) dropParts.push(`left:${dropLeft}px!important`);
            else dropParts.push('left:auto!important');
            if (dropRight != null) dropParts.push(`right:${dropRight}px!important`);
            else dropParts.push('right:auto!important');
            if (dropTop != null) dropParts.push(`top:${dropTop}px!important`);
            else dropParts.push('top:auto!important');
            if (dropBottom != null) dropParts.push(`bottom:${dropBottom}px!important`);
            else dropParts.push('bottom:auto!important');
            drop.style.cssText = dropParts.join(';');
        }
    }

    function schedulePos() {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            updatePos();
        });
    }

    function openRef(uuid) {
        window.open('https://grok.com/imagine/post/' + uuid, '_blank');
    }

    // Cached fixed position so every thumbnail click keeps the same panel place
    let fixedPanelPos = null;
    let lastOpenedUuid = null;

    function getDetailPanel() {
        let panel = document.getElementById('dani-detail-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'dani-detail-panel';
            document.body.appendChild(panel);
        }
        return panel;
    }

    function hideDetailPanel() {
        const panel = document.getElementById('dani-detail-panel');
        if (panel) panel.classList.remove('open');
        lastOpenedUuid = null;
        // Keep fixedPanelPos while dropdown is open so next thumb stays put;
        // only clear when dropdown itself closes (see clearFixedPanelPos callers).
    }

    function clearFixedPanelPos() {
        fixedPanelPos = null;
    }

    function positionDetailPanel() {
        const panel = getDetailPanel();
        const drop = document.getElementById(DROP_ID);
        if (!drop) return;

        // Reuse the same coordinates for every thumb click
        if (fixedPanelPos) {
            panel.style.left = fixedPanelPos.left + 'px';
            panel.style.top = fixedPanelPos.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.width = '340px';
            panel.style.height = '640px';
            return;
        }

        // Compute once from the dropdown container (top of first thumb area)
        const firstThumb = drop.querySelector('.thumb');
        const r = (firstThumb || drop).getBoundingClientRect();
        const pw = 340;
        const ph = 640;

        let left = r.right + 12;
        if (left + pw > window.innerWidth - 8) {
            left = Math.max(8, r.left - pw - 12);
        }
        if (left < 8) left = 8;

        let top = r.top;
        if (top + ph > window.innerHeight - 8) {
            top = Math.max(8, window.innerHeight - ph - 8);
        }
        if (top < 8) top = 8;

        left = Math.round(left);
        top = Math.round(top);
        fixedPanelPos = { left, top };

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.width = '340px';
        panel.style.height = '640px';
    }

    function showDetailPanel(anchorEl, p) {
        // Toggle: click same thumb again closes the panel
        if (lastOpenedUuid === p.uuid) {
            hideDetailPanel();
            return;
        }
        lastOpenedUuid = p.uuid;

        const panel = getDetailPanel();
        panel.innerHTML = '';

        // Header
        const head = document.createElement('div');
        head.className = 'dp-head';
        const title = document.createElement('div');
        title.className = 'dp-title';
        title.textContent = 'Parent reference';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'dp-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '×';
        closeBtn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            hideDetailPanel();
        };
        head.appendChild(title);
        head.appendChild(closeBtn);
        panel.appendChild(head);

        // Body
        const body = document.createElement('div');
        body.className = 'dp-body';

        // Thumbnail 200px height
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'dp-thumb-wrap';
        const big = document.createElement('img');
        big.className = 'dp-thumb';
        big.alt = '';
        big.loading = 'lazy';
        const candidates = p.thumbs || [];
        let idx = 0;
        big.src = candidates[0] || '';
        big.onerror = () => {
            idx++;
            if (idx < candidates.length) big.src = candidates[idx];
        };
        thumbWrap.appendChild(big);
        body.appendChild(thumbWrap);

        // File Type
        const typeLine = [p.kind, p.ext].filter(Boolean).join('');
        if (p.kind || p.ext) {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">File Type</span>';
            const val = document.createElement('div');
            val.className = 'dp-value';
            val.textContent = p.kind && p.ext ? `${p.kind}${p.ext}` : (typeLine || '—');
            // Prefer "Image.jpg" / "Video.mp4" style as user asked
            if (p.kind && p.ext) val.textContent = `${p.kind}${p.ext}`;
            else if (p.kind) val.textContent = p.kind;
            else val.textContent = p.ext || '—';
            row.appendChild(val);
            body.appendChild(row);
        }

        // Created
        if (p.created) {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">Created</span>';
            const val = document.createElement('div');
            val.className = 'dp-value';
            val.textContent = p.created;
            row.appendChild(val);
            body.appendChild(row);
        }

        // UUID
        {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">UUID</span>';
            const val = document.createElement('div');
            val.className = 'dp-value dp-uuid';
            val.textContent = p.uuid;
            row.appendChild(val);
            body.appendChild(row);
        }

        // Prompt
        {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">Prompt</span>';
            const box = document.createElement('div');
            box.className = 'dp-prompt-box';
            const text = (p.prompt || '').trim();
            if (text) {
                box.textContent = text;
            } else {
                box.classList.add('dp-prompt-empty');
                box.textContent = '(not available)';
            }
            row.appendChild(box);
            body.appendChild(row);
        }

        panel.appendChild(body);

        // Actions
        const actions = document.createElement('div');
        actions.className = 'dp-actions';

        const openLink = document.createElement('a');
        openLink.className = 'dp-btn dp-btn-open';
        openLink.href = 'https://grok.com/imagine/post/' + p.uuid;
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open on Imagine';
        openLink.onclick = e => e.stopPropagation();
        actions.appendChild(openLink);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'dp-btn dp-btn-copy';
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy prompt';
        copyBtn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const text = (p.prompt || '').trim();
            if (!text) return;
            const done = () => {
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = 'Copy prompt';
                    copyBtn.classList.remove('copied');
                }, 1600);
            };
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:fixed;left:-9999px;';
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); } catch {}
                    ta.remove();
                    done();
                });
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch {}
                ta.remove();
                done();
            }
        };
        actions.appendChild(copyBtn);

        panel.appendChild(actions);

        panel.classList.add('open');
        // Always align with first thumbnail top (fixed 340×640)
        requestAnimationFrame(() => positionDetailPanel());
    }

    function renderDrop(parents) {
        let drop = document.getElementById(DROP_ID);
        if (!drop) {
            drop = document.createElement('div');
            drop.id = DROP_ID;
            document.body.appendChild(drop);
        }
        drop.innerHTML = '';
        hideDetailPanel();
        clearFixedPanelPos();
        if (!parents.length) return;

        for (const p of parents) {
            const img = document.createElement('img');
            img.className = 'thumb';
            img.alt = '';
            img.loading = 'lazy';
            img.dataset.uuid = p.uuid;
            img.title = 'Click for details';

            const candidates = p.thumbs || [];
            let idx = 0;
            img.src = candidates[0] || '';

            img.onerror = () => {
                idx++;
                if (idx < candidates.length) {
                    img.src = candidates[idx];
                }
            };

            img.onclick = e => {
                e.preventDefault();
                e.stopPropagation();
                showDetailPanel(img, p);
            };
            drop.appendChild(img);
        }
    }

    function place(count) {
        css();
        let wrap = document.getElementById(BTN_ID);
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = BTN_ID;
            wrap.title = 'Referências (pais)\nClique para abrir/fechar';
            wrap.setAttribute('role', 'button');
            wrap.setAttribute('aria-label', 'Referências dos pais');
            wrap.textContent = '🔍';
            document.body.appendChild(wrap);

            wrap.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                const d = document.getElementById(DROP_ID);
                if (d) {
                    const opening = !d.classList.contains('open');
                    d.classList.toggle('open');
                    if (!opening) {
                        hideDetailPanel();
                        clearFixedPanelPos();
                    }
                }
                schedulePos();
            });

            document.addEventListener('click', e => {
                const drop = document.getElementById(DROP_ID);
                const btn = document.getElementById(BTN_ID);
                const panel = document.getElementById('dani-detail-panel');
                const t = e.target;
                if (panel && panel.classList.contains('open') && !panel.contains(t) && !drop?.contains(t)) {
                    hideDetailPanel();
                }
                if (drop && btn && !drop.contains(t) && !btn.contains(t) && !(panel && panel.contains(t))) {
                    drop.classList.remove('open');
                    clearFixedPanelPos();
                }
            }, true);
        }

        let countEl = wrap.querySelector('.count');
        if (count > 0) {
            if (!countEl) {
                countEl = document.createElement('span');
                countEl.className = 'count';
                wrap.appendChild(countEl);
            }
            countEl.textContent = String(count);
        } else if (countEl) {
            countEl.remove();
        }

        wrap.classList.toggle('empty', count === 0);
        schedulePos();
    }

    async function run() {
        const uuid = getPostUuid();
        if (!uuid) {
            document.getElementById(BTN_ID)?.remove();
            document.getElementById(DROP_ID)?.remove();
            return;
        }

        place(0);

        const parents = await collectParents(uuid);
        place(parents.length);
        renderDrop(parents);
    }

    function start() {
        run();

        const obs = new MutationObserver(schedulePos);
        obs.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        window.addEventListener('resize', schedulePos);
        window.addEventListener('orientationchange', () => setTimeout(schedulePos, 150));
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', schedulePos);
            window.visualViewport.addEventListener('scroll', schedulePos);
        }

        const push = history.pushState;
        const replace = history.replaceState;
        history.pushState = function () {
            push.apply(this, arguments);
            setTimeout(run, 200);
        };
        history.replaceState = function () {
            replace.apply(this, arguments);
            setTimeout(run, 200);
        };
        window.addEventListener('popstate', () => setTimeout(run, 200));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

// ========== SCRIPT 2: Lupa (Twitter/X + genéricos) – multi-media improved + UUID validation on external sites ==========
(function () {
    'use strict';

    const host = location.hostname.toLowerCase();
    const isGrok = host === 'grok.com' || host.endsWith('.grok.com') || host.includes('grok.com');
    const isRedgifs = host === 'redgifs.com' || host.endsWith('.redgifs.com') || host.includes('redgifs.com');

    if (isGrok || isRedgifs) return;

    const MAKE_IMAGINE_LINK = uuid => `https://grok.com/imagine/post/${uuid}`;
    const MAKE_THUMB_LINK  = uuid => `https://grok.com/imagine/post/${uuid}/image`;
    const BYTES_TO_FETCH = 65536;
    const MARKER = 'titlex$';
    const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const ICON_CLASS = 'titlex-ani';
    const ICON_CLASS_X = 'grok-uuid-icon';

    const checkedUrls = new Set();
    const mediaState = new WeakMap();
    const thumbCache = new Map();
    let iconsVisible = true;

    GM_addStyle(`
        .${ICON_CLASS}, .${ICON_CLASS_X} {
            position: absolute !important;
            bottom: 4px !important;
            right: 4px !important;
            z-index: 2147483647 !important;
            width: 22px !important;
            height: 22px !important;
            font-size: 16px !important;
            line-height: 22px !important;
            text-align: center !important;
            cursor: pointer !important;
            transition: transform .15s ease, opacity .15s ease !important;
            user-select: none !important;
            pointer-events: auto !important;
            opacity: .9 !important;
            filter: drop-shadow(0 0 2px rgba(0,0,0,.85));
            background: rgba(0,0,0,.55) !important;
            border-radius: 6px !important;
            touch-action: manipulation !important;
        }
        .${ICON_CLASS}:hover, .${ICON_CLASS_X}:hover {
            transform: scale(1.25) !important;
            opacity: 1 !important;
        }
        .${ICON_CLASS}.hidden, .${ICON_CLASS_X}.hidden {
            display: none !important;
        }

        .grok-thumbs-below {
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 6px !important;
            margin-top: 8px !important;
            padding: 0 4px !important;
            max-width: 100% !important;
        }
        .grok-thumbs-below .grok-thumb-item {
            width: 64px !important;
            height: 64px !important;
            border-radius: 8px !important;
            overflow: hidden !important;
            cursor: pointer !important;
            position: relative !important;
            border: 1px solid rgba(255,255,255,0.12) !important;
            transition: transform .15s ease, border-color .15s ease !important;
            background: #1a1a22 !important;
            flex-shrink: 0 !important;
            touch-action: manipulation !important;
        }
        .grok-thumbs-below .grok-thumb-item:hover {
            transform: scale(1.06) !important;
            border-color: rgba(100, 200, 255, 0.65) !important;
        }
        .grok-thumbs-below .grok-thumb-item img {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            display: block !important;
        }
        .grok-thumbs-below .grok-thumb-item .badge {
            position: absolute !important;
            bottom: 3px !important;
            right: 3px !important;
            background: rgba(0,0,0,0.75) !important;
            color: #fff !important;
            font-size: 10px !important;
            padding: 1px 4px !important;
            border-radius: 4px !important;
            pointer-events: none !important;
        }
        .grok-thumbs-below .grok-thumb-item.placeholder {
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            background: linear-gradient(135deg, #1a1a22 0%, #2a2a35 100%) !important;
            border-color: rgba(100, 180, 255, 0.35) !important;
        }
        .grok-thumbs-below .grok-thumb-item.placeholder .ph-icon {
            font-size: 22px !important;
            line-height: 1 !important;
            opacity: 0.85 !important;
            filter: drop-shadow(0 0 3px rgba(0,0,0,.6));
        }
        .grok-thumbs-below .grok-thumb-item.placeholder .ph-label {
            position: absolute !important;
            bottom: 3px !important;
            left: 3px !important;
            right: 3px !important;
            font-size: 8px !important;
            color: rgba(255,255,255,0.7) !important;
            text-align: center !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            pointer-events: none !important;
        }
        .grok-thumbs-below .grok-thumb-item.placeholder.missing-thumb {
            flex-direction: column !important;
            gap: 2px !important;
            border-color: rgba(251, 191, 36, 0.45) !important;
        }
        .grok-thumbs-below .grok-thumb-item.placeholder.missing-thumb .ph-missing {
            font-size: 10px !important;
            font-weight: 700 !important;
            line-height: 1.15 !important;
            text-align: center !important;
            color: rgba(251, 191, 36, 0.95) !important;
            white-space: pre-line !important;
            pointer-events: none !important;
            padding: 0 4px !important;
        }

        .grok-lupa-dropdown {
            position: fixed !important;
            z-index: 2147483647 !important;
            background: rgba(12, 12, 18, 0.97) !important;
            border: 1px solid rgba(255,255,255,0.14) !important;
            border-radius: 14px !important;
            padding: 10px !important;
            box-shadow: 0 12px 40px rgba(0,0,0,0.6) !important;
            backdrop-filter: blur(16px) !important;
            display: grid !important;
            grid-template-columns: repeat(2, 78px) !important;
            gap: 8px !important;
            max-width: 180px !important;
            max-height: 300px !important;
            overflow-y: auto !important;
            animation: grokFadeIn .18s ease !important;
            -webkit-overflow-scrolling: touch !important;
        }
        @keyframes grokFadeIn {
            from { opacity: 0; transform: translateY(8px) scale(0.95); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .grok-lupa-item {
            width: 78px !important;
            height: 78px !important;
            border-radius: 10px !important;
            overflow: hidden !important;
            cursor: pointer !important;
            position: relative !important;
            border: 1px solid rgba(255,255,255,0.12) !important;
            transition: transform .15s ease, border-color .15s ease !important;
            background: #1a1a22 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            touch-action: manipulation !important;
        }
        .grok-lupa-item:hover {
            transform: scale(1.07) !important;
            border-color: rgba(100, 200, 255, 0.65) !important;
        }
        .grok-lupa-item img {
            width: 100% !important;
            height: 100% !important;
            object-fit: cover !important;
            display: block !important;
        }
        .grok-lupa-item .badge {
            position: absolute !important;
            bottom: 4px !important;
            right: 4px !important;
            background: rgba(0,0,0,0.75) !important;
            color: #fff !important;
            font-size: 10px !important;
            padding: 1px 5px !important;
            border-radius: 5px !important;
            pointer-events: none !important;
        }

        @media (max-width: 767px) {
            .grok-thumbs-below .grok-thumb-item {
                width: 72px !important;
                height: 72px !important;
            }
            .${ICON_CLASS}, .${ICON_CLASS_X} {
                width: 28px !important;
                height: 28px !important;
                font-size: 18px !important;
                line-height: 28px !important;
                bottom: 6px !important;
                right: 6px !important;
            }
        }

        #lupa-detail-panel{
            position:fixed!important;z-index:2147483647!important;
            display:none!important;flex-direction:column!important;
            width:340px!important;height:640px!important;
            max-width:calc(100vw - 16px)!important;max-height:calc(100vh - 16px)!important;
            overflow:hidden!important;padding:0!important;border-radius:14px!important;
            background:rgba(16,15,14,.98)!important;
            border:1px solid rgba(255,255,255,.14)!important;
            box-shadow:0 16px 48px rgba(0,0,0,.65)!important;
            color:#f0ebe6!important;font-size:12px!important;line-height:1.45!important;
            font-family:system-ui,-apple-system,sans-serif!important;
            -webkit-overflow-scrolling:touch!important;box-sizing:border-box!important;
        }
        #lupa-detail-panel.open{display:flex!important}
        #lupa-detail-panel .dp-head{
            display:flex!important;align-items:center!important;justify-content:space-between!important;
            padding:10px 12px 8px!important;border-bottom:1px solid rgba(255,255,255,.08)!important;flex-shrink:0!important;
        }
        #lupa-detail-panel .dp-title{font-size:13px!important;font-weight:600!important;opacity:.9!important}
        #lupa-detail-panel .dp-close{
            width:28px!important;height:28px!important;border:none!important;border-radius:8px!important;
            background:rgba(255,255,255,.08)!important;color:#fff!important;font-size:16px!important;
            cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;
            padding:0!important;touch-action:manipulation!important;
        }
        #lupa-detail-panel .dp-close:hover{background:rgba(255,255,255,.16)!important}
        #lupa-detail-panel .dp-body{overflow-y:auto!important;padding:12px!important;flex:1!important;min-height:0!important}
        #lupa-detail-panel .dp-thumb-wrap{
            display:flex!important;justify-content:center!important;margin-bottom:12px!important;
            border-radius:10px!important;overflow:hidden!important;background:#1a1918!important;flex-shrink:0!important;
        }
        #lupa-detail-panel .dp-thumb{
            height:200px!important;width:auto!important;max-width:100%!important;
            object-fit:contain!important;display:block!important;background:#1a1918!important;
        }
        #lupa-detail-panel .dp-row{margin-bottom:8px!important;font-size:12px!important;line-height:1.45!important;flex-shrink:0!important}
        #lupa-detail-panel .dp-label{
            display:block!important;opacity:.5!important;font-weight:600!important;font-size:10px!important;
            text-transform:uppercase!important;letter-spacing:.04em!important;margin-bottom:2px!important;
        }
        #lupa-detail-panel .dp-value{word-break:break-word!important}
        #lupa-detail-panel .dp-uuid{font-family:ui-monospace,monospace!important;font-size:11px!important;word-break:break-all!important;opacity:.9!important}
        #lupa-detail-panel .dp-prompt-box{
            margin-top:4px!important;padding:10px!important;background:rgba(255,255,255,.04)!important;
            border:1px solid rgba(255,255,255,.08)!important;border-radius:8px!important;
            white-space:pre-wrap!important;word-break:break-word!important;
            max-height:calc(1.5em * 6 + 20px)!important;overflow-y:auto!important;
            font-size:12px!important;line-height:1.5!important;-webkit-overflow-scrolling:touch!important;
        }
        #lupa-detail-panel .dp-prompt-empty{opacity:.5!important;font-style:italic!important}
        #lupa-detail-panel .dp-actions{
            display:flex!important;flex-wrap:wrap!important;gap:8px!important;
            padding:10px 12px 12px!important;border-top:1px solid rgba(255,255,255,.08)!important;flex-shrink:0!important;
        }
        #lupa-detail-panel .dp-btn{
            display:inline-flex!important;align-items:center!important;justify-content:center!important;
            gap:6px!important;padding:8px 12px!important;border-radius:8px!important;border:none!important;
            font-size:12px!important;font-weight:600!important;cursor:pointer!important;
            touch-action:manipulation!important;text-decoration:none!important;color:#fff!important;
            transition:background .12s,transform .12s!important;
        }
        #lupa-detail-panel .dp-btn:active{transform:scale(.97)!important}
        #lupa-detail-panel .dp-btn-open{background:#299fff!important}
        #lupa-detail-panel .dp-btn-open:hover{background:#1a8ee6!important}
        #lupa-detail-panel .dp-btn-copy{
            background:rgba(255,255,255,.1)!important;border:1px solid rgba(255,255,255,.14)!important;
        }
        #lupa-detail-panel .dp-btn-copy:hover{background:rgba(255,255,255,.18)!important}
        #lupa-detail-panel .dp-btn-copy.copied{background:#16a34a!important;border-color:transparent!important}
        #lupa-detail-panel .dp-loading{opacity:.6!important;font-style:italic!important;padding:8px 0!important}
    `);

    // Shared UUID validation (X + external sites)
    // Primary: GET /rest/assets/{uuid} — must return a real asset (not SPA shell).
    // Secondary: try /imagine/post/{uuid}/image for thumbnail.
    // Returns { ok, thumb, missingThumb } or null if not a Grok asset.
    function validateUUID(uuid) {
        if (!uuid) return Promise.resolve(null);
        const key = String(uuid).toLowerCase();
        if (thumbCache.has(key)) {
            return Promise.resolve(thumbCache.get(key));
        }

        function fetchThumbBlob() {
            return new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: MAKE_THUMB_LINK(key),
                    responseType: 'blob',
                    timeout: 7000,
                    onload(res) {
                        if (res.status < 200 || res.status >= 300 || !res.response) {
                            resolve(null);
                            return;
                        }
                        const blob = res.response;
                        const type = (blob.type || '').toLowerCase();
                        if (type.startsWith('image/') && blob.size > 1500) {
                            resolve(URL.createObjectURL(blob));
                            return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                            const text = (reader.result || '').toLowerCase();
                            const isError =
                                text.includes('media post not found') ||
                                text.includes('post not found') ||
                                text.includes('not found') ||
                                text.includes('<!doctype') ||
                                text.includes('<html');
                            if (isError || blob.size < 2000) resolve(null);
                            else resolve(URL.createObjectURL(blob));
                        };
                        reader.onerror = () => resolve(null);
                        reader.readAsText(blob.slice(0, 2500));
                    },
                    onerror() { resolve(null); },
                    ontimeout() { resolve(null); }
                });
            });
        }

        function isRealAsset(data) {
            if (!data || typeof data !== 'object') return false;
            if (data.error || data.message === 'not found') return false;
            return !!(
                data.assetId || data.id || data.key || data.mimeType || data.mime_type ||
                data.mediaGenInput || data.ownerUserId || data.createTime || data.createdAt ||
                data.auxKeys || data.summary
            );
        }

        function finishWithThumb(resolve) {
            // Fallback that works on external sites without Grok login cookies
            fetchThumbBlob().then(thumb => {
                if (thumb) {
                    const result = { ok: true, thumb, missingThumb: false };
                    thumbCache.set(key, result);
                    resolve(result);
                } else {
                    // Still mark as valid-but-missing-thumb if we only know UUID is plausible
                    // but without a real image we reject (same as 1.0)
                    thumbCache.set(key, null);
                    resolve(null);
                }
            });
        }

        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://grok.com/rest/assets/' + encodeURIComponent(key),
                headers: { Accept: 'application/json' },
                timeout: 9000,
                onload(res) {
                    // 401/403 common on external sites (no session cookies) → fall back to /image
                    if (res.status === 401 || res.status === 403) {
                        finishWithThumb(resolve);
                        return;
                    }
                    if (res.status === 404) {
                        thumbCache.set(key, null);
                        resolve(null);
                        return;
                    }
                    if (res.status < 200 || res.status >= 300) {
                        // Network / other errors → still try image fallback
                        finishWithThumb(resolve);
                        return;
                    }
                    let asset = null;
                    try {
                        const data = JSON.parse(res.responseText);
                        asset = data?.asset ?? data;
                    } catch {
                        finishWithThumb(resolve);
                        return;
                    }
                    if (!isRealAsset(asset)) {
                        // SPA shell or empty → try image (public posts still have /image)
                        finishWithThumb(resolve);
                        return;
                    }

                    // Confirmed Grok asset → try thumbnail
                    fetchThumbBlob().then(thumb => {
                        const result = {
                            ok: true,
                            thumb: thumb || null,
                            missingThumb: !thumb
                        };
                        thumbCache.set(key, result);
                        resolve(result);
                    });
                },
                onerror() {
                    // Cross-origin / network fail → image fallback (1.0 behaviour)
                    finishWithThumb(resolve);
                },
                ontimeout() {
                    finishWithThumb(resolve);
                }
            });
        });
    }


    // Prefer top-level document so panels are never clipped inside iframes
    function getTopDoc() {
        try {
            if (window.top && window.top.document && window.top.document.body) return window.top.document;
        } catch (e) {}
        try {
            if (window.parent && window.parent !== window && window.parent.document && window.parent.document.body)
                return window.parent.document;
        } catch (e) {}
        return document;
    }

    function getTopWin() {
        try {
            if (window.top && window.top.document) return window.top;
        } catch (e) {}
        try {
            if (window.parent && window.parent.document) return window.parent;
        } catch (e) {}
        return window;
    }

    /** Bounding rect in top-page viewport coordinates (works from inside same-origin iframes) */
    function getPageRect(el) {
        if (!el || !el.getBoundingClientRect) {
            return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        }
        const r = el.getBoundingClientRect();
        let left = r.left;
        let top = r.top;
        try {
            if (window !== window.top) {
                let w = window;
                while (w !== w.top) {
                    const frame = w.frameElement;
                    if (!frame) break;
                    const fr = frame.getBoundingClientRect();
                    left += fr.left;
                    top += fr.top;
                    w = w.parent;
                }
            }
        } catch (e) {
            // cross-origin: fall back to local rect
        }
        return {
            left, top,
            right: left + r.width,
            bottom: top + r.height,
            width: r.width,
            height: r.height
        };
    }

    const LUPA_PANEL_CSS = `
#lupa-detail-panel{position:fixed!important;z-index:2147483647!important;display:none!important;flex-direction:column!important;width:340px!important;height:640px!important;max-width:calc(100vw - 16px)!important;max-height:calc(100vh - 16px)!important;overflow:hidden!important;padding:0!important;border-radius:14px!important;background:rgba(16,15,14,.98)!important;border:1px solid rgba(255,255,255,.14)!important;box-shadow:0 16px 48px rgba(0,0,0,.65)!important;color:#f0ebe6!important;font-size:12px!important;line-height:1.45!important;font-family:system-ui,-apple-system,sans-serif!important;-webkit-overflow-scrolling:touch!important;box-sizing:border-box!important}
#lupa-detail-panel.open{display:flex!important}
#lupa-detail-panel .dp-head{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:10px 12px 8px!important;border-bottom:1px solid rgba(255,255,255,.08)!important;flex-shrink:0!important}
#lupa-detail-panel .dp-title{font-size:13px!important;font-weight:600!important;opacity:.9!important}
#lupa-detail-panel .dp-close{width:28px!important;height:28px!important;border:none!important;border-radius:8px!important;background:rgba(255,255,255,.08)!important;color:#fff!important;font-size:16px!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:0!important}
#lupa-detail-panel .dp-close:hover{background:rgba(255,255,255,.16)!important}
#lupa-detail-panel .dp-body{overflow-y:auto!important;padding:12px!important;flex:1!important;min-height:0!important}
#lupa-detail-panel .dp-thumb-wrap{display:flex!important;justify-content:center!important;margin-bottom:12px!important;border-radius:10px!important;overflow:hidden!important;background:#1a1918!important;flex-shrink:0!important}
#lupa-detail-panel .dp-thumb{height:200px!important;width:auto!important;max-width:100%!important;object-fit:contain!important;display:block!important;background:#1a1918!important}
#lupa-detail-panel .dp-row{margin-bottom:8px!important;font-size:12px!important;line-height:1.45!important;flex-shrink:0!important}
#lupa-detail-panel .dp-label{display:block!important;opacity:.5!important;font-weight:600!important;font-size:10px!important;text-transform:uppercase!important;letter-spacing:.04em!important;margin-bottom:2px!important}
#lupa-detail-panel .dp-value{word-break:break-word!important}
#lupa-detail-panel .dp-uuid{font-family:ui-monospace,monospace!important;font-size:11px!important;word-break:break-all!important;opacity:.9!important}
#lupa-detail-panel .dp-prompt-box{margin-top:4px!important;padding:10px!important;background:rgba(255,255,255,.04)!important;border:1px solid rgba(255,255,255,.08)!important;border-radius:8px!important;white-space:pre-wrap!important;word-break:break-word!important;max-height:calc(1.5em * 6 + 20px)!important;overflow-y:auto!important;font-size:12px!important;line-height:1.5!important}
#lupa-detail-panel .dp-prompt-empty{opacity:.5!important;font-style:italic!important}
#lupa-detail-panel .dp-actions{display:flex!important;flex-wrap:wrap!important;gap:8px!important;padding:10px 12px 12px!important;border-top:1px solid rgba(255,255,255,.08)!important;flex-shrink:0!important}
#lupa-detail-panel .dp-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;padding:8px 12px!important;border-radius:8px!important;border:none!important;font-size:12px!important;font-weight:600!important;cursor:pointer!important;text-decoration:none!important;color:#fff!important}
#lupa-detail-panel .dp-btn-open{background:#299fff!important}
#lupa-detail-panel .dp-btn-open:hover{background:#1a8ee6!important}
#lupa-detail-panel .dp-btn-copy{background:rgba(255,255,255,.1)!important;border:1px solid rgba(255,255,255,.14)!important}
#lupa-detail-panel .dp-btn-copy:hover{background:rgba(255,255,255,.18)!important}
#lupa-detail-panel .dp-btn-copy.copied{background:#16a34a!important;border-color:transparent!important}
#lupa-detail-panel .dp-loading{opacity:.6!important;font-style:italic!important}
`;

    // ---- Detail panel (same as Grok thumbs) for X + Lupa ----
    const metaCache = new Map();
    let lupaFixedPos = null;
    let lastLupaUuid = null;

    function extractPromptFromAsset(data) {
        if (!data) return '';
        const mgi = data.mediaGenInput;
        if (mgi && typeof mgi === 'object') {
            const KINDS = ['textToImage', 'imageToImage', 'textToVideo', 'imageToVideo', 'referenceToVideo', 'videoExtension'];
            for (const k of KINDS) {
                const block = mgi[k];
                if (block && typeof block === 'object' && block.prompt) return String(block.prompt).trim();
            }
            for (const value of Object.values(mgi)) {
                if (value && typeof value === 'object' && value.prompt) return String(value.prompt).trim();
            }
        }
        return String(data.summary || data.prompt || data.originalPrompt || '').trim();
    }

    function extractMetaFromAsset(data) {
        if (!data) return { kind: '', ext: '', created: '' };
        const mime = String(data.mimeType || data.mime_type || '').toLowerCase();
        let kind = '', ext = '';
        if (mime.startsWith('video/') || /video/i.test(mime)) {
            kind = 'Video';
            if (mime.includes('webm')) ext = '.webm';
            else if (mime.includes('mov') || mime.includes('quicktime')) ext = '.mov';
            else ext = '.mp4';
        } else if (mime.startsWith('image/') || mime) {
            kind = 'Image';
            if (mime.includes('png')) ext = '.png';
            else if (mime.includes('webp')) ext = '.webp';
            else if (mime.includes('gif')) ext = '.gif';
            else ext = '.jpg';
        } else {
            const keys = data.mediaGenInput ? Object.keys(data.mediaGenInput).join(' ').toLowerCase() : '';
            if (/video/.test(keys)) { kind = 'Video'; ext = '.mp4'; }
            else { kind = 'Image'; ext = '.jpg'; }
        }
        let created = '';
        const raw = data.createTime || data.createdAt || data.create_time || data.created_at || '';
        if (raw) {
            const d = new Date(raw);
            created = !Number.isNaN(d.getTime())
                ? d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : String(raw);
        }
        return { kind, ext, created };
    }

    function fetchGrokAssetMeta(uuid) {
        const key = String(uuid).toLowerCase();
        if (metaCache.has(key)) return Promise.resolve(metaCache.get(key));
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://grok.com/rest/assets/' + encodeURIComponent(key),
                headers: { Accept: 'application/json' },
                timeout: 9000,
                onload(res) {
                    if (res.status < 200 || res.status >= 300) {
                        metaCache.set(key, null);
                        resolve(null);
                        return;
                    }
                    try {
                        const data = JSON.parse(res.responseText);
                        const asset = data?.asset ?? data;
                        metaCache.set(key, asset);
                        resolve(asset);
                    } catch {
                        metaCache.set(key, null);
                        resolve(null);
                    }
                },
                onerror() { metaCache.set(key, null); resolve(null); },
                ontimeout() { metaCache.set(key, null); resolve(null); }
            });
        });
    }

    function getLupaPanel() {
        const topDoc = getTopDoc();
        // Ensure panel CSS exists on the document that hosts the panel
        if (!topDoc.getElementById('lupa-detail-panel-css')) {
            const style = topDoc.createElement('style');
            style.id = 'lupa-detail-panel-css';
            style.textContent = LUPA_PANEL_CSS;
            (topDoc.head || topDoc.documentElement).appendChild(style);
        }
        let panel = topDoc.getElementById('lupa-detail-panel');
        if (!panel) {
            panel = topDoc.createElement('div');
            panel.id = 'lupa-detail-panel';
            (topDoc.body || topDoc.documentElement).appendChild(panel);
        }
        return panel;
    }

    function hideLupaPanel() {
        const panel = getTopDoc().getElementById('lupa-detail-panel');
        if (panel) panel.classList.remove('open');
        lastLupaUuid = null;
    }

    function positionLupaPanel(anchorEl) {
        const panel = getLupaPanel();
        if (lupaFixedPos) {
            panel.style.left = lupaFixedPos.left + 'px';
            panel.style.top = lupaFixedPos.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.width = '340px';
            panel.style.height = '640px';
            return;
        }
        const topWin = getTopWin();
        const winW = topWin.innerWidth || window.innerWidth;
        const winH = topWin.innerHeight || window.innerHeight;
        // Page-level rect so coordinates work even when the icon is inside an iframe
        const r = getPageRect(anchorEl || document.body);
        const pw = 340, ph = 640;
        let left = r.right + 12;
        if (left + pw > winW - 8) left = Math.max(8, r.left - pw - 12);
        if (left < 8) left = 8;
        let top = r.top;
        if (top + ph > winH - 8) top = Math.max(8, winH - ph - 8);
        if (top < 8) top = 8;
        left = Math.round(left);
        top = Math.round(top);
        lupaFixedPos = { left, top };
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.width = '340px';
        panel.style.height = '640px';
    }

    function buildLupaPanelContent(panel, info) {
        panel.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'dp-head';
        const title = document.createElement('div');
        title.className = 'dp-title';
        title.textContent = 'Grok reference';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'dp-close';
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); hideLupaPanel(); };
        head.appendChild(title);
        head.appendChild(closeBtn);
        panel.appendChild(head);

        const body = document.createElement('div');
        body.className = 'dp-body';

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'dp-thumb-wrap';
        const big = document.createElement('img');
        big.className = 'dp-thumb';
        big.alt = '';
        big.loading = 'lazy';
        if (info.thumb) {
            big.src = info.thumb;
        } else {
            big.src = MAKE_THUMB_LINK(info.uuid);
            big.onerror = () => { big.style.display = 'none'; };
        }
        thumbWrap.appendChild(big);
        body.appendChild(thumbWrap);

        if (info.kind || info.ext) {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">File Type</span>';
            const val = document.createElement('div');
            val.className = 'dp-value';
            val.textContent = info.kind && info.ext ? `${info.kind}${info.ext}` : (info.kind || info.ext || '—');
            row.appendChild(val);
            body.appendChild(row);
        }
        if (info.created) {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">Created</span>';
            const val = document.createElement('div');
            val.className = 'dp-value';
            val.textContent = info.created;
            row.appendChild(val);
            body.appendChild(row);
        }
        {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">UUID</span>';
            const val = document.createElement('div');
            val.className = 'dp-value dp-uuid';
            val.textContent = info.uuid;
            row.appendChild(val);
            body.appendChild(row);
        }
        {
            const row = document.createElement('div');
            row.className = 'dp-row';
            row.innerHTML = '<span class="dp-label">Prompt</span>';
            const box = document.createElement('div');
            box.className = 'dp-prompt-box';
            const text = (info.prompt || '').trim();
            if (text) box.textContent = text;
            else { box.classList.add('dp-prompt-empty'); box.textContent = '(not available)'; }
            row.appendChild(box);
            body.appendChild(row);
        }
        panel.appendChild(body);

        const actions = document.createElement('div');
        actions.className = 'dp-actions';
        const openLink = document.createElement('a');
        openLink.className = 'dp-btn dp-btn-open';
        openLink.href = MAKE_IMAGINE_LINK(info.uuid);
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open on Imagine';
        openLink.onclick = e => e.stopPropagation();
        actions.appendChild(openLink);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'dp-btn dp-btn-copy';
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy prompt';
        copyBtn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            const text = (info.prompt || '').trim();
            if (!text) return;
            const done = () => {
                copyBtn.textContent = 'Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => { copyBtn.textContent = 'Copy prompt'; copyBtn.classList.remove('copied'); }, 1600);
            };
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:fixed;left:-9999px;';
                    document.body.appendChild(ta);
                    ta.select();
                    try { document.execCommand('copy'); } catch {}
                    ta.remove();
                    done();
                });
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;left:-9999px;';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch {}
                ta.remove();
                done();
            }
        };
        actions.appendChild(copyBtn);
        panel.appendChild(actions);
    }

    async function showLupaDetailPanel(anchorEl, uuid, opts = {}) {
        const u = String(uuid).toLowerCase();
        // Toggle: click same thumb/icon again closes the panel
        if (lastLupaUuid === u) {
            hideLupaPanel();
            return;
        }
        lastLupaUuid = u;

        const panel = getLupaPanel();

        // Loading state
        buildLupaPanelContent(panel, {
            uuid: u,
            thumb: opts.thumb || null,
            kind: opts.isVideo ? 'Video' : (opts.kind || ''),
            ext: opts.ext || '',
            created: '',
            prompt: ''
        });
        // Show loading hint in prompt area
        const promptBox = panel.querySelector('.dp-prompt-box');
        if (promptBox) {
            promptBox.classList.add('dp-loading');
            promptBox.textContent = 'Loading…';
        }
        panel.classList.add('open');
        requestAnimationFrame(() => positionLupaPanel(anchorEl));

        let thumb = opts.thumb || null;
        if (!thumb) {
            try {
                const vr = await validateUUID(u);
                if (vr && vr.thumb) thumb = vr.thumb;
            } catch {}
        }
        let asset = null;
        try { asset = await fetchGrokAssetMeta(u); } catch {}
        const meta = extractMetaFromAsset(asset);
        const prompt = extractPromptFromAsset(asset);
        // Prefer known video flag from X
        if (opts.isVideo && !meta.kind) {
            meta.kind = 'Video';
            meta.ext = meta.ext || '.mp4';
        }

        buildLupaPanelContent(panel, {
            uuid: u,
            thumb: thumb || null,
            kind: meta.kind || opts.kind || '',
            ext: meta.ext || opts.ext || '',
            created: meta.created || '',
            prompt
        });
        requestAnimationFrame(() => positionLupaPanel(anchorEl));
    }

    function toggleIcons() {
        iconsVisible = !iconsVisible;
        document.querySelectorAll(`.${ICON_CLASS}, .${ICON_CLASS_X}`).forEach(i => {
            i.classList.toggle('hidden', !iconsVisible);
        });
        document.querySelectorAll('.grok-thumbs-below').forEach(c => {
            c.style.display = iconsVisible ? 'flex' : 'none';
        });
        document.querySelectorAll('.grok-lupa-dropdown').forEach(d => d.remove());
        if (!iconsVisible) hideLupaPanel();
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'F4' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            toggleIcons();
        }
    }, true);

    function onDocClickCloseLupa(e) {
        try {
            if (!e.target.closest('.grok-lupa-dropdown') && !e.target.closest(`.${ICON_CLASS_X}`)) {
                document.querySelectorAll('.grok-lupa-dropdown').forEach(d => d.remove());
            }
        } catch (err) {}
        try {
            const panel = getTopDoc().getElementById('lupa-detail-panel');
            if (panel && panel.classList.contains('open') && !panel.contains(e.target) &&
                !e.target.closest('.grok-thumb-item') && !e.target.closest(`.${ICON_CLASS}`) &&
                !e.target.closest(`.${ICON_CLASS_X}`)) {
                hideLupaPanel();
                lupaFixedPos = null;
            }
        } catch (err) {}
    }
    document.addEventListener('click', onDocClickCloseLupa, true);
    try {
        const td = getTopDoc();
        if (td !== document) td.addEventListener('click', onDocClickCloseLupa, true);
    } catch (e) {}

    function createIcon(uuid, cls = ICON_CLASS) {
        const icon = document.createElement('span');
        icon.className = cls;
        if (!iconsVisible) icon.classList.add('hidden');
        icon.textContent = '🔍';
        icon.title = `UUID: ${uuid}\nClick for details\nF4 to toggle`;
        icon.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            showLupaDetailPanel(icon, uuid);
        };
        return icon;
    }

    function ensureRelative(el) {
        if (!el) return null;
        if (getComputedStyle(el).position === 'static') {
            if (el.parentElement) {
                const w = document.createElement('span');
                w.style.cssText = 'position:relative;display:inline-block;max-width:100%;line-height:0;';
                el.parentElement.insertBefore(w, el);
                w.appendChild(el);
                return w;
            }
            el.style.position = 'relative';
        }
        return el;
    }

    function addAniToMedia(media, uuid) {
        if (!uuid || media.dataset.titlexUuid === uuid) return;
        media.dataset.titlexUuid = uuid;
        media.parentElement?.querySelectorAll(`.${ICON_CLASS}`).forEach(e => e.remove());
        const container = ensureRelative(media.parentElement) || media.parentElement;
        if (container) {
            container.appendChild(createIcon(uuid));
        }
    }

    // External sites: old 1.0 logic — validate only via /image (no /rest/assets required)
    async function addAniToMediaIfValid(media, uuid) {
        if (!uuid || !media || media.dataset.titlexUuid === uuid) return;
        try {
            const key = String(uuid).toLowerCase();
            // Reuse cache when present
            if (thumbCache.has(key)) {
                const cached = thumbCache.get(key);
                if (cached && (cached === true || cached.ok || (typeof cached === 'string' && cached))) {
                    addAniToMedia(media, uuid);
                }
                return;
            }
            await new Promise(resolve => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: MAKE_THUMB_LINK(key),
                    responseType: 'blob',
                    timeout: 7000,
                    onload(res) {
                        if (res.status < 200 || res.status >= 300 || !res.response) {
                            thumbCache.set(key, null);
                            resolve();
                            return;
                        }
                        const blob = res.response;
                        const type = (blob.type || '').toLowerCase();
                        if (type.startsWith('image/') && blob.size > 1500) {
                            thumbCache.set(key, { ok: true, thumb: URL.createObjectURL(blob), missingThumb: false });
                            addAniToMedia(media, uuid);
                            resolve();
                            return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                            const text = (reader.result || '').toLowerCase();
                            const isError =
                                text.includes('media post not found') ||
                                text.includes('post not found') ||
                                text.includes('not found') ||
                                text.includes('<!doctype') ||
                                text.includes('<html');
                            if (isError || blob.size < 2000) {
                                thumbCache.set(key, null);
                            } else {
                                thumbCache.set(key, { ok: true, thumb: URL.createObjectURL(blob), missingThumb: false });
                                addAniToMedia(media, uuid);
                            }
                            resolve();
                        };
                        reader.onerror = () => { thumbCache.set(key, null); resolve(); };
                        reader.readAsText(blob.slice(0, 2500));
                    },
                    onerror() { thumbCache.set(key, null); resolve(); },
                    ontimeout() { thumbCache.set(key, null); resolve(); }
                });
            });
        } catch {
            // ignore – no icon
        }
    }

    function isRedgifsUrl(url) {
        return url && /redgifs\.com/i.test(String(url));
    }

    function isInsideRedgifs(el) {
        let n = el;
        while (n) {
            if (n.tagName === 'IFRAME') {
                const src = n.src || n.getAttribute('src') || '';
                if (isRedgifsUrl(src)) return true;
            }
            if (n.tagName === 'SHREDDIT-EMBED' || n.classList?.contains('redgifs')) return true;
            n = n.parentElement;
        }
        return false;
    }

    function extractUuidFromExif(buffer) {
        try {
            const view = new DataView(buffer);
            if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;
            let offset = 2;
            while (offset < view.byteLength - 4) {
                if (view.getUint8(offset) !== 0xFF) break;
                const marker = view.getUint8(offset + 1);
                if (marker === 0xDA) break;
                const size = view.getUint16(offset + 2);
                if (marker === 0xE1 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
                    const tiff = offset + 10;
                    const little = view.getUint16(tiff) === 0x4949;
                    const r16 = o => view.getUint16(o, little);
                    const r32 = o => view.getUint32(o, little);
                    const ifd0 = tiff + r32(tiff + 4);
                    if (ifd0 >= view.byteLength) return null;
                    const entries = r16(ifd0);
                    for (let i = 0; i < entries; i++) {
                        const entry = ifd0 + 2 + i * 12;
                        if (entry + 12 > view.byteLength) break;
                        if (r16(entry) === 0x013B) {
                            const count = r32(entry + 4);
                            let vo = entry + 8;
                            if (count > 4) vo = tiff + r32(entry + 8);
                            if (vo + count > view.byteLength) return null;
                            let str = '';
                            for (let j = 0; j < count; j++) {
                                const c = view.getUint8(vo + j);
                                if (c === 0) break;
                                str += String.fromCharCode(c);
                            }
                            const m = str.match(UUID_REGEX);
                            if (m) return m[0];
                        }
                    }
                }
                offset += 2 + size;
            }
        } catch {}
        return null;
    }

    function extractUuidFromFilename(url, isVideo = false) {
        if (!url) return null;
        let filename = '', fn = null;
        try {
            const u = new URL(url);
            filename = decodeURIComponent(u.pathname.split('/').pop() || '');
            fn = u.searchParams.get('fn');
            if (fn) {
                fn = decodeURIComponent(fn);
                filename += ' ' + fn;
            }
        } catch {
            filename = url;
        }

        const gen = filename.match(/_generated_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (gen) return gen[1];

        if (isVideo) {
            if (fn) {
                const m = fn.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[a-z0-9]+)?$/i);
                if (m) return m[1];
            }
            const m2 = filename.match(/(?:^|[\s\/])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.[a-z0-9]+)?(?:$|[\s?&#])/i);
            if (m2) return m2[1];
        }
        if (/grok/i.test(filename)) {
            const m = filename.match(UUID_REGEX);
            if (m) return m[0];
        }
        return null;
    }

    function findUUIDInBuffer(buf) {
        try {
            const text = new TextDecoder('latin1').decode(buf);
            const idx = text.indexOf(MARKER);
            if (idx === -1) return null;
            const after = text.slice(idx + MARKER.length, idx + MARKER.length + 60);
            const m = after.match(UUID_REGEX);
            return m ? m[0] : null;
        } catch {
            return null;
        }
    }

    function checkUrl(url, media) {
        if (!url || isRedgifsUrl(url) || (media && isInsideRedgifs(media))) return;
        const clean = url.split(/["'\s<>]/)[0];
        if (isRedgifsUrl(clean)) return;

        const isImg = media?.tagName === 'IMG' || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(clean);
        const isVid = media?.tagName === 'VIDEO' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(clean);
        if (!isImg && !isVid) return;

        const fromName = extractUuidFromFilename(clean, isVid);
        if (fromName && media) addAniToMediaIfValid(media, fromName);

        if (checkedUrls.has(clean)) return;
        checkedUrls.add(clean);

        GM_xmlhttpRequest({
            method: 'GET',
            url: clean,
            headers: { Range: `bytes=0-${BYTES_TO_FETCH - 1}` },
            responseType: 'arraybuffer',
            timeout: 10000,
            onload(res) {
                if (res.status !== 200 && res.status !== 206) return;
                let uuid = null;
                if (isVid) uuid = findUUIDInBuffer(res.response);
                else if (isImg) uuid = extractUuidFromExif(res.response);
                if (uuid && media) addAniToMediaIfValid(media, uuid);
            }
        });
    }

    function processMedia(media) {
        if (!media || media.dataset.titlexUuid || isInsideRedgifs(media) || isRedgifsUrl(media.src) || isRedgifsUrl(media.currentSrc)) return;

        const state = mediaState.get(media) || { tries: 0, lastSrc: '' };
        const src = media.currentSrc || media.src || media.getAttribute('src') || '';
        if (src && src !== state.lastSrc) {
            state.tries = 0;
            state.lastSrc = src;
        }
        state.tries++;
        mediaState.set(media, state);
        if (state.tries > 10) return;

        const urls = new Set();
        if (media.src) urls.add(media.src);
        if (media.currentSrc) urls.add(media.currentSrc);
        if (media.tagName === 'VIDEO') media.querySelectorAll('source').forEach(s => s.src && urls.add(s.src));
        ['data-src', 'data-original', 'data-lazy-src', 'data-url'].forEach(a => {
            const v = media.getAttribute(a);
            if (v) urls.add(v);
        });
        if (media.tagName === 'IMG' && media.srcset) {
            media.srcset.split(',').forEach(p => {
                const u = p.trim().split(/\s+/)[0];
                if (u) urls.add(u);
            });
        }
        urls.forEach(u => checkUrl(u, media));
    }

    function scan() {
        document.querySelectorAll('video, img').forEach(processMedia);
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                const src = (iframe.src || iframe.getAttribute('src') || '').toLowerCase();
                if (src.includes('redgifs.com')) return;
                if (iframe.closest('shreddit-embed') || iframe.closest('[class*="redgifs"]')) return;
                const doc = iframe.contentDocument;
                if (doc) doc.querySelectorAll('video, img').forEach(processMedia);
            } catch {}
        });
    }

    // ========== Twitter / X – multi-media improved ==========
    const isX = location.hostname === 'x.com' || location.hostname === 'twitter.com' ||
                location.hostname.endsWith('.x.com') || location.hostname.endsWith('.twitter.com');

    if (isX) {
        const processed = new WeakSet();
        let scanning = false, timer = null;

        function extractMediaObjects(article) {
            const results = [];
            const seen = new Set();
            const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

            function addUuid(uuid, isVideo, source) {
                if (!uuid) return;
                const u = String(uuid).toLowerCase();
                if (!UUID_RE.test(u) || seen.has(u)) return;
                seen.add(u);
                results.push({ uuid: u, isVideo: !!isVideo, source: source || 'unknown' });
            }

            // --- 1) React Fiber walk – collect ALL grok_post_id (per media) ---
            const mediaSelectors = [
                '[data-testid="tweetPhoto"]',
                '[data-testid="videoComponent"]',
                '[data-testid="videoPlayer"]',
                '[data-testid="tweetText"]',
                'img[src*="pbs.twimg.com"]',
                'img[src*="twimg.com/media"]',
                'video'
            ];

            const startEls = [article];
            for (const sel of mediaSelectors) {
                article.querySelectorAll(sel).forEach(el => startEls.push(el));
            }

            for (const el of startEls) {
                let key;
                try {
                    key = Object.keys(el).find(k =>
                        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
                    );
                } catch { continue; }
                if (!key) continue;

                let fiber = el[key];
                let depth = 0;
                while (fiber && depth < 45) {
                    try {
                        if (fiber.memoizedProps) {
                            const str = JSON.stringify(fiber.memoizedProps);

                            // ONLY accept explicit grok_post_id — never random UUIDs near media_key/tweet text
                            const rePost = /"grok_post_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/gi;
                            let m;
                            while ((m = rePost.exec(str))) {
                                const chunk = str.slice(Math.max(0, m.index - 400), Math.min(str.length, m.index + 600));
                                const mediaKey = (chunk.match(/"media_key"\s*:\s*"([^"]+)"/) || [])[1];
                                const type = (chunk.match(/"type"\s*:\s*"([^"]+)"/) || [])[1];
                                const expanded = (chunk.match(/"expanded_url"\s*:\s*"([^"]+)"/) || [])[1] || '';
                                const isVideo = type === 'video' ||
                                    (mediaKey && mediaKey.startsWith('13_')) ||
                                    expanded.includes('/video/') ||
                                    chunk.includes('amplify_video') ||
                                    chunk.includes('"video_info"');
                                addUuid(m[1], isVideo, 'fiber-grok_post_id');
                            }
                        }
                    } catch {}
                    fiber = fiber.return;
                    depth++;
                }
            }

            // --- 2) Links / botões "Faça você mesmo" ---
            const DIY_RE = /faça\s*voc[eê]\s*mesmo|make\s*your\s*own|try\s*it\s*yourself|try\s*grok|remix|criar\s*o\s*seu|hazlo\s*t[uú]\s*mismo|create\s*your\s*own/i;

            article.querySelectorAll('a[href], button, [role="link"], [role="button"]').forEach(el => {
                try {
                    const href = (el.getAttribute('href') || el.href || '').toString();
                    const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();

                    // Direct Grok Imagine links only
                    if (/grok\.com\/imagine/i.test(href)) {
                        const m = href.match(UUID_RE);
                        if (m) addUuid(m[0], false, 'direct-link');
                    }

                    // DIY buttons: only UUIDs that appear in a grok.com URL in href/attrs
                    if (DIY_RE.test(text)) {
                        if (/grok\.com\/imagine/i.test(href)) {
                            const m = href.match(UUID_RE);
                            if (m) addUuid(m[0], false, 'diy-href');
                        }
                        for (const attr of el.attributes || []) {
                            const val = String(attr.value || '');
                            if (/grok\.com\/imagine/i.test(val)) {
                                const m = val.match(UUID_RE);
                                if (m) addUuid(m[0], false, 'diy-attr');
                            }
                        }
                        try {
                            const key = Object.keys(el).find(k =>
                                k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
                            );
                            if (key) {
                                let fiber = el[key], d = 0;
                                while (fiber && d < 25) {
                                    try {
                                        if (fiber.memoizedProps) {
                                            const str = JSON.stringify(fiber.memoizedProps);
                                            // Only UUID next to an explicit grok_post_id or grok.com/imagine URL
                                            const reGrok = /grok_post_id["\s:]+["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
                                            let m2;
                                            while ((m2 = reGrok.exec(str))) addUuid(m2[1], false, 'diy-fiber');
                                            const reUrl = /grok\.com\/imagine\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
                                            while ((m2 = reUrl.exec(str))) addUuid(m2[1], false, 'diy-fiber');
                                        }
                                    } catch {}
                                    fiber = fiber.return;
                                    d++;
                                }
                            }
                        } catch {}
                    }
                } catch {}
            });

            // --- 3) Fallback: filename UUID ---
            // _generated_UUID is a strong Grok signature → treat as medium confidence
            article.querySelectorAll('img[src*="pbs.twimg.com"], img[src*="twimg.com/media"], video').forEach(media => {
                const urls = [];
                if (media.src) urls.push(media.src);
                if (media.currentSrc) urls.push(media.currentSrc);
                if (media.srcset) {
                    media.srcset.split(',').forEach(p => {
                        const u = p.trim().split(/\s+/)[0];
                        if (u) urls.push(u);
                    });
                }
                if (media.tagName === 'VIDEO') {
                    media.querySelectorAll('source').forEach(s => s.src && urls.push(s.src));
                }
                for (const u of urls) {
                    const fromName = extractUuidFromFilename(u, media.tagName === 'VIDEO');
                    if (fromName) {
                        const isGenerated = /_generated_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(u);
                        addUuid(fromName, media.tagName === 'VIDEO', isGenerated ? 'filename-generated' : 'filename');
                    }
                }
            });

            return results;
        }

        function findMediaBlock(article) {
            const photos = [...article.querySelectorAll('[data-testid="tweetPhoto"]')];
            const videos = [...article.querySelectorAll('[data-testid="videoComponent"], [data-testid="videoPlayer"]')];
            const mediaEls = [...photos, ...videos];

            if (!mediaEls.length) {
                const img = article.querySelector('img[src*="pbs.twimg.com/media"], img[src*="twimg.com/media"], video');
                if (!img) return null;
                mediaEls.push(img);
            }

            let block = mediaEls[0];
            for (let i = 0; i < 10 && block && block !== article; i++) {
                const parent = block.parentElement;
                if (!parent || parent === article) break;
                const allInside = mediaEls.every(m => parent.contains(m));
                if (allInside) {
                    block = parent;
                } else {
                    break;
                }
            }
            return block;
        }

        function findActionBar(article) {
            const groups = article.querySelectorAll('[role="group"]');
            for (const g of groups) {
                if (
                    g.querySelector('[data-testid="reply"]') ||
                    g.querySelector('[data-testid="retweet"]') ||
                    g.querySelector('[data-testid="like"]') ||
                    g.querySelector('a[href*="/analytics"]')
                ) {
                    return g;
                }
            }
            return null;
        }

        function addThumbsBelowMedia(article, items) {
            const existing = article.querySelector('.grok-thumbs-below');
            if (existing) {
                const currentCount = existing.querySelectorAll('.grok-thumb-item').length;
                if (currentCount >= items.length) return;
                existing.remove();
            }

            const wrap = document.createElement('div');
            wrap.className = 'grok-thumbs-below';
            if (!iconsVisible) wrap.style.display = 'none';

            items.forEach(({ uuid, isVideo, thumb, conf, missingThumb }) => {
                const item = document.createElement('div');
                const noThumb = !thumb;
                item.className = 'grok-thumb-item' + (noThumb ? ' placeholder' : '') + (missingThumb || noThumb ? ' missing-thumb' : '');
                item.title = `Click for details\n${uuid}` + (noThumb ? '\n(Missing Thumbnail)' : '');

                if (thumb) {
                    const img = document.createElement('img');
                    img.src = thumb;
                    img.loading = 'lazy';
                    img.alt = '';
                    item.appendChild(img);
                } else if (missingThumb || noThumb) {
                    const miss = document.createElement('span');
                    miss.className = 'ph-missing';
                    miss.textContent = 'Missing\nThumbnail';
                    item.appendChild(miss);
                } else {
                    const icon = document.createElement('span');
                    icon.className = 'ph-icon';
                    icon.textContent = '🔍';
                    item.appendChild(icon);
                    const label = document.createElement('span');
                    label.className = 'ph-label';
                    label.textContent = conf === 'high' ? 'Grok' : 'UUID';
                    item.appendChild(label);
                }

                if (isVideo) {
                    const badge = document.createElement('span');
                    badge.className = 'badge';
                    badge.textContent = '▶';
                    item.appendChild(badge);
                }

                item.onclick = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    showLupaDetailPanel(item, uuid, {
                        thumb: thumb || null,
                        isVideo: !!isVideo
                    });
                };

                wrap.appendChild(item);
            });

            const actionBar = findActionBar(article);
            if (actionBar && actionBar.parentNode) {
                actionBar.parentNode.insertBefore(wrap, actionBar);
                return;
            }

            const mediaBlock = findMediaBlock(article);
            if (mediaBlock && mediaBlock.parentNode) {
                if (mediaBlock.nextSibling) {
                    mediaBlock.parentNode.insertBefore(wrap, mediaBlock.nextSibling);
                } else {
                    mediaBlock.parentNode.appendChild(wrap);
                }
                return;
            }

            article.appendChild(wrap);
        }

        // Confidence labels (UI only); validity is decided by post URL (no redirect)
        const HIGH_CONF = new Set(['fiber-grok_post_id', 'direct-link']);
        const MED_CONF = new Set(['fiber-context', 'diy-href', 'diy-attr', 'diy-fiber', 'filename-generated']);

        async function processTweet(article) {
            if (processed.has(article) && article.querySelector('.grok-thumbs-below')) {
                return;
            }

            const hasMedia = article.querySelector(
                '[data-testid="tweetPhoto"],[data-testid="videoComponent"],[data-testid="videoPlayer"],img[src*="pbs.twimg.com/media"]'
            );
            const hasDiyHint = /faça\s*voc|make\s*your\s*own|try\s*it\s*yourself|try\s*grok|remix|grok\.com\/imagine|create\s*your\s*own/i.test(
                article.textContent || ''
            );
            if (!hasMedia && !hasDiyHint) return;

            const objs = extractMediaObjects(article);
            if (!objs.length) return;

            processed.add(article);

            const checks = await Promise.all(
                objs.map(async (o) => {
                    const conf = HIGH_CONF.has(o.source) ? 'high' :
                                 MED_CONF.has(o.source) ? 'med' : 'low';
                    try {
                        const result = await validateUUID(o.uuid);
                        // Only show when post page is valid (did not redirect away)
                        if (!result || !result.ok) return null;
                        return {
                            uuid: o.uuid,
                            isVideo: o.isVideo,
                            thumb: result.thumb || null,
                            missingThumb: !!result.missingThumb,
                            source: o.source,
                            conf
                        };
                    } catch {
                        return null;
                    }
                })
            );

            const seenValid = new Set();
            const validItems = [];
            for (const item of checks) {
                if (!item || !item.uuid) continue;
                const u = item.uuid.toLowerCase();
                if (seenValid.has(u)) continue;
                seenValid.add(u);
                validItems.push(item);
            }

            if (validItems.length > 0) {
                addThumbsBelowMedia(article, validItems);
            }
        }

        function scanX() {
            if (scanning) return;
            scanning = true;
            const articles = document.querySelectorAll('article[data-testid="tweet"]');
            const vh = window.innerHeight;
            const tasks = [];
            for (const article of articles) {
                if (processed.has(article) && article.querySelector('.grok-thumbs-below')) continue;
                const rect = article.getBoundingClientRect();
                if (rect.bottom < -vh || rect.top > vh * 2) continue;
                tasks.push(processTweet(article));
            }
            Promise.allSettled(tasks).finally(() => { scanning = false; });
        }

        function schedule() {
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                scanX();
            }, 250);
        }

        new MutationObserver(muts => {
            for (const m of muts) {
                if (m.type !== 'childList') continue;
                for (const n of m.addedNodes) {
                    if (n.nodeType !== 1) continue;
                    if (
                        n.matches?.('article[data-testid="tweet"]') ||
                        n.querySelector?.('article[data-testid="tweet"]')
                    ) {
                        schedule();
                        return;
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });

        window.addEventListener('scroll', schedule, { passive: true });
        setInterval(scanX, 3000);
        setTimeout(scanX, 500);
        setTimeout(scanX, 1500);
    } else {
        // Sites genéricos – agora com validação de UUID via /image
        new MutationObserver(muts => {
            let need = false;
            for (const m of muts) {
                if (m.type === 'childList') {
                    for (const n of m.addedNodes) {
                        if (n.nodeType !== 1) continue;
                        if (n.tagName === 'IFRAME' && isRedgifsUrl(n.src || n.getAttribute('src'))) continue;
                        if (n.querySelector?.('iframe[src*="redgifs"]')) continue;
                        need = true;
                        break;
                    }
                } else if (m.type === 'attributes' && (m.target.tagName === 'VIDEO' || m.target.tagName === 'IMG')) {
                    if (!isInsideRedgifs(m.target) && !isRedgifsUrl(m.target.src)) processMedia(m.target);
                }
            }
            if (need) scan();
        }).observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'srcset', 'data-src', 'data-original']
        });

        ['loadstart', 'loadedmetadata', 'load', 'canplay'].forEach(evt => {
            document.addEventListener(evt, e => {
                if ((e.target.tagName === 'VIDEO' || e.target.tagName === 'IMG') &&
                    !isInsideRedgifs(e.target) && !isRedgifsUrl(e.target.src || e.target.currentSrc)) {
                    processMedia(e.target);
                }
            }, true);
        });

        scan();
        [600, 1500, 3000, 6000, 10000].forEach(t => setTimeout(scan, t));
        let ticks = 0;
        const keep = setInterval(() => {
            scan();
            if (++ticks > 5) clearInterval(keep);
        }, 5000);
    }

    // ========== SCRIPT 3: Reddit thumbs (old listing + www r/ + comments) ==========
    // Hard-resets on every URL change. Same validateUUID + detail panel as X/Lupa.
    (function redditGrokThumbs() {
        const isOldReddit = host === 'old.reddit.com' || host.endsWith('.old.reddit.com');
        const isNewReddit = host === 'www.reddit.com' || host === 'reddit.com' ||
            (host.endsWith('.reddit.com') && !isOldReddit && !host.includes('old.'));
        if (!isOldReddit && !isNewReddit) return;
        if (/\/submit|\/wiki|\/about|\/settings|\/message|\/user\//i.test(location.pathname)) return;

        // New Reddit: subreddit feed /r/{name}/[hot|new|top…] OR comment threads
        function isNewRedditSubFeed() {
            return isNewReddit && /^\/r\/[^/]+\/?(?:hot|new|top|rising|controversial)?\/?$/.test(location.pathname);
        }
        function isNewRedditCommentsPath() {
            return isNewReddit && /\/r\/[^/]+\/comments\//.test(location.pathname);
        }
        if (isNewReddit && !isNewRedditSubFeed() && !isNewRedditCommentsPath()) return;

        const UUID_RE_RD = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const MAX_POSTS = 25;           // old.reddit listing batch
        const NEW_FEED_CONCURRENCY = 4; // parallel text fetches on infinite feed
        const FETCH_DELAY = 1200;
        const MORE_DELAY = 800;
        const MAX_MORE_BATCHES = 4;
        const STORAGE_KEY = 'grokThumbsPermanent_v2';
        const MAX_CACHE_ENTRIES = 4000;

        let processedUrls = new Set();
        let lastPageKey = '';
        let rateLimitedUntil = 0;
        let lastHref = '';
        let runGen = 0;
        // Infinite feed queue (new reddit /r/)
        let feedQueue = [];
        let feedActive = 0;
        const feedQueuedIds = new Set();
        const feedDoneIds = new Set();

        function isCommentsPage() {
            return /\/r\/[^/]+\/comments\//.test(location.pathname);
        }

        function loadPermanent() {
            try {
                const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
                return data && typeof data === 'object' ? data : {};
            } catch {
                return {};
            }
        }

        function savePermanent(cache) {
            try {
                const keys = Object.keys(cache);
                if (keys.length > MAX_CACHE_ENTRIES) {
                    keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
                    keys.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach(k => delete cache[k]);
                }
                localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
            } catch (e) {
                console.debug('[Grok Thumbs Reddit] cache write fail', e);
            }
        }

        function cacheKeyFromCommentsUrl(url) {
            try {
                const u = new URL(url, location.origin);
                const parts = u.pathname.split('/').filter(Boolean);
                const i = parts.indexOf('comments');
                if (i !== -1 && parts[i + 1]) return parts[i + 1].toLowerCase();
                return u.pathname;
            } catch {
                return String(url);
            }
        }

        function remember(postId, uuids, scannedComments) {
            const cache = loadPermanent();
            const prev = cache[postId] || { uuids: [], scannedComments: false };
            const merged = [...new Set([...(prev.uuids || []), ...uuids.map(x => String(x).toLowerCase())])];
            cache[postId] = {
                uuids: merged,
                scannedComments: !!(prev.scannedComments || scannedComments),
                ts: Date.now()
            };
            savePermanent(cache);
            return cache[postId];
        }

        function recall(postId) {
            return loadPermanent()[postId] || null;
        }

        function decodeEntities(s) {
            return String(s || '')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/\\\//g, '/')
                .replace(/\\u002[fF]/g, '/');
        }

        function expandEncodings(text) {
            const parts = [decodeEntities(text)];
            try { parts.push(decodeURIComponent(parts[0].replace(/\+/g, ' '))); } catch {}
            try { parts.push(decodeURIComponent(parts[parts.length - 1])); } catch {}
            return parts.join('\n');
        }

        function extractUUIDsFromText(text) {
            const decoded = expandEncodings(text);
            const uuids = new Set();
            const patterns = [
                /(?:https?:\/\/)?(?:www\.)?grok\.com\/imagine\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /(?:https?:\/\/)?(?:www\.)?grok\.com\/post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /(?:https?:\/\/)?(?:www\.)?assets\.grok\.com\/[^\s"'<>]*?(?:post|imagine)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
                /out\.reddit\.com\/[^\s"'<>]*?grok\.com\/(?:imagine\/)?post\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
            ];
            patterns.forEach(re => {
                let m;
                re.lastIndex = 0;
                while ((m = re.exec(decoded)) !== null) {
                    if (m[1] && UUID_RE_RD.test(m[1])) uuids.add(m[1].toLowerCase());
                }
            });
            return [...uuids];
        }

        function harvestNode(el, chunks) {
            if (!el) return;
            chunks.push(el.outerHTML || '');
            chunks.push(el.innerHTML || '');
            chunks.push(el.textContent || '');
            if (el.getAttribute) {
                ['href', 'data-url', 'data-href', 'data-inbound-url', 'title'].forEach(a => {
                    const v = el.getAttribute(a);
                    if (v) chunks.push(v);
                });
            }
        }

        function extractUUIDsFromThing(thing) {
            const chunks = [];
            ['data-url', 'data-permalink', 'data-inbound-url'].forEach(attr => {
                const v = thing.getAttribute(attr);
                if (v) chunks.push(v);
            });
            harvestNode(thing, chunks);
            thing.querySelectorAll('a, .md, .usertext-body, .expando, a.title, .title').forEach(el => harvestNode(el, chunks));
            return extractUUIDsFromText(chunks.join('\n'));
        }

        function extractUUIDsFromCommentsDom(root) {
            const scope = root || document;
            const chunks = [];
            scope.querySelectorAll(
                '.comment, .comment .md, .comment .usertext-body, .sitetable.nestedlisting .md, a[href*="grok"], a[href*="reddit.com/outgoing"]'
            ).forEach(el => harvestNode(el, chunks));
            return extractUUIDsFromText(chunks.join('\n'));
        }

        function collectMoreIds(node, out) {
            if (!node) return;
            if (Array.isArray(node)) return node.forEach(n => collectMoreIds(n, out));
            if (typeof node !== 'object') return;
            if (node.kind === 'more' && node.data && Array.isArray(node.data.children)) {
                node.data.children.forEach(id => { if (id && id !== '_') out.add(id); });
            }
            Object.values(node).forEach(v => collectMoreIds(v, out));
        }

        function walkJsonForUuids(node, out) {
            if (!node) return;
            if (typeof node === 'string') {
                extractUUIDsFromText(node).forEach(u => out.add(u));
                return;
            }
            if (Array.isArray(node)) return node.forEach(n => walkJsonForUuids(n, out));
            if (typeof node === 'object') Object.values(node).forEach(v => walkJsonForUuids(v, out));
        }

        function getPageKey() {
            if (isNewReddit) return location.pathname + location.search;
            const firstThing = document.querySelector('#siteTable .thing.link, .linklisting .thing.link');
            const firstId = firstThing ? firstThing.getAttribute('data-fullname') || firstThing.id : '';
            return location.pathname + location.search + '|' + firstId;
        }

        /** Full hard reset — as if the script just loaded for the first time */
        function hardReset() {
            runGen++;
            processedUrls = new Set();
            lastPageKey = getPageKey();
            rateLimitedUntil = 0;
            feedQueue = [];
            feedActive = 0;
            feedQueuedIds.clear();
            feedDoneIds.clear();
            try { if (typeof hideLupaPanel === 'function') hideLupaPanel(); } catch {}
            try { lupaFixedPos = null; } catch {}
            document.querySelectorAll('.grok-thumbs-container').forEach(el => el.remove());
            document.querySelectorAll('.thing.link[data-grok-processed], [data-grok-feed-processed]').forEach(el => {
                delete el.dataset.grokProcessed;
                delete el.dataset.grokFeedProcessed;
            });
            console.debug('[Grok Thumbs Reddit] hard reset gen=' + runGen, location.href);
        }

        /** Same validation + UI semantics as X/Lupa: /rest/assets + optional /image */
        function createThumbnails(uuids) {
            if (!uuids.length) return null;
            const container = document.createElement('div');
            container.className = 'grok-thumbs-container';
            container.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 4px 5px;padding:4px 0;clear:both;';

            uuids.forEach(uuid => {
                const item = document.createElement('div');
                item.className = 'grok-thumb-item placeholder';
                item.title = `Click for details\n${uuid}`;
                item.style.cssText = [
                    'position:relative', 'width:64px', 'height:64px', 'border-radius:8px',
                    'overflow:hidden', 'cursor:pointer', 'flex-shrink:0',
                    'border:1px solid rgba(255,255,255,0.12)', 'background:#1a1a22',
                    'display:flex', 'align-items:center', 'justify-content:center',
                    'touch-action:manipulation'
                ].join(';');

                const loading = document.createElement('span');
                loading.style.cssText = 'font-size:9px;color:rgba(255,255,255,.5);text-align:center;line-height:1.2;';
                loading.textContent = '…';
                item.appendChild(loading);

                let thumbUrl = null;

                item.addEventListener('click', e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof showLupaDetailPanel === 'function') {
                        showLupaDetailPanel(item, uuid, { thumb: thumbUrl });
                    } else {
                        window.open(MAKE_IMAGINE_LINK(uuid), '_blank');
                    }
                });

                // Reddit: previous working logic — validate via /image only (like old Lupa)
                (async () => {
                    const key = String(uuid).toLowerCase();
                    let thumb = null;
                    try {
                        if (thumbCache.has(key)) {
                            const cached = thumbCache.get(key);
                            if (cached && cached.ok && cached.thumb) thumb = cached.thumb;
                            else if (typeof cached === 'string') thumb = cached;
                            else if (!cached) {
                                item.remove();
                                return;
                            }
                        } else {
                            thumb = await new Promise(resolve => {
                                GM_xmlhttpRequest({
                                    method: 'GET',
                                    url: MAKE_THUMB_LINK(key),
                                    responseType: 'blob',
                                    timeout: 7000,
                                    onload(res) {
                                        if (res.status < 200 || res.status >= 300 || !res.response) {
                                            thumbCache.set(key, null);
                                            resolve(null);
                                            return;
                                        }
                                        const blob = res.response;
                                        const type = (blob.type || '').toLowerCase();
                                        if (type.startsWith('image/') && blob.size > 1500) {
                                            const url = URL.createObjectURL(blob);
                                            thumbCache.set(key, { ok: true, thumb: url, missingThumb: false });
                                            resolve(url);
                                            return;
                                        }
                                        const reader = new FileReader();
                                        reader.onload = () => {
                                            const text = (reader.result || '').toLowerCase();
                                            const isError =
                                                text.includes('media post not found') ||
                                                text.includes('post not found') ||
                                                text.includes('not found') ||
                                                text.includes('<!doctype') ||
                                                text.includes('<html');
                                            if (isError || blob.size < 2000) {
                                                thumbCache.set(key, null);
                                                resolve(null);
                                            } else {
                                                const url = URL.createObjectURL(blob);
                                                thumbCache.set(key, { ok: true, thumb: url, missingThumb: false });
                                                resolve(url);
                                            }
                                        };
                                        reader.onerror = () => { thumbCache.set(key, null); resolve(null); };
                                        reader.readAsText(blob.slice(0, 2500));
                                    },
                                    onerror() { thumbCache.set(key, null); resolve(null); },
                                    ontimeout() { thumbCache.set(key, null); resolve(null); }
                                });
                            });
                        }
                    } catch {}
                    if (!thumb) {
                        item.remove();
                        return;
                    }
                    thumbUrl = thumb;
                    item.innerHTML = '';
                    item.className = 'grok-thumb-item';
                    item.style.background = '#1a1a22';
                    const img = document.createElement('img');
                    img.src = thumb;
                    img.alt = '';
                    img.loading = 'lazy';
                    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
                    item.appendChild(img);
                })();
                container.appendChild(item);
            });
            return container;
        }

        function insertThumbs(postElement, container) {
            const old = postElement.querySelector('.grok-thumbs-container');
            if (old) old.remove();
            const entry = postElement.querySelector('.entry');
            (entry || postElement).appendChild(container);
        }

        function applyUuids(thing, uuids) {
            if (uuids && uuids.length) {
                const thumbs = createThumbnails(uuids);
                if (thumbs) insertThumbs(thing, thumbs);
            }
        }

        async function safeFetch(url, options = {}) {
            if (Date.now() < rateLimitedUntil) {
                await new Promise(r => setTimeout(r, rateLimitedUntil - Date.now()));
            }
            try {
                const res = await fetch(url, options);
                if (res.status === 429) {
                    const retryAfter = 30000 + Math.random() * 30000;
                    rateLimitedUntil = Date.now() + retryAfter;
                    console.warn('[Grok Thumbs Reddit] 429 — pause', Math.round(retryAfter / 1000), 's');
                    return null;
                }
                return res;
            } catch (e) {
                console.debug('[Grok Thumbs Reddit] fetch error', e);
                return null;
            }
        }

        async function fetchMoreChildren(linkId, ids) {
            const uniq = [...new Set(ids)].filter(Boolean);
            const found = new Set();
            for (let i = 0; i < uniq.length && i / 100 < MAX_MORE_BATCHES; i += 100) {
                const batch = uniq.slice(i, i + 100);
                const params = new URLSearchParams({
                    api_type: 'json',
                    link_id: linkId.startsWith('t3_') ? linkId : 't3_' + linkId,
                    children: batch.join(','),
                    limit_children: 'false'
                });
                const res = await safeFetch(location.origin + '/api/morechildren.json?' + params.toString(), {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' }
                });
                if (!res || !res.ok) continue;
                try {
                    const data = await res.json();
                    walkJsonForUuids(data, found);
                } catch {}
                await new Promise(r => setTimeout(r, MORE_DELAY));
            }
            return [...found];
        }

        async function fetchUuidsFromComments(commentsUrl, postId) {
            const bag = new Set();
            const moreIds = new Set();
            let scanned = false;
            const jsonUrl = commentsUrl.replace(/\/+$/, '') + '.json?limit=200&raw_json=1';

            const resJson = await safeFetch(jsonUrl, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' }
            });
            if (resJson && resJson.ok) {
                try {
                    const text = await resJson.text();
                    extractUUIDsFromText(text).forEach(u => bag.add(u));
                    const data = JSON.parse(text);
                    walkJsonForUuids(data, bag);
                    collectMoreIds(data, moreIds);
                    scanned = true;
                } catch {}
            }

            if (bag.size === 0 && Date.now() >= rateLimitedUntil) {
                const resHtml = await safeFetch(commentsUrl, {
                    credentials: 'same-origin',
                    headers: { Accept: 'text/html' }
                });
                if (resHtml && resHtml.ok) {
                    try {
                        const html = await resHtml.text();
                        extractUUIDsFromText(html).forEach(u => bag.add(u));
                        scanned = true;
                        const moreRe = /data-children="([^"]+)"/gi;
                        let mm;
                        while ((mm = moreRe.exec(html)) !== null) {
                            mm[1].split(',').forEach(id => moreIds.add(id));
                        }
                    } catch {}
                }
            }

            if (moreIds.size && Date.now() >= rateLimitedUntil) {
                const extra = await fetchMoreChildren('t3_' + postId, [...moreIds]);
                extra.forEach(u => bag.add(u));
            }

            return { uuids: [...bag], scanned };
        }

        /**
         * Lightweight "view source" scan: fetch comments as text (JSON preferred, HTML fallback).
         * No iframes, no rendering — only the raw body for UUID regex (like Ctrl+U).
         */
        async function verifyFromCommentsSource(commentsUrl, postId) {
            const { uuids, scanned } = await fetchUuidsFromComments(commentsUrl, postId);
            return { uuids, scanned };
        }

        async function processPostSurface(thing) {
            if (thing.dataset.grokProcessed) return null;
            thing.dataset.grokProcessed = '1';

            const commentsA = thing.querySelector('a.comments, a.bylink.comments');
            const permalink = thing.getAttribute('data-permalink');
            const commentsUrl = commentsA
                ? commentsA.href
                : (permalink ? location.origin + permalink : location.href);

            const postId = cacheKeyFromCommentsUrl(commentsUrl);
            const cached = recall(postId);
            const bag = new Set(cached && cached.uuids ? cached.uuids : []);

            extractUUIDsFromThing(thing).forEach(u => bag.add(u));
            if (isCommentsPage()) extractUUIDsFromCommentsDom(document).forEach(u => bag.add(u));

            applyUuids(thing, [...bag]);

            // Comments page itself: surface is enough (page is already open)
            if (isCommentsPage()) {
                remember(postId, [...bag], true);
                return null;
            }

            if (!commentsUrl.includes('/comments/')) return null;
            if (cached && cached.scannedComments) return null;
            if (processedUrls.has(commentsUrl)) return null;
            processedUrls.add(commentsUrl);

            return { thing, commentsUrl, postId, bag };
        }

        async function processPostWithSource(job, gen) {
            if (!job || gen !== runGen) return;
            const { thing, commentsUrl, postId, bag } = job;
            const { uuids, scanned } = await verifyFromCommentsSource(commentsUrl, postId);
            if (gen !== runGen) return;
            uuids.forEach(u => bag.add(u));
            remember(postId, [...bag], scanned);
            applyUuids(thing, [...bag]);
        }

        /** old.reddit listing: parallel text fetch of up to 25 comment threads (no iframes) */
        async function runOldListingSourceBatches(gen) {
            const posts = [...document.querySelectorAll('#siteTable .thing.link, .linklisting .thing.link')]
                .slice(0, MAX_POSTS);

            // 1) Surface extract + collect jobs that need comment verification
            const jobs = [];
            for (const thing of posts) {
                if (gen !== runGen) return;
                const job = await processPostSurface(thing);
                if (job) jobs.push(job);
            }

            // 2) Fetch comment source text in parallel (JSON/HTML — like view-source)
            if (jobs.length) {
                console.debug(
                    '[Grok Thumbs Reddit] fetching comment source for',
                    jobs.length,
                    'posts in parallel (text only, no iframes)'
                );
                await Promise.all(jobs.map(job => processPostWithSource(job, gen)));
            }
        }

        function insertThumbsNearNewPost(postEl, container) {
            if (!postEl || !container) return;
            const old = postEl.parentElement?.querySelector(
                `:scope > .grok-thumbs-container[data-for="${container.dataset.for || ''}"]`
            );
            // Remove previous thumbs for this post id
            const pid = container.dataset.for;
            if (pid) {
                postEl.parentElement?.querySelectorAll(`.grok-thumbs-container[data-for="${pid}"]`)
                    .forEach(el => el.remove());
            }
            container.style.margin = '8px 0 12px 0';
            container.style.paddingLeft = '8px';
            // Place after the post element
            if (postEl.nextSibling) {
                postEl.parentElement.insertBefore(container, postEl.nextSibling);
            } else {
                postEl.parentElement.appendChild(container);
            }
        }

        function getNewRedditPostElements() {
            return [...document.querySelectorAll(
                'shreddit-post, [data-testid="post-container"], article[id^="t3_"], div[data-fullscreen-id^="t3_"]'
            )];
        }

        function getNewPostPermalink(el) {
            if (!el) return null;
            const attr =
                el.getAttribute('permalink') ||
                el.getAttribute('content-href') ||
                el.getAttribute('href');
            if (attr && /\/comments\//.test(attr)) {
                try {
                    return new URL(attr, location.origin).href;
                } catch {
                    return location.origin + (attr.startsWith('/') ? attr : '/' + attr);
                }
            }
            const a =
                el.querySelector('a[slot="full-post-link"]') ||
                el.querySelector('a[href*="/comments/"]') ||
                el.querySelector('a[data-click-id="body"]');
            if (a && a.href && /\/comments\//.test(a.href)) return a.href;
            // shreddit-post id often t3_xxx
            const id = el.getAttribute('id') || el.getAttribute('post-id') || '';
            const m = id.match(/t3_([a-z0-9]+)/i);
            if (m) {
                const sub = location.pathname.match(/^\/r\/([^/]+)/);
                if (sub) return `${location.origin}/r/${sub[1]}/comments/${m[1]}/`;
            }
            return null;
        }

        function getNewPostId(el, permalink) {
            if (permalink) return cacheKeyFromCommentsUrl(permalink);
            const id = el.getAttribute('id') || el.getAttribute('post-id') || '';
            const m = id.match(/t3_([a-z0-9]+)/i);
            return m ? m[1].toLowerCase() : (id || Math.random().toString(36)).toLowerCase();
        }

        function harvestNewPostSurface(el) {
            const bag = new Set();
            try {
                const html = el.outerHTML || '';
                extractUUIDsFromText(html).forEach(u => bag.add(u));
                el.querySelectorAll('a[href*="grok"]').forEach(a => {
                    extractUUIDsFromText(a.href || '').forEach(u => bag.add(u));
                });
            } catch {}
            return [...bag];
        }

        function applyUuidsToNewPost(el, postId, uuids) {
            if (!uuids.length) return;
            const thumbs = createThumbnails(uuids);
            if (!thumbs) return;
            thumbs.dataset.for = postId;
            thumbs.dataset.redditNew = '1';
            insertThumbsNearNewPost(el, thumbs);
        }

        function pumpFeedQueue() {
            while (feedActive < NEW_FEED_CONCURRENCY && feedQueue.length) {
                const job = feedQueue.shift();
                if (!job || feedDoneIds.has(job.postId)) continue;
                feedActive++;
                (async () => {
                    const gen = runGen;
                    try {
                        if (Date.now() < rateLimitedUntil) {
                            // re-queue later
                            feedQueue.push(job);
                            return;
                        }
                        const { uuids, scanned } = await fetchUuidsFromComments(job.permalink, job.postId);
                        if (gen !== runGen) return;
                        const bag = new Set(job.surfaceUuids || []);
                        uuids.forEach(u => bag.add(u));
                        remember(job.postId, [...bag], scanned);
                        feedDoneIds.add(job.postId);
                        if (job.el.isConnected) {
                            applyUuidsToNewPost(job.el, job.postId, [...bag]);
                        }
                    } catch (e) {
                        console.debug('[Grok Thumbs Reddit] feed job fail', e);
                    } finally {
                        feedActive--;
                        if (gen === runGen) pumpFeedQueue();
                    }
                })();
            }
        }

        function enqueueFeedJob(job, priority) {
            if (!job || !job.postId || feedDoneIds.has(job.postId) || feedQueuedIds.has(job.postId)) return;
            feedQueuedIds.add(job.postId);
            if (priority) feedQueue.unshift(job);
            else feedQueue.push(job);
            pumpFeedQueue();
        }

        /** Infinite /r/ feed: surface scan now, text-source comments in a light queue */
        function scanNewRedditFeed(gen) {
            if (gen !== runGen) return;
            const posts = getNewRedditPostElements();
            for (const el of posts) {
                if (gen !== runGen) return;
                if (el.dataset.grokFeedProcessed) continue;
                el.dataset.grokFeedProcessed = '1';

                const permalink = getNewPostPermalink(el);
                const postId = getNewPostId(el, permalink);
                const cached = recall(postId);
                const surface = harvestNewPostSurface(el);
                const bag = new Set([...(cached?.uuids || []), ...surface]);

                if (bag.size) applyUuidsToNewPost(el, postId, [...bag]);

                // Already fully scanned in a previous visit
                if (cached && cached.scannedComments) {
                    feedDoneIds.add(postId);
                    continue;
                }
                if (!permalink || !permalink.includes('/comments/')) continue;

                // Visible posts go first
                const rect = el.getBoundingClientRect();
                const visible = rect.bottom > 0 && rect.top < window.innerHeight + 200;
                enqueueFeedJob({
                    el,
                    permalink,
                    postId,
                    surfaceUuids: [...bag]
                }, visible);
            }
        }

        async function runNewRedditComments(gen) {
            if (gen !== runGen) return;

            const bag = new Set();
            document.querySelectorAll('a[href*="grok.com"]').forEach(a => {
                extractUUIDsFromText(a.href || '').forEach(u => bag.add(u));
            });
            extractUUIDsFromText(document.body ? document.body.innerHTML.slice(0, 500000) : '').forEach(u => bag.add(u));

            const postId = cacheKeyFromCommentsUrl(location.href);
            const cached = recall(postId);
            if (cached && cached.uuids) cached.uuids.forEach(u => bag.add(u));

            if (!cached || !cached.scannedComments) {
                if (Date.now() >= rateLimitedUntil) {
                    const { uuids, scanned } = await fetchUuidsFromComments(location.href, postId);
                    if (gen !== runGen) return;
                    uuids.forEach(u => bag.add(u));
                    remember(postId, [...bag], scanned);
                }
            }

            if (!bag.size) return;
            // Attach near OP on comments page
            const op = document.querySelector('shreddit-post') || document.querySelector('[data-testid="post-container"]');
            const thumbs = createThumbnails([...bag]);
            if (thumbs) {
                thumbs.dataset.for = postId;
                thumbs.dataset.redditNew = '1';
                if (op) insertThumbsNearNewPost(op, thumbs);
                else {
                    const main = document.querySelector('main') || document.body;
                    main.insertBefore(thumbs, main.firstChild);
                }
            }
        }

        async function run() {
            const currentKey = getPageKey();
            if (currentKey !== lastPageKey) {
                hardReset();
            }
            const gen = runGen;

            if (isNewReddit) {
                if (isNewRedditCommentsPath()) {
                    await runNewRedditComments(gen);
                } else if (isNewRedditSubFeed()) {
                    scanNewRedditFeed(gen);
                }
                return;
            }

            // old.reddit: parallel text fetch of up to 25 comment threads
            if (isCommentsPage()) {
                const posts = [...document.querySelectorAll('#siteTable .thing.link, .linklisting .thing.link')]
                    .filter(p => !p.dataset.grokProcessed)
                    .slice(0, 3);
                for (const thing of posts) {
                    if (gen !== runGen) return;
                    await processPostSurface(thing);
                }
                return;
            }

            await runOldListingSourceBatches(gen);
        }

        function isAllowedNewRedditUrl() {
            return isNewRedditSubFeed() || isNewRedditCommentsPath();
        }

        hardReset();
        lastHref = location.href;
        run();

        let debounceTimer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (location.href !== lastHref) {
                    lastHref = location.href;
                    if (isNewReddit && !isAllowedNewRedditUrl()) {
                        hardReset();
                        return;
                    }
                    hardReset();
                    setTimeout(run, 400);
                    return;
                }
                const newKey = getPageKey();
                if (newKey !== lastPageKey) hardReset();
                run();
            }, 900);
        });
        observer.observe(document.querySelector('#siteTable, .nestedlisting, shreddit-feed, faceplate-batch, main') || document.body, {
            childList: true,
            subtree: true
        });

        // Prioritize visible posts when scrolling the infinite feed
        let scrollTimer = null;
        window.addEventListener('scroll', () => {
            if (!isNewRedditSubFeed()) return;
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                if (runGen) scanNewRedditFeed(runGen);
            }, 400);
        }, { passive: true });

        setInterval(() => {
            if (location.href !== lastHref) {
                lastHref = location.href;
                if (isNewReddit && !isAllowedNewRedditUrl()) {
                    hardReset();
                    return;
                }
                hardReset();
                setTimeout(run, 600);
            }
        }, 600);

        window.addEventListener('popstate', () => {
            lastHref = location.href;
            hardReset();
            setTimeout(run, 400);
        });

        console.log(
            '%c[Grok Thumbs Reddit] Ativo — ' +
            (isOldReddit
                ? 'old.reddit: parallel source ≤25'
                : (isNewRedditSubFeed()
                    ? 'www.reddit /r/ feed (infinite queue, concurrency ' + NEW_FEED_CONCURRENCY + ')'
                    : 'www.reddit comments')) +
            ' | text-source | validateUUID | hard reset on URL change',
            'color:#fbbf24;font-weight:bold'
        );
    })();

    console.log('%c[Detective Lupa] Ativo – v2.2.2 | Grok 🔍 | thumbs toggle | panel on topDoc (iframes) | Created fixed | Reddit = 2.2', 'color:#00ff88;font-weight:bold');
})();

