// Кадрирование обложки сервера и канала: рамка 16:9, на выходе 960×540 — размер баннера Discord.
import { openModal, toast } from './overlays';
import { syncRange } from './util';

const OUT_W = 960;
const OUT_H = 540;

export type BannerCrop = { bytes: Uint8Array; name: string };

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Перетаскивание и масштаб. null — отмена. */
export function openBannerCrop(file: File): Promise<BannerCrop | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: BannerCrop | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    let baseScale = 1;
    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let nw = 0;
    let nh = 0;
    let ready = false;
    let frame: HTMLElement | null = null;
    let img: HTMLImageElement | null = null;
    let zoomEl: HTMLInputElement | null = null;

    const frameW = () => frame?.clientWidth || 480;
    const frameH = () => frame?.clientHeight || 270;

    const clampOffsets = () => {
      if (!img) return;
      const fw = frameW();
      const fh = frameH();
      const scale = baseScale * zoom;
      const minX = Math.min(0, fw - nw * scale);
      const minY = Math.min(0, fh - nh * scale);
      offsetX = Math.min(0, Math.max(minX, offsetX));
      offsetY = Math.min(0, Math.max(minY, offsetY));
    };

    const applyTransform = () => {
      if (!img) return;
      clampOffsets();
      const scale = baseScale * zoom;
      img.style.width = `${nw * scale}px`;
      img.style.height = `${nh * scale}px`;
      img.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    };

    const fitCover = () => {
      const fw = frameW();
      const fh = frameH();
      baseScale = Math.max(fw / nw, fh / nh);
      zoom = 1;
      if (zoomEl) zoomEl.value = '100';
      const dw = nw * baseScale;
      const dh = nh * baseScale;
      offsetX = (fw - dw) / 2;
      offsetY = (fh - dh) / 2;
      applyTransform();
    };

    const exportJpeg = (): BannerCrop | null => {
      if (!ready || !img || nw < 1 || nh < 1) return null;
      const fw = frameW();
      const fh = frameH();
      const scale = baseScale * zoom;
      const canvas = document.createElement('canvas');
      canvas.width = OUT_W;
      canvas.height = OUT_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      try {
        ctx.drawImage(img, -offsetX / scale, -offsetY / scale, fw / scale, fh / scale, 0, 0, OUT_W, OUT_H);
      } catch {
        return null;
      }
      const url = canvas.toDataURL('image/jpeg', 0.9);
      if (!url.startsWith('data:image/jpeg')) return null;
      return { bytes: dataUrlToBytes(url), name: 'banner.jpg' };
    };

    openModal({
      width: 560,
      cls: 'is-banner-crop',
      title: 'Кадрирование обложки',
      sub: 'Размер как у Discord: 960×540. Колёсико меняет масштаб, картинку можно двигать.',
      body: `<div class="cv2-bcrop">
        <div class="cv2-bcrop__frame"><img class="cv2-bcrop__img" alt="" draggable="false"></div>
        <label class="cv2-bcrop__tools"><span>Масштаб</span><input type="range" class="cv2-range" min="100" max="300" value="100" step="1"></label>
      </div>`,
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Применить',
          kind: 'primary',
          onClick: () => {
            const cropped = exportJpeg();
            if (!cropped) {
              toast('Не удалось обрезать изображение', 'error');
              return false;
            }
            finish(cropped);
          },
        },
      ],
      onClose: () => finish(null),
      onMount: (box) => {
        frame = box.querySelector('.cv2-bcrop__frame');
        img = box.querySelector('.cv2-bcrop__img');
        zoomEl = box.querySelector('.cv2-bcrop__tools input');
        if (!frame || !img || !zoomEl) {
          finish(null);
          return;
        }
        const frameEl = frame;
        const image = img;
        const range = zoomEl;

        const onZoom = () => {
          syncRange(range);
          const next = Math.max(1, Number(range.value) / 100);
          const fw = frameW();
          const fh = frameH();
          const cx = fw / 2;
          const cy = fh / 2;
          const imgX = (cx - offsetX) / (baseScale * zoom);
          const imgY = (cy - offsetY) / (baseScale * zoom);
          zoom = next;
          offsetX = cx - imgX * baseScale * zoom;
          offsetY = cy - imgY * baseScale * zoom;
          applyTransform();
        };
        const onDown = (e: PointerEvent) => {
          dragging = true;
          lastX = e.clientX;
          lastY = e.clientY;
          frameEl.classList.add('is-dragging');
          frameEl.setPointerCapture?.(e.pointerId);
        };
        const onMove = (e: PointerEvent) => {
          if (!dragging) return;
          offsetX += e.clientX - lastX;
          offsetY += e.clientY - lastY;
          lastX = e.clientX;
          lastY = e.clientY;
          applyTransform();
        };
        const onUp = () => {
          dragging = false;
          frameEl.classList.remove('is-dragging');
        };
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const next = Math.min(300, Math.max(100, Number(range.value) + (e.deltaY > 0 ? -5 : 5)));
          range.value = String(next);
          onZoom();
        };

        image.onload = () => {
          nw = image.naturalWidth || 1;
          nh = image.naturalHeight || 1;
          ready = true;
          requestAnimationFrame(fitCover);
        };
        image.onerror = () => {
          toast('Не удалось открыть изображение', 'error');
          finish(null);
        };

        range.addEventListener('input', onZoom);
        syncRange(range);
        frameEl.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        frameEl.addEventListener('wheel', onWheel, { passive: false });

        const reader = new FileReader();
        reader.onload = () => {
          image.src = String(reader.result || '');
        };
        reader.onerror = () => {
          toast('Не удалось прочитать файл', 'error');
          finish(null);
        };
        reader.readAsDataURL(file);
      },
    });
  });
}
