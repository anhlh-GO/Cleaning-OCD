# Cleaning ASMR — bản HTML5

Bản làm lại bằng HTML5 Canvas của game Unity `Cleaning.zip`, dùng nguyên asset gốc: sprite, animation Spine 4.1, âm thanh và font Duddy. Có đủ 35 level, chạy đúng thứ tự level của bản gốc (`GameLevelConfigSO`).

## Chạy game
Game cần một web server tĩnh, vì trình duyệt chặn `fetch` khi mở file trực tiếp qua `file://`. Ví dụ:

```bash
npx serve .
```

Mở `http://localhost:3000` trên điện thoại hoặc trình duyệt. Tham số `?lv=N` mở thẳng level thứ N.

## Tỉ lệ màn hình dọc
- Khung game luôn là màn dọc. Trên desktop khung khoá ở 9:16. Trên điện thoại khung dùng hết màn hình, với tỉ lệ từ 9:16 đến 9:21.
- Camera fit theo đúng logic `LevelViewPort` của Unity (`EnvelopWithCamera`, tức `min(halfW/aspect, halfH)`). Zoom vào vật thể dùng `targetSprite` + `padding` của từng bước.

## Cấu trúc
| Đường dẫn | Nội dung |
|---|---|
| `index.html` | Giao diện: HUD, thanh tiến độ, chọn level, popup thắng |
| `js/core.js` | Toán ma trận 2D, tween/easing, nạp asset, âm thanh WebAudio |
| `js/scene.js` | Scene graph từ prefab Unity: transform, SortingGroup/sorting layer, SpriteMask, collider, render Spine |
| `js/steps.js` | Bản port của các loại bước: Mask, DragAndDrop, Scrape, Blow, ClickObject, DragTool, Sweep, Vacuum, Pesticide, WaxTool, ScaleObject, FadeObject, ConnectTheDots, Click/Drag/DragTool-ToPlaySpine. Gồm cả `StepAnimationController` và gợi ý thao tác |
| `js/game.js` | LevelController: thứ tự bước, hiệu ứng viewport (zoom, fade, đổi nền), vòng lặp, input |
| `assets/levels/*.json` | 35 level đã chuyển từ prefab Unity |
| `assets/sp/` | Sprite đã cắt (WebP) |
| `assets/spine/` | Skeleton, atlas và texture Spine. Texture đã khử premultiplied alpha |
| `assets/audio/` | Âm thanh `.ogg` gốc |
| `vendor/spine-canvas.js` | Runtime Spine 4.1 cho Canvas |

## Ghi chú
- Particle System của Unity (bọt, nước phun...) không được port. Thay vào đó là hiệu ứng lấp lánh đơn giản khi chà.
- Bàn tay hướng dẫn gốc được thay bằng vòng gợi ý. Vòng này hiện sau khoảng 2,5 giây không thao tác.
- File `.ogg` không phát trên Safari đời cũ.
